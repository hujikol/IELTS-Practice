# Native layer

Rust side of the Tauri shell. The renderer never touches the filesystem.

## Layout

| File | Role |
|---|---|
| `src/store.rs` | Durable JSON store: atomic writes, revisions, recovery, asset paths. |
| `src/commands.rs` | The allowlisted command surface. |
| `src/lib.rs` | Builder, plugin registration, single-instance guard. |

## Commands

`create_attempt`, `list_attempts`, `load_attempt`, `delete_attempt`, `issue_request`,
`commit_import`.

Deliberately absent: any shell execution, any generic read/write-file command, and any
command taking a filesystem path from the renderer. Every path is resolved by native code
from an attempt id and a known subdirectory, and `Store::safe_join` rejects `..`, absolute
paths and empty input.

## Durability

`write_atomic` writes a uniquely named temp file in the destination directory, `fsync`s it,
copies the current file to `<name>.previous.json`, then renames over the target and fsyncs
the parent directory. A crash therefore leaves either the old file or the new one.

`Store::load` falls back to the backup when the main file is unparseable, so a corrupt store
surfaces recovery instead of an empty history. A store from a *newer* version is refused
rather than downgraded.

Revision checks live in `Store::commit`: every modifying command passes
`expected_revision`, and a mismatch returns `StoreError::Conflict` so the UI reloads
instead of applying a stale snapshot. One `Mutex` serializes all read-modify-write cycles —
a renderer-side queue is not sufficient.

## Known limits

- `commit_import` returns `StoreError::Duplicate` for an identical `sha256` on the same
  generation. The renderer surfaces it as a normal `CommandError`, so a duplicate currently
  looks like a failure in the UI. It should be treated as a silent success.
- Windows atomic-replace semantics are untested. `std::fs::rename` over an existing file
  behaves differently on Windows, and Phase 6 requires an OS fault test before release.
- `Store::load` takes a write lock, so a caller that already holds it must use
  `read_unlocked`. The `Mutex` is not reentrant and the compiler cannot catch a violation.
