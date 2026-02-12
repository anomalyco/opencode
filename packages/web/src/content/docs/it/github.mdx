---
title: GitHub
description: Usa OpenCode in issue e pull request su GitHub.
---

OpenCode si integra nel tuo workflow GitHub. Menziona `/opencode` o `/oc` in un commento e OpenCode eseguira' i task dentro il runner di GitHub Actions.

---

## Funzionalità

- **Triage delle issue**: chiedi a OpenCode di indagare su una issue e spiegartela.
- **Fix e implementazioni**: chiedi a OpenCode di risolvere una issue o implementare una feature. Lavorera' su un nuovo branch e inviera' una PR con tutte le modifiche.
- **Sicuro**: OpenCode gira all'interno dei runner GitHub.

---

## Installazione

Esegui il comando seguente in un progetto che si trova in un repo GitHub:

```bash
opencode github install
```

Questo ti guidera' nell'installazione della GitHub app, nella creazione del workflow e nella configurazione dei secret.

---

### Configurazione manuale

In alternativa, puoi configurarlo manualmente.

1. **Installa la GitHub app**

   Vai su [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Assicurati che sia installata sul repository di destinazione.

2. **Aggiungi il workflow**

   Aggiungi il seguente file workflow in `.github/workflows/opencode.yml` nel tuo repo. Assicurati di impostare il `model` appropriato e le API key richieste in `env`.

   ```yml title=".github/workflows/opencode.yml" {24,26}
   name: opencode

   on:
     issue_comment:
       types: [created]
     pull_request_review_comment:
       types: [created]

   jobs:
     opencode:
       if: |
         contains(github.event.comment.body, '/oc') ||
         contains(github.event.comment.body, '/opencode')
       runs-on: ubuntu-latest
       permissions:
         id-token: write
       steps:
          - name: Checkout repository
            uses: actions/checkout@v6
            with:
              fetch-depth: 1
              persist-credentials: false

          - name: Run OpenCode
           uses: anomalyco/opencode/github@latest
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
           with:
             model: anthropic/claude-sonnet-4-20250514
             # share: true
             # github_token: xxxx
   ```

3. **Salva le API key nei secret**

   Nelle **impostazioni** della tua organizzazione o progetto, espandi **Secrets and variables** sulla sinistra e seleziona **Actions**. Poi aggiungi le API key richieste.

---

## Configurazione

- `model`: il modello da usare con OpenCode. Usa il formato `provider/model`. E' **obbligatorio**.
- `agent`: l'agente da usare. Deve essere un agente primario. Se non trovato, usa `default_agent` dalla config o `"build"`.
- `share`: se condividere la sessione OpenCode. Di default e' **true** per repository pubblici.
- `prompt`: prompt personalizzato opzionale per sovrascrivere il comportamento di default. Usalo per personalizzare come OpenCode processa le richieste.
- `token`: token di accesso GitHub opzionale per eseguire operazioni come creare commenti, committare modifiche e aprire pull request. Di default, OpenCode usa l'installation access token della OpenCode GitHub App, quindi commit, commenti e pull request risultano provenire dalla app.

  In alternativa, puoi usare il [token integrato `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) del runner GitHub Actions senza installare la OpenCode GitHub App. Assicurati solo di concedere i permessi necessari nel workflow:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Se preferisci, puoi anche usare un [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT).

---

## Eventi supportati

OpenCode puo' essere attivato dai seguenti eventi GitHub:

| Tipo evento                   | Attivato da                            | Dettagli                                                                                                                  |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Commento su una issue o PR             | Menziona `/opencode` o `/oc` nel commento. OpenCode legge il contesto e puo' creare branch, aprire PR o rispondere.       |
| `pull_request_review_comment` | Commento su specifiche righe in una PR | Menziona `/opencode` o `/oc` durante una review. OpenCode riceve path file, numeri di riga e contesto del diff.           |
| `issues`                      | Issue aperta o modificata              | Attiva automaticamente OpenCode quando le issue vengono create o modificate. Richiede l'input `prompt`.                   |
| `pull_request`                | PR aperta o aggiornata                 | Attiva automaticamente OpenCode quando le PR vengono aperte, sincronizzate o riaperte. Utile per review automatiche.      |
| `schedule`                    | Pianificazione basata su cron          | Esegue OpenCode a pianificazione. Richiede l'input `prompt`. Output nei log e nelle PR (nessuna issue su cui commentare). |
| `workflow_dispatch`           | Trigger manuale dalla UI GitHub        | Attiva OpenCode on-demand dalla tab Actions. Richiede l'input `prompt`. Output nei log e nelle PR.                        |

### Esempio con schedule

Esegui OpenCode a pianificazione per eseguire task automatizzati:

```yaml title=".github/workflows/opencode-scheduled.yml"
name: Scheduled OpenCode Task

on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am UTC

jobs:
  opencode:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Run OpenCode
        uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review the codebase for any TODO comments and create a summary.
            If you find issues worth addressing, open an issue to track them.
```

Per gli eventi schedulati, l'input `prompt` e' **obbligatorio** dato che non c'e' un commento da cui estrarre le istruzioni. I workflow schedulati girano senza un contesto utente per i controlli di permesso, quindi il workflow deve concedere `contents: write` e `pull-requests: write` se ti aspetti che OpenCode crei branch o PR.

---

### Esempio di pull request

Review automatica delle PR quando vengono aperte o aggiornate:

```yaml title=".github/workflows/opencode-review.yml"
name: opencode-review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: anomalyco/opencode/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          use_github_token: true
          prompt: |
            Review this pull request:
            - Check for code quality issues
            - Look for potential bugs
            - Suggest improvements
```

Per gli eventi `pull_request`, se non viene fornito alcun `prompt`, OpenCode fa di default la review della pull request.

---

### Esempio di triage delle issue

Triage automatico delle nuove issue. Questo esempio filtra gli account piu' vecchi di 30 giorni per ridurre lo spam:

```yaml title=".github/workflows/opencode-triage.yml"
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - name: Check account age
        id: check
        uses: actions/github-script@v7
        with:
          script: |
            const user = await github.rest.users.getByUsername({
              username: context.payload.issue.user.login
            });
            const created = new Date(user.data.created_at);
            const days = (Date.now() - created) / (1000 * 60 * 60 * 24);
            return days >= 30;
          result-encoding: string

      - uses: actions/checkout@v6
        if: steps.check.outputs.result == 'true'
        with:
          persist-credentials: false

      - uses: anomalyco/opencode/github@latest
        if: steps.check.outputs.result == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
          prompt: |
            Review this issue. If there's a clear fix or relevant docs:
            - Provide documentation links
            - Add error handling guidance for code examples
            Otherwise, do not comment.
```

Per gli eventi `issues`, l'input `prompt` e' **obbligatorio** dato che non c'e' un commento da cui estrarre le istruzioni.

---

## Prompt personalizzati

Sovrascrivi il prompt di default per personalizzare il comportamento di OpenCode nel tuo workflow.

```yaml title=".github/workflows/opencode.yml"
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-5
    prompt: |
      Review this pull request:
      - Check for code quality issues
      - Look for potential bugs
      - Suggest improvements
```

E' utile per imporre criteri specifici di review, standard di codice o aree di focus rilevanti per il progetto.

---

## Esempi

Ecco alcuni esempi di come puoi usare OpenCode su GitHub.

- **Spiega una issue**

  Aggiungi questo commento in una issue GitHub.

  ```
  /opencode explain this issue
  ```

  OpenCode leggera' l'intero thread, inclusi tutti i commenti, e rispondera' con una spiegazione chiara.

- **Risolvi una issue**

  In una issue GitHub, scrivi:

  ```
  /opencode fix this
  ```

  OpenCode creera' un nuovo branch, implementera' le modifiche e aprira' una PR con i cambiamenti.

- **Rivedi PR e fai modifiche**

  Lascia il seguente commento su una PR GitHub.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode implementera' la modifica richiesta e la committera' nella stessa PR.

- **Rivedi righe specifiche di codice**

  Lascia un commento direttamente sulle righe di codice nella tab "Files" della PR. OpenCode rileva automaticamente file, numeri di riga e contesto del diff per fornire risposte precise.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Quando commenti su righe specifiche, OpenCode riceve:
  - Il file esatto in review
  - Le righe di codice specifiche
  - Il contesto del diff circostante
  - Informazioni sul numero di riga

  Questo permette richieste piu' mirate senza dover specificare manualmente path file o numeri di riga.
