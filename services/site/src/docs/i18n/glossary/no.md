# Glossary and style: Norwegian Bokmål (`no`)

Register: informal, direct Bokmål, addressing the reader as **du**. Short sentences, active voice, imperative for
instructions («Kjør», «Legg til», «Angi»). No translationese or calques. Titles in sentence case, as Norwegian
headings normally are. Use « » only when quoting prose; keep straight quotes inside code.

## Keep in English

- Products: OpenCode, Zen, Go, Go Plus, Go Teams, OpenCode Models, OpenCode Console, Console, Desktop, Anomaly.
- Provider, model, company, app, tool and package names.
- Acronyms: MCP, LSP, SDK, CLI, API, TUI, JSON, ZDR, SSO, SCIM, OIDC, SAML, ACP, RPC, GUI, HTTP, URL, IDE, LLM, PTY.
- `harness` (and `Harnesses` as the Console docs page name), `skill`/`skills`, `token`/`tokens`, `prompt`, `endpoint`,
  `gateway`, `loopback`, `bundle`, `worktree`/`worktrees`, `commit`, `branch`, `plugin`/`plugins`, `hook`,
  `transform`/`transforms` (plugin API), `Code Mode`, `composer`, `Diff`, `AGENTS.md`, `SKILL.md`.
- Commands, flags, config keys and values, environment variables, paths, code, URLs.
- Bold UI labels quoted from the product, such as **Settings › Billing**, **Add credits**, **Extra Usage**.
- Plan names and dollar prices: `$10/måned`, `Go`, `Go Plus`, `Go Teams`, `Free`, `Enterprise`.

## Terms

| English | Norwegian | Notes |
| --- | --- | --- |
| agent, subagent | agent, subagent | Keep the English words; `coding agent` → kodingsagent, `child agent` → underagent only if the English says child |
| open source coding agent | kodingsagent med åpen kildekode | Never «AI-agent» |
| workspace / team / member | arbeidsområde / team / medlem | Console: arbeidsområdet er beholderen, teamet er personene |
| owner / admin | eier / administrator | |
| provider (model provider) | leverandør | provider key → leverandørnøkkel |
| model | modell | Model IDs unchanged |
| session | økt | |
| tool, tool call | verktøy, verktøykall | |
| permission / policy | tillatelse / policy | |
| config / settings | konfigurasjon / innstillinger | `Config` as a page title → Konfigurasjon |
| command / flag / option | kommando / flagg / alternativ | |
| formatter | formaterer | |
| references (feature) | referanser | A docs "Reference" section → Referanse |
| attachment | vedlegg | |
| compaction | komprimering | `/compact` unchanged |
| snapshot | snapshot | plural snapshots |
| checkpoint | sjekkpunkt | |
| transcript | transkripsjon | |
| scrollback | rullehistorikk | |
| base URL | basis-URL | |
| Free (price or tier label) | Free | free models → gratis modeller |
| credit(s) | kreditt / kreditter | |
| balance | saldo | |
| invoice / invoiced billing | faktura / betaling med faktura | Use månedsfaktura where the source specifies a monthly invoice. |
| subscription | abonnement | |
| budget | budsjett | |
| usage | bruk | |
| billing | fakturering | |
| request / response | forespørsel / svar | |
| web search | nettsøk | |
| tier | nivå | |
| mode | modus | |
| repository | repositorium | `repo` only inside code |
| desktop app | desktop-app | |
| sandbox | sandkasse | |
| rate limit | hastighetsbegrensning | |
| context window | kontekstvindu | |
| reasoning effort | resonneringsinnsats | |
| streaming | strømming | |
| retry | prøv igjen | |
| deploy / deployment | rull ut / utrulling | |
| extension | utvidelse | |
| integration | integrasjon | |
| shell / shell command | shell / terminalkommando | Use shell for the interpreter or its environment, terminalkommando for what you run. Keep `shell` as an identifier. |
| path (filesystem) | sti, filsti | Use katalog for a directory; keep literal paths as written. |
| credentials | tilgangsopplysninger | Use the specific term when only API keys, tokens, or a username and password are meant. |
| policy statement | policyregel, regel | Use regel in a policy context, not setning. |
| prompt cache / prompt caching | promptcache / caching av prompter | Cache is distinct from the reserved context buffer in compaction. |
| origin (CORS) | origin | Use English when referring to the browser security concept. |
| scope (OAuth) | tilgangsomfang | Keep `scope` as an identifier. |
