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
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn uuid() -> String {
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
    if !attempt.is("preparing") {
        return Err(StoreError::NotPreparing);
    }
    Ok(())
}

// ─── Commands ───

/// Identity and ownership are assigned here, natively, so a renderer cannot choose an
/// id or claim another owner. The store stays dumb so tests and migrations can pin a
/// known id. Split out so the integration tests exercise this exact rule.
pub fn create_attempt_inner(store: &Store, mut attempt: Attempt) -> Result<Attempt, StoreError> {
    attempt.id = uuid();
    attempt.owner_id = "local".into();
    store.create(attempt)
}

#[tauri::command]
pub fn create_attempt(
    state: tauri::State<'_, AppState>,
    args: CreateAttemptArgs,
) -> CmdResult<Attempt> {
    Ok(create_attempt_inner(&state.store, args.attempt)?)
}

#[tauri::command]
pub fn list_attempts(state: tauri::State<'_, AppState>) -> CmdResult<Vec<AttemptSummary>> {
    Ok(state.store.list()?)
}

#[tauri::command]
pub fn load_attempt(state: tauri::State<'_, AppState>, attempt_id: String) -> CmdResult<Attempt> {
    Ok(state.store.load_attempt(&attempt_id)?)
}

// Deletion lives in `lifecycle::delete_attempt`, which cascades to the attempt's own
// imports/ and recordings/ subtrees and requires confirmation. A metadata-only delete
// here would silently orphan every recording the user made.

/// §4.2 the first issue persists a generation id and a snapshot of the rendered brief.
/// Repeated copying reuses both; only an explicit rotate replaces them.
/// §4.2 issue/reuse a generation request. Split from the Tauri wrapper so the
/// integration tests exercise this exact code rather than a reimplementation.
pub fn issue_request_inner(
    store: &Store,
    attempt_id: &str,
    expected_revision: i64,
    job_key: &str,
    rotate: bool,
    snapshot: &str,
    contract_version: i64,
) -> Result<(JobRequest, i64), StoreError> {
    let updated = store.commit(attempt_id, expected_revision, |attempt| {
        require_preparing(attempt)?;
        // Copy and repair reuse the issued request; only an explicit rotate replaces it.
        if !rotate && attempt.requests.contains_key(job_key) {
            return Ok(());
        }
        attempt.requests.insert(
            job_key.to_string(),
            JobRequest {
                generation_id: uuid(),
                issued_at: now_ms(),
                snapshot: snapshot.to_string(),
                contract_version,
                envelope_version: 1,
            },
        );
        Ok(())
    })?;
    let request = updated
        .requests
        .get(job_key)
        .cloned()
        .ok_or(StoreError::NotFound)?;
    Ok((request, updated.revision))
}

#[tauri::command]
pub fn issue_request(
    state: tauri::State<'_, AppState>,
    args: IssueRequestArgs,
) -> CmdResult<IssuedRequest> {
    let (request, revision) = issue_request_inner(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        &args.job_key,
        args.rotate,
        &args.snapshot,
        args.contract_version,
    )?;
    Ok(IssuedRequest {
        generation_id: request.generation_id,
        snapshot: request.snapshot,
        rotated: args.rotate,
        revision,
    })
}

/// §7.2 native re-checks target identity, lifecycle and generation before committing.
/// Material content was already validated in the bundled app; native never trusts it
/// enough to skip the revision and identity checks. Split from the Tauri wrapper so
/// integration tests exercise this exact code.
#[allow(clippy::too_many_arguments)]
pub fn commit_import_inner(
    store: &Store,
    attempt_id: &str,
    expected_revision: i64,
    job_key: &str,
    generation_id: &str,
    data: serde_json::Value,
    sha256: &str,
    contract_version: i64,
    raw_original: &str,
    replace_confirmed: bool,
) -> Result<Attempt, StoreError> {
    let job_key = job_key.to_string();
    let generation_id = generation_id.to_string();
    let sha256 = sha256.to_string();
    let data = data.clone();
    let raw_original = raw_original.to_string();

    // The asset is written inside the commit closure, per accepted checksum, so a
    // metadata failure leaves an orphan rather than a reference to missing data.
    let updated = store.commit(attempt_id, expected_revision, |attempt| {
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
            // §7.3 the attempt IS preparing, so reporting "not_preparing" here would
            // send the UI to re-open a draft that is fine. This is its own failure.
            return Err(StoreError::ReplacementNotConfirmed);
        }

        // Replacement marks the outgoing entry superseded in place and appends the new
        // one. Re-pushing the previous entry instead would log it twice, because the
        // current entry is already recorded below.
        if attempt.imports.contains_key(&job_key) {
            if let Some(history) = attempt.import_history.get_mut(&job_key) {
                if let Some(current) = history.iter_mut().rev().find(|e| e.superseded_at.is_none())
                {
                    current.superseded_at = Some(now_ms());
                }
            }
        }

        // BUG 2: the original was always written to imports/<id>/<job>/original.json, so a
        // replacement OVERWROTE the superseded original on disk and the audit history
        // pointed at a file whose contents had changed. Each accepted generation gets
        // its own directory, keyed by checksum.
        let original_path = format!(
            "imports/{attempt_id}/{job_key}/{}/original.json",
            &sha256[..sha256.len().min(16)]
        );
        store.write_asset(&original_path, raw_original.as_bytes())?;

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

#[tauri::command]
pub fn commit_import(state: tauri::State<'_, AppState>, args: CommitArgs) -> CmdResult<Attempt> {
    Ok(commit_import_inner(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        &args.job_key,
        &args.generation_id,
        args.data,
        &args.sha256,
        args.contract_version,
        &args.raw_original,
        args.replace_confirmed,
    )?)
}
