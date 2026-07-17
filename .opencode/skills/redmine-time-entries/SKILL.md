---
name: redmine-time-entries
description: "Trigger: cargar horas, time entries, registrar horas, cargar tiempo, redmine horas, oneinfo horas. Automate Redmine time entry creation via Playwright using Engram session data."
license: Apache-2.0
metadata:
  author: "servidor"
  version: "2.2"
---

## Activation Contract

Load work hours into OneAdmin Redmine (https://oneadmin.oneinfoconsulting.com) by reading what was done from Engram memories and automating the time entry form via Playwright.

Use when: user says "cargar horas", "load hours", "register time entries", "cargar tiempo", or asks to log work done into Redmine.

## 🔒 Credential Security (READ THIS FIRST)

**Credentials NEVER pass through the chat, bash commands, or AI context.**

```
❌ NUNCA:   echo $REDMINE_PASS | ...     (bash expone la clave en ps aux)
❌ NUNCA:   read .credentials y mostrarlo  (AI context → logs de sesión)
❌ NUNCA:   pedir usuario/contraseña en el chat
✅ SIEMPRE: load-hours.js lee .credentials INTERNAMENTE
✅ SIEMPRE: si el usuario no configuró creds, crear .credentials.example y parar
```

### Cómo el usuario configura sus credenciales (sin exponerlas — FLUJO AUTOMÁTICO)

**La forma más segura (recomendada):** Ejecutá `load-hours.js` directamente. Si no hay credenciales:

1. El script detecta que `.credentials` no existe
2. Te explica que es seguro (local, no pasa por el chat, no se sube a ningún lado)
3. Te **abre el editor de texto** (`$EDITOR` o `nano`) con el archivo `.credentials.example`
4. Ahí completás tu usuario y contraseña — **esto pasa en tu terminal local, no en el chat de la IA**
5. Guardás y cerrás el editor
6. El script verifica los datos, los guarda en `.credentials`, y continúa

**¿Por qué es seguro?**
- Tu usuario y contraseña **NUNCA** pasan por el contexto de la IA
- **NUNCA** se muestran en el chat, logs, o bash history
- El archivo `.credentials` queda en tu máquina, no se sube a ningún repo
- Solo este script puede leerlo localmente
- Si querés rotar la contraseña, borrás `.credentials` y repetís el proceso

**Alternativa — Variables de entorno (sin archivo en disco):**
```bash
export REDMINE_USER=tu_usuario
export REDMINE_PASS=tu_contraseña
```
`load-hours.js` las lee automáticamente.

### Onboarding guard (AUTOMÁTICO — no requiere acción del orquestrador)

El script `load-hours.js` maneja esto automáticamente:
1. Busca `REDMINE_USER`/`REDMINE_PASS` en entorno
2. Si no, busca `.credentials`
3. Si no encuentra nada, **abre el editor automáticamente** para que configures (sin intervención del chat)

No es necesario ejecutar `setup.js` por separado ni hacer verificaciones manuales.

## Quick Usage (standalone script)

```bash
# Single day — auto-detail from Engram + git log
bun load-hours.js --date 2026-07-13 --comment "Built installer"

# Multiple days — auto-detail for each date
bun load-hours.js --date 2026-07-14,2026-07-15,2026-07-16 --comment "Dev work"

# With custom detail (skip auto-generation)
bun load-hours.js --date 2026-07-13 --hours 4 --activity Análisis \
  --comment "Review plan" --detail "Refs: abc123, def456"

# Skip auto-detail entirely
bun load-hours.js --date 2026-07-13 --no-detail --comment "Quick fix"
```

> **Note**: Auto-detail requires `bun` (queries Engram SQLite DB + git log).
> Falls back to `node` gracefully but without auto-detail.
> Use `--no-detail` to skip the auto-query even when running with `bun`.

## Hard Rules

- 🔒 **NEVER touch `.credentials` from AI context.** `load-hours.js` lo lee internamente. El AI no debe leerlo, mostrarlo, ni pasarlo como argumento.
- 🔒 **NEVER pass credentials via bash.** No `echo $PASS |`, no `--password=...` en línea de comandos. El script usa el archivo o env vars.
- 🔒 **Onboarding guard es AUTOMÁTICO.** `load-hours.js` abre el editor y te guía. El orquestrador NO debe preguntar credenciales en el chat, NO debe leer `.credentials`, NO debe ejecutar `setup.js` manualmente.
- ALWAYS ask ALL of these before starting (mandatory preflight):
  1. **Proyecto**: Which Redmine project? (from config.json or ask)
  2. **Tarea/Issue**: Which task to log against?
  3. **Rango de fechas**: Which dates to load?
  4. **Actividad**: Activity type? (default from config)
  5. **Horas por día**: Hours per day? (default from config)
  6. **Modo de confirmación**: `auto` / `confirm-all` / `confirm-each`
- Use "Crear y continuar" for batch, "Crear" for last entry.
- Load ONLY work done in the specified project.

## Config Files

| File | Purpose | Shareable? |
|------|---------|------------|
| `config.json` | Project, issue, activity defaults | Yes (no secrets) |
| `.credentials` | Username + password | NO (per-user) |

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--date` | Date(s) comma-separated | required |
| `--comment` | Short summary | empty |
| `--detail` | Extended technical info (auto-generated from Engram + git log if omitted) | empty |
| `--no-detail` | Skip auto-detail generation | false |
| `--hours` | Hours | from config |
| `--activity` | Activity type | from config |
| `--issue` | Issue ID override | from config |
| `--project` | Project slug override | from config |
| `--headless` | Show browser (false) | true |

## Activities

Análisis, Diseño, Desarrollo, Seguimiento, Testing, Prueba de Concepto, Reunion, Despliegue+Soporte QA, Despliegue+Soporte PROD, Gestión

## Error Handling

- Login fails → re-run `node setup.js`
- Form error → log, skip entry, continue
- Browser crash → close and retry
- Always closes browser in finally block
