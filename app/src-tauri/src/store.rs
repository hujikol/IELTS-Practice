// §8 native store. Owns every path and every write. The renderer never touches the
// filesystem: it sends allowlisted commands and receives records back.
//
// Durability contract (§8.2): write a unique temp file in the destination directory,
// fsync it, keep the last known-good snapshot, then rename over the target. A crash
// leaves either the old file or the new one, never a half-written store.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const STORE_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("no space left on device")]
    NoSpace,
    #[error("permission denied")]
    Permission,
    #[error("store is corrupt: {0}")]
    Corrupt(String),
    #[error("unsupported store version {0}")]
    UnsupportedVersion(u32),
    #[error("attempt not found")]
    NotFound,
    #[error("revision conflict")]
    Conflict,
    #[error("lifecycle does not allow this change")]
    Lifecycle,
    #[error("io error: {0}")]
    Io(String),
    /// §7.3 an identical envelope for the same accepted generation is a no-op. It gets
    /// its own variant so the UI can treat it as success, not as a failure to retry.
    #[error("identical material was already accepted")]
    Duplicate,
}

impl StoreError {
    /// §18.1 errors carry a stable code plus retryable, never raw io internals.
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoSpace => "no_space",
            Self::Permission => "permission_denied",
            Self::Corrupt(_) => "store_corrupt",
            Self::UnsupportedVersion(_) => "store_version_unsupported",
            Self::NotFound => "not_found",
            Self::Conflict => "revision_conflict",
            Self::Lifecycle => "not_preparing",
            Self::Io(_) => "store_unavailable",
            Self::Duplicate => "duplicate",
        }
    }

    /// A duplicate is not retryable and not an error to surface as one.
    pub fn retryable(&self) -> bool {
        matches!(self, Self::NoSpace | Self::Io(_))
    }
}

fn classify(e: &io::Error) -> StoreError {
    match e.kind() {
        io::ErrorKind::PermissionDenied => StoreError::Permission,
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => StoreError::NoSpace,
        _ => StoreError::Io(e.to_string()),
    }
}

// ─── Records ───
// Field names mirror src/lib/types.ts exactly; serde renames keep the wire format
// snake_case so the TypeScript types need no transformation layer.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportRef {
    pub sha256: String,
    pub accepted_at: i64,
    pub original_path: String,
    pub generation_id: String,
    pub contract_version: i64,
    pub envelope_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ImportHistoryEntry {
    pub sha256: String,
    pub accepted_at: i64,
    pub original_path: String,
    pub generation_id: String,
    pub contract_version: i64,
    pub envelope_version: i64,
    pub superseded_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JobRequest {
    pub generation_id: String,
    pub issued_at: i64,
    pub snapshot: String,
    pub contract_version: i64,
    pub envelope_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Attempt {
    pub id: String,
    pub owner_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub revision: i64,
    pub mode: String,
    pub status: String,
    pub data: serde_json::Value,
    #[serde(default)]
    pub requests: BTreeMap<String, JobRequest>,
    #[serde(default)]
    pub imports: BTreeMap<String, ImportRef>,
    #[serde(default)]
    pub import_history: BTreeMap<String, Vec<ImportHistoryEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_seed: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_map: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreFile {
    pub store_version: u32,
    pub attempts: BTreeMap<String, Attempt>,
}

impl StoreFile {
    pub fn empty() -> Self {
        Self {
            store_version: STORE_VERSION,
            attempts: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub id: String,
    pub mode: String,
    pub status: String,
    pub scope: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub revision: i64,
    pub prepared_count: usize,
    pub job_count: usize,
}

// ─── Durable write ───

/// The backup name for a store file. Both the writer and the recovery reader derive
/// it here: deriving it twice is how they silently drifted apart once already.
fn backup_name(stem: &str) -> String {
    format!("{stem}.previous.json")
}

/// Write `bytes` to `target` atomically: unique temp in the same directory, fsync,
/// then rename. The parent directory is fsynced where the platform allows it.
fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let dir = target
        .parent()
        .ok_or_else(|| StoreError::Io("no parent directory".into()))?;
    fs::create_dir_all(dir).map_err(|e| classify(&e))?;
    let stem = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("store");
    // Unique temp name so two processes can never collide on the same temp file.
    let temp = dir.join(format!(".{stem}.{}.tmp", std::process::id()));

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| classify(&e))?;
    file.write_all(bytes).map_err(|e| classify(&e))?;
    file.sync_all().map_err(|e| classify(&e))?;
    drop(file);

    // Keep the last known-good snapshot before replacing the live file.
    if target.exists() {
        let backup = dir.join(backup_name(stem));
        let _ = fs::copy(target, &backup);
    }

    if let Err(e) = fs::rename(&temp, target) {
        let _ = fs::remove_file(&temp);
        return Err(classify(&e));
    }
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_store(bytes: &[u8]) -> Result<StoreFile, StoreError> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| StoreError::Corrupt(e.to_string()))?;
    let version = value
        .get("store_version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    if version > STORE_VERSION {
        // Refuse a future store rather than overwriting data this build cannot read.
        return Err(StoreError::UnsupportedVersion(version));
    }
    serde_json::from_value(value).map_err(|e| StoreError::Corrupt(e.to_string()))
}

// ─── Store ───

pub struct Store {
    root: PathBuf,
    /// §8.2 one native write queue serializes read-modify-write. A renderer-side
    /// queue is not sufficient: two commands can interleave between read and write.
    guard: Mutex<()>,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            guard: Mutex::new(()),
        }
    }

    pub fn store_path(&self) -> PathBuf {
        self.root.join("attempts.json")
    }

    /// Must match the name `write_atomic` derives from the target stem, or recovery
    /// silently finds no backup and a corrupt store becomes total data loss.
    pub fn backup_path(&self) -> PathBuf {
        self.root.join(backup_name("attempts.json"))
    }

    pub fn imports_dir(&self) -> PathBuf {
        self.root.join("imports")
    }

    pub fn recordings_dir(&self) -> PathBuf {
        self.root.join("recordings")
    }

    /// Load the store, falling back to the backup when the main file is unreadable.
    /// A corrupt store opens recovery rather than silently becoming empty history.
    ///
    /// Takes the write lock. Callers that already hold it must use `read_unlocked`:
    /// the Mutex is not reentrant, so self-locking here deadlocks.
    pub fn load(&self) -> Result<StoreFile, StoreError> {
        let _held = self.lock()?;
        self.read_unlocked()
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>, StoreError> {
        self.guard
            .lock()
            .map_err(|_| StoreError::Io("store lock poisoned".into()))
    }

    /// Read without locking. Only safe for a caller already holding the guard.
    fn read_unlocked(&self) -> Result<StoreFile, StoreError> {
        match fs::read(self.store_path()) {
            Ok(bytes) => match parse_store(&bytes) {
                Ok(store) => Ok(store),
                Err(primary) => {
                    // Fall back rather than discard: an empty history would look like
                    // data loss to the user.
                    match fs::read(self.backup_path()) {
                        Ok(bytes) => parse_store(&bytes).or(Err(primary)),
                        Err(_) => Err(primary),
                    }
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(StoreFile::empty()),
            Err(e) => Err(classify(&e)),
        }
    }

    fn persist(&self, store: &StoreFile) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(store).map_err(|e| StoreError::Io(e.to_string()))?;
        write_atomic(&self.store_path(), &bytes)
    }

    pub fn list(&self) -> Result<Vec<AttemptSummary>, StoreError> {
        let store = self.load()?;
        let mut out: Vec<AttemptSummary> = store
            .attempts
            .values()
            .map(|a| {
                let prepared = a
                    .data
                    .get("prepared")
                    .and_then(|p| p.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                let jobs = a
                    .data
                    .get("jobs")
                    .and_then(|j| j.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                AttemptSummary {
                    id: a.id.clone(),
                    mode: a.mode.clone(),
                    status: a.status.clone(),
                    scope: a
                        .data
                        .get("scope")
                        .and_then(|s| s.as_str())
                        .map(str::to_string),
                    created_at: a.created_at,
                    updated_at: a.updated_at,
                    revision: a.revision,
                    prepared_count: prepared,
                    job_count: jobs,
                }
            })
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    pub fn load_attempt(&self, id: &str) -> Result<Attempt, StoreError> {
        let store = self.load()?;
        store.attempts.get(id).cloned().ok_or(StoreError::NotFound)
    }

    pub fn create(&self, attempt: Attempt) -> Result<Attempt, StoreError> {
        let _held = self
            .guard
            .lock()
            .map_err(|_| StoreError::Io("store lock poisoned".into()))?;
        let mut store = self.read_unlocked()?;
        if store.attempts.contains_key(&attempt.id) {
            return Err(StoreError::Conflict);
        }
        let mut record = attempt;
        record.created_at = now_ms();
        record.updated_at = record.created_at;
        record.revision = 0;
        store.attempts.insert(record.id.clone(), record.clone());
        self.persist(&store)?;
        Ok(record)
    }

    /// Every modifying command re-checks the expected revision. A mismatch means the
    /// renderer is acting on stale state and must reload rather than overwrite.
    pub fn commit(
        &self,
        id: &str,
        expected_revision: i64,
        mutate: impl FnOnce(&mut Attempt) -> Result<(), StoreError>,
    ) -> Result<Attempt, StoreError> {
        let _held = self
            .guard
            .lock()
            .map_err(|_| StoreError::Io("store lock poisoned".into()))?;
        let mut store = self.read_unlocked()?;
        let record = store.attempts.get_mut(id).ok_or(StoreError::NotFound)?;
        if record.revision != expected_revision {
            return Err(StoreError::Conflict);
        }
        mutate(record)?;
        record.revision += 1;
        record.updated_at = now_ms();
        let out = record.clone();
        self.persist(&store)?;
        Ok(out)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let _held = self
            .guard
            .lock()
            .map_err(|_| StoreError::Io("store lock poisoned".into()))?;
        let mut store = self.read_unlocked()?;
        if store.attempts.remove(id).is_none() {
            return Err(StoreError::NotFound);
        }
        self.persist(&store)
    }

    /// §8.2 asset-first commit: the immutable original is synced before metadata
    /// references it, so a failure leaves an orphan rather than a dangling reference.
    pub fn write_asset(&self, relative: &str, bytes: &[u8]) -> Result<String, StoreError> {
        let path = self.safe_join(relative)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| classify(&e))?;
        }
        write_atomic(&path, bytes)?;
        Ok(relative.to_string())
    }

    pub fn read_asset(&self, relative: &str) -> Result<Vec<u8>, StoreError> {
        let path = self.safe_join(relative)?;
        let mut buf = Vec::new();
        File::open(&path)
            .map_err(|_| StoreError::NotFound)?
            .read_to_end(&mut buf)
            .map_err(|e| classify(&e))?;
        Ok(buf)
    }

    /// Reject traversal and absolute paths. The renderer supplies only relative names.
    pub fn safe_join(&self, relative: &str) -> Result<PathBuf, StoreError> {
        if relative.is_empty() || relative.starts_with('/') || relative.contains("..") {
            return Err(StoreError::Io("unsafe path".into()));
        }
        Ok(self.root.join(relative))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn attempt(id: &str) -> Attempt {
        Attempt {
            id: id.into(),
            owner_id: "local".into(),
            created_at: 0,
            updated_at: 0,
            revision: 0,
            mode: "untimed".into(),
            status: "preparing".into(),
            data: json!({ "prepared": [], "jobs": [{ "key": "l0" }], "scope": "full" }),
            requests: BTreeMap::new(),
            imports: BTreeMap::new(),
            import_history: BTreeMap::new(),
            voice_seed: None,
            voice_map: None,
        }
    }

    #[test]
    fn creates_and_reloads_an_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        let loaded = store.load_attempt("a1").unwrap();
        assert_eq!(loaded.id, "a1");
        assert_eq!(loaded.revision, 0);
    }

    #[test]
    fn a_missing_store_loads_as_empty_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        assert!(store.load().unwrap().attempts.is_empty());
    }

    #[test]
    fn commit_increments_revision_and_rejects_a_stale_expectation() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        let updated = store.commit("a1", 0, |_| Ok(())).unwrap();
        assert_eq!(updated.revision, 1);
        // The renderer still believes revision 0.
        assert!(matches!(
            store.commit("a1", 0, |_| Ok(())),
            Err(StoreError::Conflict)
        ));
    }

    #[test]
    fn a_failed_mutation_leaves_no_revision_bump() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        let err = store
            .commit("a1", 0, |_| Err(StoreError::Lifecycle))
            .unwrap_err();
        assert_eq!(err.code(), "not_preparing");
        assert_eq!(store.load_attempt("a1").unwrap().revision, 0);
    }

    #[test]
    fn a_corrupt_main_store_falls_back_to_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        store.commit("a1", 0, |_| Ok(())).unwrap(); // writes the backup
        fs::write(store.store_path(), b"{ this is not json").unwrap();
        // Recovery must surface the earlier attempt, not an empty history.
        assert_eq!(store.load().unwrap().attempts.len(), 1);
    }

    #[test]
    fn a_future_store_version_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(store.store_path(), br#"{"store_version":99,"attempts":{}}"#).unwrap();
        assert!(matches!(
            store.load(),
            Err(StoreError::UnsupportedVersion(99))
        ));
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        for bad in ["../escape", "/etc/passwd", "a/../../b", ""] {
            assert!(store.safe_join(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn assets_round_trip_and_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store
            .write_asset("imports/a1/l0/original.json", b"{}")
            .unwrap();
        let reopened = Store::new(dir.path().to_path_buf());
        assert_eq!(
            reopened.read_asset("imports/a1/l0/original.json").unwrap(),
            b"{}"
        );
    }

    #[test]
    fn delete_removes_only_the_selected_attempt() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        store.create(attempt("a2")).unwrap();
        store.delete("a1").unwrap();
        let left = store.list().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "a2");
    }

    #[test]
    fn summaries_report_prepared_and_job_counts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        store.create(attempt("a1")).unwrap();
        let summary = &store.list().unwrap()[0];
        assert_eq!(summary.prepared_count, 0);
        assert_eq!(summary.job_count, 1);
        assert_eq!(summary.scope.as_deref(), Some("full"));
    }
}
