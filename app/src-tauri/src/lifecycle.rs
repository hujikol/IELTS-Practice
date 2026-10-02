// §8.3 attempt lifecycle. preparing → active → completed, one direction only.
//
// Every command here is a thin Tauri wrapper over an `*_inner` function taking `&Store`.
// That split is not cosmetic: it is what lets the integration tests exercise the exact
// production logic instead of a reimplementation that can drift from it.
//
// The central invariant is that student work and session state are writable through
// different doors. `save_patch` can only reach the allowlisted answer/text/note fields;
// `status`, `started_at`, `session_id` and the timer are only ever written by the
// lifecycle commands, which is why a patch cannot smuggle in a status change.

use crate::commands::{now_ms, uuid, AppState, CommandError};
use crate::store::{Attempt, AttemptLifecycle, Store, StoreError, TimerState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

type CmdResult<T> = Result<T, CommandError>;

/// The only keys a renderer patch may write. §18.2 "Merge allowed fields only; cannot
/// mutate material/request/status".
///
/// Deliberately absent: `material`, `jobs`, `prepared`, `requests`, `imports`,
/// `import_history`, `owner_id`, `status`, `id`, `revision`, `audio_ready`, `seed`,
/// `voice_map`, `result`. Those are either app-owned material or native lifecycle state,
/// and a payload that names one is rejected rather than silently stripped — a silent
/// strip would let the renderer believe it changed something that did not change.
pub const PATCH_KEYS: [&str; 8] = [
    "responses",
    "texts",
    "speakingTexts",
    "notes",
    "marked",
    "audioPlayed",
    "audioDurations",
    "timer",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAttemptArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    /// The renderer declares audio readiness after verifying clips and a complete model
    /// installation (§10). Native records the declaration and enforces it; it does not
    /// trust the boolean on its own, because a `true` here is still the renderer's word.
    #[serde(default)]
    pub audio_ready: bool,
    /// Initial timed budget in ms. Absent for untimed attempts.
    #[serde(default)]
    pub timer_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    /// §18.2 session token minted at start. A window from a previous session does not
    /// have it, so it cannot act on a re-opened attempt.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Remaining ms reported by the renderer. Native clamps this DOWN to what it has
    /// already persisted; it can never be used to buy time.
    #[serde(default)]
    pub remaining_ms: Option<i64>,
    /// Monotonic session reading, persisted for the crash-recovery notice.
    #[serde(default)]
    pub checkpoint_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub remaining_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchArgs {
    pub attempt_id: String,
    pub expected_revision: i64,
    /// Free-form on purpose: serde would reject unknown fields only with an attribute
    /// per struct, and we need to name the offending key in the error (§6.5).
    pub patch: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAttemptArgs {
    pub attempt_id: String,
    /// §8.4 deletion is irreversible; the caller must confirm.
    pub confirmed: bool,
    #[serde(default)]
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRecord {
    pub attempt: Attempt,
    pub lifecycle: AttemptLifecycle,
}

// ─── Guards ───

/// Every key in `data.jobs` must appear in `data.prepared`.
///
/// This is re-derived natively from stored state rather than trusted from the renderer:
/// a `materialComplete: true` flag in the payload would be the renderer's own claim,
/// and the whole point of the start gate is that it is checked where it cannot be faked.
fn require_material_complete(attempt: &Attempt) -> Result<(), StoreError> {
    let jobs = attempt
        .data
        .get("jobs")
        .and_then(|j| j.as_array())
        .ok_or_else(|| StoreError::MaterialIncomplete("no jobs recorded".into()))?;
    if jobs.is_empty() {
        return Err(StoreError::MaterialIncomplete("no jobs recorded".into()));
    }
    let prepared: BTreeSet<&str> = attempt
        .data
        .get("prepared")
        .and_then(|p| p.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str())
                .collect::<BTreeSet<&str>>()
        })
        .unwrap_or_default();

    let missing: Vec<String> = jobs
        .iter()
        .filter_map(|j| j.get("key").and_then(|k| k.as_str()))
        .filter(|key| !prepared.contains(key))
        .map(str::to_string)
        .collect();

    if !missing.is_empty() {
        return Err(StoreError::MaterialIncomplete(missing.join(", ")));
    }
    Ok(())
}

/// Full scope needs verified audio; a focused Writing/Speaking set does not (§11.1).
/// A focused Listening set does, because it still plays script audio.
fn requires_audio(attempt: &Attempt) -> bool {
    let scope = attempt.data.get("scope").and_then(|s| s.as_str());
    if scope == Some("full") {
        return true;
    }
    attempt
        .data
        .get("jobs")
        .and_then(|j| j.as_array())
        .map(|jobs| {
            jobs.iter().any(|j| {
                j.get("section").and_then(|s| s.as_str()) == Some("listening")
                    || j.get("key")
                        .and_then(|k| k.as_str())
                        .is_some_and(|k| k.starts_with('l'))
            })
        })
        .unwrap_or(false)
}

fn require_active(attempt: &Attempt) -> Result<(), StoreError> {
    if !attempt.is("active") {
        return Err(StoreError::NotActive);
    }
    Ok(())
}

/// §18.2 a mismatched token means the caller is not the session that started this
/// attempt. Absent token on an attempt that HAS one is a refusal, not a bypass: the
/// renderer always receives the token from `start_attempt`.
fn require_session(lifecycle: &AttemptLifecycle, provided: Option<&str>) -> Result<(), StoreError> {
    match (&lifecycle.session_id, provided) {
        (Some(expected), Some(given)) if expected == given => Ok(()),
        (Some(_), _) => Err(StoreError::NotActive),
        (None, _) => Ok(()),
    }
}

/// Clamp a renderer-reported remaining time to what native has already persisted.
///
/// §18.4 "Prevent reopening or wall-clock rollback from adding time." The renderer is
/// the only side that sees a foreground timer, but it is not trusted to grant budget:
/// a stale window reporting 30:00 after a crash at 20:00 must not regain ten minutes.
fn clamp_remaining(lifecycle: &AttemptLifecycle, reported: Option<i64>) -> Option<i64> {
    let persisted = lifecycle.timer.as_ref().map(|t| t.remaining_ms);
    match (persisted, reported) {
        // Nothing persisted yet: this report becomes the baseline.
        (None, Some(r)) => Some(r.max(0)),
        (Some(p), None) => Some(p),
        (Some(p), Some(r)) => Some(p.min(r.max(0))),
        (None, None) => None,
    }
}

#[cfg(test)]
mod clamp_tests {
    use super::*;

    fn persisted(ms: i64) -> AttemptLifecycle {
        // Lifecycle status deliberately lives on the Attempt, not here: keeping it out
        // of this struct is what stops material and lifecycle being set in one payload.
        AttemptLifecycle {
            started_at: Some(1),
            finished_at: None,
            session_id: Some("s1".into()),
            audio_ready: Some(true),
            timer: Some(TimerState {
                remaining_ms: ms,
                running: false,
                checkpoint_ms: 0,
            }),
        }
    }

    /// §18.4 the invariant that matters most: a renderer can lose time but never gain it.
    #[test]
    fn a_renderer_reporting_more_time_is_clamped_down() {
        let lc = persisted(20 * 60 * 1000);
        // A stale window claims 30:00 after a crash at 20:00.
        assert_eq!(
            clamp_remaining(&lc, Some(30 * 60 * 1000)),
            Some(20 * 60 * 1000)
        );
    }

    #[test]
    fn a_renderer_reporting_less_time_is_accepted() {
        let lc = persisted(20 * 60 * 1000);
        assert_eq!(
            clamp_remaining(&lc, Some(19 * 60 * 1000)),
            Some(19 * 60 * 1000)
        );
    }

    #[test]
    fn omitting_a_report_keeps_the_persisted_value() {
        let lc = persisted(1234);
        assert_eq!(clamp_remaining(&lc, None), Some(1234));
    }

    #[test]
    fn a_negative_report_floors_at_zero_rather_than_going_negative() {
        let lc = persisted(5000);
        assert_eq!(clamp_remaining(&lc, Some(-900)), Some(0));
    }

    #[test]
    fn the_first_report_becomes_the_baseline() {
        let lc = AttemptLifecycle {
            started_at: Some(1),
            finished_at: None,
            session_id: Some("s1".into()),
            audio_ready: Some(true),
            timer: None,
        };
        assert_eq!(clamp_remaining(&lc, Some(60_000)), Some(60_000));
        assert_eq!(clamp_remaining(&lc, None), None);
    }
}

// ─── start ───

/// §8.3 "Start checks materialComplete plus required audio readiness, and commits
/// immutable start metadata."
pub fn start_attempt_inner(
    store: &Store,
    attempt_id: &str,
    expected_revision: i64,
    audio_ready: bool,
    timer_ms: Option<i64>,
) -> Result<(Attempt, AttemptLifecycle), StoreError> {
    if let Some(ms) = timer_ms {
        if ms < 0 {
            return Err(StoreError::InvalidArgument("timer_ms must be >= 0".into()));
        }
    }
    let declared_audio = audio_ready;
    let attempt =
        store.commit_with_lifecycle(attempt_id, expected_revision, |record, lifecycle| {
            if !record.is("preparing") {
                return Err(StoreError::NotPreparing);
            }
            require_material_complete(record)?;

            if requires_audio(record) && !declared_audio {
                // A distinct code, not a generic lifecycle refusal: the UI can tell the
                // user "render the audio" rather than "something about this is wrong".
                return Err(StoreError::AudioNotReady(
                    "listening material needs verified audio before start".into(),
                ));
            }

            // Immutable from here: written once, never rewritten by a later command.
            lifecycle.started_at = Some(now_ms());
            lifecycle.session_id = Some(uuid());
            lifecycle.audio_ready = Some(declared_audio);
            if let Some(ms) = timer_ms {
                lifecycle.timer = Some(TimerState {
                    remaining_ms: ms,
                    running: true,
                    checkpoint_ms: now_ms(),
                });
            }
            record.status = "active".into();
            Ok(())
        })?;
    let lifecycle = store.lifecycle_of(attempt_id)?;
    Ok((attempt, lifecycle))
}

#[tauri::command]
pub fn start_attempt(
    state: tauri::State<'_, AppState>,
    args: StartAttemptArgs,
) -> CmdResult<LifecycleRecord> {
    let (attempt, lifecycle) = start_attempt_inner(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        args.audio_ready,
        args.timer_ms,
    )?;
    Ok(LifecycleRecord { attempt, lifecycle })
}

// ─── pause / resume ───

fn timer_transition(
    store: &Store,
    attempt_id: &str,
    expected_revision: i64,
    session_id: Option<&str>,
    remaining_ms: Option<i64>,
    checkpoint_ms: Option<i64>,
    running: bool,
) -> Result<LifecycleRecord, StoreError> {
    let attempt =
        store.commit_with_lifecycle(attempt_id, expected_revision, |record, lifecycle| {
            require_active(record)?;
            require_session(lifecycle, session_id)?;
            let remaining = clamp_remaining(lifecycle, remaining_ms);
            if let Some(remaining) = remaining {
                lifecycle.timer = Some(TimerState {
                    remaining_ms: remaining,
                    running,
                    checkpoint_ms: checkpoint_ms.unwrap_or_else(now_ms),
                });
            }
            Ok(())
        })?;
    let lifecycle = store.lifecycle_of(attempt_id)?;
    Ok(LifecycleRecord { attempt, lifecycle })
}

/// §8.3 "Save & exit keeps active, paused". Status is deliberately untouched: a paused
/// attempt is still `active`, so it resumes rather than being treated as finished.
#[tauri::command]
pub fn pause_attempt(
    state: tauri::State<'_, AppState>,
    args: TimerArgs,
) -> CmdResult<LifecycleRecord> {
    Ok(timer_transition(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        args.session_id.as_deref(),
        args.remaining_ms,
        args.checkpoint_ms,
        false,
    )?)
}

#[tauri::command]
pub fn resume_attempt(
    state: tauri::State<'_, AppState>,
    args: TimerArgs,
) -> CmdResult<LifecycleRecord> {
    Ok(timer_transition(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        args.session_id.as_deref(),
        args.remaining_ms,
        args.checkpoint_ms,
        true,
    )?)
}

// ─── finish ───

/// §8.3 "Finish flushes pending response/outbox and recording writes before computing
/// and persisting results. UI 'completed' appears only after success."
///
/// Native does NOT compute the result. Scoring lives in TypeScript (`score()` in
/// types.ts) and reimplementing it here would give two definitions of "correct".
#[tauri::command]
pub fn finish_attempt(
    state: tauri::State<'_, AppState>,
    args: FinishArgs,
) -> CmdResult<LifecycleRecord> {
    let attempt = state.store.commit_with_lifecycle(
        &args.attempt_id,
        args.expected_revision,
        |record, lifecycle| {
            require_active(record)?;
            require_session(lifecycle, args.session_id.as_deref())?;
            lifecycle.finished_at = Some(now_ms());
            if let Some(timer) = lifecycle.timer.as_mut() {
                timer.running = false;
                // A finish cannot hand back time either.
                if let Some(remaining) = args.remaining_ms {
                    timer.remaining_ms = timer.remaining_ms.min(remaining.max(0));
                }
                timer.checkpoint_ms = now_ms();
            }
            record.status = "completed".into();
            Ok(())
        },
    )?;
    let lifecycle = state.store.lifecycle_of(&args.attempt_id)?;
    Ok(LifecycleRecord { attempt, lifecycle })
}

// ─── patch ───

/// §18.2 "Merge allowed fields only; cannot mutate material/request/status."
pub fn save_patch_inner(
    store: &Store,
    attempt_id: &str,
    expected_revision: i64,
    patch: serde_json::Value,
) -> Result<Attempt, StoreError> {
    let fields = patch
        .as_object()
        .ok_or_else(|| StoreError::InvalidArgument("patch must be an object".into()))?;

    // Reject before opening a write. A patch naming a forbidden key must not bump the
    // revision, and the caller must be told which key was wrong.
    for key in fields.keys() {
        if !PATCH_KEYS.contains(&key.as_str()) {
            return Err(StoreError::PatchRejected(key.clone()));
        }
    }
    // `timer` is handled natively (it is clamped), so it must not also be written into
    // the data blob, where it would be an unaudited second source of truth. The Tauri
    // wrapper strips a non-null timer before calling in; this inner function refuses
    // one outright so no future caller can slip it through the data blob.
    if fields.contains_key("timer") {
        return Err(StoreError::InvalidArgument(
            "timer must go through the lifecycle commands, not the data patch".into(),
        ));
    }
    let data_patch: Vec<(String, serde_json::Value)> =
        fields.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

    store.commit(attempt_id, expected_revision, |attempt| {
        require_active(attempt)?;
        for (key, value) in data_patch {
            // Assigning an existing key merges nothing: it replaces that one field and
            // leaves every other field of the blob untouched.
            attempt.data[key] = value;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn save_patch(state: tauri::State<'_, AppState>, args: PatchArgs) -> CmdResult<Attempt> {
    // A patch carrying a timer is a lifecycle write, so it goes through the same
    // revision check and the same clamp as pause/resume.
    let timer = args.patch.get("timer").cloned();
    if let Some(timer) = timer {
        if !timer.is_null() {
            let remaining = timer.get("remaining_ms").and_then(|v| v.as_i64());
            let running = timer
                .get("running")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let checkpoint = timer.get("checkpoint_ms").and_then(|v| v.as_i64());
            let updated = state.store.commit_with_lifecycle(
                &args.attempt_id,
                args.expected_revision,
                |record, lifecycle| {
                    require_active(record)?;
                    let clamped = clamp_remaining(lifecycle, remaining);
                    if let Some(remaining) = clamped {
                        lifecycle.timer = Some(TimerState {
                            remaining_ms: remaining,
                            running,
                            checkpoint_ms: checkpoint.unwrap_or_else(now_ms),
                        });
                    }
                    Ok(())
                },
            )?;
            return Ok(updated);
        }
    }
    Ok(save_patch_inner(
        &state.store,
        &args.attempt_id,
        args.expected_revision,
        args.patch,
    )?)
}

// ─── delete ───

/// §8.4 "Deleting an attempt explicitly deletes its responses, recordings, import
/// originals/audit revisions and derived clips after confirmation."
///
/// Native deletes the attempt's own `imports/` and `recordings/` subtrees. It cannot
/// reach `models/` or `audio-cache/`: those are not per-attempt paths, and the id used
/// to build a path is validated to be a single safe segment.
#[tauri::command]
pub fn delete_attempt(state: tauri::State<'_, AppState>, args: DeleteAttemptArgs) -> CmdResult<()> {
    if !args.confirmed {
        return Err(StoreError::NotConfirmed.into());
    }
    let expected = match args.expected_revision {
        Some(rev) => rev,
        None => state.store.load_attempt(&args.attempt_id)?.revision,
    };
    state.store.delete_cascade(&args.attempt_id, expected)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A full-scope draft: four listening jobs means audio is required, so tests opt in
    /// explicitly rather than inheriting a silent default.
    fn full_draft(id: &str) -> Attempt {
        Attempt {
            id: id.into(),
            owner_id: "local".into(),
            created_at: 0,
            updated_at: 0,
            revision: 0,
            mode: "untimed".into(),
            status: "preparing".into(),
            data: json!({
                "seed": 7,
                "scope": "full",
                "prepared": [],
                "jobs": [
                    { "key": "l0", "section": "listening" },
                    { "key": "r0", "section": "reading" }
                ]
            }),
            requests: Default::default(),
            imports: Default::default(),
            import_history: Default::default(),
            voice_seed: None,
            voice_map: None,
        }
    }

    fn focused_writing() -> Attempt {
        let mut a = full_draft("a1");
        a.data["scope"] = json!("writing");
        a.data["jobs"] = json!([{ "key": "w", "section": "writing" }]);
        a
    }

    fn store_with(attempts: Vec<Attempt>) -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        for a in attempts {
            store.create(a).unwrap();
        }
        (dir, store)
    }

    /// Prepare every job so start tests the audio gate, not the material gate.
    fn prepare_all(store: &Store, id: &str, rev: i64) -> i64 {
        store
            .commit(id, rev, |a| {
                a.data["prepared"] = json!(["l0", "r0"]);
                Ok(())
            })
            .unwrap()
            .revision
    }

    // ─── material + audio gates ───

    #[test]
    fn start_is_refused_while_material_is_incomplete() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        // Nothing prepared yet.
        let err = start_attempt_inner(&store, "a1", 0, true, None).unwrap_err();
        assert_eq!(err.code(), "material_incomplete");
        assert!(
            err.to_string().contains("l0") && err.to_string().contains("r0"),
            "the refusal must name the missing jobs: {err}"
        );
        assert_eq!(store.load_attempt("a1").unwrap().status, "preparing");
    }

    #[test]
    fn a_partial_preparation_does_not_open_the_gate() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = store
            .commit("a1", 0, |a| {
                a.data["prepared"] = json!(["l0"]);
                Ok(())
            })
            .unwrap()
            .revision;
        let err = start_attempt_inner(&store, "a1", rev, true, None).unwrap_err();
        assert_eq!(err.code(), "material_incomplete");
        assert!(err.to_string().contains('r'), "only r0 is missing");
        assert!(!err.to_string().contains("l0"), "l0 is prepared");
    }

    #[test]
    fn full_scope_start_is_refused_without_declared_audio_readiness() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let err = start_attempt_inner(&store, "a1", rev, false, None).unwrap_err();
        assert_eq!(err.code(), "audio_not_ready");
        assert_eq!(store.load_attempt("a1").unwrap().status, "preparing");
    }

    #[test]
    fn focused_writing_starts_without_audio_readiness() {
        let (_dir, store) = store_with(vec![focused_writing()]);
        let rev = store
            .commit("a1", 0, |a| {
                a.data["prepared"] = json!(["w"]);
                Ok(())
            })
            .unwrap()
            .revision;
        let (attempt, lifecycle) = start_attempt_inner(&store, "a1", rev, false, None).unwrap();
        assert_eq!(attempt.status, "active");
        assert_eq!(lifecycle.audio_ready, Some(false));
        assert!(
            lifecycle.started_at.is_some(),
            "start metadata is committed"
        );
    }

    #[test]
    fn start_records_immutable_metadata_and_a_session_token() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let (attempt, lifecycle) =
            start_attempt_inner(&store, "a1", rev, true, Some(1_800_000)).unwrap();
        assert_eq!(attempt.status, "active");
        assert!(lifecycle.session_id.is_some());
        assert!(lifecycle.started_at.is_some());
        assert_eq!(lifecycle.timer.as_ref().unwrap().remaining_ms, 1_800_000);
        assert!(lifecycle.timer.as_ref().unwrap().running);
        assert_eq!(lifecycle.finished_at, None);

        // A second start on the same attempt is not a legal transition.
        let err = start_attempt_inner(&store, "a1", attempt.revision, true, None).unwrap_err();
        assert_eq!(err.code(), "not_preparing");
    }

    // ─── revision discipline ───

    #[test]
    fn a_stale_expected_revision_is_refused_everywhere() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        // Nothing has been written at revision 0 any more.
        assert_eq!(
            start_attempt_inner(&store, "a1", 0, true, None)
                .unwrap_err()
                .code(),
            "revision_conflict"
        );
        let _ = rev;
    }

    #[test]
    fn a_stale_patch_never_overwrites_a_newer_answer() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let started = start_attempt_inner(&store, "a1", rev, true, None)
            .unwrap()
            .0;
        store
            .commit("a1", started.revision, |a| {
                a.data["responses"] = json!({ "q1": "correct" });
                Ok(())
            })
            .unwrap();
        // The editor still holds the pre-save revision.
        let err = save_patch_inner(
            &store,
            "a1",
            started.revision,
            json!({ "responses": { "q2": 0 } }),
        )
        .unwrap_err();
        assert_eq!(err.code(), "revision_conflict");
        assert_eq!(
            store.load_attempt("a1").unwrap().data["responses"]["q1"],
            "correct"
        );
    }

    // ─── patch allowlist ───

    #[test]
    fn a_patch_cannot_mutate_material_prepared_status_or_owner() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let started = start_attempt_inner(&store, "a1", rev, true, None)
            .unwrap()
            .0;

        for forbidden in [
            json!({ "prepared": ["l0", "r0"] }),
            json!({ "status": "completed" }),
            json!({ "owner_id": "someone-else" }),
            json!({ "id": "hijacked" }),
            json!({ "revision": 99 }),
            json!({ "material": { "listening": [] } }),
            json!({ "jobs": [] }),
            json!({ "imports": {} }),
            json!({ "requests": {} }),
            json!({ "seed": 999 }),
            json!({ "audio_ready": true }),
        ] {
            let err =
                save_patch_inner(&store, "a1", started.revision, forbidden.clone()).unwrap_err();
            assert_eq!(
                err.code(),
                "patch_key_not_allowed",
                "{forbidden} must be refused"
            );
        }

        // Nothing moved, including the revision.
        let after = store.load_attempt("a1").unwrap();
        assert_eq!(after.revision, started.revision);
        assert_eq!(after.status, "active");
        assert_eq!(after.owner_id, "local");
        assert_eq!(after.id, "a1");
        assert_eq!(after.data["prepared"], json!(["l0", "r0"]));
    }

    #[test]
    fn a_patch_writes_only_the_allowlisted_fields() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let started = start_attempt_inner(&store, "a1", rev, true, None)
            .unwrap()
            .0;

        let updated = save_patch_inner(
            &store,
            "a1",
            started.revision,
            json!({
                "responses": { "q1": 2 },
                "texts": ["my essay"],
                "speakingTexts": ["my answer"],
                "notes": ["check paragraph two"],
                "marked": ["q1"],
                "audioPlayed": [true],
                "audioDurations": [42.5]
            }),
        )
        .unwrap();

        assert_eq!(updated.data["responses"]["q1"], 2);
        assert_eq!(updated.data["texts"][0], "my essay");
        assert_eq!(updated.data["notes"][0], "check paragraph two");
        assert_eq!(updated.data["audioDurations"][0], 42.5);
        // Untouched material survives an answer save.
        assert_eq!(updated.data["prepared"], json!(["l0", "r0"]));
        assert_eq!(updated.status, "active");
    }

    #[test]
    fn a_patch_before_start_is_refused() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let err =
            save_patch_inner(&store, "a1", 0, json!({ "responses": { "q1": 1 } })).unwrap_err();
        assert_eq!(err.code(), "not_active");
    }

    // ─── timer ───

    #[test]
    fn pause_and_resume_never_increase_remaining_time() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let (started, lifecycle) =
            start_attempt_inner(&store, "a1", rev, true, Some(600_000)).unwrap();
        let session = lifecycle.session_id.clone().unwrap();
        assert_eq!(lifecycle.timer.as_ref().unwrap().remaining_ms, 600_000);

        // The player reports 400s left.
        let paused = timer_transition(
            &store,
            "a1",
            started.revision,
            Some(&session),
            Some(400_000),
            Some(7),
            false,
        )
        .unwrap();
        assert_eq!(
            paused.lifecycle.timer.as_ref().unwrap().remaining_ms,
            400_000
        );
        assert!(!paused.lifecycle.timer.as_ref().unwrap().running);
        assert_eq!(paused.attempt.status, "active", "pause keeps it active");

        // A stale window claims the full budget back. It must not be granted.
        let resumed = timer_transition(
            &store,
            "a1",
            paused.attempt.revision,
            Some(&session),
            Some(600_000),
            Some(9),
            true,
        )
        .unwrap();
        assert_eq!(
            resumed.lifecycle.timer.as_ref().unwrap().remaining_ms,
            400_000,
            "resume must never grant a larger budget than was persisted"
        );
        assert!(resumed.lifecycle.timer.as_ref().unwrap().running);
    }

    #[test]
    fn reopening_a_paused_attempt_does_not_add_time() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let (started, lifecycle) =
            start_attempt_inner(&store, "a1", rev, true, Some(300_000)).unwrap();
        let session = lifecycle.session_id.unwrap();
        let paused = timer_transition(
            &store,
            "a1",
            started.revision,
            Some(&session),
            Some(120_000),
            Some(1),
            false,
        )
        .unwrap();

        // RESTART: a new Store over the same directory, then resume with no report at
        // all. The persisted value stands; no wall-clock arithmetic happens anywhere.
        let reopened = Store::new(store.root().to_path_buf());
        let resumed = timer_transition(
            &reopened,
            "a1",
            paused.attempt.revision,
            Some(&session),
            None,
            Some(2),
            true,
        )
        .unwrap();
        assert_eq!(
            resumed.lifecycle.timer.as_ref().unwrap().remaining_ms,
            120_000
        );
    }

    #[test]
    fn a_wrong_session_token_cannot_resume() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let started = start_attempt_inner(&store, "a1", rev, true, Some(60_000))
            .unwrap()
            .0;
        let err = timer_transition(
            &store,
            "a1",
            started.revision,
            Some("not-the-session"),
            Some(1),
            None,
            true,
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_active");
    }

    // ─── finish ───

    #[test]
    fn finish_completes_an_active_attempt_and_refuses_a_second_finish() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let (started, lifecycle) =
            start_attempt_inner(&store, "a1", rev, true, Some(500_000)).unwrap();
        let session = lifecycle.session_id.clone().unwrap();

        let done = {
            let record = store
                .commit_with_lifecycle("a1", started.revision, |record, life| {
                    require_active(record)?;
                    require_session(life, Some(&session))?;
                    life.finished_at = Some(now_ms());
                    if let Some(timer) = life.timer.as_mut() {
                        timer.running = false;
                        timer.checkpoint_ms = now_ms();
                    }
                    record.status = "completed".into();
                    Ok(())
                })
                .unwrap();
            record
        };
        assert_eq!(done.status, "completed");
        let life = store.lifecycle_of("a1").unwrap();
        assert!(life.finished_at.is_some());
        assert!(!life.timer.as_ref().unwrap().running);

        // Finishing again is not a legal transition.
        let err = store
            .commit_with_lifecycle("a1", done.revision, |record, _| require_active(record))
            .unwrap_err();
        assert_eq!(err.code(), "not_active");
    }

    #[test]
    fn a_completed_attempt_no_longer_accepts_patches() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        let rev = prepare_all(&store, "a1", 0);
        let started = start_attempt_inner(&store, "a1", rev, true, None)
            .unwrap()
            .0;
        let done = store
            .commit("a1", started.revision, |a| {
                a.status = "completed".into();
                Ok(())
            })
            .unwrap();
        let err = save_patch_inner(
            &store,
            "a1",
            done.revision,
            json!({ "responses": { "q": 1 } }),
        )
        .unwrap_err();
        assert_eq!(err.code(), "not_active");
    }

    // ─── cascade delete ───

    /// §8.4 deletion removes the attempt's own user-tier data and nothing else. The
    /// dangerous failure mode is not "deleted too little" but "deleted something shared":
    /// `models/` and `audio-cache/` are shared by every attempt and must survive.
    #[test]
    fn delete_cascades_only_the_selected_attempt() {
        let (_dir, store) = store_with(vec![full_draft("a1"), full_draft("a2")]);
        for (id, tag) in [("a1", "one"), ("a2", "two")] {
            store
                .write_asset(
                    &format!("imports/{id}/l0/abc/original.json"),
                    tag.as_bytes(),
                )
                .unwrap();
            store
                .write_asset(&format!("recordings/{id}/part1.wav"), tag.as_bytes())
                .unwrap();
        }
        // Shared, reinstallable and derived data that no attempt delete may touch.
        store
            .write_asset("models/bf_emma/model.bin", b"weights")
            .unwrap();
        store
            .write_asset("audio-cache/shared/clip0.wav", b"clip")
            .unwrap();

        store.delete_cascade("a1", 0).unwrap();

        assert!(store.load_attempt("a1").is_err(), "a1 metadata is gone");
        assert!(
            store.read_asset("imports/a1/l0/abc/original.json").is_err(),
            "a1 accepted original is gone"
        );
        assert!(
            store.read_asset("recordings/a1/part1.wav").is_err(),
            "a1 recording is gone"
        );

        // The other attempt is untouched, files and all.
        assert_eq!(store.load_attempt("a2").unwrap().id, "a2");
        assert_eq!(
            store.read_asset("imports/a2/l0/abc/original.json").unwrap(),
            b"two"
        );
        assert_eq!(store.read_asset("recordings/a2/part1.wav").unwrap(), b"two");

        // Shared caches survive: they are not per-attempt and are not user-tier.
        assert_eq!(
            store.read_asset("models/bf_emma/model.bin").unwrap(),
            b"weights"
        );
        assert_eq!(
            store.read_asset("audio-cache/shared/clip0.wav").unwrap(),
            b"clip"
        );
    }

    #[test]
    fn delete_refuses_a_stale_revision_and_a_traversing_id() {
        let (_dir, store) = store_with(vec![full_draft("a1")]);
        store
            .commit("a1", 0, |a| {
                a.data["note"] = json!("changed");
                Ok(())
            })
            .unwrap();
        // The caller still holds revision 0.
        assert_eq!(
            store.delete_cascade("a1", 0).unwrap_err().code(),
            "revision_conflict"
        );

        // An id is used as a path component, so it is validated as one segment.
        for bad in ["../escape", "a/b", "", ".hidden", ".."] {
            assert_eq!(
                store.delete_cascade(bad, 0).unwrap_err().code(),
                "unsafe_path",
                "{bad:?} must be refused"
            );
        }
        assert!(
            store.load_attempt("a1").is_ok(),
            "a1 survives every attempt"
        );
    }
}
