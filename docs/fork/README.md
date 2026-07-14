# Gentle OpenCode

Fork de [opencode](https://github.com/anomalyco/opencode) distribuido con [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) integrado.

## Objetivo

Instalación en un paso en Windows: opencode + gentle-ai + skills + Engram. Cero configuración manual.

## Qué incluye

| Componente | Descripción |
|---|---|
| opencode (fork) | CLI y desktop app con gentle-orchestrator como agente por defecto |
| gentle-ai | Gestor de skills, prompts, agentes, permisos, plugins |
| Engram | Memoria persistente entre sesiones |
| SDD | Spec-Driven Development: fases de planificación (propose → spec → design → tasks → apply) |
| Skills | 30+ skills preinstalados (tdd, review, chained-pr, diagnose, etc.) |

## Instalación

```powershell
irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex
```

## Documentación

- [Installer](./installer.md) — cómo funciona el instalador paso a paso
- [Releases](../releases.md) — historial de versiones y flujo de release
- [Nextcloud mirror](../nextcloud.md) — mirror de descarga alternativo

## Arquitectura

```
install.ps1
  ├── winget auto-install git, node, npm (si faltan)
  ├── Download opencode-fork.exe (GitHub o Nextcloud mirror)
  ├── Download gentle-ai.exe (GitHub)
  ├── PATH setup
  ├── Backup engram.db (si existe)
  ├── gentle-ai install --agent opencode
  │     ├── Skills, prompts, agentes, permisos
  │     ├── Engram MCP server
  │     └── SDD orchestrator
  └── Link config para desktop app
```

## Proveedor de modelos

El proveedor `opencode-go` se sirve del catálogo `https://models.dev/api.json`. Requiere `OPENCODE_API_KEY`.

## Principio

gentle-ai es source of truth de skills/prompts/agentes/config. Este fork no duplica ni modifica nada de gentle-ai.
