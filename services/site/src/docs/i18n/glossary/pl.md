# Polish docs glossary and style (pl)

Glossary for `src/docs/content/pl/` and the Polish Console dictionary
(`packages/site/src/i18n/pl/`). Follow it together with `src/docs/i18n/glossary.md`
(the shared table) and the site's `services/site/src/i18n/pl.ts`, whose register this
translation keeps.

## Register

- Second person singular, informal, with courtesy capitals on possessives and pronouns:
  **Ty**, **Twój**, **Twoje**, **Cię**, **się**. Imperatives: „Użyj", „Wybierz", „Uruchom",
  „Dodaj", „Otwórz". Never „Pan/Pani", never „państwo" for the reader.
- Natural Polish technical prose, not a calque. Prefer a plain verb to a noun phrase
  („aby skonfigurować" over „w celu dokonania konfiguracji"), avoid „posiada" (use „ma"),
  avoid „dedykowany" when „własny" or „osobny" works, avoid overusing „będzie" and
  „można" when an imperative is shorter.
- Short sentences; keep the English page's structure and information density. The
  translation may be slightly longer than the English, never shorter by dropping content.
- No questions in marketing-style copy unless the English asks one; the docs keep the
  English tone (statements, instructions).
- Polish typography: „cudzysłowy" (or «cudzysłowy» for quoted UI), półpauza – for ranges,
  pauza — sparingly, wielokropek …, no space before `%` but a space before units
  (`10 $`, `5 min`, `2 GB`); keep the English number formats for prices ($10) and IDs.
  Use non-breaking space only where the source already has one.
- Sentence case in headings, as in the English page: only the first word and proper nouns
  capitalized.

## Keep in English (never translate, never inflect inside code)

Product and brand: OpenCode, OpenCode Zen, Zen, OpenCode Go, Go, Go Plus, Go Teams,
OpenCode Console, Console, Desktop, OpenCode Desktop, OpenCode Models, Anomaly, Enterprise
(as the plan/segment name), Free only when it is a quoted UI label (**Free**).
Roles and protocols: agent, subagent, harness, MCP, MCP server, LSP, ACP, SDK, CLI, TUI,
API, JSON, JSONC, YAML, SSO, SCIM, OIDC, SAML, OAuth, ZDR, URL, HTTP, HTTPS, RPC, IPC,
GUI, IDE, UI, UX, PTY, SSE, CORS, mDNS, JWT, CSRF, DNS, TLS, CA, CI, CD, PR.
Tools and apps: Claude Code, Codex, Cursor, VS Code, GitHub, GitLab, Slack, Docker, Bun,
Node.js, npm, pnpm, Yarn, Homebrew, etc. — every provider, model, company and app name.
Technical nouns Polish developers keep in English: prompt, token, skill, plugin, hook,
commit, pull request, endpoint, bundle, sandbox, runtime, middleware, handler, stream,
proxy, loopback, Diff (the viewer), AGENTS.md, SKILL.md, MCP, LSP.
Bold English UI labels quoted from the product (**Settings › Billing**, **Add credits**,
**Personal**, **Console API URL**) stay exactly as written, with the same bold markers.

Paths, commands, flags, config keys and values, env vars, URLs, code spans and fenced
blocks stay byte-identical. Do not translate code-block captions' `title="..."` values
or info strings. Internal links stay docs-root-relative (`/config`), never `/docs/...`
or `/pl/docs/...`.

## Terms

| English | Polish | Notes |
| --- | --- | --- |
| agent | agent | Plural „agenci" (as in the site's `pl.ts`), gen. „agentów" |
| subagent | subagent | Plural „subagenty", gen. „subagentów" (not „subagenci") |
| child agent / child session | agent podrzędny / sesja podrzędna | |
| workspace | obszar roboczy | Console entity; keep `workspace` in code/keys |
| team | zespół | Go Teams stays English |
| member | członek | „członkowie", „członka" |
| Console (product) | Console | OpenCode Console, bramka Console |
| account | konto | Never „konto użytkownika" when „konto" is enough |
| sign in / log in | zaloguj się / logowanie | Noun „logowanie" |
| authentication / authenticate | uwierzytelnianie / uwierzytelnić | Not „autoryzacja" (that is authorization) |
| authorization | autoryzacja | |
| permission | uprawnienie | |
| token (OAuth, access, API) | token | Declined: tokenu, tokeny, tokenów |
| API key | klucz API | |
| provider (model provider) | dostawca | „dostawca modeli"; API providers in plugin docs → „dostawca" |
| model | model | |
| inference | inferencja | |
| gateway | bramka | „bramka Console", „bramka inferencji" |
| proxy (network) | proxy | „serwer proxy" |
| endpoint | endpoint | Declined: endpointu, endpointy |
| request / response | żądanie / odpowiedź | |
| usage | użycie | „zużycie" only for consumed tokens/credits where it reads better |
| credits (prepaid balance) | środki | „doładuj środki", „saldo" for balance |
| balance | saldo | |
| top up | doładuj | |
| billing | rozliczenia | Page title „Rozliczenia" |
| invoice | faktura | invoiced billing → „rozliczenia na podstawie faktur" |
| subscription | subskrypcja | |
| plan | plan | |
| budget | budżet | |
| spend limit / credit limit | limit wydatków / limit środków | |
| allowance (Go) | limit | „limit Go" |
| rate limit | limit zapytań | |
| policy / policies | zasada / zasady | OpenCode policies; not „polityka" (privacy policy is „polityka prywatności") |
| workspace policy | zasady obszaru roboczego | |
| transcript | zapis rozmowy | |
| scrollback | historia przewijania | |
| formatter | formater | |
| references (the feature) | referencje | A docs „Reference" section → „Referencja" |
| checkpoint | punkt kontrolny | |
| snapshot | migawka | |
| effort (reasoning) | wysiłek rozumowania | |
| expose (API/RPC) | udostępniać | Avoid „eksponować" |
| composer | kompozytor | In build/plugin API pages `composer` is an object → keep `composer` |
| harness | harness | Plural „harnessy", gen. „harnessów" |
| profile (Codex) | profil | |
| session | sesja | |
| prompt | prompt | Declined: promptu, prompty |
| turn (conversation) | tura | |
| step | krok | |
| tool | narzędzie | |
| tool call | wywołanie narzędzia | |
| skill | skill | Plural „skille", gen. „skilli" |
| plugin | plugin | Plural „pluginy", gen. „pluginów" |
| hook | hook | Plural „hooki", gen. „hooków" |
| command | polecenie | Slash command → „polecenie z ukośnikiem" |
| keybind / keybinding | skrót klawiszowy | Plural „skróty klawiszowe" |
| theme | motyw | |
| config / configuration | konfiguracja | Config file → „plik konfiguracji" |
| default | domyślny | |
| built-in | wbudowany | |
| custom | własny | |
| mode | tryb | |
| reasoning | rozumowanie | |
| thinking | myślenie | |
| streaming | strumieniowanie | |
| context window | okno kontekstu | |
| compaction | kompaktowanie | |
| summarize | podsumuj | |
| fork (session) | fork | „utwórz fork", „fork sesji"; verb „rozwidl" only if needed |
| revert / unrevert | cofnij / przywróć | |
| undo / redo | cofnij / ponów | |
| share | udostępnij | |
| web search | wyszukiwanie w internecie | Keep `websearch` in code/keys |
| network | sieć | |
| sandbox | piaskownica | |
| container | kontener | Docker image → „obraz" |
| repository | repozytorium | |
| branch | gałąź | Git branch |
| commit | commit | |
| pull request | pull request | |
| issue | zgłoszenie | GitHub issue |
| release | wydanie | |
| changelog | dziennik zmian | |
| quickstart | szybki start | |
| install | zainstaluj / instalacja | |
| upgrade | zaktualizuj / aktualizacja | `opencode upgrade` stays |
| uninstall | odinstaluj / odinstalowanie | |
| debug | debugowanie | |
| log | log | Plural „logi" |
| error | błąd | |
| warning | ostrzeżenie | |
| deprecated | przestarzały | |
| experimental | eksperymentalny | |
| stable | stabilny | |
| preview | podgląd | |
| filesystem | system plików | |
| working directory | katalog roboczy | |
| directory | katalog | |
| path | ścieżka | |
| glob | glob | „wzorzec glob" |
| regular expression | wyrażenie regularne | |
| shell | powłoka | „polecenie powłoki"; `shell` in code stays |
| environment variable | zmienna środowiskowa | |
| header | nagłówek | HTTP header |
| claim (JWT) | pole JWT | Not „roszczenie” |
| body | treść | Request body → „treść żądania" |
| query | zapytanie | |
| schema | schemat | |
| validation | walidacja | |
| route | trasa | HTTP route |
| handler | handler | |
| service | usługa | |
| event | zdarzenie | |
| event bus | magistrala zdarzeń | |
| stream | strumień | |
| layer (Effect) | warstwa | |
| worktree | worktree | Plural „worktree" |
| tab | karta | UI tab; „karta" also for a tab in Desktop |
| panel | panel | |
| drawer | wysuwany panel | UI component; keep `drawer` in API identifiers |
| menu item | pozycja menu | |
| slot | slot | GUI plugin slots |
| registry | rejestr | |
| contract (GUI IPC) | kontrakt | |
| IPC | IPC | |
| native | natywny | |
| icon | ikona | |
| layout | układ | |
| dialog | okno dialogowe | |
| select | lista wyboru | UI component |
| toggle | przełącznik | |
| composer pill | pigułka kompozytora | GUI plugin pills |
| titlebar | pasek tytułu | |
| sidebar | pasek boczny | |
| Diff viewer | widok Diff | For generic file changes use „zmiany”; keep `diff` in identifiers |
| raised surfaces (theme) | tła elementów na wyższych warstwach | `background.raised` and `@dialog` stay unchanged |
| well-known config origin | źródło konfiguracji well-known | Refers to discovery via `.well-known/opencode`, not a widely known source |
| free | darmowy | Tier descriptor; **Free** label stays English |
| paid | płatny | |
| monthly | miesięczny | |
| per member | za członka | |
| unlimited | bez limitu | |
| included | w cenie / wliczony | Choose by context |

## MDX and formatting

- Keep every MDX component and its props byte-identical (`<Callout type="note">`,
  `<CodeTabs ... />`, `<Tabs>`, `<Tab>`, `<Card>`, `<Steps>`, `<Frame>`, etc.), including
  JSX object/array props and attribute values. Translate only children text and
  captions, never prop values.
- Keep fenced blocks byte-identical, including indentation and language/info strings.
- Keep heading count, order and depth exactly. Translate heading text, keep code spans in
  headings exactly. Heading ids are generated from the English page, so anchors work.
- Keep frontmatter `title` and `description` translated; every other key/value (`noindex`,
  `sidebar`, ...) stays as written. Quotes in frontmatter: use Polish „..." only inside
  the YAML string if the English used quotes; keep the YAML double quotes around it.
- Tables: translate header cells and prose cells; keep cells that are code, IDs, numbers,
  model names, prices, or English UI labels exactly. Keep the same number of columns and
  rows, and the same alignment row.
- Lists: same number of items and same nesting. Do not merge or split items.
- Links: translate the link text, keep the target exactly. Internal targets stay
  root-relative.
- Inline code: never translate or reformat; keep the same spans, in the same places.
- Numbers, prices, dates, versions, model IDs, percentages, durations: exact.
- Do not add or remove sentences, examples, warnings or headings.
- Callout labels come from the site (`Notatka`, `Wskazówka`, `Uwaga`,
  `Niebezpieczeństwo`), so do not write them yourself.

## Polish wording choices

- „OpenCode to open source'owy agent do programowania" — follow `pl.ts` (it uses both
  „agent do kodowania" and „agent do programowania"; in docs prefer „agent kodujący" for
  the role and „agent do programowania" only in the intro sentence).
  Never call OpenCode an AI coding agent; it is an open source coding agent.
- „aplikacja desktopowa", „aplikacja webowa", „interfejs terminalowy", „aplikacja mobilna".
- „polecenie" for a command, „flaga" for a flag, „opcja" for an option.
- „w terminalu", „w OpenCode", „w Console", „w Go"; „na desktopie" only in marketing copy,
  docs use „w aplikacji Desktop".
- Avoid gendered assumptions; „użytkownik" only when the English means a user other than
  the reader.
- Use „który" not „jaki" for relative clauses; avoid „jeżeli" when „jeśli" is enough.
- Do not start sentences with „Aby" too often; vary with imperatives.
- No full stop after headings, labels, buttons, or table cells that are fragments.
