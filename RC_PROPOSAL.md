# RFC: Remote Control (RC) — like Claude Code

## Problem
Opencode `serve` + `web` already allows remote, but no first-class mobile RC:
- No QR to pair phone quickly
- No `opencode rc` command like `claude rc`
- Mobile web needs manual URL + no session sync UX

## Proposal — `feat(rc): remote control via QR + mobile attach`

### CLI
- `opencode rc` — start RC server, print QR with `opencode attach <url>` + web URL
- `opencode rc --qr` — only print QR
- Reuse existing `listen()` + `MDNS` + `CorsOptions` (server.ts:listen)

### Server (`packages/opencode/src/server`)
- New route `GET /rc/qr` → returns `{ url, qrDataUrl }` (qr = `opencode attach <url>`)
- New route `GET /rc/status` → `{ hostname, port, url, mdnsDomain }`
- No auth bypass — reuse existing auth/CORS layer

### Web (`packages/app/src`)
- New page `/rc` — shows QR, copy button, `Attach` deep-link (`opencode://attach?url=...`)
- Hook into `app.tsx` header: add "Remote" button next to session

### Mobile open
- Phone just opens `https://<host>:<port>` or scans QR → same `packages/app` UI (responsive, PWA)
- No native app needed — "Add to Home Screen" = Claude-like
- Alternative: `opencode attach <url>` from another laptop/termux

## Verification
- `bun dev` → `opencode rc` → scan QR from phone → session continues
- `curl /rc/qr` returns valid data URL
- No regression: existing `opencode serve/web/attach` untouched

## Issue First
This doc will be the GitHub issue body (feature request template) before PR. Small PR, focused, with screenshots.

