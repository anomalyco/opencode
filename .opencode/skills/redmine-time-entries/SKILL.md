---
name: redmine-time-entries
description: "Trigger: cargar horas, registrar horas, cargar tiempo, redmine horas, oneinfo horas. Automatiza la carga de horas en Redmine via Playwright usando datos de Engram."
license: Apache-2.0
metadata:
  author: "servidor"
  version: "2.3"
---

## Activación

Carga horas de trabajo en OneAdmin Redmine (https://oneadmin.oneinfoconsulting.com) leyendo lo trabajado desde memorias Engram y automatizando el formulario de carga via Playwright.

Usar cuando el usuario diga: "cargar horas", "registrar horas", "cargar tiempo", "cargar horas redmine", o pida registrar trabajo en Redmine.

## 🔒 Seguridad de Credenciales

**Las credenciales NUNCA pasan por el chat, comandos bash, o contexto de IA.**

```
❌ NUNCA:   echo $REDMINE_PASS | ...     (bash expone la clave en ps aux)
❌ NUNCA:   mostrar .credentials en el chat
❌ NUNCA:   pedir usuario/contraseña en el chat
✅ SIEMPRE: load-hours.js lee .credentials INTERNAMENTE
✅ SIEMPRE: si no hay creds, crea template y pide editarlo
```

### Cómo configurar las credenciales (4 métodos seguros)

**Opción A — opencode-cred (RECOMENDADO):**
```bash
opencode-cred set redmine
```
Abre formulario en el navegador (localhost). Las credenciales se guardan en `~/.config/opencode/credentials/redmine.cred`.

**Opción B — Editor gráfico (recomendado para AI context):**
Cuando `load-hours.js` detecta que no hay terminal interactivo:
1. Escribe el template `.credentials` con placeholders
2. Muestra la ruta del archivo y termina
3. El orquestrador abre editor gráfico (gedit/kate)
4. El usuario completa y guarda
5. Se vuelve a ejecutar el script (ya encuentra las credenciales)

**Opción C — Variables de entorno (sin archivo en disco):**
```bash
export REDMINE_USER=tu_usuario
export REDMINE_PASS=tu_contraseña
```
`load-hours.js` las lee automáticamente.

**Opción D — Terminal local:**
Ejecutá `load-hours.js` directo en una terminal. Si hay TTY, abre `gedit`, `kate`, `nano`, o `$EDITOR`.

**¿Por qué es seguro?**
- Las credenciales **NUNCA** pasan por el contexto de la IA
- **NUNCA** se muestran en el chat, logs, o bash history
- Archivos locales con permisos 600
- `opencode-cred` usa formulario en localhost, nada sale de tu PC

### Onboarding automático (orquestrador)

Cuando el orquestrador necesita cargar horas y no hay credenciales:

1. Ejecuta `load-hours.js` → detecta que no hay `.credentials`
2. Como no hay TTY, escribe el template y **sale** mostrando la ruta
3. El orquestrador abre la herramienta disponible:
   - gedit/kate → editor gráfico con el template
   - xdg-open → editor por defecto
4. El usuario completa usuario/contraseña y guarda
5. El orquestrador vuelve a ejecutar `load-hours.js` → ya funciona

**Una sola vez**: guardado `.credentials`, se reusa siempre.
El orquestrador NO debe preguntar credenciales en el chat ni leer `.credentials`.

## Uso rápido

```bash
# Un día — comment y detail auto-generados
bun load-hours.js --date 2026-07-17

# Varios días
bun load-hours.js --date 2026-07-14,2026-07-15,2026-07-16

# Con datos explícitos (sin auto-generación)
bun load-hours.js --date 2026-07-17 --hours 4 --activity "Análisis" \
  --comment "Revisión de plan" --detail "Refs: abc123, def456"

# Sin auto-detail
bun load-hours.js --date 2026-07-17 --no-detail

# Multi-proyecto mismo día (--entries JSON)
bun load-hours.js --entries '[
  {"date":"2026-07-17","hours":4,"project":"proy-a","issue":"123","activity":"Desarrollo","comment":"Nueva funcionalidad"},
  {"date":"2026-07-17","hours":2,"project":"proy-b","issue":"456","activity":"Testing","comment":"Corrección de bugs"}
]'

# Multi-proyecto con flags separados por coma
bun load-hours.js --date 2026-07-17,2026-07-17 \
  --project proy-a,proy-b --issue 123,456 \
  --activity Desarrollo,Testing --hours 4,2
```

> **Nota**: El auto-detail requiere `bun` (consulta SQLite de Engram + git log).
> Sin `bun` funciona pero sin auto-generación de detalle.

## Reglas estrictas

- 🔒 **NUNCA tocar `.credentials` desde el contexto de IA.** `load-hours.js` lo lee internamente. El AI no debe leerlo, mostrarlo, ni pasarlo como argumento.
- 🔒 **NUNCA pasar credenciales por bash.** No `echo $PASS |`, no `--password=...`. El script usa archivo o env vars.
- 🔒 **Onboarding guard AUTOMÁTICO.** `load-hours.js` maneja la config sola. El orquestrador NO pregunta credenciales, NO lee `.credentials`, NO ejecuta `setup.js`.
- **Siempre preguntar antes de empezar** (preflight obligatorio):
  1. **¿Cuántos proyectos?** ¿Uno solo o varios? Si son varios, recolectar entradas por proyecto.
  2. **Entradas por proyecto** (repetir por cada uno):
     - **Proyecto**: slug del proyecto en Redmine
     - **Tarea/Issue**: número de tarea (opcional, específica del proyecto)
     - **Fechas**: qué días cargar para este proyecto
     - **Actividad**: tipo (Desarrollo, Testing, etc.)
     - **Horas por día**
  3. **Modo de confirmación**: `auto` / `confirmar-todo` / `confirmar-cada-una`
- Usar "Crear y continuar" para entradas en lote, "Crear" para la última.
- **Cargar SOLO** trabajo hecho en el/los proyecto(s) especificados.
- **Soportar múltiples proyectos en el mismo día.** Ej: 4h en Proyecto A (Desarrollo) y 4h en Proyecto B (Testing), misma fecha.
- Con múltiples proyectos, pasar `--entries` JSON en vez de `--date`.
- El **comment se auto-genera** a partir de los commits del día si no se especifica. Arma un resumen descriptivo como `"skills: multi-project, credential flow | installer: tests, docs"`.

## Archivos de configuración

| Archivo | Propósito | Compartible? |
|---------|-----------|-------------|
| `config.json` | Proyecto, tarea, actividad por defecto | Sí (sin secretos) |
| `.credentials` | Usuario + contraseña | NO (por usuario) |

## Flags CLI

| Flag | Descripción | Default |
|------|-------------|---------|
| `--date` | Fecha(s) separadas por coma (modo simple) | — |
| `--entries` | JSON array de entradas (modo multi-proyecto) | — |
| `--comment` | Resumen corto | auto-generado |
| `--detail` | Info técnica extendida (auto-generada) | auto |
| `--no-detail` | Saltar auto-generación de detalle | false |
| `--hours` | Horas | del config |
| `--activity` | Tipo de actividad | del config |
| `--issue` | ID de tarea (coma-sep para multi-entry) | del config |
| `--project` | Slug del proyecto (coma-sep para multi-entry) | del config |
| `--headless` | Mostrar navegador (false) | true |

## Actividades

Análisis, Diseño, Desarrollo, Seguimiento, Testing, Prueba de Concepto, Reunion, Despliegue+Soporte QA, Despliegue+Soporte PROD, Gestión

## Manejo de errores

- Login falla → actualizar credenciales en `.credentials`
- Error en formulario → loguear, saltar entrada, continuar
- Navegador crashea → cerrar y reintentar
- Siempre cierra el navegador en finally
