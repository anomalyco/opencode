# Technical Architecture: Voice for opencode

**Status:** Draft
**Last updated:** 2026-06-21
**Companion to:** [`prd-voice-commands.md`](./prd-voice-commands.md) · [`voice-roadmap.md`](./voice-roadmap.md)

This document describes *how* we build the voice experience defined in the PRD. The
PRD owns the user experience; this owns the system design.

**v1 launch:** hosted web app — users speak in the browser, cloud STT/TTS runs in a
**Python voice sidecar**, the sidecar drives a **hosted opencode server**. We prove
**web → sidecar → opencode** first. **LiveKit is deferred** to a later media upgrade
(see roadmap Phase 7).

---

## 1. Decisions (settled)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Dedicated voice sidecar**, separate service | Realtime audio + ML is a different domain than the TS app; clean boundary. |
| D2 | **Python sidecar** with cloud STT/TTS plugins | Matches existing Phase 0 work; swappable providers without touching opencode core. |
| D3 | **Hosted / remote first** | v1 launch is users on the hosted web app — not a local-only experiment. |
| D4 | **Sidecar is a headless client of the opencode server** | Reuses opencode's client/server design; no voice logic inside opencode core. |
| D5 | **Prove web → sidecar → opencode before LiveKit** | Debug one journey at a time; HTTP/WSS from browser to sidecar is enough for v1. |
| D6 | **LiveKit later** | WebRTC/LiveKit upgrades the *media plane* when we need phone or lower latency — not required for first launch. |

> **Principle:** opencode is already client/server with hosted infra (`identity`,
> `console`, `enterprise`). The sidecar joins as another authenticated client. The
> hard constraint is **the session must reach the user's code** on hosted deploy —
> see §6.5.

---

## 2. Two planes (v1)

The system separates into two planes. v1 uses **HTTPS/WSS** for media; LiveKit replaces
that plane later without changing the control contract.

- **Media plane (v1)** — audio between **browser and sidecar** over **HTTPS or
  WebSocket** (mic chunks up, TTS audio down). Does not flow through opencode server.
- **Control plane** — sidecar drives an opencode session **server-to-server** via
  HTTP/WS (same APIs the web app uses today). Carries: session ID, directory, prompt
  text, response stream, permissions.

```
  ┌─────────────────────────────────────────────────────────────┐
  │  web app (@opencode-ai/app) — hosted                        │
  │  in-textarea mic · six states · plays TTS                   │
  └───────────────┬────────────────────────────▲────────────────┘
                  │  media plane (v1)            │
                  │  HTTPS / WSS                 │  TTS audio + status events
                  ▼                              │
  ┌─────────────────────────────────────────────┴────────────────┐
  │  voice-sidecar (Python, hosted)                              │
  │  STT · end-of-turn · summarization · TTS · mid-turn decider   │
  │  opencode HTTP client (control plane) ────────────────────────┼──┐
  └───────────────────────────────────────────────────────────────┘  │
                                                                     │  control plane
                                                                     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  opencode server (hosted)                                        │
  │  sessions · agent loop · tools · git / remote workspace          │
  └──────────────────────────────────────────────────────────────────┘
```

### Future: LiveKit media plane (Phase 7+)

When HTTP streaming is insufficient (phone, latency, NAT), the browser joins a
**LiveKit room** and the sidecar ingests/publishes audio there. **Control plane stays
the same** — sidecar still talks to opencode over HTTP/WS.

```
  browser / phone  ──WebRTC──▶  LiveKit room  ◀──  voice-sidecar (agent)
                                        │
                                        └──▶  opencode server (unchanged)
```

---

## 3. Components

### 3.1 Web app (`@opencode-ai/app`)
Primary v1 interface. Responsibilities:
- **Composer voice UI** — mic + status inside the prompt text area (PRD §6.1).
- **Capture** — browser mic via standard Web APIs.
- **Stream to sidecar** — open a voice session (WSS or chunked upload); send audio;
  receive status + TTS.
- **Playback** — play TTS audio returned by the sidecar.
- **Session targeting** — pass active session ID + workspace directory to the sidecar.
- **Typing unchanged** — keyboard and voice share the composer.

The web app does **not** call STT/TTS providers directly in v1 — the sidecar owns keys
and provider choice.

### 3.2 voice-sidecar (Python, hosted)
Voice brain and the seam between browser and opencode.

**v1 pipeline:**
1. **Accept audio** from the web client (streaming).
2. **STT** — cloud transcription (xAI or swappable provider).
3. **End-of-turn** — detect pause / utterance boundary; auto-submit (PRD).
4. **Mid-turn decider** (PRD §6.2) — when opencode is Working or Speaking, classify:
   stop / status / redirect / reply.
5. **Drive opencode** — submit prompt (or abort/status/reply) to target session via HTTP.
6. **Observe** — poll/stream session until reply ready; handle permission prompts.
7. **Summarize for speech** (PRD §7) — spoken summary, not verbatim code.
8. **TTS** — cloud synthesis; return audio to the web client.
9. **Barge-in** — user speech during playback → stop TTS → decider.

Sidecar holds **voice/turn state only** — not code or git state.

**Local dev:** `voice-stt` CLI (Phase 0–1) exercises STT and the opencode client without
the web app or HTTP API.

### 3.3 opencode server (hosted)
Unchanged core responsibility: sessions, agent loop, tools, filesystem/workspace.
The sidecar is an authenticated client — same role as the web app's backend connection.

Possible small additions:
- stable **wait-for-idle** / message APIs for headless clients,
- optional voice-oriented response shaping (or keep summarization in sidecar).

---

## 4. Journey of one voice turn (v1)

This is the path we must prove **before LiveKit**:

| Step | Where | What happens |
|---|---|---|
| 1 | Web | User enables mic → **Listening**; audio stream opens to sidecar |
| 2 | Sidecar | Receives audio → **Hearing you** |
| 3 | Sidecar | STT → transcript → **Transcribing** |
| 4 | Sidecar | End-of-turn → if idle, treat as command; if busy, **decider** |
| 5 | Sidecar → opencode | POST prompt to session → web shows **Working** |
| 6 | opencode | Agent runs (tools, permissions…) |
| 7 | Sidecar | Reads reply → summarizes for speech |
| 8 | Sidecar | TTS → sends audio to web → **Speaking** |
| 9 | Web | Plays audio; user may barge in → back to step 2 |
| 10 | Web | Returns to **Listening** until mic off |

**Status sync:** sidecar pushes state (or web derives from events) so the composer
shows the six PRD states throughout.

---

## 5. Sidecar HTTP API (sketch — Phase 2)

Exact routes TBD; the contract is:

- `POST /voice/session` — bind to opencode session ID + directory; returns voice session ID.
- `WSS /voice/session/{id}/stream` — bidirectional: client sends audio frames; server
  sends `{ type: status \| transcript \| tts \| error, ... }`.
- Auth: same identity as hosted opencode (token forwarded or exchanged server-side).

CLI (`voice-stt ask`) remains for debugging the opencode leg without the web or WSS.

---

## 6. Open questions

1. **Summarization location** — sidecar LLM pass vs opencode server endpoint?
2. **Session targeting** — how web hands sidecar the active session; multi-tab behavior.
3. **Auth** — browser→sidecar and sidecar→opencode token flow on hosted deploy.
4. **Audio transport** — WebSocket binary frames vs WebRTC data channel before LiveKit.
5. **Hosted opencode + code access (§6.5)** — how remote workspaces reach user repos;
   blocks hosted launch if unresolved.
6. **Provider choices** — STT/TTS/decider models; cost and latency budgets.
7. **Backgrounded tab** — pause listening/speaking (PRD §12).
8. **Barge-in vs noise** — tuning without LiveKit VAD until Phase 7.

---

## 7. Milestones

| Milestone | Roadmap | Outcome |
|---|---|---|
| **M0** | P0 | Local STT CLI works |
| **M1** | P1–P2 | Sidecar drives opencode + exposes voice API (STT/TTS) |
| **M2** | P3–P4 | Web composer wired; **hosted v1 launch** |
| **M3** | P5 | Full conversation UX (decider, barge-in, summarization) |
| **M4** | P6 | Production hardening |
| **M5** | P7–P8 | LiveKit media + phone |

---

## 8. Extensibility (after v1)

| To add… | You implement | You reuse |
|---|---|---|
| **LiveKit / phone** | Swap media plane to WebRTC room | Sidecar opencode client + summarization + decider |
| **TUI / desktop voice** | Mic → sidecar API (same as web) or LiveKit room later | Entire sidecar + server |
| **New STT/TTS provider** | Swap plugin in sidecar | Web app, opencode, control plane |

No client re-implements the decider or opencode session logic — those live in the sidecar once.
