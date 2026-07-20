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
❌ NUNCA:   mostrar .credentials en el chat  (AI context → logs de sesión)
❌ NUNCA:   pedir usuario/contraseña en el chat
✅ SIEMPRE: load-hours.js lee .credentials INTERNAMENTE
✅ SIEMPRE: si no hay creds, crea template y pide editarlo
```

### Cómo el usuario configura sus credenciales (sin exponerlas — 4 MÉTODOS SEGUROS)

**Opción A — opencode-cred (RECOMENDADO, multi-skill):**
```bash
opencode-cred set redmine
```
Abre formulario en el navegador (localhost). Las credenciales se guardan en `~/.config/opencode/credentials/redmine.cred`.

**Opción B — Editor gráfico (recomendado para AI context):**
Cuando `load-hours.js` detecta que no hay TTY interactivo (caso típico cuando lo ejecuta el orquestrador):
1. Escribe el template `.credentials` con placeholders
2. Imprime la ruta del archivo
3. El orquestrador abre un editor gráfico (gedit/kate) para que el usuario complete
4. El usuario guarda y cierra
5. El orquestrador vuelve a ejecutar el script (ya encuentra las creds)

**Opción C — Variables de entorno (sin archivo en disco):**
```bash
export REDMINE_USER=tu_usuario
export REDMINE_PASS=tu_contraseña
```
`load-hours.js` las lee automáticamente. Ideal para CI o sesiones temporales.

**Opción D — Editor local (terminal):**
Ejecutá `load-hours.js` directamente en una terminal. Si detecta TTY, abre `gedit`, `kate`, `nano`, o `$EDITOR` con el template.

**¿Por qué es seguro?**
- Las credenciales **NUNCA** pasan por el contexto de la IA
- **NUNCA** se muestran en el chat, logs, o bash history
- Los archivos quedan en tu máquina (permisos 600)
- `opencode-cred` usa formulario en localhost, nada sale de tu PC

### Onboarding guard (AUTOMÁTICO — orquestrador)

Cuando el orquestrador necesita cargar horas y detecta que no hay credenciales:

1. Ejecuta `load-hours.js` → el script detecta que no hay `.credentials`
2. Como no hay TTY, escribe el template `.credentials` y **sale con código 0** mostrando la ruta
3. El orquestrador **lee la ruta** del mensaje y abre la herramienta disponible en orden:
   - Si hay Playwright y DISPLAY → formulario HTML local en el navegador
   - Si hay gedit/kate → editor gráfico con el template
   - Si hay DISPLAY → `xdg-open` el archivo
4. El usuario completa usuario/contraseña y guarda
5. El orquestrador vuelve a ejecutar `load-hours.js` → ya encuentra las credenciales

**Una sola vez**: una vez guardado `.credentials`, el script lo reusa automáticamente.
El orquestrador NO debe preguntar credenciales en el chat, NO debe leer `.credentials` él mismo.

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

# Multi-project in the same day (--entries JSON)
bun load-hours.js --entries '[
  {"date":"2026-07-17","hours":4,"project":"proj-a","issue":"123","activity":"Desarrollo","comment":"Feature X"},
  {"date":"2026-07-17","hours":2,"project":"proj-b","issue":"456","activity":"Testing","comment":"Bug fixes"},
  {"date":"2026-07-16","hours":6,"project":"proj-a","activity":"Desarrollo","comment":"More work"}
]'

# Multi-project via comma-separated --project and --issue (same dates, different projects)
bun load-hours.js --date 2026-07-17,2026-07-17 \
  --project proj-a,proj-b --issue 123,456 \
  --activity Desarrollo,Testing --hours 4,2 \
  --comment "Feature X,Bug fixes"
```

> **Note**: Auto-detail requires `bun` (queries Engram SQLite DB + git log).
> Falls back to `node` gracefully but without auto-detail.
> Use `--no-detail` to skip the auto-query even when running with `bun`.

## Hard Rules

- 🔒 **NEVER touch `.credentials` from AI context.** `load-hours.js` lo lee internamente. El AI no debe leerlo, mostrarlo, ni pasarlo como argumento.
- 🔒 **NEVER pass credentials via bash.** No `echo $PASS |`, no `--password=...` en línea de comandos. El script usa el archivo o env vars.
- 🔒 **Onboarding guard es AUTOMÁTICO.** `load-hours.js` abre el editor y te guía. El orquestrador NO debe preguntar credenciales en el chat, NO debe leer `.credentials`, NO debe ejecutar `setup.js` manualmente.
- ALWAYS ask ALL of these before starting (mandatory preflight):
  1. **¿Cuántos proyectos?** Single project or multiple? If multiple, collect entries per project.
  2. **Entradas por proyecto** (for each, repeat as needed):
     - **Proyecto**: Which Redmine project slug?
     - **Tarea/Issue**: Which task to log against (optional, project-specific)?
     - **Rango de fechas**: Which dates to load for this project?
     - **Actividad**: Activity type?
     - **Horas por día**: Hours per day?
  3. **Modo de confirmación**: `auto` / `confirm-all` / `confirm-each`
- Use "Crear y continuar" for batch entries, "Crear" for last entry.
- Load ONLY work done in the specified project(s).
- Soportar múltiples proyectos en el mismo día. Ejemplo: 4 horas en Proyecto A (Desarrollo) y 4 horas en Proyecto B (Testing), misma fecha.
- Cuando hay múltiples proyectos, pasar `--entries` JSON al script en lugar de `--date`.

## Config Files

| File | Purpose | Shareable? |
|------|---------|------------|
| `config.json` | Project, issue, activity defaults | Yes (no secrets) |
| `.credentials` | Username + password | NO (per-user) |

## CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--date` | Date(s) comma-separated (simple mode) | — |
| `--entries` | JSON array of entry objects (multi-project mode) | — |
| `--comment` | Short summary | auto |
| `--detail` | Extended technical info (auto-generated from Engram + git log if omitted) | auto |
| `--no-detail` | Skip auto-detail generation | false |
| `--hours` | Hours | from config |
| `--activity` | Activity type | from config |
| `--issue` | Issue ID override (comma-sep for multi-date) | from config |
| `--project` | Project slug override (comma-sep for multi-date) | from config |
| `--headless` | Show browser (false) | true |

## Activities

Análisis, Diseño, Desarrollo, Seguimiento, Testing, Prueba de Concepto, Reunion, Despliegue+Soporte QA, Despliegue+Soporte PROD, Gestión

## Error Handling

- Login fails → re-run `node setup.js`
- Form error → log, skip entry, continue
- Browser crash → close and retry
- Always closes browser in finally block
