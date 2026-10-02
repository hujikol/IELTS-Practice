// Phase 1 release slice, proven end to end against the real store:
// create draft → issue request → import material → restart → material survives.
//
// These call the SAME functions the Tauri commands call (issue_request_inner /
// commit_import_inner), so this is production logic under test, not a reimplementation.
//
// This is the automated half of M1. The human half — pasting into a real chat — is
// P1-08 and cannot be simulated: a fixture is not a model response.

use ielts_studio_lib::store::Attempt;
use ielts_studio_lib::{commit_import_inner, create_attempt_inner, issue_request_inner, Store};
use serde_json::json;
use std::collections::BTreeMap;
use tempfile::TempDir;

fn draft() -> Attempt {
    Attempt {
        id: "a1".into(),
        owner_id: "local".into(),
        created_at: 0,
        updated_at: 0,
        revision: 0,
        mode: "untimed".into(),
        status: "preparing".into(),
        data: json!({
            "seed": 4242,
            "scope": "full",
            "prepared": [],
            "listening": [],
            "reading": [],
            "jobs": [
                { "key": "l0", "label": "Listening · Part 1", "section": "listening", "part": 1 },
                { "key": "r0", "label": "Reading · Passage 1", "section": "reading", "part": 1 }
            ]
        }),
        requests: BTreeMap::new(),
        imports: BTreeMap::new(),
        import_history: BTreeMap::new(),
        voice_seed: None,
        voice_map: None,
    }
}

fn issue(store: &Store, rev: i64, job: &str, rotate: bool) -> (String, i64) {
    let (request, revision) =
        issue_request_inner(store, "a1", rev, job, rotate, "SNAPSHOT", 1).unwrap();
    (request.generation_id, revision)
}

fn import(
    store: &Store,
    rev: i64,
    job: &str,
    generation: &str,
    sha: &str,
    replace: bool,
) -> Result<i64, ielts_studio_lib::StoreError> {
    commit_import_inner(
        store,
        "a1",
        rev,
        job,
        generation,
        json!({ "title": "Cataloguing a municipal archive" }),
        sha,
        1,
        r#"{"format_version":1}"#,
        replace,
    )
    .map(|a| a.revision)
}

#[test]
fn the_first_milestone_slice_survives_a_restart() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_path_buf();

    let store = Store::new(root.clone());
    store.create(draft()).unwrap();

    let (gen_l0, rev) = issue(&store, 0, "l0", false);
    let (gen_r0, rev) = issue(&store, rev, "r0", false);
    let rev = import(&store, rev, "l0", &gen_l0, "sha-l0", false).unwrap();

    // RESTART: a brand new Store over the same directory.
    let reopened = Store::new(root.clone());
    let after = reopened.load_attempt("a1").unwrap();

    assert_eq!(after.revision, rev);
    assert_eq!(after.status, "preparing");
    // The issued request survived, so the prompt can be copied again verbatim.
    assert_eq!(after.requests["l0"].generation_id, gen_l0);
    assert_eq!(after.requests["l0"].snapshot, "SNAPSHOT");
    assert_eq!(after.requests["r0"].generation_id, gen_r0);
    // Accepted material, its checksum and its raw original all survived.
    assert_eq!(after.imports["l0"].sha256, "sha-l0");
    assert_eq!(
        reopened
            .read_asset(&after.imports["l0"].original_path)
            .unwrap(),
        br#"{"format_version":1}"#
    );
    assert_eq!(after.data["prepared"], json!(["l0"]));
}

#[test]
fn copying_a_prompt_twice_reuses_the_same_generation() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (first, rev) = issue(&store, 0, "l0", false);
    let (second, _) = issue(&store, rev, "l0", false);
    assert_eq!(first, second, "a second copy must not invalidate the first");
}

#[test]
fn rotating_invalidates_only_its_own_job() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (l0, rev) = issue(&store, 0, "l0", false);
    let (r0, rev) = issue(&store, rev, "r0", false);
    let (l0_new, _rev) = issue(&store, rev, "l0", true);

    assert_ne!(l0, l0_new);
    let after = store.load_attempt("a1").unwrap();
    assert_eq!(after.requests["l0"].generation_id, l0_new);
    assert_eq!(
        after.requests["r0"].generation_id, r0,
        "rotating l0 must not disturb r0"
    );
}

#[test]
fn a_response_to_a_rotated_prompt_is_refused() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (old_gen, rev) = issue(&store, 0, "l0", false);
    let (_, rev) = issue(&store, rev, "l0", true);

    // The user pasted the answer to the OLD prompt.
    let err = import(&store, rev, "l0", &old_gen, "sha", false).unwrap_err();
    assert_eq!(err.code(), "revision_conflict");
}

#[test]
fn an_identical_import_is_a_no_op_and_a_different_one_needs_confirmation() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (gen, rev) = issue(&store, 0, "l0", false);
    let rev = import(&store, rev, "l0", &gen, "sha-1", false).unwrap();

    // Same payload again: duplicate, and the revision must not move.
    assert_eq!(
        import(&store, rev, "l0", &gen, "sha-1", false)
            .unwrap_err()
            .code(),
        "duplicate"
    );
    assert_eq!(store.load_attempt("a1").unwrap().revision, rev);

    // Different payload without confirmation is refused.
    assert_eq!(
        import(&store, rev, "l0", &gen, "sha-2", false)
            .unwrap_err()
            .code(),
        "not_preparing"
    );
    // With confirmation it lands.
    let rev = import(&store, rev, "l0", &gen, "sha-2", true).unwrap();
    assert_eq!(
        store.load_attempt("a1").unwrap().imports["l0"].sha256,
        "sha-2"
    );
}

#[test]
fn importing_after_the_attempt_starts_is_refused() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (gen, rev) = issue(&store, 0, "l0", false);
    let started = store
        .commit("a1", rev, |a| {
            a.status = "active".into();
            Ok(())
        })
        .unwrap();

    assert_eq!(
        import(&store, started.revision, "l0", &gen, "sha", false)
            .unwrap_err()
            .code(),
        "not_preparing"
    );
}

#[test]
fn jobs_prepare_independently_and_a_stale_revision_never_overwrites() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (gen_l0, rev) = issue(&store, 0, "l0", false);
    let (gen_r0, rev) = issue(&store, rev, "r0", false);
    let rev = import(&store, rev, "l0", &gen_l0, "sha-l0", false).unwrap();

    // A second tab still holds the older revision and tries to write.
    assert_eq!(
        import(&store, rev - 1, "r0", &gen_r0, "sha-r0", false)
            .unwrap_err()
            .code(),
        "revision_conflict"
    );
    // The correct revision still works, and l0's material is untouched.
    let rev = import(&store, rev, "r0", &gen_r0, "sha-r0", false).unwrap();
    let after = store.load_attempt("a1").unwrap();
    assert_eq!(after.revision, rev);
    assert_eq!(after.imports["l0"].sha256, "sha-l0");
    assert_eq!(after.data["prepared"], json!(["l0", "r0"]));
}

#[test]
fn a_replacement_retains_the_previous_original() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    store.create(draft()).unwrap();
    let (gen, rev) = issue(&store, 0, "l0", false);
    let rev = import(&store, rev, "l0", &gen, "sha-1", false).unwrap();
    let first_path = store.load_attempt("a1").unwrap().imports["l0"]
        .original_path
        .clone();
    let rev = import(&store, rev, "l0", &gen, "sha-2", true).unwrap();

    let after = store.load_attempt("a1").unwrap();
    assert_eq!(after.imports["l0"].sha256, "sha-2");
    // The superseded original is still readable AND still holds its own bytes. A
    // shared filename would have left the history pointing at overwritten content.
    assert!(store.read_asset(&first_path).is_ok());
    assert_ne!(
        first_path, after.imports["l0"].original_path,
        "each acceptance needs its own path"
    );
    // And the audit history records both, oldest first.
    let history = &after.import_history["l0"];
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].sha256, "sha-1");
    assert!(history[0].superseded_at.is_some());
    assert_eq!(history[1].sha256, "sha-2");
    assert!(history[1].superseded_at.is_none());
    let _ = rev;
}

#[test]
fn native_assigns_identity_so_the_renderer_cannot_choose_it() {
    let dir = TempDir::new().unwrap();
    let store = Store::new(dir.path().to_path_buf());
    // A draft that tries to dictate its own id, owner and revision.
    let mut d = draft();
    d.id = "attacker-chosen-id".into();
    d.owner_id = "someone-else".into();
    d.revision = 999;
    d.status = "completed".into();
    let created = create_attempt_inner(&store, d).unwrap();
    assert_ne!(
        created.id, "attacker-chosen-id",
        "id must be assigned natively"
    );
    assert_eq!(created.owner_id, "local", "owner must be assigned natively");
    assert_eq!(created.revision, 0, "revision is assigned by the store");
    assert_eq!(created.created_at, created.updated_at);
}
