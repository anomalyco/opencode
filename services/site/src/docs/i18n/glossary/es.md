# Español (es)

Neutral international Spanish for Spain and Latin America. Address the reader as **tú**, never vosotros. Sentence case in headings (only the first word and proper nouns capitalized). Opening `¿` and `¡`, `«comillas»` for quoted text, `…` for ellipses, no Oxford comma. Prefer natural Spanish over calques, and keep sentences about as long as the English.

## Register and style

- Direct, concise prose: `puedes`, `tu`, `tus`, `haz clic`, `escribe` (not "introduce" or "ingresa").
- Prefer the active voice and imperative for instructions: `Ejecuta el comando`, not `El comando debe ser ejecutado`.
- No gerund headings: English `Configuring X` becomes `Configurar X` or the noun form.
- `e.g.` → `p. ej.`; `etc.` stays `etc.`.
- Do not translate UI labels quoted from the product when they are bold (`**Settings › Billing**`, `**Add credits**`, `**Personal**`, `**Owner**`) or inside code. In plain prose, roles and pages read naturally in Spanish (`propietario`, `administrador`, `miembro`, `la página Policies`).
- Never call OpenCode an AI coding agent: it is an `agente de programación de código abierto`. Do not add "IA" to that phrase.

## Keep in English

- Product names: OpenCode, OpenCode Console, Console, OpenCode Models, OpenCode Go, Go, Go Plus, Go Teams, Zen, Desktop, Enterprise, Anomaly.
- Provider, model, company, app and harness names: Anthropic, OpenAI, Claude Code, Codex, Pi, Hermes, DeepSeek Harness, MCP, LSP, SDK, CLI, API, TUI, JSON, YAML, OIDC, SAML, SCIM, SSO, ZDR, OAuth, MFA.
- `harness` / `harnesses` stays English, as do `worktree`, `payload`, `endpoint`, `gateway`, `proxy`, `commit`, `issue`, `pull request`, `token`/`tokens`, `prompt`.
- Commands, flags, config keys and values, env vars, paths, code, URLs and IDs.

## Terms

| English | Español | Notes |
| --- | --- | --- |
| agent / subagent | agente / subagente | coding agent → agente de programación; child agent → agente hijo |
| primary agent | agente principal | Preserve `primary` in identifiers and config values |
| workspace | espacio de trabajo | Console's simpler "team" is equipo; Go Teams stays English |
| team | equipo | |
| Console (product) | Console | Capitalized, no translation: `OpenCode Console`; generic UI sense may read `la consola` |
| account | cuenta | |
| provider | proveedor | model provider → proveedor de modelos |
| model | modelo | model ID → ID del modelo |
| inference | inferencia | |
| request | solicitud | |
| rate limit | límite de solicitudes | Use `límite de uso` for usage limit |
| usage / spend | uso / gasto | |
| budget / limit / allowance | presupuesto / límite / cuota | |
| credit / balance / top up | crédito / saldo / recargar | |
| invoice / billing | factura / facturación | |
| subscription / plan / tier | suscripción / plan / nivel | |
| API key | clave de API | key alone → clave |
| sign in / sign up / sign out | iniciar sesión / registrarse / cerrar sesión | |
| tool / tool call | herramienta / llamada a herramienta | tool names stay as written |
| skill | skill (feminine), plural skills | Feature name for reusable agent instructions; keep `SKILL.md`, `skills/` paths and Agent Skills as written |
| plugin | plugin | |
| command / slash command | comando / comando de barra | |
| permission | permiso | allow/ask/deny → permitir/preguntar/denegar |
| policy / policies | política / políticas | the page `Policies` keeps its English name |
| config / configuration | configuración | config file → archivo de configuración |
| setting | ajuste | Settings (UI page) stays English when bold |
| session / message / turn / step | sesión / mensaje / turno / paso | |
| snapshot | instantánea | |
| checkpoint | punto de control | |
| compaction / summarize | compactación / resumir | |
| context window / input limit | ventana de contexto / límite de entrada | Use `ventana` when unambiguous |
| loopback / callback | loopback / callback | dirección de loopback, puerto de callback |
| formatter | formateador | |
| theme | tema | |
| keybind / keybinding | atajo de teclado | |
| file / folder / directory / path | archivo / carpeta / directorio / ruta | |
| repository / branch / merge | repositorio / rama / fusionar | |
| share / export / import / attach | compartir / exportar / importar / adjuntar | |
| revert / undo / redo / fork / resume | revertir / deshacer / rehacer / bifurcar / reanudar | fork a session → bifurcar la sesión |
| reasoning effort | esfuerzo de razonamiento | |
| cache lifetime | duración de la caché | |
| open-weight / frontier model | de pesos abiertos / modelo frontera | |
| free (tier or price) | gratis | adjective gratuito/gratuita in prose when it reads better |
| web search | búsqueda web | |
| Docs / Changelog / Support | Docs / Novedades / Soporte | as the site's `es.ts` already does |
| Terms of service / privacy policy | Términos del servicio / política de privacidad | |
| composer | campo de entrada | |
| GUI | GUI | `./gui-experimental` and `@opencode/plugin/gui` stay as written |
| harness | harness | |

## Notes

- File/folder names in prose: `archivo`, `carpeta`, `directorio`, `ruta`.
- Prices, percentages and dollar amounts keep the English literal (`$10`, `$0.31`, `4.6%`, `52.61`) so they match billing exactly.
- "OpenCode owns/gestiona" reads `gestiona` or `se encarga de`, never `es dueño de`.
- Console as a product is `Console` or `OpenCode Console`; the generic interface is `la consola`.
