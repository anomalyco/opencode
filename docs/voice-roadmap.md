# Voice for opencode — Phased Roadmap

**Status:** Draft
**Last updated:** 2026-06-21
**Companion to:** [`prd-voice-commands.md`](./prd-voice-commands.md) · [`voice-architecture.md`](./voice-architecture.md)

The ordering is deliberate: each phase **proves one hard thing** and leaves the rest
stubbed. **v1 launch is a hosted web product** — users open the web app, talk, and hear
replies. We prove **web → sidecar → opencode** end to end **before** LiveKit or phone.

LiveKit is a **later media upgrade**, not a prerequisite for launch.

---

## Phase 0 — Local STT binary ✅ (mostly done)
**Goal:** prove speech → text on one machine.
**Build:** Python CLI — mic (or `.wav`) → cloud STT → transcript on stdout. Swappable
`transcribe(audio) -> text` interface.
**De-risks:** audio capture, provider keys, transcription quality.
**Done when:** you speak, it prints accurate text.
**Not yet:** opencode, sidecar HTTP API, web app, TTS.

## Phase 1 — Sidecar → opencode (control plane)
**Goal:** a command actually runs in an opencode session and returns a reply.
**Build:** Python sidecar as a **headless opencode client** — create/reuse session →
submit prompt → wait for completion → read assistant reply. Prove locally with
`voice-stt ask` / `converse` against a running opencode server.
**De-risks:** session API, wait/reply semantics, `OPENCODE_DIRECTORY` / auth.
**Done when:** `voice-stt ask "list the files in src"` → opencode runs it → reply on stdout.
**Not yet:** web app, sidecar HTTP API, TTS, hosting.

## Phase 2 — Sidecar voice service (STT + TTS API)
**Goal:** expose the sidecar as a **hosted voice service** the web app can call.
**Build:** HTTP/WebSocket API on the sidecar:
- ingest audio from the browser (streaming chunks or utterance upload),
- run cloud STT + end-of-turn detection,
- drive opencode (Phase 1 client),
- synthesize spoken summary via cloud TTS,
- return audio + status events to the client.
**De-risks:** browser↔sidecar streaming contract, latency, auth between services.
**Done when:** a minimal test page (or curl + wav) gets STT → opencode → TTS back
without the full web composer.
**Not yet:** polished web composer, decider, production hosting.

## Phase 3 — Web app → sidecar (composer integration)
**Goal:** wire the PRD composer (in-textarea mic + six states) to the sidecar voice API.
**Build:** `@opencode-ai/app` captures browser mic, streams to sidecar, plays TTS,
reflects status (Off / Listening / Hearing / Transcribing / Working / Speaking).
Auto-submit transcribed text via the sidecar→opencode path. Session targeting: active
session ID + directory passed to the sidecar.
**De-risks:** mic permission, tab focus, status sync, composer UX.
**Done when:** locally — enable mic in the web app, speak a command, hear a spoken reply.
**Not yet:** hosted deploy, mid-turn decider, production hardening.

## Phase 4 — Hosted launch (v1 product)
**Goal:** **first public launch** — remote users on the hosted web app with voice.
**Build:** deploy **web app + opencode server + voice sidecar on Fly.io**; auth
(reuse `identity` / `console` patterns); TLS; rate limits; cloud disclosure in UI.
**De-risks:** biggest product risk (§6.5 in architecture); multi-tenant auth; cost.
**Done when:** a user opens the Fly-hosted app, enables voice, speaks, opencode acts,
they hear a summary back — no local install required.
**Not yet:** mid-turn decider polish, phone, LiveKit.

See [`voice-p4-staging-deploy.md`](./voice-p4-staging-deploy.md) for the Fly.io deploy checklist.

## Phase 5 — Conversation UX (still browser → sidecar HTTP)
**Goal:** hands-free back-and-forth without LiveKit.
**Build:** continuous listening, auto-submit on pause, talk-back summarization (PRD §7),
**mid-turn decider** (stop / status / redirect / reply), barge-in during TTS playback.
All over the Phase 2 sidecar API — browser mic in, TTS audio out.
**De-risks:** classification accuracy, barge-in vs noise, summary quality.
**Done when:** PRD flows A–I work in the hosted web app.
**Not yet:** LiveKit, phone-native clients.

## Phase 6 — Hardening & production
**Goal:** dependable daily use.
**Build:** error/recovery (STT/TTS/network/opencode failures), observability, provider
budgets, security review of audio streaming + auth, edge cases (PRD §10).
**Done when:** reliable, observable, safe enough for general availability.

## Phase 7 — LiveKit / WebRTC media upgrade (future)
**Goal:** upgrade the **media plane** when HTTP streaming from the browser is not enough.
**Build:** re-home sidecar ingest/playback onto **LiveKit Agents** (or equivalent WebRTC
SFU). Browser (and later phone) joins a room; sidecar handles VAD, STT, TTS in the
room. **Control plane unchanged** — sidecar still drives opencode over HTTP/WS.
**De-risks:** WebRTC NAT, LiveKit ops, migration from Phase 2 API without breaking web.
**Done when:** phone/mobile web can join with lower latency; optional path for power users.
**Why later:** v1 proves product value with simpler browser→sidecar HTTP; LiveKit is
optimization + phone, not the first seam to debug.

## Phase 8 — Phone & additional clients (future)
**Goal:** validate "no laptop" and thin clients beyond web.
**Build:** mobile web (LiveKit room from Phase 7), then TUI/desktop as room joiners +
status. Reuses sidecar + opencode unchanged.
**Done when:** talk to opencode from a phone with nothing else running locally.

---

## Mapping to architecture milestones
P0 ≈ local STT spike · P1–P2 ≈ M1 (control + voice API) · P3–P4 ≈ M2 (web + hosted
launch) · P5 ≈ M3 (conversation) · P6 ≈ M4 (hardening) · P7–P8 ≈ M5 (LiveKit + phone).

## Cross-cutting: remote code access (start early)
Hosted launch (Phase 4) depends on how sessions reach user code. **Run a short spike in
parallel with Phase 1** — investigate `enterprise` / `console` / sandbox remote
workspaces. If hosted opencode can't operate on a repo, it reshapes Phase 4.

## Current status (2026-06-21)
- **P0–P3:** done locally (STT, sidecar API, web composer, multi-turn voice).
- **P4 staging plan:** all on Fly.io (UI + bun server + voicar) — see [`voice-p4-staging-deploy.md`](./voice-p4-staging-deploy.md).
- **P4 deploy:** not live yet (Slices 3–4).
- **P5–P8:** not started.
