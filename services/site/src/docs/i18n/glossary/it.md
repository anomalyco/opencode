# Italiano (it)

Termini condivisi per la traduzione dei docs V2 (`src/docs/content/it/`). Le regole di `../glossary.md`
valgono sempre; questa pagina aggiunge le scelte italiane. La colonna inglese resta quella condivisa.

## Registro

- Dai del tu, come il sito italiano (`services/site/src/i18n/it.ts`): «puoi», «il tuo spazio di lavoro»,
  «Scopri di più».
- Frasi brevi e dirette, presente indicativo, voce attiva. Evita il passivo con «venire» e le perifrasi
  «è possibile …» quando basta un imperativo o un verbo diretto.
- Niente domande retoriche. Titoli e voci di elenco restano sintagmi nominali quando l'inglese lo fa.
- Punteggiatura italiana: virgolette alte “…” quando l'inglese le usa, ellissi «…», nessuno spazio prima
  di `, . : ; ! ?`. I due punti solo dove l'italiano li richiede. Gli apostrofi restano dritti (`'`), come
  nel resto del sito.
- Prezzi e numeri restano identici all'inglese (`$10/month` → `$10/mese`, `$1.23` invariato).

## Termini

| English | it | Note |
| --- | --- | --- |
| agent, subagent | agente, subagente | `coding agent` → agente di coding; `child agent` → agente figlio |
| workspace | spazio di lavoro | Con la maiuscola è un'etichetta UI: **Workspace** resta in inglese |
| team | team | Invariabile; `team member` → membro del team |
| Console (product) | Console | OpenCode Console resta OpenCode Console; **Console** come etichetta resta |
| provider | provider | Invariabile; `model provider` → provider di modelli |
| model | modello | I nomi dei modelli restano invariati |
| session | sessione | |
| tool | strumento | Nomi di tool e chiavi `tools` restano in codice |
| skill | skill | Invariabile, come sul sito |
| plugin | plugin | Invariabile |
| harness | harness | Invariabile, come da glossario condiviso |
| token | token | Invariabile (`API token` → token API) |
| prompt | prompt | Invariabile |
| effort (reasoning) | intensità del ragionamento | La chiave `effort` e i valori delle varianti restano invariati |
| discovery (automatic) | rilevamento automatico | Usa «ricerca» per l'operazione di cercare, «individua» o «trova» per il verbo |
| command | comando | Il comando vero e proprio resta in codice (`/init`) |
| permission | permesso | `permission mode` → modalità di permesso |
| config, configuration | configurazione | `config` come chiave o file resta in codice |
| API key | chiave API | |
| account | account | Invariabile, come sul sito |
| sign in / log in | accedi / accesso | `Sign in` come etichetta UI resta in inglese |
| owner | proprietario | **Owner** come etichetta resta |
| admin | amministratore | **Admin** come etichetta resta |
| member | membro | |
| billing | fatturazione | `Billing` come etichetta resta |
| invoice, invoiced billing | fattura, pagamento su fattura | Contrapposto all'acquisto di crediti prepagati |
| credit, credits | credito, crediti | `Add credits` come etichetta resta |
| balance | saldo | |
| top up | ricarica, ricaricare | |
| spend limit | limite di spesa | |
| subscription | abbonamento | |
| plan | piano | Nomi dei piani restano: Go, Go Plus, Go Teams |
| usage | utilizzo | `usage limits` → limiti di utilizzo |
| request | richiesta | |
| endpoint | endpoint | Invariabile |
| deploy (v.) | distribuire | `deploy` come sostantivo può restare |
| build (n.) | build | La sezione dei docs `Build` è «Sviluppare» |
| web search | ricerca web | `Web search` come etichetta resta |
| worktree | worktree | Invariabile |
| diff | diff | Invariabile |
| checkpoint | checkpoint | Invariabile |
| snapshot | snapshot | Invariabile |
| rollback | rollback | Invariabile |
| inference | inferenza | |
| gateway | gateway | Invariabile |
| policy, policies | policy | Invariabile anche al plurale; la pagina Policies è «Policy» |
| budget | budget | Invariabile |
| region | regione | `Regions` come etichetta resta |
| privacy | privacy | |
| retention | conservazione | `zero-retention` → zero-retention |
| training | addestramento | |
| keybind | scorciatoia da tastiera | La pagina Keybinds è «Scorciatoie da tastiera» |
| formatter | formattatore | |
| theme | tema | |
| tab | scheda | |
| panel | pannello | |
| slot | slot | Invariabile |
| registry | registro | |
| title bar | barra del titolo | |
| command palette | palette dei comandi | |
| scrollback | cronologia | |
| transcript | cronologia della conversazione | |
| composer | area di composizione | Solo quando non è l'oggetto API `composer` |
| loopback | loopback | Invariabile |
| bundle | bundle | Invariabile |
| shell | shell | Invariabile |
| terminal | terminale | |
| AI | IA | Nel prosa, come il sito italiano; `AI SDK` e i nomi che lo contengono restano |
| Free (tier or price label) | Free | `free` aggettivo → gratuito |

## Titoli delle pagine

Introduzione, Agenti, Allegati, Comandi, Compattazione, Configurazione, Enterprise, Formattatori,
Istruzioni, Server MCP, Migrazione da V1, Modelli, Rete, Permessi, Plugin, Policy, Provider, Riferimenti,
Skill, Snapshot, Temi, Strumenti, Risoluzione dei problemi, Ricerca web.
Per Console: Introduzione a Console, Spazi di lavoro, Membri, Fatturazione, Budget, Modelli, Provider,
SSO, SCIM, Ricerca web, Harness, Go.

## Termini dei plugin e dell'app desktop

| English | it | Note |
| --- | --- | --- |
| window | finestra | Nelle pagine GUI dei plugin |
| main process | processo principale | Electron |
| panel | pannello | |
| tab | scheda | Anche nelle schede delle sessioni |
| slot | slot | Invariabile |
| store (plugin state) | store | Invariabile; il verbo è «archiviare» |
| registry | registro | |
| contract | contratto | |
| embed (web view) | embed | Invariabile |
| bundle | bundle | Invariabile |
| header (di una pagina o finestra) | intestazione | `header` HTTP resta in codice |
| footer | piè di pagina | |
| toast | toast | Invariabile |
| dialog | dialogo | |
| surface | superficie | |
| harness | harness | Invariabile |
| warming | warming | Invariabile; «scaldare» solo come verbo |
| worktree | worktree | Invariabile |
| seat (subscription) | posto | «posto Go Teams» |
| sidecar (server id) | sidecar | Resta `"sidecar"` |
