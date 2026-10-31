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
# Run unit & integration tests (477 tests)
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
│   │       ├── attempts.ts               # Local attempt storage & sanitization
│   │       ├── bands.ts                  # IELTS band tables & CEFR concordance
│   │       ├── assessment-coordinator.ts # Report compilation & objective scoring
│   │       ├── scoring.ts                # Diagnostic aggregation & weakness ranking
│   │       ├── material.ts               # Schema validation & test data structures
│   │       ├── providers.ts              # LLM integration & prompt orchestration
│   │       └── types.ts                  # Domain models & utility functions
│   ├── tests/                            # 477 automated unit & integration tests
│   └── package.json
└── README.md
```
