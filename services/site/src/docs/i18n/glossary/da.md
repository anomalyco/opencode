# Dansk ordliste og stilguide til V2-dokumentationen

Denne fil styrer den danske oversættelse af `src/docs/content/**/*.mdx`. Den er både ordliste og
stilguide for oversættere. Hold den engelske kolonne uændret, og tilføj nye termer her efter review.

## Stil

- Skriv naturligt dansk i du-form, kort og direkte. Oversæt ikke ord for ord.
- Behold engelske fagtermer, som danske udviklere faktisk bruger (fx agent, token, prompt, plugin,
  session, branch, commit, endpoint, proxy, harness, worktree, diff).
- Undgå unødvendige angelsismer, når der findes et naturligt dansk ord. Skriv fx "brugerdefineret"
  frem for "custom", "indstillinger" frem for "settings", "mappe" frem for "folder", "sti" frem for
  "path", "anmodning" frem for "request" i løbende tekst.
- Brug "du", "din", "dit", "dine". Brug imperativ i vejledninger: "Kør kommandoen …", "Tilføj …".
- Brug "f.eks.", "dvs.", "bl.a." og "osv." med punktummer.
- Brug “…” om korte citater og UI-tekster i løbende tekst, når det er nødvendigt. Brug ikke
  anførselstegn om kode; brug inline code.
- Hold afsnit korte som i den engelske tekst. Oversæt ikke en sætning til to.
- Oversæt ikke overskrifter til noget, der ændrer dybde, rækkefølge eller antal.
- Bevar tal, priser, datoer, versioner, model-ID'er og grænseværdier præcist. Måleenheder i priser
  bøjes naturligt: `$10/month` → `$10/måned`, `$20/member/month` → `$20/medlem/måned`.
- Brug dansk kommatering. Undgå engelsk Oxford-komma.

## Behold på engelsk

- Produkt- og firmanavne: OpenCode, opencode (binær/kommando), OpenCode Models, Zen, Go, Go Plus,
  Go Teams, OpenCode Console, Console, Desktop, OpenCode Desktop, Anomaly.
- Rolleordene agent og subagent, også i sammensætninger som kodningsagent og agentisk kodning.
- Udbyder-, model-, app- og værktøjsnavne: Anthropic, Claude, Claude Code, OpenAI, Codex, GitHub,
  GitHub Copilot, Cursor, Zed, Neovim, VS Code, Docker, WSL, Cloudflare, Stripe, Slack, Figma, osv.
- Forkortelser: MCP, LSP, SDK, CLI, API, TUI, JSON, JSONC, YAML, SSO, SCIM, OIDC, SAML, ZDR, ACP,
  HTTP, HTTPS, URL, IP, DNS, TLS, CORS, CI, CD, PR, UI, UX, VCS, AST, RPC, SSE.
- Kommandoer, flag, konfigurationsnøgler og -værdier, miljøvariabler, stier, kode, URL'er og nøgler.
- Engelske UI-labels, der citeres fra produktet, især fede labels: **Settings › Billing**,
  **Add credits**, **Regions**, **Global**, **Credit**, **Manage subscription**, **Privacy**.
- "harness" og "profile" (Codex) som fagtermer.
- "bundle", "base URL", "rate limit", "loopback", "scrollback", "diff" (viewer/sektion).

## Termer

| Engelsk | Dansk | Noter |
| --- | --- | --- |
| agent, subagent | agent, subagent | agenter, subagenter; coding agent → kodningsagent |
| open source coding agent | open source-kodningsagent | Aldrig "AI-kodningsagent" |
| workspace | arbejdsområde | arbejdsområdet, arbejdsområder; Console-konceptet |
| team | team | teamet, teams; teammedlemmer |
| member | medlem | medlemmer |
| account | konto | konti |
| authentication / authenticate | autentificering / autentificere | login → log ind |
| authorization / authorize | godkendelse / godkende | |
| permission | tilladelse | tilladelser |
| provider (model) | udbyder | modeludbyder; API-provider i kode → provider |
| inference | inferens | |
| usage | forbrug | usage limits → forbrugsgrænser |
| request | anmodning | |
| API key | API-nøgle | |
| token | token | tokens; access token → adgangstoken |
| prompt | prompt | prompts, prompten |
| session | session | sessioner, sessionen |
| child session / parent session | undersession / overordnet session | Behold identifikatorer som `opencode/child-session` uændret |
| transcript | samtalelog | Ikke transskription; transskription bruges om lyd til tekst |
| reasoning effort | ræsonneringsniveau | Behold f.eks. `effort` og `reasoningEffort` som feltnavne |
| tool | værktøj | værktøjer; tool call → værktøjskald |
| skill | skill | skills, skillen; Agent Skills som specifikation bevares |
| plugin | plugin | plugins, pluginet |
| hook | hook | hooks |
| event | hændelse | hændelsesabonnement, serverhændelse; API-identifikatorer bevares |
| cleanup function | oprydningsfunktion | |
| command | kommando | slash command → slash-kommando |
| keybind | tastebinding | tastebindinger |
| config / configuration | konfiguration | config-fil → konfigurationsfil; `opencode.json` bevares |
| formatter | formatter | formattere |
| linter | linter | |
| snapshot | snapshot | |
| checkpoint | checkpoint | |
| reference (funktionen) | reference | referencer; en "Reference"-sektion → Reference |
| compaction | komprimering | context compaction → kontekstkomprimering |
| attachment | vedhæftning | vedhæftninger |
| theme | tema | temaer |
| troubleshooting | fejlfinding | |
| policy | politik | politikker; Policies-siden → Politikker |
| budget | budget | budgetter |
| billing | fakturering | |
| invoice | faktura | |
| invoiced billing / credit limit | betaling efter faktura / kreditramme | kreditramme ved en kreditaftale |
| credits | kredit | add credits → tilføj kredit; `credits` i kode bevares |
| balance | saldo | |
| auto-recharge | automatisk optankning | UI-labels som **Auto-recharge** bevares |
| pay-as-you-go | betaling efter forbrug | Behold navnet, når det citeres som UI-label |
| subscription | abonnement | |
| plan | plan | planer |
| renewal / renews | fornyelse / fornyes | |
| refund | refusion | |
| payment method | betalingsmetode | |
| owner | ejer | |
| admin / administrator | administrator | |
| service account | tjenestekonto | |
| region | region | regioner |
| privacy | privatliv | privacy settings → privatlivsindstillinger |
| retention | opbevaring | data retention → dataopbevaring |
| training (på data) | træning | |
| web search | websøgning | |
| proxy | proxy | |
| gateway | gateway | |
| endpoint | endpoint | |
| deploy (verbum) | deploye | deployment → udrulning |
| build (substantiv) | build | bygge (verbum) |
| bundle | bundle | |
| worktree | worktree | |
| branch | branch | |
| commit | commit | |
| pull request | pull request | |
| issue | issue | |
| repository | repository | repo i løbende tekst |
| directory / folder | mappe | |
| file | fil | |
| path | sti | |
| desktop app | desktopapp | |
| web app | webapp | |
| sidebar | sidebar | |
| scrollbar | rullebjælke | |
| tab | fane | |
| panel | panel | |
| window | vindue | |
| settings | indstillinger | UI-labelt **Settings** bevares |
| environment variable | miljøvariabel | |
| shell | shell | |
| terminal | terminal | |
| stdout / stderr | stdout / stderr | |

## Struktur og mekanik

- Overskrifter: samme antal, rækkefølge og dybde som engelsk. Overskriftens tekst oversættes, men
  inline code i en overskrift bevares ordret.
- Frontmatter: oversæt `title` og `description`. Behold alle andre nøgler og værdier uændret
  (fx `noindex: true`).
- Kodeblokke: byte-identiske. Oversæt kun en eventuel menneskelig `title`-tekst; stier og filnavne
  i `title` bevares.
- Inline code, kommandoer, flag, stier, URL'er, konfigurationsnøgler og -værdier: byte-identiske.
- Links: oversæt linkteksten, behold målet uændret. Interne links skal være docs-relative som
  `/config`, aldrig `/docs/...` eller `/<locale>/docs/...`.
- MDX-komponenter og props bevares. Oversæt menneskelige prop-værdier som `label="Install method"`,
  men ikke stier, id'er eller kode.
- Tabeller: oversæt alle celler, behold rækker og kolonner. Rør ikke kolonnebredde-padding i
  Markdown-tabeller, medmindre det er nødvendigt for at undgå at ødelægge tabellen.
- Callouts: behold komponenten og `type`, oversæt indholdet.
- Ingen udeladelser og ingen tilføjelser. Hver engelsk sætning skal have en dansk modpart.

## Kvalitetstjek før aflevering

- Sammenlign afsnit for afsnit, punkt for punkt, tabelrække for tabelrække og kodeblok for
  kodeblok med den engelske side.
- Læs den danske tekst højt i hovedet: lyder den som noget, en dansk udvikler ville skrive?
- Tjek tal, priser, model-ID'er og versioner.
- Tjek at alle overskrifter og al kode er bevaret.
- Kør `check-translations` og kontrollér, at siden ikke står i `structure`-listen.
