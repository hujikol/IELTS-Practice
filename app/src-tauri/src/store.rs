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
    /// §18.2 a path outside the store root, or an absolute/traversing asset name.
    #[error("unsafe path: {0}")]
    UnsafePath(String),
    #[error("io error: {0}")]
    Io(String),
    /// §7.3 an identical envelope for the same accepted generation is a no-op. It gets
    /// its own variant so the UI can treat it as success, not as a failure to retry.
    #[error("identical material was already accepted")]
    Duplicate,

    // ─── Lifecycle (§8.3) ───
    // One variant per illegal transition. A single shared "lifecycle" code cannot tell
    // the UI whether to reload a draft, re-open a session, or refuse a stale preview.
    #[error("attempt is not in preparation")]
    NotPreparing,
    #[error("attempt is not active")]
    NotActive,
    #[error("material is incomplete: {0}")]
    MaterialIncomplete(String),
    #[error("audio is not ready: {0}")]
    AudioNotReady(String),
    #[error("patch key is not allowed: {0}")]
    PatchRejected(String),
    /// A caller argument is out of range or internally inconsistent.
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("replacement was not confirmed")]
    ReplacementNotConfirmed,
    /// §18.1 deletion must be explicitly confirmed by the caller.
    #[error("deletion was not confirmed")]
    NotConfirmed,

    // ─── Archive (§8.4 / §18.3) ───
    /// `limit` is a stable token (`max_wav_bytes`, …) and `detail` is the human sentence.
    /// They are separate fields so the UI can branch on the token without parsing prose.
    #[error("archive limit exceeded: {limit}: {detail}")]
    LimitExceeded { limit: String, detail: String },
    #[error("archive checksum mismatch: {0}")]
    ChecksumMismatch(String),
    #[error("invalid archive: {0}")]
    ArchiveInvalid(String),
    #[error("archive collides with stored attempts: {0}")]
    ArchiveCollision(String),
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
            Self::UnsafePath(_) => "unsafe_path",
            Self::Io(_) => "store_unavailable",
            Self::Duplicate => "duplicate",
            Self::NotPreparing => "not_preparing",
            Self::NotActive => "not_active",
            Self::MaterialIncomplete(_) => "material_incomplete",
            Self::AudioNotReady(_) => "audio_not_ready",
            Self::PatchRejected(_) => "patch_key_not_allowed",
            Self::InvalidArgument(_) => "invalid_argument",
            Self::ReplacementNotConfirmed => "replacement_not_confirmed",
            Self::NotConfirmed => "not_confirmed",
            Self::LimitExceeded { .. } => "limit_exceeded",
            Self::ChecksumMismatch(_) => "checksum_mismatch",
            Self::ArchiveInvalid(_) => "archive_invalid",
            Self::ArchiveCollision(_) => "archive_collision",
        }
    }

    /// A duplicate is not retryable and not an error to surface as one.
    pub fn retryable(&self) -> bool {
        matches!(self, Self::NoSpace | Self::Io(_))
    }

    /// §18.3 "Large restores report the offending limit". The limit name is a stable
    /// token (`max_attempts`, `max_wav_bytes`, …) so the UI can explain the refusal
    /// without parsing the human-readable detail out of the message.
    pub fn limit_name(&self) -> Option<&str> {
        match self {
            Self::LimitExceeded { limit, .. } => Some(limit),
            _ => None,
        }
    }
}

impl StoreError {
    /// Build a limit refusal. `detail` is the human sentence; the limit token is what
    /// code branches on.
    pub fn limit(name: &str, detail: String) -> Self {
        Self::LimitExceeded {
            limit: name.to_string(),
            detail,
        }
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
pub struct TimerState {
    /// §18.4 "Prevent reopening or wall-clock rollback from adding time." A resume may
    /// lower `remaining_ms` but never raise it above this persisted checkpoint.
    pub remaining_ms: i64,
    pub running: bool,
    /// Native wall-clock ms of the last durable checkpoint. Used only to bound how much
    /// time a crash can lose (§18.4), never to add time.
    pub checkpoint_ms: i64,
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

/// §8.3/§18.2/§18.4 native-owned session state, persisted beside the attempt rather
/// than inside it.
///
/// `Attempt` is the app-owned record that `src/lib/types.ts` mirrors field for field, so
/// adding a field to it would silently drift from that type. Lifecycle state is written
/// only by `start`/`pause`/`resume`/`finish`, never by a patch, which is precisely the
/// separation that keeps material and lifecycle from being settable through one payload.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AttemptLifecycle {
    /// Written once by `start_attempt`; a later command must never rewrite it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    /// Written once by `finish_attempt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    /// §18.2 session token. A window from a previous session cannot act on a re-opened
    /// attempt because it does not know the token minted at start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// §8.3 "required audio readiness". The renderer declares it after verifying clips
    /// and a complete model installation; `start_attempt` reads this and never assumes
    /// readiness from the caller's word alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_ready: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer: Option<TimerState>,
}

impl Attempt {
    pub fn is(&self, status: &str) -> bool {
        self.status == status
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreFile {
    pub store_version: u32,
    pub attempts: BTreeMap<String, Attempt>,
    /// Native session state, keyed by attempt id. Absent from older stores and skipped
    /// on write when empty, so a draft written before this field still loads.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub lifecycle: BTreeMap<String, AttemptLifecycle>,
}

impl StoreFile {
    pub fn empty() -> Self {
        Self {
            store_version: STORE_VERSION,
            attempts: BTreeMap::new(),
            lifecycle: BTreeMap::new(),
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

    /// Native session state for one attempt. An attempt with no lifecycle entry yet is
    /// still a valid `preparing` draft, so absence is not an error.
    pub fn lifecycle_of(&self, id: &str) -> Result<AttemptLifecycle, StoreError> {
        let store = self.load()?;
        if !store.attempts.contains_key(id) {
            return Err(StoreError::NotFound);
        }
        Ok(store.lifecycle.get(id).cloned().unwrap_or_default())
    }

    /// §18.1 every modifying command re-checks the expected revision. This variant also
    /// hands the closure the attempt's native lifecycle block, so lifecycle writes and
    /// the revision bump land in ONE atomic store write rather than two files' worth of
    /// half-applied state.
    pub fn commit_with_lifecycle(
        &self,
        id: &str,
        expected_revision: i64,
        mutate: impl FnOnce(&mut Attempt, &mut AttemptLifecycle) -> Result<(), StoreError>,
    ) -> Result<Attempt, StoreError> {
        let _held = self.lock()?;
        let mut store = self.read_unlocked()?;
        // NotFound is checked BEFORE the revision, so a missing id is never reported as
        // a conflict: the UI would show "someone else changed it" for a deleted draft.
        if !store.attempts.contains_key(id) {
            return Err(StoreError::NotFound);
        }
        if store.attempts.get(id).map(|r| r.revision) != Some(expected_revision) {
            return Err(StoreError::Conflict);
        }
        // Split borrow: the closure needs the attempt and the lifecycle entry, which
        // live in two different maps of the same struct.
        let StoreFile {
            attempts,
            lifecycle,
            ..
        } = &mut store;
        let record = attempts.get_mut(id).ok_or(StoreError::NotFound)?;
        let entry = lifecycle.entry(id.to_string()).or_default();
        mutate(record, entry)?;
        record.revision += 1;
        record.updated_at = now_ms();
        let out = record.clone();
        self.persist(&store)?;
        Ok(out)
    }

    /// `id` is honoured as given. Callers that must not let the renderer choose an id
    /// assign one natively first (see `create_attempt`); this layer stays dumb so
    /// tests and migrations can pin a known id.
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
        store.lifecycle.remove(id);
        self.persist(&store)
    }

    /// §8.4 cascade delete, serialized against every other write through the same
    /// queue. Metadata is removed FIRST so a crash leaves orphan files (recoverable)
    /// rather than a record pointing at deleted recordings.
    ///
    /// Only the two per-attempt subtrees are touched. `models/` and `audio-cache/` are
    /// shared across attempts and are never reachable from an attempt id, so no code
    /// path here can delete them.
    pub fn delete_cascade(&self, id: &str, expected_revision: i64) -> Result<Attempt, StoreError> {
        if !is_safe_id(id) {
            return Err(StoreError::UnsafePath(id.to_string()));
        }
        let removed = {
            let _held = self.lock()?;
            let mut store = self.read_unlocked()?;
            let record = store.attempts.get(id).ok_or(StoreError::NotFound)?;
            if record.revision != expected_revision {
                return Err(StoreError::Conflict);
            }
            let record = record.clone();
            store.attempts.remove(id);
            store.lifecycle.remove(id);
            self.persist(&store)?;
            record
        };
        for sub in ["imports", "recordings"] {
            let dir = self.safe_join(&format!("{sub}/{id}"))?;
            if dir.exists() {
                fs::remove_dir_all(&dir).map_err(|e| classify(&e))?;
            }
        }
        Ok(removed)
    }

    /// Replace several attempts in ONE atomic store write. §8.4 restore is
    /// validate-all-before-activate: by the time this runs, every checksum, path and
    /// limit has already been checked, so a partial history cannot be written.
    ///
    /// `replace` lists ids whose differing content the caller explicitly chose to
    /// overwrite; a collision outside that list aborts the whole restore.
    pub fn restore_attempts(
        &self,
        incoming: Vec<(Attempt, AttemptLifecycle)>,
        replace: &[String],
    ) -> Result<Vec<Attempt>, StoreError> {
        let _held = self.lock()?;
        let mut store = self.read_unlocked()?;
        for (attempt, _) in &incoming {
            if let Some(existing) = store.attempts.get(&attempt.id) {
                let same = serde_json::to_vec(existing).ok() == serde_json::to_vec(attempt).ok();
                if same {
                    continue;
                }
                if !replace.contains(&attempt.id) {
                    // §8.4 default restore preserves existing attempts.
                    return Err(StoreError::ArchiveCollision(attempt.id.clone()));
                }
            }
        }
        let mut saved = Vec::with_capacity(incoming.len());
        for (attempt, lifecycle) in incoming {
            store.lifecycle.insert(attempt.id.clone(), lifecycle);
            store.attempts.insert(attempt.id.clone(), attempt.clone());
            saved.push(attempt);
        }
        self.persist(&store)?;
        Ok(saved)
    }

    /// Every regular file under `relative`, as (store-relative path, size in bytes).
    ///
    /// Sizes come from directory metadata, not from reading the files, so a caller can
    /// enforce a total-size ceiling BEFORE allocating a single payload (§18.3).
    pub fn list_assets(&self, relative: &str) -> Result<Vec<(String, u64)>, StoreError> {
        let root = self.safe_join(relative)?;
        let mut out = Vec::new();
        if !root.exists() {
            return Ok(out);
        }
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let entries = fs::read_dir(&dir).map_err(|e| classify(&e))?;
            for entry in entries {
                let entry = entry.map_err(|e| classify(&e))?;
                let meta = entry.metadata().map_err(|e| classify(&e))?;
                // `metadata` follows symlinks; a symlinked directory could otherwise
                // walk the export out of the store root.
                if meta.is_dir() {
                    stack.push(entry.path());
                } else if meta.is_file() {
                    let name = entry
                        .path()
                        .strip_prefix(&self.root)
                        .map_err(|_| StoreError::UnsafePath(relative.to_string()))?
                        .to_string_lossy()
                        .replace('\\', "/");
                    out.push((name, meta.len()));
                }
            }
        }
        out.sort();
        Ok(out)
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
        if relative.is_empty()
            || relative.starts_with('/')
            || relative.contains('\\')
            || relative.split('/').any(|c| c == ".." || c == ".")
        {
            return Err(StoreError::UnsafePath(relative.to_string()));
        }
        Ok(self.root.join(relative))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

/// An attempt id is used as a path component, so it must be a single safe segment.
/// Native ids are UUID-shaped, but this is checked rather than assumed: a hostile
/// archive controls its own attempt ids.
pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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
            .commit("a1", 0, |_| Err(StoreError::NotPreparing))
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
