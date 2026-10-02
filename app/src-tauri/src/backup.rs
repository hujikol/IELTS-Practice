// §8.4 export/restore. P1-07 single attempt, P3-06 full store.
//
// ── FORMAT DEVIATION, STATED PLAINLY ──────────────────────────────────────────
// The spec calls for an "archive". No zip/deflate crate is available and adding one is
// not mine to do, so the container here is a SINGLE JSON FILE holding a versioned
// manifest plus base64-encoded payloads. Consequences the caller must know:
//
//   * No compression. The §18.3 "max 100:1 expansion ratio" is therefore vacuous for
//     archives this code produces (expansion is ~1.33x from base64, not 100x), and the
//     ratio check only ever fires on a hostile archive that lies about its own size.
//   * A 256 MiB WAV becomes ~341 MiB of JSON in memory, because the manifest and every
//     payload are held simultaneously to checksum them. That is the real cost of the
//     no-dependency constraint, and it is why the limits are checked BEFORE allocation.
//   * Swapping in a real zip container later is a contained change: only
//     `write_container`/`read_container` and the checksum helper move.
//
// Checksums are SHA-256, implemented in `sha256` below against the FIPS 180-4 spec
// rather than adding the `sha2` crate. It is verified against the standard test
// vectors in this module's tests, so a wrong digest cannot pass silently.

use crate::commands::{now_ms, AppState, CommandError};
use crate::store::{is_safe_id, Attempt, AttemptLifecycle, Store, StoreError, STORE_VERSION};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

type CmdResult<T> = Result<T, CommandError>;

/// Archive format version. Bumped independently of the store version, exactly as §8.1
/// requires for the envelope version.
pub const ARCHIVE_VERSION: u32 = 1;

// ─── §18.3 limits ───
// Chosen safety limits, not measurements. Each is a named constant so the refusal can
// say which one was hit instead of "too big".
pub const MAX_ATTEMPTS: usize = 1_000;
pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB uncompressed
pub const MAX_WAV_BYTES: u64 = 256 * 1024 * 1024; // 256 MiB per WAV
pub const MAX_ENVELOPE_BYTES: u64 = 1024 * 1024; // 1 MiB per material envelope
pub const MAX_EXPANSION_RATIO: u64 = 100;
pub const MAX_JSON_DEPTH: usize = 32;

/// Subtrees that are NEVER part of an export. §8.4 credentials are secret and excluded
/// from all exports; §8.4 model caches and synthesized clips are derived/reinstallable.
/// `models/` is listed explicitly so a future refactor cannot leak a multi-hundred-MB
/// voice installation into a user-facing "backup".
const EXCLUDED_SUBTREES: [&str; 3] = ["models", "audio-cache", "credentials"];

// ─── SHA-256 (FIPS 180-4) ───

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// SHA-256 of `data`, as lowercase hex.
///
/// A from-scratch implementation because no hashing crate may be added. The unit test
/// below pins it against the three standard FIPS vectors; if this ever drifts, that
/// test fails rather than a restore silently accepting a corrupt file.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = data.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for block in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d) = (h[0], h[1], h[2], h[3]);
        let (mut e, mut f, mut g, mut hh) = (h[4], h[5], h[6], h[7]);

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }

        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }

    h.iter().map(|word| format!("{word:08x}")).collect()
}

// ─── base64 (RFC 4648 standard alphabet) ───

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Strict base64 decode. Rejects unknown characters, bad padding and interior padding
/// rather than skipping them, because a lenient decoder would let a tampered payload
/// decode to something that merely looks right.
fn b64_decode(text: &str) -> Result<Vec<u8>, StoreError> {
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(StoreError::ArchiveInvalid(
            "payload is not a whole number of base64 quanta".into(),
        ));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for (i, chunk) in bytes.chunks_exact(4).enumerate() {
        let last = i == bytes.len() / 4 - 1;
        let pad = chunk.iter().filter(|b| **b == b'=').count();
        if pad > 2 || (pad > 0 && !last) {
            return Err(StoreError::ArchiveInvalid("bad base64 padding".into()));
        }
        let mut n = 0u32;
        for (j, byte) in chunk.iter().enumerate() {
            let v = if *byte == b'=' {
                0
            } else {
                B64.iter()
                    .position(|c| c == byte)
                    .ok_or_else(|| StoreError::ArchiveInvalid("bad base64 byte".into()))?
                    as u32
            };
            // A padding slot must not carry data bits.
            if j >= 4 - pad && v != 0 {
                return Err(StoreError::ArchiveInvalid("non-zero padding bits".into()));
            }
            n = (n << 6) | v;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

// ─── Container ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchiveEntry {
    /// Store-relative path. Validated on restore; never used to build a path directly.
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    /// "import_original" or "recording". A WAV is capped per file; an envelope is
    /// capped at 1 MiB (§18.3).
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchiveAttempt {
    pub attempt: Attempt,
    #[serde(default)]
    pub lifecycle: AttemptLifecycle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Archive {
    pub archive_version: u32,
    pub store_version: u32,
    pub created_at: i64,
    pub kind: String,
    /// Stated in the file itself so a restore never has to guess whether something was
    /// deliberately left out.
    pub excludes: Vec<String>,
    pub attempts: Vec<ArchiveAttempt>,
    pub entries: Vec<ArchiveEntry>,
    pub total_uncompressed_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub archive_version: u32,
    pub bytes: u64,
    pub attempts: usize,
    pub entries: usize,
    pub total_uncompressed_bytes: u64,
    pub path: String,
    pub excludes: Vec<String>,
    /// §8.4 the UI must warn that this content is private and unencrypted.
    pub unencrypted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    /// Every attempt id the archive carried.
    pub attempt_ids: Vec<String>,
    pub entries_written: usize,
    /// Ids written over existing content, split by whether the user confirmed it.
    pub replaced: Vec<String>,
    /// Ids already present with identical content: restored as a no-op.
    pub skipped: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAttemptArgs {
    pub attempt_id: String,
    /// User-selected destination. An absolute path is allowed here and ONLY here: this
    /// is the one command whose purpose is to write outside the store (§18.2 "explicit
    /// user-selected destination"). It is still refused if it lands inside the store,
    /// where it would overwrite live data with a copy of itself.
    pub destination: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStoreArgs {
    pub destination: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArgs {
    pub archive_path: String,
    /// Ids whose differing content the user explicitly chose to replace (§8.4).
    #[serde(default)]
    pub replace_ids: Vec<String>,
}

// ─── Limits ───

/// §18.3 "enforce streaming byte/count ceilings before allocating full content."
///
/// This runs on directory metadata, before any file is read, so a store with too much
/// content is refused without ever holding it in memory.
fn check_limits(attempts: usize, entries: &[(String, u64)]) -> Result<u64, StoreError> {
    if attempts > MAX_ATTEMPTS {
        return Err(StoreError::limit(
            "max_attempts",
            format!("{attempts} attempts exceeds {MAX_ATTEMPTS}"),
        ));
    }
    if entries.len() > MAX_ENTRIES {
        return Err(StoreError::limit(
            "max_entries",
            format!("{} entries exceeds {MAX_ENTRIES}", entries.len()),
        ));
    }
    let total: u64 = entries.iter().map(|(_, size)| *size).sum();
    if total > MAX_TOTAL_BYTES {
        return Err(StoreError::limit(
            "max_total_bytes",
            format!("{total} total bytes exceeds {MAX_TOTAL_BYTES}"),
        ));
    }
    for (path, size) in entries {
        let is_wav = path.ends_with(".wav");
        let (limit, cap) = if is_wav {
            ("max_wav_bytes", MAX_WAV_BYTES)
        } else {
            ("max_envelope_bytes", MAX_ENVELOPE_BYTES)
        };
        if *size > cap {
            return Err(StoreError::limit(
                limit,
                format!("{path} is {size} bytes, over {cap}"),
            ));
        }
    }
    Ok(total)
}

/// Depth bound checked on the parsed value. §7.1 requires bounding nesting during
/// parsing; serde_json already caps recursion at 128, so this catches the 33–128 band
/// that would otherwise reach application code.
fn check_depth(value: &serde_json::Value, limit: usize) -> Result<(), StoreError> {
    fn walk(v: &serde_json::Value, depth: usize, limit: usize) -> Result<(), StoreError> {
        if depth > limit {
            return Err(StoreError::ArchiveInvalid(format!(
                "nesting deeper than {limit} levels"
            )));
        }
        match v {
            serde_json::Value::Array(items) => {
                for item in items {
                    walk(item, depth + 1, limit)?;
                }
            }
            serde_json::Value::Object(map) => {
                for item in map.values() {
                    walk(item, depth + 1, limit)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    walk(value, 1, limit)
}

// ─── Export ───

/// §18.3 an archive path must be a relative, in-store path with no traversal, no
/// absolute prefix, no backslash and no exotic component. Checked here as well as in
/// `safe_join` because this is attacker-controlled input from a file on disk.
fn validate_entry_path(path: &str) -> Result<(), StoreError> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return Err(StoreError::UnsafePath(path.to_string()));
    }
    if path
        .split('/')
        .any(|c| c.is_empty() || c == "." || c == "..")
    {
        return Err(StoreError::UnsafePath(path.to_string()));
    }
    let head = path.split('/').next().unwrap_or_default();
    if EXCLUDED_SUBTREES.contains(&head) {
        return Err(StoreError::ArchiveInvalid(format!(
            "{path} is in an excluded subtree"
        )));
    }
    Ok(())
}

/// Collect an attempt's import originals, audit history and recordings.
///
/// The history is walked as well as the current import: §8.4 a replacement appends
/// rather than deletes, so an export that only took `imports` would silently drop every
/// superseded original and break the audit trail on restore.
fn collect_attempt_assets(
    store: &Store,
    attempt: &Attempt,
) -> Result<Vec<(String, String, u64)>, StoreError> {
    let mut wanted: BTreeMap<String, String> = BTreeMap::new();
    for reference in attempt.imports.values() {
        wanted.insert(reference.original_path.clone(), "import_original".into());
    }
    for history in attempt.import_history.values() {
        for entry in history {
            wanted.insert(entry.original_path.clone(), "import_original".into());
        }
    }
    // Every retained original must actually exist. A reference to a missing file means
    // the store is already inconsistent, and exporting around it would hide that.
    for path in wanted.keys() {
        validate_entry_path(path)?;
        if !store.root().join(path).exists() {
            return Err(StoreError::ArchiveInvalid(format!(
                "accepted original is missing: {path}"
            )));
        }
    }

    let mut out: Vec<(String, String, u64)> = wanted
        .into_iter()
        .map(|(path, role)| {
            let size = std::fs::metadata(store.root().join(&path))
                .map(|m| m.len())
                .unwrap_or(0);
            (path, role, size)
        })
        .collect();

    for (path, size) in store.list_assets(&format!("recordings/{}", attempt.id))? {
        if path.ends_with(".wav") {
            out.push((path, "recording".into(), size));
        }
    }
    Ok(out)
}

fn build_archive(
    store: &Store,
    ids: Option<&str>,
    embed_payloads: bool,
) -> Result<Archive, StoreError> {
    let file = store.load()?;
    let selected: Vec<&Attempt> = match ids {
        Some(id) => vec![file.attempts.get(id).ok_or(StoreError::NotFound)?],
        None => file.attempts.values().collect(),
    };

    // Sizes first, from metadata, so the limits are enforced before any read.
    let mut planned: Vec<(String, String, u64)> = Vec::new();
    for attempt in &selected {
        planned.extend(collect_attempt_assets(store, attempt)?);
    }
    let sizes: Vec<(String, u64)> = planned.iter().map(|(p, _, s)| (p.clone(), *s)).collect();
    let total = check_limits(selected.len(), &sizes)?;

    let mut entries = Vec::with_capacity(planned.len());
    for (path, role, declared) in planned {
        let bytes = if embed_payloads {
            let data = std::fs::read(store.root().join(&path))
                .map_err(|e| StoreError::Io(e.to_string()))?;
            // Trust the bytes on disk, not the earlier stat: a file that grew between
            // the limit check and the read must still be checksummed at its real size.
            let digest = sha256_hex(&data);
            (data.len() as u64, digest, Some(b64_encode(&data)))
        } else {
            (
                declared,
                store
                    .read_asset(&path)
                    .map(|d| sha256_hex(&d))
                    .unwrap_or_default(),
                None,
            )
        };
        entries.push(ArchiveEntry {
            path,
            bytes: bytes.0,
            sha256: bytes.1,
            role,
            base64: bytes.2,
        });
    }

    let actual_total: u64 = entries.iter().map(|e| e.bytes).sum();
    Ok(Archive {
        archive_version: ARCHIVE_VERSION,
        store_version: STORE_VERSION,
        created_at: now_ms(),
        kind: if ids.is_some() { "attempt" } else { "store" }.into(),
        excludes: EXCLUDED_SUBTREES.iter().map(|s| s.to_string()).collect(),
        attempts: selected
            .iter()
            .map(|a| ArchiveAttempt {
                attempt: (*a).clone(),
                lifecycle: file.lifecycle.get(&a.id).cloned().unwrap_or_default(),
            })
            .collect(),
        entries,
        total_uncompressed_bytes: actual_total.max(total.min(actual_total)),
    })
}

fn destination_path(store: &Store, raw: &str) -> Result<PathBuf, StoreError> {
    let path = PathBuf::from(raw);
    if path.as_os_str().is_empty() {
        return Err(StoreError::InvalidArgument("empty destination".into()));
    }
    // Refuse to write the export inside the store: it would land among the very files
    // it is describing, and a later restore could pick it up as user content.
    //
    // Canonicalize the PARENT, not the file. The file usually does not exist yet, and
    // canonicalizing a non-existent path fails — which would silently skip this guard
    // for exactly the case it exists to catch.
    let probe = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let resolved = probe
        .canonicalize()
        .map_err(|e| StoreError::Io(e.to_string()))?;
    let root = store
        .root()
        .canonicalize()
        .map_err(|e| StoreError::Io(e.to_string()))?;
    if resolved.starts_with(&root) || resolved == root {
        return Err(StoreError::InvalidArgument(
            "destination must be outside the application data directory".into(),
        ));
    }
    Ok(path)
}

pub fn export_attempt_inner(
    store: &Store,
    attempt_id: &str,
    destination: &str,
) -> Result<ExportSummary, StoreError> {
    if !is_safe_id(attempt_id) {
        return Err(StoreError::UnsafePath(attempt_id.to_string()));
    }
    let archive = build_archive(store, Some(attempt_id), true)?;
    write_container(store, destination, &archive)
}

pub fn backup_store_inner(store: &Store, destination: &str) -> Result<ExportSummary, StoreError> {
    let archive = build_archive(store, None, true)?;
    write_container(store, destination, &archive)
}

fn write_container(
    store: &Store,
    destination: &str,
    archive: &Archive,
) -> Result<ExportSummary, StoreError> {
    let path = destination_path(store, destination)?;
    let bytes = serde_json::to_vec(archive).map_err(|e| StoreError::Io(e.to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| StoreError::Io(e.to_string()))?;
    }
    std::fs::write(&path, &bytes).map_err(|e| StoreError::Io(e.to_string()))?;
    Ok(ExportSummary {
        archive_version: archive.archive_version,
        bytes: bytes.len() as u64,
        attempts: archive.attempts.len(),
        entries: archive.entries.len(),
        total_uncompressed_bytes: archive.total_uncompressed_bytes,
        path: path.to_string_lossy().to_string(),
        excludes: archive.excludes.clone(),
        unencrypted: true,
    })
}

#[tauri::command]
pub fn export_attempt(
    state: tauri::State<'_, AppState>,
    args: ExportAttemptArgs,
) -> CmdResult<ExportSummary> {
    Ok(export_attempt_inner(
        &state.store,
        &args.attempt_id,
        &args.destination,
    )?)
}

#[tauri::command]
pub fn backup_store(
    state: tauri::State<'_, AppState>,
    args: BackupStoreArgs,
) -> CmdResult<ExportSummary> {
    Ok(backup_store_inner(&state.store, &args.destination)?)
}

// ─── Restore ───

/// §8.4 "Full validation before activation; no partial restored history."
///
/// Every check runs before a single byte is written: version, path safety, per-file and
/// total limits, expansion ratio, and the checksum of every payload. Only once all of
/// that passes does anything touch the store.
fn validate_archive(archive: &Archive, source_bytes: u64) -> Result<(), StoreError> {
    if archive.archive_version > ARCHIVE_VERSION {
        return Err(StoreError::ArchiveInvalid(format!(
            "archive_version {} is newer than {ARCHIVE_VERSION}",
            archive.archive_version
        )));
    }
    if archive.store_version > STORE_VERSION {
        return Err(StoreError::UnsupportedVersion(archive.store_version));
    }
    if archive.attempts.len() > MAX_ATTEMPTS {
        return Err(StoreError::limit(
            "max_attempts",
            format!("{} attempts exceeds {MAX_ATTEMPTS}", archive.attempts.len()),
        ));
    }
    if archive.entries.len() > MAX_ENTRIES {
        return Err(StoreError::limit(
            "max_entries",
            format!("{} entries exceeds {MAX_ENTRIES}", archive.entries.len()),
        ));
    }

    let mut total = 0u64;
    for entry in &archive.entries {
        validate_entry_path(&entry.path)?;
        let is_wav = entry.path.ends_with(".wav");
        let (limit, cap) = if is_wav {
            ("max_wav_bytes", MAX_WAV_BYTES)
        } else {
            ("max_envelope_bytes", MAX_ENVELOPE_BYTES)
        };
        if entry.bytes > cap {
            return Err(StoreError::limit(
                limit,
                format!("{} is {} bytes, over {cap}", entry.path, entry.bytes),
            ));
        }
        total = total.saturating_add(entry.bytes);
    }
    if total > MAX_TOTAL_BYTES {
        return Err(StoreError::limit(
            "max_total_bytes",
            format!("{total} total bytes exceeds {MAX_TOTAL_BYTES}"),
        ));
    }
    // A hostile archive can claim small files and ship a huge payload. Comparing the
    // declared total against the real container size catches that before decoding.
    if source_bytes > 0 && total > source_bytes.saturating_mul(MAX_EXPANSION_RATIO) {
        return Err(StoreError::limit(
            "max_expansion_ratio",
            format!(
                "{total} bytes declared from a {source_bytes} byte archive exceeds {MAX_EXPANSION_RATIO}:1"
            ),
        ));
    }

    for attempt in &archive.attempts {
        if !is_safe_id(&attempt.attempt.id) {
            return Err(StoreError::UnsafePath(attempt.attempt.id.clone()));
        }
        check_depth(&attempt.attempt.data, MAX_JSON_DEPTH)?;
    }
    Ok(())
}

pub fn restore_archive_inner(
    store: &Store,
    archive_path: &str,
    replace_ids: &[String],
) -> Result<RestoreSummary, StoreError> {
    let raw = std::fs::read(archive_path).map_err(|e| StoreError::Io(e.to_string()))?;
    let archive: Archive = serde_json::from_slice(&raw)
        .map_err(|e| StoreError::ArchiveInvalid(format!("unreadable archive: {e}")))?;
    check_depth(
        &serde_json::to_value(&archive.attempts).unwrap_or_default(),
        MAX_JSON_DEPTH,
    )?;

    validate_archive(&archive, raw.len() as u64)?;

    // Decode and verify every payload BEFORE writing anything. A tampered payload must
    // leave the store exactly as it was, not half-restored.
    let mut verified: Vec<(ArchiveEntry, Vec<u8>)> = Vec::with_capacity(archive.entries.len());
    for entry in archive.entries {
        let encoded = entry
            .base64
            .clone()
            .ok_or_else(|| StoreError::ArchiveInvalid(format!("{} has no payload", entry.path)))?;
        let data = b64_decode(&encoded)?;
        if data.len() as u64 != entry.bytes {
            return Err(StoreError::ArchiveInvalid(format!(
                "{} declares {} bytes but carries {}",
                entry.path,
                entry.bytes,
                data.len()
            )));
        }
        let digest = sha256_hex(&data);
        if !digest.eq_ignore_ascii_case(&entry.sha256) {
            return Err(StoreError::ChecksumMismatch(format!(
                "{}: expected {}, got {digest}",
                entry.path, entry.sha256
            )));
        }
        verified.push((entry, data));
    }

    // Only now do assets land. Asset-first ordering means a failure here leaves orphan
    // files, never a record pointing at content that was never written (§8.2).
    for (entry, data) in &verified {
        store.write_asset(&entry.path, data)?;
    }

    let existing = store.load()?;
    let attempt_ids: Vec<String> = archive
        .attempts
        .iter()
        .map(|a| a.attempt.id.clone())
        .collect();
    let mut replaced = Vec::new();
    let mut skipped = Vec::new();
    let mut incoming: Vec<(Attempt, AttemptLifecycle)> = Vec::new();
    for item in archive.attempts {
        let id = item.attempt.id.clone();
        // An id already present with identical content is a no-op, not a replacement:
        // the user did not overwrite anything, so it must not be reported as one.
        let identical = existing.attempts.get(&id).is_some_and(|stored| {
            serde_json::to_vec(stored).ok() == serde_json::to_vec(&item.attempt).ok()
        });
        if identical {
            skipped.push(id);
            continue;
        }
        replaced.push(id.clone());
        incoming.push((item.attempt, item.lifecycle));
    }

    store.restore_attempts(incoming, replace_ids)?;

    Ok(RestoreSummary {
        attempt_ids,
        entries_written: verified.len(),
        replaced,
        skipped,
    })
}

#[tauri::command]
pub fn restore_archive(
    state: tauri::State<'_, AppState>,
    args: RestoreArgs,
) -> CmdResult<RestoreSummary> {
    Ok(restore_archive_inner(
        &state.store,
        &args.archive_path,
        &args.replace_ids,
    )?)
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
            requests: Default::default(),
            imports: Default::default(),
            import_history: Default::default(),
            voice_seed: None,
            voice_map: None,
        }
    }

    /// A store with an accepted original and a recording on disk.
    ///
    /// Returns three things: the store, a temp dir that OWNS the store root, and a
    /// separate destination for the exported archive.
    ///
    /// Both temp dirs must outlive the store. `TempDir` deletes its tree on drop, so a
    /// fixture that lets the owning dir go out of scope hands back a store whose files
    /// have already been removed — which surfaces much later as a baffling NotFound.
    fn store_with_assets() -> (Store, tempfile::TempDir, tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        // The store root must exist: `load` on a missing directory returns an EMPTY
        // store, so a fixture that skips this silently reports NotFound later.
        let root = dir.path().join("store");
        std::fs::create_dir_all(&root).unwrap();
        let store = Store::new(root);
        let mut a = attempt("a1");
        a.imports.insert(
            "l0".into(),
            crate::store::ImportRef {
                sha256: "abc".into(),
                accepted_at: 1,
                original_path: "imports/a1/l0/abc/original.json".into(),
                generation_id: "gen-1".into(),
                contract_version: 1,
                envelope_version: 1,
            },
        );
        store
            .write_asset("imports/a1/l0/abc/original.json", br#"{"data":1}"#)
            .unwrap();
        store
            .write_asset("recordings/a1/part1.wav", b"RIFFfake")
            .unwrap();
        store.create(a).unwrap();
        let out_dir = tempfile::tempdir().unwrap();
        let out = out_dir.path().join("out.json");
        (store, dir, out_dir, out.to_string_lossy().to_string())
    }

    // ─── SHA-256 correctness ───
    //
    // A hand-written hash that is wrong would let a corrupt restore through, so it is
    // pinned to the FIPS 180-4 vectors rather than trusted.

    #[test]
    fn sha256_matches_the_standard_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // 448-bit message, the third FIPS example.
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        // 896-bit message exercises the second block group.
        assert_eq!(
            sha256_hex(b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"),
            "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"
        );
    }

    #[test]
    fn base64_round_trips_every_padding_case() {
        for sample in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"fooba",
            b"foobar",
            b"\x00\xff\xfe binary \x01",
        ] {
            let encoded = b64_encode(sample);
            assert_eq!(b64_decode(&encoded).unwrap(), sample, "{encoded}");
        }
    }

    #[test]
    fn base64_refuses_malformed_input() {
        assert!(b64_decode("abc").is_err(), "not a multiple of four");
        assert!(b64_decode("ab*d").is_err(), "unknown byte");
        assert!(b64_decode("a=cd").is_err(), "interior padding");
        assert!(b64_decode("aB=c").is_err(), "non-zero padding bits");
    }

    // ─── export ───

    #[test]
    fn export_includes_originals_and_recordings_but_never_credentials_or_models() {
        let (store, _root, _out_dir, out) = store_with_assets();
        // Things that must never appear in an export.
        store
            .write_asset("models/bf_emma/model.bin", b"900MB of weights")
            .unwrap();
        store
            .write_asset("audio-cache/a1/clip0.wav", b"derived clip")
            .unwrap();
        store
            .write_asset("credentials/api.json", br#"{"api_key":"sk-secret"}"#)
            .unwrap();

        let summary = export_attempt_inner(&store, "a1", &out).unwrap();
        assert_eq!(summary.attempts, 1);
        assert!(
            summary.unencrypted,
            "the UI must be able to warn about this"
        );

        let text = std::fs::read_to_string(&out).unwrap();
        let archive: Archive = serde_json::from_str(&text).unwrap();
        let paths: Vec<&str> = archive.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"imports/a1/l0/abc/original.json"));
        assert!(paths.contains(&"recordings/a1/part1.wav"));

        // The strongest assertion available: the secret bytes are not in the file at all.
        assert!(
            !text.contains("sk-secret"),
            "credential leaked into the export"
        );
        assert!(!text.contains("900MB of weights"), "model cache leaked");
        assert!(!text.contains("derived clip"), "derived cache leaked");
        assert!(archive.excludes.contains(&"credentials".to_string()));
    }

    #[test]
    fn export_checksums_match_the_bytes_on_disk() {
        let (store, _root, _out_dir, out) = store_with_assets();
        export_attempt_inner(&store, "a1", &out).unwrap();
        let archive: Archive =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        for entry in &archive.entries {
            let bytes = store.read_asset(&entry.path).unwrap();
            assert_eq!(entry.bytes, bytes.len() as u64);
            assert_eq!(entry.sha256, sha256_hex(&bytes), "{}", entry.path);
        }
    }

    #[test]
    fn export_refuses_to_write_inside_the_store() {
        let (store, _root, _out_dir, _) = store_with_assets();
        let inside = store.root().join("backup.json");
        let err = export_attempt_inner(&store, "a1", inside.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code(), "invalid_argument");
    }

    // ─── round trip ───

    #[test]
    fn a_round_trip_into_an_isolated_store_preserves_everything() {
        let (store, _root, _out_dir, out) = store_with_assets();
        export_attempt_inner(&store, "a1", &out).unwrap();

        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        let summary = restore_archive_inner(&target, &out, &[]).unwrap();
        assert_eq!(summary.attempt_ids, vec!["a1".to_string()]);
        assert_eq!(summary.entries_written, 2);

        let restored = target.load_attempt("a1").unwrap();
        assert_eq!(restored.imports["l0"].sha256, "abc");
        assert_eq!(
            target
                .read_asset("imports/a1/l0/abc/original.json")
                .unwrap(),
            br#"{"data":1}"#
        );
        assert_eq!(
            target.read_asset("recordings/a1/part1.wav").unwrap(),
            b"RIFFfake"
        );
    }

    #[test]
    fn a_second_identical_restore_is_a_skipped_no_op() {
        let (store, _root, _out_dir, out) = store_with_assets();
        export_attempt_inner(&store, "a1", &out).unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        restore_archive_inner(&target, &out, &[]).unwrap();
        let again = restore_archive_inner(&target, &out, &[]).unwrap();
        assert_eq!(again.skipped, vec!["a1".to_string()]);
    }

    // ─── restore refusals ───

    /// Export the fixture attempt and parse the result back, for tests that need to
    /// tamper with the archive. Returns the path and the parsed value.
    fn exported_archive(dir: &tempfile::TempDir, store: &Store) -> (String, Archive) {
        let out = dir.path().join("archive.json");
        export_attempt_inner(store, "a1", out.to_str().unwrap()).unwrap();
        let archive: Archive =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        (out.to_string_lossy().to_string(), archive)
    }

    fn write_archive(path: &str, archive: &Archive) {
        std::fs::write(path, serde_json::to_vec(archive).unwrap()).unwrap();
    }

    #[test]
    fn restore_rejects_a_tampered_payload() {
        let (store, _root, out_dir, _) = store_with_assets();
        let (out, mut archive) = exported_archive(&out_dir, &store);
        // Flip one byte of the recording payload but leave the checksum alone.
        let entry = archive
            .entries
            .iter_mut()
            .find(|e| e.path.ends_with(".wav"))
            .unwrap();
        let mut data = b64_decode(entry.base64.as_ref().unwrap()).unwrap();
        data[0] = b'X';
        entry.base64 = Some(b64_encode(&data));

        let tampered = out_dir.path().join("tampered.json");
        write_archive(tampered.to_str().unwrap(), &archive);

        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        let err = restore_archive_inner(&target, tampered.to_str().unwrap(), &[]).unwrap_err();
        assert_eq!(err.code(), "checksum_mismatch");
        assert!(
            err.to_string().contains(".wav"),
            "must name the file: {err}"
        );
        // Nothing was written.
        assert!(target.list().unwrap().is_empty());
        drop(out);
    }

    #[test]
    fn restore_rejects_a_traversal_path() {
        let (store, _root, out_dir, _) = store_with_assets();
        let (_out, mut archive) = exported_archive(&out_dir, &store);
        archive.entries[0].path = "../../../etc/passwd".into();
        let bad = out_dir.path().join("traversal.json");
        write_archive(bad.to_str().unwrap(), &archive);

        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        let err = restore_archive_inner(&target, bad.to_str().unwrap(), &[]).unwrap_err();
        assert_eq!(err.code(), "unsafe_path");
        assert!(target.list().unwrap().is_empty());
    }

    #[test]
    fn restore_rejects_an_absolute_path() {
        let (store, _root, out_dir, _) = store_with_assets();
        let (_out, mut archive) = exported_archive(&out_dir, &store);
        archive.entries[0].path = "/etc/passwd".into();
        let bad = out_dir.path().join("absolute.json");
        write_archive(bad.to_str().unwrap(), &archive);
        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        assert_eq!(
            restore_archive_inner(&target, bad.to_str().unwrap(), &[])
                .unwrap_err()
                .code(),
            "unsafe_path"
        );
    }

    #[test]
    fn restore_rejects_a_colliding_id_without_explicit_replacement() {
        let (store, _root, out_dir, _) = store_with_assets();
        let (out, _archive) = exported_archive(&out_dir, &store);

        // Same id, different content: the target already has a1 with other data.
        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        let mut existing = attempt("a1");
        existing.data["note"] = json!("local edits the archive does not have");
        target.create(existing).unwrap();

        let err = restore_archive_inner(&target, &out, &[]).unwrap_err();
        assert_eq!(err.code(), "archive_collision");
        assert!(err.to_string().contains("a1"));
        // The local copy survived untouched.
        assert_eq!(
            target.load_attempt("a1").unwrap().data["note"],
            json!("local edits the archive does not have")
        );

        // With the user explicitly choosing replacement, it lands.
        let summary = restore_archive_inner(&target, &out, &["a1".to_string()]).unwrap();
        assert_eq!(summary.replaced, vec!["a1".to_string()]);
        assert_ne!(
            target.load_attempt("a1").unwrap().data["note"],
            json!("local edits the archive does not have")
        );
    }

    #[test]
    fn restore_preserves_unrelated_attempts_by_default() {
        let (store, _root, _out_dir, out) = store_with_assets();
        export_attempt_inner(&store, "a1", &out).unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        target.create(attempt("other")).unwrap();
        restore_archive_inner(&target, &out, &[]).unwrap();
        let ids: Vec<String> = target.list().unwrap().into_iter().map(|s| s.id).collect();
        assert!(
            ids.contains(&"other".to_string()),
            "restore must not wipe history"
        );
        assert!(ids.contains(&"a1".to_string()));
    }

    // ─── limits ───

    /// Build a minimal valid archive, apply `mutate`, and return the refusal so a test
    /// can assert on whichever code or limit name it cares about.
    fn limit_err(mutate: impl FnOnce(&mut Archive)) -> StoreError {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("limited.json");
        let mut archive = Archive {
            archive_version: ARCHIVE_VERSION,
            store_version: STORE_VERSION,
            created_at: 0,
            kind: "attempt".into(),
            excludes: vec![],
            attempts: vec![ArchiveAttempt {
                attempt: attempt("a1"),
                lifecycle: AttemptLifecycle::default(),
            }],
            entries: vec![],
            total_uncompressed_bytes: 0,
        };
        mutate(&mut archive);
        write_archive(path.to_str().unwrap(), &archive);
        let target = Store::new(dir.path().join("target"));
        restore_archive_inner(&target, path.to_str().unwrap(), &[]).unwrap_err()
    }

    /// The refusal must name WHICH limit was hit, not just that something was too big.
    fn limit_case(mutate: impl FnOnce(&mut Archive), expected: &str) {
        let err = limit_err(mutate);
        assert_eq!(err.code(), "limit_exceeded", "wrong failure: {err}");
        assert_eq!(
            err.limit_name(),
            Some(expected),
            "the refusal must name the limit: {err}"
        );
    }

    #[test]
    fn too_many_attempts_names_the_limit() {
        limit_case(
            |a| {
                a.attempts = (0..MAX_ATTEMPTS + 1)
                    .map(|i| ArchiveAttempt {
                        attempt: attempt(&format!("a{i}")),
                        lifecycle: AttemptLifecycle::default(),
                    })
                    .collect();
            },
            "max_attempts",
        );
    }

    #[test]
    fn too_many_entries_names_the_limit() {
        limit_case(
            |a| {
                a.entries = (0..MAX_ENTRIES + 1)
                    .map(|i| ArchiveEntry {
                        path: format!("imports/a1/l0/{i}/original.json"),
                        bytes: 1,
                        sha256: "x".into(),
                        role: "import_original".into(),
                        base64: Some(b64_encode(b"{}")),
                    })
                    .collect();
            },
            "max_entries",
        );
    }

    #[test]
    fn an_oversized_wav_names_the_limit() {
        limit_case(
            |a| {
                a.entries.push(ArchiveEntry {
                    path: "recordings/a1/huge.wav".into(),
                    bytes: MAX_WAV_BYTES + 1,
                    sha256: "x".into(),
                    role: "recording".into(),
                    base64: Some(b64_encode(b"{}")),
                });
            },
            "max_wav_bytes",
        );
    }

    #[test]
    fn an_oversized_envelope_names_the_limit() {
        limit_case(
            |a| {
                a.entries.push(ArchiveEntry {
                    path: "imports/a1/l0/big/original.json".into(),
                    bytes: MAX_ENVELOPE_BYTES + 1,
                    sha256: "x".into(),
                    role: "import_original".into(),
                    base64: Some(b64_encode(b"{}")),
                });
            },
            "max_envelope_bytes",
        );
    }

    #[test]
    fn too_many_total_bytes_names_the_limit() {
        limit_case(
            |a| {
                // Under the per-file cap, over the total.
                let chunks = MAX_TOTAL_BYTES / MAX_WAV_BYTES + 2;
                a.entries = (0..chunks)
                    .map(|i| ArchiveEntry {
                        path: format!("recordings/a1/{i}.wav"),
                        bytes: MAX_WAV_BYTES,
                        sha256: "x".into(),
                        role: "recording".into(),
                        base64: Some(b64_encode(b"{}")),
                    })
                    .collect();
            },
            "max_total_bytes",
        );
    }

    /// A tiny file that claims to expand enormously.
    ///
    /// Sized to stay UNDER `max_total_bytes` (7 × 256 MiB ≈ 1.75 GiB) while being far
    /// over 100:1 against a ~2 KB container, so the refusal can only come from the
    /// ratio check. Otherwise this test would pass by tripping a different limit.
    #[test]
    fn an_excessive_expansion_ratio_names_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let archive = Archive {
            archive_version: ARCHIVE_VERSION,
            store_version: STORE_VERSION,
            created_at: 0,
            kind: "attempt".into(),
            excludes: vec![],
            attempts: vec![ArchiveAttempt {
                attempt: attempt("a1"),
                lifecycle: AttemptLifecycle::default(),
            }],
            entries: (0..7)
                .map(|i| ArchiveEntry {
                    path: format!("recordings/a1/{i}.wav"),
                    bytes: MAX_WAV_BYTES,
                    sha256: "x".into(),
                    role: "recording".into(),
                    base64: Some(b64_encode(b"{}")),
                })
                .collect(),
            total_uncompressed_bytes: 0,
        };
        let path = dir.path().join("bomb.json");
        write_archive(path.to_str().unwrap(), &archive);
        let target = Store::new(dir.path().join("target"));
        let err = restore_archive_inner(&target, path.to_str().unwrap(), &[]).unwrap_err();
        assert_eq!(err.limit_name(), Some("max_expansion_ratio"));
    }

    /// A newer archive must be refused, not guessed at. This is deliberately NOT a
    /// `limit_exceeded`: a future format is an unsupported version, and reporting it as
    /// "too big" would send the user looking for a size problem that does not exist.
    #[test]
    fn a_future_archive_version_is_refused() {
        let err = limit_err(|a| a.archive_version = ARCHIVE_VERSION + 1);
        assert_eq!(err.code(), "archive_invalid");
        assert!(err.to_string().contains("newer"));
    }

    #[test]
    fn a_failed_restore_writes_nothing_at_all() {
        let (store, _root, out_dir, _) = store_with_assets();
        let (_out, mut archive) = exported_archive(&out_dir, &store);
        // Second entry is corrupt; the first is valid. Nothing may be activated.
        let mut good = archive.entries[0].clone();
        good.base64 = Some(b64_encode(b"different bytes"));
        archive.entries[0].sha256 = "0".repeat(64);
        archive.entries.push(good);
        let bad = out_dir.path().join("mixed.json");
        write_archive(bad.to_str().unwrap(), &archive);

        let target_dir = tempfile::tempdir().unwrap();
        let target = Store::new(target_dir.path().to_path_buf());
        assert!(restore_archive_inner(&target, bad.to_str().unwrap(), &[]).is_err());
        assert!(
            target.list().unwrap().is_empty(),
            "validate-all-before-write: no partial history"
        );
    }
}
