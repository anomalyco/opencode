---
name: jarvis-github-kanban
description: Flujo completo de gestión de ítems en GitHub Projects (Jarvis · Interno). Usar SIEMPRE al crear, mover, debatir, ejecutar o cerrar ítems del kanban. Cubre estados, mutaciones GraphQL, IDs de campos/opciones, labels, versiones, kanban-sync.py, changelog auto-generado, y el ciclo de vida DraftIssue→Issue→Close. También al crear versiones nuevas, campos nuevos, o auditar el kanban.
---

# Jarvis — GitHub Kanban Workflow

Flujo completo de gestión de ítems en el proyecto `Jarvis · Interno` (Project #5 de jaminsmoke).

## Datos del proyecto

| Dato | Valor |
|---|---|
| Project ID | `PVT_kwHOBM87Yc4Bfn48` |
| Repo ID | `R_kgDOTv7ysw` |
| Repo | `jaminsmoke/Jarvis` |
| Rama default | `dev` |
| URL kanban | https://github.com/users/jaminsmoke/projects/5 |

## Setup del Project (primera vez)

Esta skill asume que el Project ya existe. Para crear uno nuevo:

### 1. Crear el Project

Ir a https://github.com/users/jaminsmoke/projects → New project → elegir "Kanban" como template. Nombre: `Jarvis · Interno`.

### 2. Vincular el repositorio

Project Settings → Linked repositories → buscar `jaminsmoke/Jarvis` → Link. Esto habilita convertir Drafts a Issues del repo.

### 3. Crear campos personalizados

En Project Settings → Fields → + New field (SingleSelect para todos):

| Campo | Opciones iniciales | Nota |
|---|---|---|
| **Status** | Detectado, Debate, Roadmap, Ejecutando, Verificando, Changelog | Marcar "Changelog" como "Done" en la UI |
| **Versión** | Sin asignar, v0.1.0 | Añadir versiones según releases |
| **Prioridad** | Alta, Media, Baja | |
| **Decisión** | Decidido, Descartado, Diferido | |
| **Tipo** | Bug, Feature, Maintenance, Security, Decision | |
| **Área principal** | App, Desktop, Core, Server, CI, Infra, Docs, Lint, Dependencies, Release, Governance, Upstream | |
| **HighLighted** | Yes, No | |

Campos Date: **Inicio**, **Completado**. Campos Text: **Inicio exacto**, **Completado exacto**.

> ⚠️ Los IDs de campos y opciones cambian en cada Project. Obtenerlos con `gh project field-list` y `gh api graphql` y actualizar esta skill.

### 4. Configurar la vista Kanban

En la vista principal (tab "Kanban"):
- **Layout**: Board
- **Group by**: Status
- **Slice by**: (ninguno)
- **Sort**: manual (drag & drop)
- **Visible fields**: Title, Status, Versión, Prioridad, Tipo, Área principal

La vista se configura exclusivamente desde la UI (no hay API para `groupBy` ni layout).

### 5. Workflow de estados

En Project Settings → Workflows, configurar que "Changelog" cierre automáticamente los issues al moverse allí:
- Status → Changelog → Set item to "Done" (close issue)

Esto aplica el check de completado automáticamente.

### Skills complementarias

> 📘 Usar junto con `jarvis-github-agentuse` para todas las operaciones de gh CLI, MCP, GraphQL y REST necesarias durante el setup y gestión diaria.

## Ciclo de vida de un item

```
Detectado → Debate → Roadmap → Ejecutando → Verificando → Changelog
  Draft      Draft     Draft     Issue OPEN    Issue OPEN    Issue CLOSED
```

### Reglas generales

- **0 Drafts en Changelog**: todos los items en Changelog deben ser Issues reales cerrados.
- **Sin saltos**: cada item avanza en orden. Excepción: Descartado (va directo a Changelog como Issue cerrado).
- **Versión objetivo móvil**: la siguiente versión posterior a la release `latest`. Si `latest = v0.1.4`, objetivo = `v0.1.5`.
- **Body acumulativo**: el cuerpo empieza en Detectado y evoluciona sin perder secciones.
- **Tipo Draft/Issue**: DraftIssue tiene título y cuerpo pero NO labels, assignee, número, estado open/closed. Issue tiene todo.

### 1. Detectado → Crear item

```graphql
addProjectV2DraftIssue(projectId, title, body)
```

**Obligatorio**: título concreto, cuerpo con plantilla completa, Versión, Prioridad, Inicio e Inicio exacto (del `createdAt`).

**Plantilla del cuerpo**:
```markdown
## Contexto
<situación, objetivo, por qué importa ahora>

## Hallazgo y evidencia
<hechos verificables, rutas, versiones, métricas>

## Impacto
<consecuencias técnicas, producto, seguridad>

## Alcance a debatir
<qué decidir, límites>

## Preguntas para Debate
1. <pregunta>
2. <pregunta>

## Criterio para avanzar
<evidencia mínima para pasar a Roadmap>

## Clasificación preliminar
- Tipo: <bug|feature|maintenance|security|decision>
- Área: <app|desktop|core|server|CI|infra|docs|lint|dependencies|release|governance|upstream>
- Labels esperadas: <label1>, <label2>
- Prioridad: <Alta|Media|Baja>
- Versión objetivo: <siguiente a latest>
```

### 2. Debate → Discutir y decidir

```graphql
updateProjectV2ItemFieldValue → Status: "Debate"
```

Editar el cuerpo: responder preguntas, añadir alternativas y trade-offs.

Al cerrar el debate:
- `Decisión: Decidido` → avanza a Roadmap
- `Decisión: Descartado` → documentar motivo, convertir a Issue, cerrar, Changelog
- `Decisión: Diferido` → documentar motivo y condición, devolver a Detectado

### 3. Roadmap → Planificar

```graphql
updateProjectV2ItemFieldValue → Status: "Roadmap"
updateProjectV2ItemFieldValue → Decisión: "Decidido"
```

Añadir al cuerpo:
```markdown
## Decisión acordada
<opción elegida y razones>

## Plan aprobado
1. <cambio concreto>
2. <siguiente paso>

## Criterios de aceptación
- [ ] <resultado observable>

## Plan de verificación
- <typecheck/lint/tests>

## Riesgos y recuperación
<riesgos y forma de revertir>
```

### 4. Ejecutando → Convertir a Issue (ANTES de escribir código)

```graphql
# 1. Leer y conservar title + body del DraftIssue
query { node(id: $ITEM_ID) { ... on ProjectV2Item { content { ... on DraftIssue { title, body } } } } }

# 2. Convertir
convertProjectV2DraftIssueItemToIssue(itemId, repositoryId)

# 3. Verificar title + body preservados
query { node(id: $ITEM_ID) { ... on ProjectV2Item { content { ... on Issue { number, title, body } } } } }

# 4. Aplicar labels
addLabelsToLabelable(labelableId, labelIds)

# 5. Status → Ejecutando
updateProjectV2ItemFieldValue → Status: "Ejecutando"
```

- **Nunca reemplazar** el cuerpo por plantilla vacía.
- Aplicar labels según Tipo + Área.
- Verificar que title, body, labels, Status son coherentes.

### 5. Verificando → Documentar implementación

```graphql
updateProjectV2ItemFieldValue → Status: "Verificando"
```

Añadir al cuerpo SIN borrar contexto:
```markdown
## Implementación
**Commit**: <sha> (rama dev)
**Archivos**: <lista>
<decisiones técnicas y desviaciones>

## Verificación
<pendiente hasta completar todos los checks>
```

### 6. Changelog → Cerrar

```graphql
# 1. Actualizar cuerpo con verificación final
# 2. Añadir ✅ al título
# 3. Cerrar Issue
closeIssue(issueId)
# 4. Campos del Project
updateProjectV2ItemFieldValue → Status: "Changelog"
updateProjectV2ItemFieldValue → Completado (Date)
updateProjectV2ItemFieldValue → Completado exacto (Text, UTC ISO 8601)
updateProjectV2ItemFieldValue → HighLighted: "Yes" (si aplica)
# 5. Regenerar changelog
python scripts/kanban-sync.py changelog
```

## Mutaciones GraphQL clave

| Mutación | Input | Uso |
|---|---|---|
| `addProjectV2DraftIssue` | projectId, title, body | Crear Draft |
| `updateProjectV2DraftIssue` | draftIssueId, title, body | Editar Draft (usar json.dumps para body) |
| `updateProjectV2ItemFieldValue` | projectId, itemId, fieldId, value | Setear cualquier campo |
| `convertProjectV2DraftIssueItemToIssue` | itemId, repositoryId | Draft → Issue |
| `addLabelsToLabelable` | labelableId, labelIds | Añadir labels |
| `closeIssue` | issueId | Cerrar Issue |
| `deleteProjectV2Item` | projectId, itemId | Eliminar item |

## Status IDs

| Status | Option ID |
|---|---|
| Detectado | `0a2ea60d` |
| Debate | `12bff49e` |
| Roadmap | `e0f179d6` |
| Ejecutando | `5983e216` |
| Verificando | `4885da16` |
| Changelog | `7874500c` |

## Campos personalizados

| Campo | Field ID | Tipo | Opciones |
|---|---|---|---|
| Status | `PVTSSF_lAHOBM87Yc4Bfn48zhZ5fDo` | SingleSelect | Ver tabla arriba |
| Versión | `PVTSSF_lAHOBM87Yc4Bfn48zhZ5goQ` | SingleSelect | Releases |
| Prioridad | `PVTSSF_lAHOBM87Yc4Bfn48zhZ5goU` | SingleSelect | Alta/Media/Baja |
| Decisión | `PVTSSF_lAHOBM87Yc4Bfn48zhZ5jKI` | SingleSelect | Decidido/Descartado/Diferido |
| Tipo | `PVTSSF_lAHOBM87Yc4Bfn48zhZ8Pgs` | SingleSelect | Bug/Feature/Maintenance/Security/Decision |
| Área principal | `PVTSSF_lAHOBM87Yc4Bfn48zhZ8Pis` | SingleSelect | App/Desktop/Core/Server/CI/Infra/Docs/Lint/Dependencies/Release/Governance/Upstream |
| HighLighted | `PVTSSF_lAHOBM87Yc4Bfn48zhZ-CSY` | SingleSelect | Yes/No |
| Inicio | `PVTF_lAHOBM87Yc4Bfn48zhZ8bRE` | Date | Día local |
| Inicio exacto | `PVTF_lAHOBM87Yc4Bfn48zhZ8bRI` | Text | UTC ISO 8601 |
| Completado | `PVTF_lAHOBM87Yc4Bfn48zhZ5mT8` | Date | Día local |
| Completado exacto | `PVTF_lAHOBM87Yc4Bfn48zhZ8bRM` | Text | UTC ISO 8601 |

## Option IDs por campo

### Versión
| Opción | ID |
|---|---|
| v0.1.0 | `15905bd2` |
| v0.1.1 | `f2c85aca` |
| v0.1.2 | `ac87c877` |
| v0.1.3 | `9e7509ea` |
| v0.1.4 | `66fdab55` |
| v0.1.5 | `469e6317` |
| Sin asignar | `837adc26` |

### Prioridad
| Opción | ID |
|---|---|
| Alta | `5d462692` |
| Media | `8759d88f` |
| Baja | `491c0a1b` |

### Decisión
| Opción | ID |
|---|---|
| Decidido | `21adec4d` |
| Descartado | `c4245afc` |
| Diferido | `3e191ae5` |

### Tipo
| Opción | ID |
|---|---|
| Bug | `b691c1c3` |
| Feature | `d1c781da` |
| Maintenance | `cc0d870e` |
| Security | `e0113689` |
| Decision | `5b30cb08` |

### Área principal
| Opción | ID |
|---|---|
| App | `60f552c6` |
| Desktop | `0d7ae8e0` |
| Core | `295fb2fd` |
| Server | `6a079565` |
| CI | `000da29f` |
| Infra | `b6546326` |
| Docs | `b592ee68` |
| Lint | `c2734252` |
| Dependencies | `9ad312e3` |
| Release | `f304f880` |
| Governance | `47729191` |
| Upstream | `05960faf` |

### HighLighted
| Opción | ID |
|---|---|
| Yes | `70a25690` |
| No | `30d8c17f` |

## Versión objetivo móvil

1. Consultar release `latest` en GitHub. No asumirla.
2. Derivar siguiente patch: `vX.Y.(Z+1)`.
3. Si el alcance exige minor/major, decidirlo en Debate.
4. Antes de crear items, verificar que la opción existe en el campo Versión.
5. **Crear nueva versión**: NO hay API. Ir a Project Settings → Fields → Versión → Add option. Luego actualizar esta skill con el nuevo ID.
6. Al publicar la versión, crear preventivamente la siguiente opción.
7. `Sin asignar` es siempre inconsistencia — corregir.

## Labels canónicas

| Label | Cuándo usarla |
|---|---|
| `app` | Cambios en `packages/app/` o experiencia web |
| `desktop` | Cambios en `packages/desktop/`, Electron o updater |
| `docs` | Documentación, AGENTS.md, GitHub Pages |
| `CI` | Workflows, checks, runners |
| `infra` | Releases, signing, automatización del Kanban |
| `lint` | Deuda o reglas de lint |
| `dependencies` | Actualizaciones de dependencias |
| `core` | Runtime central |
| `server` | Servidor, API |
| `release` | Proceso de release, artefactos |
| `governance` | Ownership, políticas |
| `upstream` | Sincronización con OpenCode |
| `bug` | Comportamiento incorrecto |
| `feature` | Capacidad nueva observable |
| `maintenance` | Refactor, mejora de proceso |
| `security` | Vulnerabilidad, secreto, hardening |
| `decision` | Decisiones D-XXX |

- Elegir exactamente 1 Tipo + 1 Área antes de Ejecutando.
- No usar `feature` para bugs, CI, docs, seguridad.
- No mezclar aliases heredados: `documentation` → `docs`, `enhancement` → `feature`.

## Script kanban-sync

Vive en `Jarvis/scripts/kanban-sync.py`. Comandos:

```bash
python scripts/kanban-sync.py changelog  # Regenera HTML + JSON
python scripts/kanban-sync.py audit      # Verifica campos correctos
python scripts/kanban-sync.py move <itemId> <fromStatus> <toStatus>  # Transiciones
```

### Changelog auto-generado

- **`docs/changelog.html`**: todos los Issues cerrados agrupados por versión. Generado por `kanban-sync.py changelog`.
- **`docs/changelog.json`**: solo items con `HighLighted: Yes` (3-5 por versión). Generado por `scripts/generate-changelog-json.py`. Lo consume el modal `DialogReleaseNotes` de la app.
- Ambos se regeneran en CI (`ci-quality.yml` job `changelog`) y al cerrar items.
- El HTML es determinista (sin timestamp) — solo cambia si el kanban cambió.

### Crear nuevo campo en el Project

NO hay API — solo UI:
1. Ir a https://github.com/users/jaminsmoke/projects/5/settings
2. Fields → + New field → elegir tipo (SingleSelect recomendado)
3. Añadir opciones
4. Obtener IDs consultando:
```bash
gh project field-list 5 --owner jaminsmoke --format json
gh api graphql -f query='query{node(id:"FIELD_ID"){...on ProjectV2SingleSelectField{name,options{id,name}}}}'
```
5. Actualizar esta skill con los nuevos IDs.

## CI: job changelog

En `ci-quality.yml`, job `Regenerate changelog`:
- Ejecuta `python scripts/kanban-sync.py changelog`
- Si hay diff en `docs/`, commitea y pushea
- Usa `GH_PAT` (classic PAT con `read:project`) — GITHUB_TOKEN no accede a Projects
- Sin `continue-on-error` — falla honestamente si el token no funciona

## Ejecución de GraphQL (sin archivos temporales)

**PROHIBIDO** crear scripts one-shot (`.py`, `.sh`, `.gql`, `.tmp*`) ni dentro ni fuera del repo para operaciones puntuales.

- **Queries/mutaciones cortas** — inline:
```bash
gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: {projectId: "...", itemId: "...", fieldId: "...", value: {singleSelectOptionId: "..."}}) { clientMutationId } }'
```
- **Queries largas o con bodies grandes** — por stdin (heredoc), sin volcar a archivo:
```bash
gh api graphql -F query=@- <<'GQL'
query { node(id: "...") { ... on ProjectV2Item { content { ... on DraftIssue { body } } } } }
GQL
```
- **Issue bodies grandes**: `gh issue edit N --body-file -` con el body por stdin.
- **Lógica extra** (parsear/iterar): `python -c "..."` inline que invoca `gh api` con la query por stdin; la query se puede pasar como heredoc dentro del comando. Nunca `write_file` a un script.
- Para escapar caracteres especiales en bodies, usar `jq -Rs .` o `python -c "import json,sys; print(json.dumps(sys.stdin.read()))"` — sin archivos.

## Regla: operaciones one-shot SIN scripts (ni dentro ni fuera del repo)

- Ejecutar operaciones puntuales **directamente con `gh` o MCP**: inline, por stdin, o `python -c` con la lógica inline.
- **NUNCA** crear `_*.py` / `_*.gql` / `.tmp*` / `.sh` en ningún sitio (ni `Jarvis/scripts/`, ni `/tmp`, ni `C:/tmp`) para operaciones one-shot.
- **Solo versionar scripts en `Jarvis/scripts/`** si son reutilizables (`kanban-sync.py`, `generate-changelog-json.py`, `kanban-close.ps1`), con docstring y tests en `scripts/tests/`.
- Si una operación se repite: convertirla a comando de skill o script versionado con tests; nunca dejar temporales.
- Al terminar cada tarea de items: `git status` debe quedar limpio (no se generan temporales si no se crean).
