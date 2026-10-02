// §18.2 command surface. Only these commands are bound — no shell execution, no
// generic read/write-file command, and no path the renderer chooses freely.
//
// Every modifying command takes attempt_id + expected_revision and returns the
// persisted new revision. A failed write returns no record at all, so the UI can
// never show a save that did not happen.

use crate::store::{
    Attempt, AttemptSummary, ImportHistoryEntry, ImportRef, JobRequest, Store, StoreError,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<i64>,
}

impl From<StoreError> for CommandError {
    fn from(e: StoreError) -> Self {
        Self {
            message: e.to_string(),
            code: e.code().to_string(),
            retryable: e.retryable(),
            current_revision: None,
        }
    }
}

type CmdResult<T> = Result<T, CommandError>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttemptArgs {
    pub attempt: Attempt,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    pub job_key: String,
    pub generation_id: String,
    /// App-validated material. Native re-checks identity and lifecycle, never content.
    pub data: serde_json::Value,
    pub sha256: String,
    pub contract_version: i64,
    pub raw_original: String,
    pub replace_confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRequestArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    pub job_key: String,
    pub rotate: bool,
    pub snapshot: String,
    pub contract_version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedRequest {
    pub generation_id: String,
    pub snapshot: String,
    pub rotated: bool,
    pub revision: i64,
}

pub struct AppState {
    pub store: Arc<Store>,
}

/// §18.1 timestamps and ownership are generated here, never taken from model output.
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn uuid() -> String {
    // Random enough for local single-process identity; not a security boundary.
    let mut bytes = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut bytes);
    } else {
        let seed = now_ms() as u64;
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = ((seed >> (i % 8 * 8)) as u8) ^ (i as u8);
        }
    }
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn require_preparing(attempt: &Attempt) -> Result<(), StoreError> {
    if attempt.status != "preparing" {
        return Err(StoreError::Lifecycle);
    }
    Ok(())
}

// ─── Commands ───

#[tauri::command]
pub fn create_attempt(
    state: tauri::State<'_, AppState>,
    args: CreateAttemptArgs,
) -> CmdResult<Attempt> {
    let mut attempt = args.attempt;
    // Ownership and identity are assigned natively; a renderer cannot claim another owner.
    attempt.id = uuid();
    attempt.owner_id = "local".into();
    Ok(state.store.create(attempt)?)
}

#[tauri::command]
pub fn list_attempts(state: tauri::State<'_, AppState>) -> CmdResult<Vec<AttemptSummary>> {
    Ok(state.store.list()?)
}

#[tauri::command]
pub fn load_attempt(state: tauri::State<'_, AppState>, attempt_id: String) -> CmdResult<Attempt> {
    Ok(state.store.load_attempt(&attempt_id)?)
}

#[tauri::command]
pub fn delete_attempt(state: tauri::State<'_, AppState>, attempt_id: String) -> CmdResult<()> {
    Ok(state.store.delete(&attempt_id)?)
}

/// §4.2 the first issue persists a generation id and a snapshot of the rendered brief.
/// Repeated copying reuses both; only an explicit rotate replaces them.
#[tauri::command]
pub fn issue_request(
    state: tauri::State<'_, AppState>,
    args: IssueRequestArgs,
) -> CmdResult<IssuedRequest> {
    let store = state.store.clone();
    let job_key = args.job_key.clone();
    let rotate = args.rotate;
    let snapshot = args.snapshot.clone();
    let contract_version = args.contract_version;

    let updated = store.commit(&args.attempt_id, args.expected_revision, |attempt| {
        require_preparing(attempt)?;
        // Copy and repair reuse the issued request; only an explicit rotate replaces it.
        if !rotate && attempt.requests.contains_key(&job_key) {
            return Ok(());
        }
        attempt.requests.insert(
            job_key.clone(),
            JobRequest {
                generation_id: uuid(),
                issued_at: now_ms(),
                snapshot: snapshot.clone(),
                contract_version,
                envelope_version: 1,
            },
        );
        Ok(())
    })?;

    let request = updated.requests.get(&job_key).ok_or(StoreError::NotFound)?;
    Ok(IssuedRequest {
        generation_id: request.generation_id.clone(),
        snapshot: request.snapshot.clone(),
        rotated: rotate,
        revision: updated.revision,
    })
}

/// §7.2 native re-checks target identity, lifecycle and generation before committing.
/// Material content was already validated in the bundled app; native never trusts it
/// enough to skip the revision and identity checks.
#[tauri::command]
pub fn commit_import(state: tauri::State<'_, AppState>, args: CommitArgs) -> CmdResult<Attempt> {
    let store = state.store.clone();
    let job_key = args.job_key.clone();
    let generation_id = args.generation_id.clone();
    let sha256 = args.sha256.clone();
    let contract_version = args.contract_version;
    let data = args.data.clone();
    let raw_original = args.raw_original.clone();
    let replace_confirmed = args.replace_confirmed;

    // Asset first: a metadata failure then leaves an orphan, never a dangling reference.
    let original_path = format!("imports/{}/{}/original.json", args.attempt_id, job_key);
    store.write_asset(&original_path, raw_original.as_bytes())?;

    let updated = store.commit(&args.attempt_id, args.expected_revision, |attempt| {
        require_preparing(attempt)?;

        let request = attempt.requests.get(&job_key).ok_or(StoreError::NotFound)?;
        if request.generation_id != generation_id {
            // Stale response: the prompt was rotated after the user copied it.
            return Err(StoreError::Conflict);
        }

        let is_duplicate = attempt
            .imports
            .get(&job_key)
            .map(|existing| existing.sha256 == sha256)
            .unwrap_or(false);

        if is_duplicate {
            // Identical envelope for the same generation: no-op, no revision bump.
            return Err(StoreError::Duplicate);
        }

        if attempt.imports.contains_key(&job_key) && !replace_confirmed {
            return Err(StoreError::Lifecycle);
        }

        // Replacement appends to history; it never deletes the previous original.
        if let Some(previous) = attempt.imports.get(&job_key).cloned() {
            let entry = ImportHistoryEntry {
                sha256: previous.sha256,
                accepted_at: previous.accepted_at,
                original_path: previous.original_path,
                generation_id: previous.generation_id,
                contract_version: previous.contract_version,
                envelope_version: previous.envelope_version,
                superseded_at: Some(now_ms()),
            };
            attempt
                .import_history
                .entry(job_key.clone())
                .or_default()
                .push(entry);
        }

        let reference = ImportRef {
            sha256: sha256.clone(),
            accepted_at: now_ms(),
            original_path: original_path.clone(),
            generation_id: generation_id.clone(),
            contract_version,
            envelope_version: 1,
        };
        attempt.imports.insert(job_key.clone(), reference.clone());
        attempt
            .import_history
            .entry(job_key.clone())
            .or_default()
            .push(ImportHistoryEntry {
                sha256: reference.sha256,
                accepted_at: reference.accepted_at,
                original_path: reference.original_path,
                generation_id: reference.generation_id,
                contract_version: reference.contract_version,
                envelope_version: reference.envelope_version,
                superseded_at: None,
            });

        // `prepared` is app state, never model output.
        let prepared = attempt
            .data
            .get_mut("prepared")
            .and_then(|p| p.as_array_mut());
        if let Some(list) = prepared {
            if !list.iter().any(|k| k.as_str() == Some(job_key.as_str())) {
                list.push(serde_json::Value::String(job_key.clone()));
            }
        }
        attempt.data["data"] = data;
        Ok(())
    })?;

    Ok(updated)
}
