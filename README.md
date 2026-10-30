# IELTS Practice App

An offline-first, client-side web application for IELTS Academic preparation. Generates standardized mock tests, delivers authentic exam simulation conditions, provides deterministic code-first objective scoring, quote-verified writing and speaking evaluations, personalized weakness diagnostics, and CEFR level tracking.

---

## 🚀 Implementation Status

The project has completed its core architecture migration from legacy cloud/desktop wrappers into a clean, modern, pure TypeScript + React single-page application (`app/`).

| Milestone / Feature | Status | Notes |
|---|---|---|
| **Core Architecture & Storage** | ✅ Complete | Browser-native durable storage (`localStorage`), revision conflict protection, atomic transactions. |
| **Material Generation & Validation** | ✅ Complete | Full mock tests (`l1-l4`, `r1-r3`, `w1-w2`, `s1-s3`) & focused modules with strict schema validation. |
| **AI Provider Layer** | ✅ Complete | Compatible with OpenAI, OpenRouter, Experiential Labs, local Ollama/LM Studio, and 100% offline manual copy/paste mode. |
| **Listening Module & Audio** | ✅ Complete | In-browser Kokoro neural TTS, distinct British/American/Australian voices, pause/resume queue handling, strict timed exam 1-play mode. |
| **Interactive Map & Plan Labelling** | ✅ Complete | Architectural SVG vector map, HTML5 drag-and-drop & click-to-place, clean place-name extraction, bi-directional question syncing. |
| **Reading Academic Module** | ✅ Complete | Authentic word window constraints (720–910 words), TFNG, YNNG, multiple choice, matching headings, summary gaps. |
| **Writing & Speaking Modules** | ✅ Complete | Task 1 vector visuals (process, line, bar, map comparison) & Task 2 essay capture with word counting; Speaking prompts & cue cards. |
| **Scoring & Verification Engine** | ✅ Complete | Hard Rule: code computes all numbers. Verbatim substring quote verification for AI feedback. Empty response protection. |
| **CEFR Level & Band Reporting** | ✅ Complete | Official IELTS-to-CEFR concordance (C2 Mastery down to A1), executive dashboard analytics, completed test history. |
| **Test Suite & Verification** | ✅ Complete | 457 automated tests passing (`npm test`), strict TypeScript typechecking, zero ESLint warnings. |

---

## 🎯 Hard Rules & Guarantees

1. **Code computes every number**: Raw scores, bands, word counts, accuracy, timings, averages, and IELTS half-band rounding are computed strictly by code. The AI never grades objective items and never invents overall bands.
2. **Objective sections scored by code only**: Listening, Reading, and Grammar drills are strictly code-evaluated against deterministic keys.
3. **Evidence-backed subjective claims**: Every AI claim about a student's Writing or Speaking response must cite verbatim substring quotes verified by client-side string search.
4. **Offline and privacy first**: Answer keys are never displayed during test taking. Tests are saved locally. No mandatory external account or telemetry.
5. **No fabricated bands**: If a section is unattempted, bands remain `null` / unattempted, and overall bands are withheld until all required modules are submitted.
6. **Estimated band disclaimer**: All results are transparently labeled *"Estimated band, not an official IELTS result"*.

---

## 🌟 Key Features

### 1. Exam Simulation Player
- **Timed and Untimed Modes**: Practice with realistic countdown clocks or at your own pace without time pressure.
- **Opposite-Side Navigation**:
  - **Left Sidebar**: Sticky question navigator displaying progress (`Answered X / Y`) and amber indicators for flagged items (`⚑`).
  - **Center Canvas**: Main reading passage, listening audio player, vector visuals, and question groups.
  - **Right Drawer**: Floating auto-saving scratchpad notes with live word counting, toggled via header or floating pill.
- **Exam Listening Audio**:
  - Neural text-to-speech engine powered by Kokoro ONNX.
  - Monologues and dialogues with character voices and neutral narration.
  - In timed mode: Audio is strictly playable once (`1/1`) and transcripts remain hidden throughout the test.

### 2. Interactive Drag & Drop Map / Plan Labelling
- Vector SVG architectural maps with Entrance marker, Compass Rose, and drop pins (`A` through `H`).
- Place names are cleanly parsed (e.g., `Gift shop`, `Picnic area`) rather than showing full question text.
- Redundant question lists below map questions are omitted in favor of intuitive direct-on-map interactions.

### 3. Diagnostic Scoring & 7-Day Action Plan
- **Detailed Review**: Item-by-item breakdown with correct answers, explanations, and verbatim evidence quotes.
- **Weakness Analysis**: Identifies top error patterns and high-impact skills (e.g., inference, qualifier words, paraphrase matching).
- **7-Day Structured Plan**: Day-by-day drills and targeted technique reminders tailored to the candidate's diagnostic profile.

### 4. Dashboard & CEFR History
- **Executive Performance Metrics**:
  - All-time highest band and current CEFR level.
  - Latest test score and test count.
  - Section-by-section averages across Listening, Reading, Writing, and Speaking.
- **Completed Test History**:
  - Clear summary cards for each test displaying the Overall Band and the CEFR badge (`C2`, `C1`, `B2`, `B1`, `A2`, `A1`).
  - Grid showing all 4 IELTS category band scores with direct one-click review.

---

## 🛠️ Tech Stack

- **Framework**: React 19, TypeScript
- **Bundler & Tooling**: Vite, Rollup
- **Audio / ML**: `@huggingface/transformers`, Kokoro ONNX WebAssembly
- **Testing**: Node.js native test runner (`node:test`, `node:assert/strict`)
- **Linting & Types**: ESLint 9 (flat config), TypeScript (`tsc -b`)
- **Storage**: Browser `localStorage` with memory fallback and recovery outbox

---

## 💻 Getting Started

### Prerequisites
- Node.js 20+ (recommended v22 or v24)
- `pnpm` (or `npm`)

### Installation & Setup
```bash
# Clone the repository
git clone https://github.com/hujikol/IELTS-Practice.git
cd IELTS_practice/app

# Install dependencies
pnpm install
```

### Running Locally
```bash
# Start Vite development server
pnpm dev
```
Open `http://localhost:5173` in your browser.

### Quality Verification
```bash
# Run unit & integration tests (457 tests)
pnpm test

# Run TypeScript typecheck
pnpm run typecheck

# Run ESLint
pnpm run lint

# Production build
pnpm run build
```

---

## 📁 Repository Structure

```
IELTS_practice/
├── app/
│   ├── src/
│   │   ├── components/
│   │   │   ├── dashboard.tsx             # Main dashboard, history & CEFR overview
│   │   │   ├── preparation.tsx           # Batch prompt generation & material import
│   │   │   ├── player.tsx                # Active test player & opposite-side navigation
│   │   │   ├── review.tsx                # Post-test scoring, feedback & 7-day plan
│   │   │   ├── listening-audio-player.tsx# Kokoro TTS listening player
│   │   │   ├── visual-renderer.tsx       # SVG vector charts & Drag & Drop Map
│   │   │   └── ai-connection.tsx         # Provider configuration modal & status
│   │   └── lib/
│   │       ├── attempts.ts               # Local attempt storage & sanitization
│   │       ├── bands.ts                  # IELTS band tables & CEFR concordance
│   │       ├── assessment-coordinator.ts # Report compilation & objective scoring
│   │       ├── scoring.ts                # Diagnostic aggregation & weakness ranking
│   │       ├── material.ts               # Schema validation & test data structures
│   │       ├── providers.ts              # LLM integration & prompt orchestration
│   │       └── types.ts                  # Domain models & utility functions
│   ├── tests/                            # 457 automated unit & integration tests
│   └── package.json
└── README.md
```

---

## 📄 License

MIT License. Designed and developed for IELTS Academic candidates.
