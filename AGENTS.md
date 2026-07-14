- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## CodeGraph — Navegación Estructural

Este proyecto está indexado con CodeGraph (`.codegraph/codegraph.db`):
- **Archivos**: 2,239 | **Nodos**: 36,173 | **Aristas**: 37,276
- Usar `codegraph_explore` con `projectPath: "/home/servidor/Descargas/opencode"` para consultar símbolos.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.
- In Effect generators, bind services to named variables before calling methods. Do not use nested service yields such as `yield* (yield* Foo.Service).bar()`.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Repos Relacionados

| Repo | Stack | Ubicación | Rol |
|------|-------|-----------|-----|
| **POS Cuentas Corrientes** | Angular 21, TypeScript, SCSS | `~/Descargas/POSCuentasCorrientes/` | Frontend cuentas corrientes y admin chatbot |
| **POS Frontend Reform** | Angular | `~/Descargas/POSFrontReform/` | Frontend POS (punto de venta, caja) |
| **POS Backend** | .NET 8, Clean Architecture, EF Core | `~/Descargas/PosBackend/` | API de ventas, auth JWT, cuentas corrientes |
| **Chatbot Backend** | Python 3.10, FastAPI, SQLAlchemy async | `/media/servidor/d0a196c3-2d36-4431-b15d-8ea078ad8222/EcEnlacesChacoPython/` | API chatbot WhatsApp, admin panel, leads |
| **Landing Page** | Angular 19, Express SSR | `~/Descargas/LandingPage/` | Landing page institucional Enlaces Chaco |
| **EC File Manager** | .NET, Python | `~/Descargas/ECFileManager/` | Gestor de archivos |
| **Proyecto Personalidad IA** | .NET 9/10, Clean Architecture | `~/Descargas/ProyectoPersonalidadIA/` | Sistema de personalidad IA |

### URLs por entorno

| Servicio | Staging | Producción |
|----------|---------|------------|
| POS Cuentas Corrientes | `poscuentascorrientes-stage.up.railway.app` | `www.enlaceschaco.ar` |
| POS Frontend Reform | `posfrontreform-stage.up.railway.app` | — |
| POS Backend | `posbackend-staging.up.railway.app/api` | `posbackend-production-e8e4.up.railway.app/api` |
| Chatbot API | `ecchatbot.enlaceschaco.ar/admin` | `ecchatbot.enlaceschaco.ar/admin` |

## Fork: gentle-opencode

Este fork de opencode se distribuye con gentle-ai integrado.

### Objetivo

Que el usuario en Windows haga un solo install y ya tenga opencode fork + gentle-ai + skills + config listos para funcionar. Sin pasos adicionales.

### Plan de instalación

El `install.ps1` de este fork (o script Shell) debe:

1. Bajar y extraer `opencode-fork.exe`
2. Bajar la ultima release de gentle-ai desde GitHub Releases
3. Poner gentle-ai en PATH (ej. `%LOCALAPPDATA%\\gentle-ai\\bin`)
4. Ejecutar `gentle-ai install --agent opencode` (non-interactive)
5. Eso baja persona, engram, sdd, skills, permisos, plugins, todo

### Provider / modelos

- El provider `opencode-go` viene del catalog `https://models.dev/api.json` -- no necesita código extra en el fork.
- Los modelos como `opencode-go/deepseek-v4-flash` requieren la env var `OPENCODE_API_KEY` configurada.

### A futuro

- La configuración se manejara remotamente a través del login de Microsoft del usuario.
- gentle-ai seguira siendo source of truth de skills/prompts/agentes/config.
- Este fork solo asegura compatibilidad con gentle-ai (no bloquear, no pisar config).

### Principio rector

gentle-ai ya tiene instalador, persona, skills, SDD, Engram, permisos, commands. Este fork NO duplica, modifica, ni extiende nada de eso. gentle-ai es el encargado de gestionar la config del agente.

### Releases

- **Repo**: `ivanfernadezm99/opencode`
- **GitHub Releases**: https://github.com/ivanfernadezm99/opencode/releases
- **Nextcloud mirror** (descarga pública): https://enlaceschacocloud.duckdns.org/s/ojAcbHDQBTX97oD
- **Sync script**: `scripts/sync-to-nextcloud.sh` — baja assets de GitHub y los sube a Nextcloud

#### Flujo de release

```bash
# 1. Taggear y pushear
git tag -a vX.Y.Z -m "vX.Y.Z: descripción"
git push fork vX.Y.Z --force --no-verify

# 2. Crear release en GitHub con assets
gh release create vX.Y.Z \
  --repo ivanfernadezm99/opencode \
  --title "Gentle OpenCode vX.Y.Z" \
  --notes "..." \
  install.ps1 install.bat opencode_X.Y.Z_windows_amd64.zip

# 3. Sincronizar a Nextcloud
./scripts/sync-to-nextcloud.sh vX.Y.Z
```

#### Archivos del release

| Archivo | Peso | Descripción |
|---|---|---|
| `install.ps1` | ~17 KB | Instalador PowerShell (detecta prerequisitos, usa winget si faltan) |
| `install.bat` | 398 B | Wrapper para doble-click (invoca install.ps1 con -ExecutionPolicy Bypass) |
| `opencode_X.Y.Z_windows_amd64.zip` | ~55 MB | Binario CLI compilado para Windows x64 |

#### Qué hace el installer

1. Chequea git, node, npm → si faltan, los instala con winget
2. Backup de `%USERPROFILE%\.engram\engram.db` antes de reinstalar (la memoria de Engram sobrevive)
3. Baja opencode-fork desde GitHub (o Nextcloud con `-UseMirror`)
4. Baja gentle-ai desde GitHub
5. Agrega ambos a PATH
6. Ejecuta `gentle-ai install --agent opencode` (baja persona, engram, SDD, skills, plugins)
7. Linkea config para la app de escritorio

#### Instalación

```powershell
# Estándar (PowerShell como Admin)
irm https://github.com/ivanfernadezm99/opencode/releases/latest/download/install.ps1 | iex

# Con mirror Nextcloud (si GitHub está lento/bloqueado)
.\install.ps1 -UseMirror
```

#### Engram DB

- **Ubicación**: `%USERPROFILE%\.engram\engram.db` (Windows), `~/.engram/engram.db` (Linux)
- **Separado de la config**: `gentle-ai install` solo toca `~/.config/opencode/`, nunca la base de datos
- **Backup automático**: el installer crea `engram.db.backup-YYYYMMDD-HHmmss` antes de reinstalar

#### Historial de versiones del fork

| Versión | Cambio |
|---|---|
| v1.0.0 | Release inicial: installer NSIS + CLI binario |
| v1.0.1 | Backup automático de engram.db antes de reinstalar |
| v1.0.2 | Auto-install de git, node, npm vía winget en Windows frescas |
| v1.0.3 | Soporte mirror Nextcloud + script de sync (`-UseMirror`) |
| v1.0.4 | Sin rate limit de GitHub API (usa HTTP redirect en vez de api.github.com) |
| v1.0.5 | Auto-fallback a Nextcloud cuando GitHub no responde |
