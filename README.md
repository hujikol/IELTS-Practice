# IELTS-Practice

Offline-first IELTS Academic practice app. Planning stage — **no application code is tracked in this repository yet.**

## Status

The working spec and the upstream source export are both **intentionally untracked**. This repo currently holds only `.gitignore` and this README.

| Item | Where it lives | Tracked |
|---|---|---|
| `IDEA.md` — the implementation plan | repo root, local only | no |
| `IELTS-Studio-Local-Source-2026-10-01.zip` | repo root, local only | no |
| `ielts-studio-local/` — extracted upstream source | local only | no |

The upstream export is a third-party snapshot from a Vinext/Cloudflare-Worker deployment and is kept intact so it can be diffed while the rewrite proceeds. It carries its own README and implementation plan, which remain the record of what the original code actually does.

## What this is

An offline-first desktop practice app for IELTS Academic, distributed on macOS and Windows. Timed and untimed modes across Listening, Reading, Writing and Speaking, with original generated material, estimated bands and weakness analysis.

The upstream app it replaces connected to ChatGPT through a public MCP endpoint. That path did not work — the deployment reported `has_mcp: true` while exposing no tools, and no `/mcp` request ever appeared in its logs. The rewrite deletes that surface entirely rather than repairing it.

## Hard product rules

- **Offline first.** No chat browser, no hosted service, no account required. After the voice model is fetched once, everything runs locally.
- **No public MCP endpoint.** Copy/paste is the material-generation transport. A chat browser cannot reach `127.0.0.1`, so a local agent is the only thing a loopback MCP server could serve.
- **The same validator runs on every input path.** Import and API generation both call the existing `applyGenerated` / `validateBlock` code. No second, drift-prone validation path.
- **Never fabricate a band.** Estimates are withheld until every section has a real result, and Speaking is scored only on a saved waveform.
- **Practice estimates, not official results.** Generated items are not standardised or examiner-calibrated.

## Planned stack

- React SPA on Vite — vinext, wrangler and RSC removed
- Tauri shell for macOS and Windows, unsigned initially
- JSON file store with atomic rename, replacing D1 and drizzle
- Kokoro TTS in-browser for Listening audio
- Provider config as a single `base_url` + `model` + `api_key`, covering OpenAI, OpenRouter and local Ollama

## Open risks

- Kokoro model weights may be fetched from a CDN URL baked into the prebuilt worker bundle. If that cannot be repointed at a local file, the offline claim does not hold.
- Kokoro's redistribution terms have not been verified, which matters once the app is distributed.

## License

None chosen yet.

The upstream export in `ielts-studio-local/` is third-party and carries its own terms, including a vendored shadcn/Tailwind stylesheet under separate license. Review before redistributing anything derived from it.