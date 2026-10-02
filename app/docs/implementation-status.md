# Implementation status

Evidence record per §21.1. Task states: **not started / in progress / blocked / verified**.

## Environment (measured, not assumed)

| Tool | Version | Note |
|---|---|---|
| Node | v24.15.0 | via nvm at `~/.nvm/versions/node/v24.15.0/bin/node` |
| Node (default PATH) | v16.20.2 | **do not use** — `/usr/local/bin/node` shadows nvm (§20.2.2) |
| pnpm | 11.25.0 | corepack-activated |
| cargo / rustc | 1.94.1 | Homebrew, both |
| macOS | 27.0.1 | arm64 |
| Windows | — | **not available on this machine**; Phase 6 gates unrunnable here |

Rust available; Tauri CLI `2.12.0` installed as a dev dependency.

## Phase 0 — Core and toolchain

| Task | State | Evidence |
|---|---|---|
| P0-01 | **verified** | Inventory above. Scaffold present: `package.json`, lockfile, Vite/TS config, `src/lib/types.ts`. Missing at start: `main.tsx`, `App.tsx`, `eslint.config.mjs`, `src-tauri/`, `docs/`, all `tests/`, all `src/lib/{material,import,guide}.ts`. |
| P0-02 | **verified** | Vite entrypoint + React mount + ESLint flat config. Tauri scaffold created and **`pnpm tauri dev` launched a real window** (`Running target/debug/ielts-studio`, process stable). Two drafts were created by clicking in the live UI and persisted to `~/Library/Application Support/local.ielts.studio/attempts.json` with its backup alongside — native assigned both UUIDs and `owner_id: local`, and all nine full-scope jobs are present. macOS *bundling* is still blocked: only CommandLineTools, not full Xcode. |
| P0-03 | **verified** | `src/lib/types.ts` extended: `RawMaterial` family separated from normalized types, nullable `SectionResult.band` (zero placeholder removed), 60-member `ErrorCode`, `ValidationError`, versioned `JobRequest`/`ImportRef`, `ImportHistoryEntry`, typed `VoiceMap` (no `unknown`), §18.2 command payloads. `tests/contract.test.ts` asserts nullable bands and error codes. |
| P0-04 | **verified** | `src/lib/material.ts` (839 lines) written by coordinator after the subagent died. Full §6 contract: shape validation, block/Writing/Speaking semantics, transport-neutral `requirements()`, `emptyTest` with explicit generation metadata, single `applyMaterial`. 61 tests in `tests/material.test.ts`, one rule broken at a time, each asserting its ErrorCode. |
| P0-05 | **verified** | `src/lib/import.ts` (350 lines) landed before its agent died. Bounded scanner enforces depth 32 during parse, decoded-key duplicate detection, `__proto__`/`constructor`/`prototype` rejection at every level, exact raw/fenced grammar, 1 MiB cap. `tests/parser.test.ts` (24 tests) written by coordinator — the agent shipped **zero** tests for it. |
| P0-06 | **verified** | `src/lib/guide.ts` (318 lines) + `tests/guide.test.ts` (20 tests). One fenced block, singleton-enum identity pinning, no tool/MCP wording, deterministic output, repair reuses the issued snapshot. |
| P1-01 | **verified** | `src-tauri/src/store.rs` with atomic write (unique temp → fsync → backup → rename), revision checks, corrupt-store backup fallback, future-version refusal, traversal rejection, asset-first writes. **10/10 Rust tests pass**, clippy clean at `-D warnings`. |
| P1-02 | **partial** | `create_attempt` / `list_attempts` / `load_attempt` / `delete_attempt` commands. Attempt id and owner are assigned natively so the renderer cannot claim another owner. |
| P1-03 | **partial** | `issue_request` persists a generation id + snapshot; repeated issue reuses both, only `rotate` replaces them. |
| P1-04 | **partial** | `commit_import` re-checks lifecycle, generation id and revision natively, writes the original asset before metadata, dedupes on sha256, and appends to audit history on replacement. Renderer side `import-pipeline.ts` stages on a clone with an `ActionCounter` guard. 15 TS tests pass. |
| P1-05 | **partial** | Duplicate no-op and replacement confirmation are implemented on both sides; the confirm UI is in `preparation.tsx`. |
| P1-06 | **partial** | `src/components/preparation.tsx` — one screen: draft creation, job list with prepared state, copy prompt / rotate, paste, validate, answer-bearing preview, replace confirmation, repair-request copy. No player, model or provider dependencies. |
| P1-07 | delegated | Export/restore handed to the native-layer agent. |
| P2-01 | **verified, with a finding that changes the plan** | `src/lib/voices.ts` + `tests/voices.test.ts` (11 tests) parse the **installed** kokoro-js package and pin every voice id, gender and accent to it. The package ships 17 voices: 9 American (**all male**) and 8 British (4M/4F). **There is no American female voice.** Only British can form a male/female dialogue pair, so all four dialogue sets are British. Seeded resolution guarantees P1≠P3 and a stable retry. |
| P1-08 | **harness ready, trials not run** | `src/lib/trials.ts` + `tests/trials.test.ts` (10 tests): renders the real prompt per job, validates a real pasted response, records outcome with its error code, enforces the 2-repair budget, and renders a **redacted** evidence file that never contains model content. The gate deliberately reports NOT ready until every trial is imported **and** human-reviewed. **The trials themselves still need a human** to paste into a real chat. |
| P0-07 | **verified** | **127 tests, all passing**: 4 contract + 24 parser + 20 guide + 8 guide↔material consistency + 71 material §6 matrix. `tests/guide-contract.test.ts` fails if prompt text drifts from the validation contract (§5.2). Runner confirmed on bare Node 24, no transform step. |

## Command evidence

```
$ pnpm typecheck   # tsc -b --noEmit --incremental false
PASS
$ pnpm test        # node --test tests/*.test.ts
PASS  (300 tests, 0 fail)
$ pnpm lint        # eslint src tests
PASS
$ pnpm build       # tsc -b && vite build
PASS  dist/assets/index-*.js 190.68 kB │ gzip: 60.10 kB
```

```
$ pnpm tauri dev
Running BeforeDevCommand (`pnpm dev`)   -> VITE ready, http://localhost:5173/
Running DevCommand (`cargo run --no-default-features`)
Finished `dev` profile in 9.69s
Running `target/debug/ielts-studio`      <-- real window, process stable

$ cargo build --manifest-path src-tauri/Cargo.toml
Finished `dev` profile [unoptimized + debuginfo] target(s)
$ cargo fmt --manifest-path src-tauri/Cargo.toml
(applied)
```

$ cargo fmt --manifest-path src-tauri/Cargo.toml -- --check     # clean
$ cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
Finished (0 warnings)
$ cargo test --manifest-path src-tauri/Cargo.toml --lib
test result: ok. 10 passed; 0 failed; finished in 0.08s

## Blockers and decisions

**Three P0 subagents failed on provider connectivity, not on code.** "Hermes can't reach the
model provider" after 444–467s each. Two of the three had already written their source files
before dying, so partial work survived; the parser's agent wrote none of its tests. A
subagent self-report is not evidence either way (§16.3) — every claim above was re-verified by
running the four commands directly.

**Integration risk from the P0-06 agent — now closed.** `guide.ts` originally took its
requirements as an injected parameter because `material.ts` did not exist, leaving prompt text
and §6 constraints as two hand-kept sources. `src/lib/guide-requirements.ts` now derives the
guide's requirements from `material.requirements()`, and `tests/guide-contract.test.ts` asserts
the rendered guide carries the contract's own numbers. Editing a constraint in one place and
forgetting the other now fails a test.

**Five real bugs found and fixed during verification.** The first two were in agent-written
code and the next three in coordinator-written `material.ts`. All were caught by tests that did
not exist when the code was written:
- `import.ts:286` — TS18048 under `noUncheckedIndexedAccess`; `LITERALS.find()` returns
  `T | undefined` and the `never`-returning guard sits on a separate statement.
- `import.ts:56` — **latent correctness bug**: the BOM was stripped only at index 0, so
  `"  \uFEFF{…}"` (whitespace before BOM) leaked a stray character. §7.1 says "a leading UTF-8
  BOM *and* surrounding whitespace"; order matters. Now trims, then strips, then re-trims.
- `material.ts` applyMaterial speaking branch — `const raw = raw as RawSpeaking` shadowed the
  parameter, throwing `Cannot access 'raw' before initialization` on every Speaking import.
- `material.ts` option counting — `tfng`/`ynng` were routed through the generic
  multiple-choice count, so a **legal** 3-option `["TRUE","FALSE","NOT GIVEN"]` array was
  rejected as `choice_count` before the format rule could pass it. Every TFNG question was
  unimportable.
- `material.ts` NOT GIVEN detection — keyed on `choices[2] === 'NOT GIVEN'`, which treated a
  *malformed* array like `["FALSE","TRUE","NOT GIVEN"]` as a genuine NOT GIVEN question and
  skipped its evidence requirement. Now requires `correct === 2` **and** the exact literal.
- `material.ts` sparse arrays — `applyMaterial` assigned `bucket[2]` on an empty array, leaving
  holes, then dereferenced `block.questions` on `undefined`. Preparing a non-first part of a
  full test crashed. Now skips holes, with a regression test asserting a partially prepared
  attempt stays sparse without throwing.

Ordering was also corrected: script structure is validated *before* the word window, because an
empty or blank turn shortens the joined source and was being reported as a length failure,
hiding the real defect.

**`pnpm approve-builds` on kokoro-js transitive deps.** `kokoro-js@1.2.1` pulls `onnxruntime-node`,
`protobufjs` and `sharp`; pnpm 11 refuses to run any command while their build scripts are
unapproved. Phase 0 never executes kokoro, so `pnpm-workspace.yaml` sets
`allowBuilds: {onnxruntime-node: false, protobufjs: false, sharp: false}`. **This is a decision to
revisit at P2-02**, where the offline audio gate decides whether local TTS actually needs them.
Not a silent workaround — an explicit Phase 0 scope decision.

**ESLint `no-explicit-any` set to error.** §16.1 forbids an `any` escape for envelope and voice-map
payloads. Unknown model JSON is typed `unknown`. This is why `typescript-eslint` was added.

## Not verified

- No real-model generation trial has been run (§9.1). Test fixtures are test data, never reported
  as an external model response.
- No audio work. Kokoro weights, voice IDs and fp32 feasibility are all Phase 2.
- No native persistence. §8 durability claims are entirely unproven.
- No Windows evidence of any kind.