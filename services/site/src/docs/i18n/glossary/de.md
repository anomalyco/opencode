# German (de) docs glossary

Locale preferences and recurring terms for the German V2 docs (`src/docs/content/de/`). Applies the shared terms in `glossary.md`; this file records the German choices and keeps them consistent with the Console marketing dictionary (`packages/site/src/i18n/de/`).

## Style

- Informal "du" throughout, short imperatives ("Führe … aus", "Öffne …"), no "Sie".
- German quotes „…“, ellipsis "…", non-breaking space before % ("60 %").
- Natural German developer documentation: compounds, no translationese or literal calques. Prefer a verb to a noun where English uses a noun ("Run …" → "Führe … aus").
- Keep sentences close to the English in length; do not add explanations.

## Keep in English

Product names: OpenCode, Zen, Go, Go Plus, Go Teams, Desktop, Console, Models (OpenCode Models), Anomaly. Role words agent, subagent, harness, and app names (Claude Code, Codex, Pi, Hermes Agent, Cursor, VS Code, …). Acronyms MCP, LSP, SDK, CLI, API, TUI, JSON, ZDR, SSO, SCIM, OIDC, SAML, BCP, PTY. Bold English UI labels quoted from the product (**Settings › Billing**, **Add credits**). Commands, flags, keys, paths, URLs, code.

## Terms

| English | de | Notes |
| --- | --- | --- |
| agent, subagent | Agent, Subagent | German nouns, plural Agenten/Subagenten; Coding-Agent hyphenated |
| workspace | Workspace | der Workspace, plural Workspaces; not Team (Console's simpler "team" stays Team) |
| team | Team | Go Teams stays English |
| Console (the product) | Console | die Console; OpenCode Console unchanged |
| account | Konto | Not Account; provider account → Anbieterkonto |
| provider (model provider) | Anbieter | Keep Provider where it is a literal identifier, UI label or config/API name |
| authentication / authenticate | Authentifizierung / authentifizieren | |
| authorization | Autorisierung | |
| API key | API-Schlüssel | Preserve literal UI labels and identifiers such as `apiKey` |
| service account | Service-Konto | |
| token | Token | plural Tokens; stays English |
| input / output tokens | Eingabetokens / Ausgabetokens | |
| session | Session | die Session, plural Sessions |
| prompt | Prompt | plural Prompts |
| tool / tool call | Tool / Tool-Aufruf | |
| plugin | Plugin | plural Plugins |
| skill | Skill | plural Skills |
| inference | Inference | die Inference |
| usage | Nutzung | usage limits → Nutzungslimits |
| request | Anfrage | |
| request body | Anfrage-Body | |
| response | Antwort | |
| endpoint | Endpunkt | |
| config / configuration | Konfiguration | config file → Konfigurationsdatei; `opencode.json` unchanged |
| command | Befehl | slash command → Slash-Befehl |
| permissions | Berechtigungen | |
| approval / saved approval | Zustimmung / gespeicherte Zustimmung | Keep English labels such as „Allow always“ when quoting the UI |
| policy / policies | Policy / Policies | Console feature; ordinary "rule" → Regel |
| budget | Budget | |
| subscription | Abo | |
| billing | Abrechnung | |
| credits / balance | Guthaben | |
| auto-recharge | automatische Aufladung | Keep **Auto-recharge** when quoting the UI |
| invoiced billing / credit limit | Abrechnung per Rechnung / Kreditrahmen | Not Rechnungsstellung / Kreditlimit in billing prose |
| spend limit | Ausgabenlimit | |
| invoice | Rechnung | |
| refund | Erstattung | |
| model | Modell | |
| model discovery | automatische Modellerkennung | Prefer a verb in prose: „OpenCode erkennt lokale Modelle automatisch“ |
| context | Kontext | |
| gateway | Gateway | |
| proxy | Proxy | network proxy only |
| deployment | Deployment | deploy → deployen |
| self-hosted | selbst gehostet | |
| base URL | Basis-URL | |
| web search | Websuche | |
| theme | Theme | |
| keybind / keybinds | Tastenbelegung | |
| formatter | Formatter | |
| snapshot | Snapshot | |
| compaction | Compaction | Feature name; verb "kompaktieren" |
| transcript | Transkript | |
| scrollback | Scrollback | |
| references (feature) | Referenzen | a docs "Reference" section stays Referenz |
| attachment | Anhang | plural Anhänge |
| checkpoint | Checkpoint | |
| effort (reasoning) | Effort | reasoning effort → Reasoning-Effort |
| loopback | Loopback | |
| expose (API/RPC) | bereitstellen | Avoid "exponieren" |
| composer | Eingabefeld | Keep `composer` when it names the API object, and preserve quoted UI labels |
| composer pill | Status-Chip am Eingabefeld | Keep `ComposerPill` as the API identifier |
| child session / parent session | untergeordnete Session / übergeordnete Session | Not Kind-Session or Parent-Session |
| hue / base hue | Farbton / Grundfarbton | Keep `hue` in code, identifiers and literal UI labels |
| bundle | Bundle | |
| profile (Codex) | Profile | harness, profile stay English |
| Free (tier) | Free | Tier label stays English; "free" as in no cost → kostenlos |
| Owner / Admin / Member (roles) | Owner / Admin / Member | Keep English role names |
