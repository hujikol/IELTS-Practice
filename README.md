# IELTS Practice App

An offline-first, client-side web application for IELTS Academic preparation. Generates standardized mock tests, delivers authentic exam simulation conditions, provides deterministic code-first objective scoring, quote-verified writing and speaking evaluations, personalized weakness diagnostics, and CEFR level tracking.

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

### 1. Interactive Speaking Interview (Voice Recording & 1-on-1 Flow)
- **Two Operating Modes**:
  - **∞ Practice Mode**: Unlimited time, visible question text, replayable examiner audio, re-recording permitted, live transcript preview, notes allowed in all parts.
  - **⏱ Exam Simulation**: Authentic 11–14 min interview, audio-only questions (text hidden), single take, strict 60s prep countdown and 2:00 auto-stop timer, VAD silence auto-advance, max 1 repeat request (*"Could you repeat that?"*).
- **Conversational State Machine**:
  - `MIC_CHECK`: Web Audio API `AnalyserNode` live input level meter with 3-second sample test clip and playback verification.
  - `INTRO`: Examiner greeting, candidate name verification, and ID check.
  - `PART 1`: 3 topic frames (e.g. work/study, hometown, hobbies) with short questions asked one at a time.
  - `PART 2`: Official Cambridge Cue Card rendering with topic title, 3 *"You should say:"* bullet points, 60-second preparation countdown with scratchpad drafting, and 2-minute individual long turn.
  - `PART 3`: Abstract, society-level analytical discussion questions thematically linked to Part 2.
- **Recording & Audio Engine**:
  - `MediaRecorder` capture with `audio/webm;codecs=opus` (with MP4 fallback) and chunked IndexedDB persistence (`ielts_studio_speaking_db`).
  - **Incremental & Eager Persistence**: Voice clips and transcripts are saved to IndexedDB and synced to the session store immediately on every answer, auto-stop (VAD/hard-cap), manual stop, or early exit/finish, preventing lost audio.
  - **Review Playback**: Review screen re-hydrates candidate recordings in natural sequence with dedicated audio players for candidate self-review and AI transcription.
  - Voice Activity Detection (VAD) via RMS thresholds for exam auto-advance (3s silence in Part 1, 4s in Part 3).
  - Dual-engine examiner TTS: Kokoro neural TTS + Web Speech API fallback.
  - Live verbatim candidate transcription via native Web Speech API.

### 2. Streamlined Dashboard & Performance Analytics
- **Practice Launcher**: 5 clear focus cards (Full Mock, Listening, Reading, Writing, Speaking) with a 1-click segmented timing switch (`∞ Self-Paced` vs `⏱ Exam Timed`).
- **Contextual Shortcuts**: Quick 1-click launch for 2-Way Conversational Dialogue with Kokoro FP32 neural voices.
- **Executive Proficiency Overview**: Highlights current Best Band, CEFR Level badge (`C2`, `C1`, `B2`, etc.), latest exam score, and category averages.
- **Scannable Test History**: Clean rows showing test title, completion timestamp, timing mode, color-coded skill chips (`🎧 7.5`, `📖 8.0`, `✍️ 6.5`, `🗣️ 7.0`), Overall Band, and CEFR indicator.
- **Destructive Action Safety**: Confirmation modal and soft rose hover styling for delete actions (`#fff1f2`, `#be123c`, `#fecdd3`).

### 3. Diagnostic Review Screen & 7-Day Action Plan
- **Cohesive Educational Diagnostic Card**: Clean, high-contrast white card with soft Royal Blue accents replacing harsh dark banners.
- **Adaptive Tabs**: Dynamically filters to display only attempted sections (Overview & Plan, Listening, Reading, Writing, Speaking).
- **Unified Overview Hub**: Combines Top Priority Weaknesses (ranked by score impact with actionable fix bullets), Verified Strengths (≥85% accuracy), and the interactive 7-Day Improvement Plan with persistent checkboxes and 1-click `Launch Drill` triggers.
- **Enhanced Question Review**: Question stem context, clear answer comparisons (`Your answer` vs `Correct answer`), and a unified analysis container with source quotes, Cambridge distractor elimination, personal diagnostic notes, and strategy tips.

### 4. Exam Simulation Player
- **Fixed Viewport & Scroll Locking**: Pinned top header and bottom navigation; only the middle passage and question split-panes scroll independently.
- **Opposite-Side Navigation**:
  - Left Sidebar: Sticky question navigator with completion counters and flagged item indicators.
  - Center Canvas: Reading passage, Kokoro listening audio player, vector visuals, and question groups.
  - Right Drawer: Floating auto-saving scratchpad notes with live word counting.
- **Interactive Drag & Drop Map / Plan Labelling**: Architectural SVG vector maps with Entrance marker, Compass Rose, drop pins (`A`–`H`), and clean place-name parsing.

### 5. Seeded IELTS Variety Engine (Dynamic Multi-Skill Generation)
- **High-Entropy Standardized Blueprints**: Guarantees authentic, non-repetitive generation across all 4 modules while remaining 100% compliant with Cambridge IELTS specifications:
  - **Speaking**: Rotates 4 familiar openers (*work/study, hometown, accommodation, area*) with 80+ everyday topics in Part 1 across 8 question styles (*frequency, preference, past habits, change over time, future intention, etc.*), 64 distinct Cambridge Part 2 cue cards, and 6 in-depth abstract discussion questions in Part 3 covering 9 cognitive IELTS functions (*evaluating, predicting, weighing trade-offs, speculating*). Includes seeded authentic fallbacks for practice mode.
  - **Listening**: 28 Part 1 transactional scenarios, 22 Part 2 social talks, 12 Part 3 academic dialogues, and 28 Part 4 academic lecture domains dynamically paired with official question formats (*form, note, table, sentence, and flow-chart completion, multiple choice, matching features and opinions*).
  - **Reading**: Cycles and balances all 14 official Cambridge IELTS Academic question types (*TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN, matching headings i–viii, matching information to paragraphs A–G, matching features, matching sentence endings, summary completion with or without word banks, note/table/flow-chart completion, short answers, multiple choice*) across 31 academic subject domains and 9 structural narrative types, ensuring no duplicate formats across passages.
  - **Writing**: Balanced rotation of Task 1 visuals (*tables, bar charts, line graphs, process diagrams*) and all 7 Task 2 essay types (*agree/disagree, both views & opinion, advantages/disadvantages, problem-solution, causes-solutions, positive/negative development, two-part questions*) across 27 authentic themes.

---

## 🛠️ Tech Stack

- **Framework**: React 19, TypeScript
- **Bundler & Tooling**: Vite, Rollup
- **Audio / ML**: Web Audio API (`AnalyserNode`), `MediaRecorder`, Kokoro ONNX WebAssembly, Web Speech API (`SpeechRecognition` & `SpeechSynthesis`)
- **Testing**: Node.js native test runner (`node:test`, `node:assert/strict`)
- **Linting & Types**: ESLint 9 (flat config), TypeScript (`tsc -b`)
- **Storage**: Browser `localStorage` & `IndexedDB` with memory fallback and recovery outbox

---

## 💻 Getting Started

### Prerequisites
- Node.js 20+ (recommended v22 or v24)
- `pnpm` (or `npm`)

### Installation & Setup
```bash
# Clone the repository
git clone https://github.com/hujikol/IELTS-Practice.git
cd IELTS-Practice/app

# Install dependencies
pnpm install
```

### Running Locally
```bash
# Start Vite development server
pnpm dev
```
Open `http://localhost:5173` in your browser.

### Quality Verification & Calibration
```bash
# Run unit & integration tests (494 tests)
pnpm test

# Run TypeScript typecheck
pnpm run typecheck

# Run Writing calibration harness against benchmark human-marked fixtures
node scripts/calibrate-writing.mjs --dry-run
# or with active AI provider:
# node scripts/calibrate-writing.mjs --runs=3

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
│   │   │   ├── dashboard.tsx             # Streamlined dashboard, history & CEFR overview
│   │   │   ├── preparation.tsx           # Batch prompt generation & material import
│   │   │   ├── player.tsx                # Fixed-viewport test player & navigation
│   │   │   ├── speaking-section.tsx      # Interactive 1-on-1 voice speaking interview
│   │   │   ├── review.tsx                # Post-test scoring, feedback & 7-day plan
│   │   │   ├── listening-audio-player.tsx# Kokoro TTS listening player
│   │   │   ├── visual-renderer.tsx       # SVG vector charts & Drag & Drop Map
│   │   │   ├── ai-connection.tsx         # Provider configuration modal & status
│   │   │   └── ui/
│   │   │       ├── button.tsx            # Standardized button variants with intuitive icons
│   │   │       └── confirmation-modal.tsx# Accessible confirmation dialogs
│   │   └── lib/
│   │       ├── speaking-recorder.ts      # Voice recording, AnalyserNode meter, VAD & IndexedDB
│   │       ├── stt-engine.ts             # Audio STT (/audio/transcriptions) & Web Audio pause analysis
│   │       ├── attempts.ts               # Local attempt storage & sanitization
│   │       ├── bands.ts                  # IELTS band tables & CEFR concordance
│   │       ├── assessment-coordinator.ts # Report compilation & objective scoring
│   │       ├── writing-score.ts          # Calibrated Writing scoring orchestrator & quote verification
│   │       ├── writing-rubric.ts         # Versioned rubric anchors (w-1.0.0) for Task 1 & 2
│   │       ├── writing-checks.ts         # Deterministic pre-checks (length caps, off-topic detection)
│   │       ├── score-cache.ts            # Deterministic scoring cache (prompt, text, rubric, model)
│   │       ├── scoring.ts                # Diagnostic aggregation & weakness ranking
│   │       ├── material.ts               # Schema validation & test data structures
│   │       ├── variety.ts                # Seeded IELTS variety engine & diverse blueprints
│   │       ├── providers.ts              # LLM integration (chat & dedicated scoring)
│   │       └── types.ts                  # Domain models & utility functions
│   ├── scripts/
│   │   └── calibrate-writing.mjs         # Writing calibration harness across benchmark band fixtures
│   ├── tests/                            # 494 automated unit & integration tests
│   └── package.json
└── README.md
```
