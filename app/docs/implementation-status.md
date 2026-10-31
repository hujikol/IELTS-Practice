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

## Milestone & Feature Verification Summary

| Feature / Task | State | Evidence & Implementation Details |
|---|---|---|
| **Core & Storage (P0–P1)** | **verified** | Client-side durable storage (`localStorage`), revision conflict protection, atomic transactions. 461 unit tests passing. |
| **Material Generation & Validation** | **verified** | Full mock tests (`l1–l4`, `r1–r3`, `w1–w2`, `s1–s3`) & single-skill focused modules with schema validation. |
| **Neural Listening Audio (P2-02)** | **verified** | Kokoro-82M FP32 neural TTS in ONNX WebAssembly. Permanent offline caching in `CacheStorage` and `IndexedDB`. Character dialogue mapping. |
| **Interactive Map & Plan Labelling** | **verified** | Architectural vector SVG maps, HTML5 drag-and-drop and click-to-place pins (`A`–`H`), clean place-name parsing, bi-directional syncing. |
| **Interactive Speaking Section** | **verified** | 1-on-1 authentic interview state machine (`MIC_CHECK` -> `INTRO` -> `PART 1` -> `PART 2` -> `PART 3` -> `FINISHED`). `MediaRecorder` with WebM/Opus / MP4 fallback, Web Audio `AnalyserNode` live input level meter, VAD silence auto-advance, Cambridge Cue Card layout (60s prep countdown & 2:00 auto-stop timer), resilient IndexedDB audio storage (`ielts_studio_speaking_db`), and live Web Speech API verbatim candidate transcription. |
| **Dual Operating Modes** | **verified** | **Practice Mode** (unlimited time, question text visible, unlimited audio replay, re-recording permitted, scratchpad notes in all parts) vs **Exam Mode** (strict 11–14 min simulation, audio-only questions, 1 take, auto-timers, max 1 repeat request). |
| **Streamlined Dashboard (/web-uix)** | **verified** | 5-card module focus launcher, 1-click segmented timing switch, contextual 2-way conversational listening shortcut, executive proficiency stats (Best Band, CEFR badge, category averages), compact scannable test history, confirmation modal with soft rose destructive hover state. |
| **Diagnostic Review Screen (/web-uix)** | **verified** | High-contrast approachable educational diagnostic hero, official CEFR concordance (`C2` down to `A1`), adaptive dynamic section tabs, unified Overview & 7-Day Plan with persistent checkboxes, stem-bearing question comparison cards, and unified Cambridge explanation/evidence containers. |
| **Deterministic Scoring & Guarantees** | **verified** | Hard Rule: code computes all numbers. Zero fabricated bands for unattempted writing/speaking. Verbatim quote verification. |

## Command Evidence

```
$ pnpm typecheck   # tsc -b --noEmit --incremental false
PASS (0 errors)

$ pnpm test        # node --test tests/*.test.ts
PASS (461 tests, 0 fail)

$ pnpm lint        # eslint src tests
PASS (0 warnings)

$ pnpm build       # tsc -b && vite build
PASS dist/assets/index-*.js 501.43 kB │ gzip: 149.69 kB
```

## Speaking Section Architectural Details
- **Hardware Check**: `navigator.mediaDevices.getUserMedia` permission querying, live Web Audio API `AudioContext` and `AnalyserNode` input signal level calculation (0–100%), and 3-second sample test clip recording with instant playback check.
- **Recording Engine**: `MediaRecorder` with `timeslice` of 1000ms saving chunked Blobs into IndexedDB to guard against unexpected tab closures.
- **VAD Auto-Advance**: In Exam Mode, silence detection monitors candidate pause length: 3s silence in Part 1 (following ≥3s speech) and 4s silence in Part 3 automatically advances to the next question.
- **Examiner Audio Dual-Engine**: Kokoro-82M neural FP32 speech synthesis with zero-latency Web Speech API `speechSynthesis` fallback.
- **Part 2 Cue Card Flow**: 60-second preparation countdown with active notes drafting, transitioning to a 2-minute individual long turn with read-only notes reference.
