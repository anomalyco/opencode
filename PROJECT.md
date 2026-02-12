# OpenCode – Projektvorbereitung

## Was ist OpenCode?

**OpenCode** ist ein Open-Source AI Coding Agent für die Terminal-Umgebung. Ähnlich zu Claude Code, aber:

- **100% Open Source** – vollständig selbst hostbar
- **Provider-unabhängig** – Claude, OpenAI, Google, lokale Modelle, OpenCode Zen
- **TUI-Fokus** – von Neovim-Nutzern für die Konsole gebaut
- **Client-Server** – Server läuft lokal, Clients (TUI, Web, Desktop) verbinden sich

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  Clients                                                      │
│  ├── TUI (opentui + SolidJS) – packages/opencode/src/cli/tui  │
│  ├── Web UI – packages/app                                    │
│  └── Desktop (Tauri) – packages/desktop                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ SDK / REST
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Server (packages/opencode)                          │
│  ├── API (Hono) – server/server.ts                           │
│  ├── Session-Management                                       │
│  ├── Tools (read, edit, bash, grep, …)                       │
│  ├── Agents (build, plan, general)                           │
│  └── Provider-Integration (AI SDK)                           │
└─────────────────────────────────────────────────────────────┘
```

## Wichtige Pfade

| Bereich | Pfad |
|---------|------|
| API-Routen | `packages/opencode/src/server/routes/` |
| Tools | `packages/opencode/src/tool/` |
| Agents | `packages/opencode/src/agent/` |
| TUI-Komponenten | `packages/opencode/src/cli/cmd/tui/` |
| Session-Logik | `packages/opencode/src/session/` |
| Projekt-API (specs) | `specs/project.md` |

## Entwicklung

```bash
# Setup
bun install

# TUI starten
bun dev
bun dev <verzeichnis>   # in anderem Verzeichnis

# API-Server (für Web/Desktop)
bun dev serve

# Web-App (Server muss laufen)
bun run dev:web

# Typecheck
bun turbo typecheck
```

## Nächste Schritte

Nach dieser Vorbereitung kannst du Features hinzufügen. Typische Änderungen:

- **Neue Tools**: `packages/opencode/src/tool/` – neue Datei mit `Tool.define()`
- **API-Erweiterung**: `packages/opencode/src/server/` + `./script/generate.ts`
- **UI-Anpassungen**: `packages/opencode/src/cli/cmd/tui/` oder `packages/app`
- **Neue Provider**: `packages/opencode/src/provider/`
