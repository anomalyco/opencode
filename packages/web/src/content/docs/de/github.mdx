---
title: GitHub
description: Verwenden Sie OpenCode in GitHub-Problemen und Pull-Requests.
---

OpenCode lässt sich in Ihren GitHub-Workflow integrieren. Erwähnen Sie `/opencode` oder `/oc` in Ihrem Kommentar, und OpenCode führt Aufgaben in Ihrem GitHub Actions-Runner aus.

---

## Funktionen

- **Issue Triage**: Bitten Sie OpenCode, ein Problem zu untersuchen und es Ihnen zu erklären.
- **Reparieren und implementieren**: Bitten Sie OpenCode, ein Problem zu beheben oder eine Funktion zu implementieren. Und es funktioniert in einem neuen Branch und sendet ein PR mit allen Änderungen.
- **Sicher**: OpenCode läuft in den Runners Ihres GitHub.

---

## Installation

Führen Sie den folgenden Befehl in einem Projekt aus, das sich in einem GitHub-Repository befindet:

```bash
opencode github install
```

Dies führt Sie durch die Installation der GitHub-App, das Erstellen des Workflows und das Einrichten von Secrets.

---

### Manuelle Einrichtung

Oder Sie können es manuell einrichten.

1. **Installieren Sie die GitHub-App**

   Gehen Sie zu [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Stellen Sie sicher, dass es im Ziel-Repository installiert ist.

2. **Den Workflow hinzufügen**

   Fügen Sie die folgende Workflowdatei zu `.github/workflows/opencode.yml` in Ihrem Repository hinzu. Stellen Sie sicher, dass Sie in `env` die passenden Werte für `model` und `api_key` setzen.

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

3. **Speichern Sie die API-Schlüssel in Secrets**

   Erweitern Sie in den **Einstellungen** Ihrer Organisation oder Ihres Projekts links **Secrets und Variablen** und wählen Sie **Aktionen** aus. Und fügen Sie die erforderlichen API-Schlüssel hinzu.

---

## Konfiguration

- `model`: Das mit OpenCode zu verwendende Modell. Nimmt das Format `provider/model` an. Dies ist **erforderlich**.
- `agent`: Der zu verwendende Agent. Muss ein Hauptagent sein. Fällt aus der Konfiguration auf `default_agent` oder `"build"` zurück, wenn es nicht gefunden wird.
- `share`: Ob die OpenCode-Sitzung geteilt werden soll. Der Standardwert ist **true** für öffentliche Repositorys.
- `prompt`: Optionale benutzerdefinierte Eingabeaufforderung zum Überschreiben des Standardverhaltens. Verwenden Sie dies, um anzupassen, wie OpenCode Anfragen verarbeitet.
- `token`: Optionales GitHub-Zugriffstoken zum Ausführen von Vorgängen wie dem Erstellen von Kommentaren, dem Festschreiben von Änderungen und dem Öffnen von Pull Requests. Standardmäßig verwendet OpenCode das Installation Access Token der OpenCode GitHub-App, sodass Commits, Kommentare und Pull Requests so aussehen, als würden sie von der App kommen.

  Alternativ können Sie [built-in `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) des GitHub Action Runners verwenden, ohne die OpenCode GitHub App zu installieren. Stellen Sie einfach sicher, dass Sie in Ihrem Workflow die erforderlichen Berechtigungen erteilen:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Sie können bei Bedarf auch einen [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) verwenden.

---

## Unterstützte Events

OpenCode kann durch die folgenden GitHub-Events ausgelöst werden:

| Ereignistyp                   | Ausgelöst durch                                   | Einzelheiten                                                                                                                                        |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Kommentieren Sie ein Problem oder PR              | Erwähnen Sie `/opencode` oder `/oc` in Ihrem Kommentar. OpenCode liest den Kontext und kann Branches erstellen, PRs öffnen oder antworten.          |
| `pull_request_review_comment` | Kommentieren Sie bestimmte Codezeilen in einem PR | Erwähnen Sie `/opencode` oder `/oc` beim Überprüfen des Codes. OpenCode empfängt Dateipfad, Zeilennummern und Diff Context.                         |
| `issues`                      | Problem geöffnet oder bearbeitet                  | Lösen Sie OpenCode automatisch aus, wenn Probleme erstellt oder geändert werden. Erfordert `prompt`-Eingabe.                                        |
| `pull_request`                | PR geöffnet oder aktualisiert                     | Lösen Sie OpenCode automatisch aus, wenn PRs geöffnet, synchronisiert oder erneut geöffnet werden. Nützlich für automatisierte Bewertungen.         |
| `schedule`                    | Cron-basierter Zeitplan                           | Führen Sie OpenCode nach einem Zeitplan aus. Erfordert `prompt`-Eingabe. Die Ausgabe geht an Protokolle und PRs (kein Kommentar zu diesem Problem). |
| `workflow_dispatch`           | Manueller Trigger von GitHub UI                   | Lösen Sie OpenCode bei Bedarf über die Actions Tab aus. Erfordert `prompt`-Eingabe. Die Ausgabe erfolgt an Protokolle und PRs.                      |

### Beispiel für einen Zeitplan

Führen Sie OpenCode nach einem Zeitplan aus, um automatisierte Aufgaben auszuführen:

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

Für geplante Ereignisse ist die Eingabe `prompt` **erforderlich**, da es keinen Kommentar gibt, aus dem Anweisungen extrahiert werden können. Geplante Workflows werden ohne Benutzerkontext zur Berechtigungsprüfung ausgeführt. Daher muss der Workflow `contents: write` und `pull-requests: write` gewähren, wenn Sie erwarten, dass OpenCode Branches oder PRs erstellt.

---

### Pull-Request-Beispiel

Überprüfen Sie PRs automatisch, wenn sie geöffnet oder aktualisiert werden:

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

Wenn für `pull_request`-Ereignisse kein `prompt` bereitgestellt wird, überprüft OpenCode standardmäßig die Pull-Anfrage.

---

### Beispiel für eine Issue-Triage

Neue Probleme automatisch selektieren. In diesem Beispiel wird nach Konten gefiltert, die älter als 30 Tage sind, um Spam zu reduzieren:

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

Für `issues`-Ereignisse ist die Eingabe `prompt` **erforderlich**, da es keinen Kommentar gibt, aus dem Anweisungen extrahiert werden können.

---

## Benutzerdefinierte Prompts

Überschreiben Sie die Standardaufforderung, um das Verhalten von OpenCode für Ihren Workflow anzupassen.

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

Dies ist nützlich, um bestimmte Prüfkriterien, Kodierungsstandards oder Schwerpunktbereiche durchzusetzen, die für Ihr Projekt relevant sind.

---

## Beispiele

Hier sind einige Beispiele, wie Sie OpenCode in GitHub verwenden können.

- **Erklären Sie ein Problem**

  Fügen Sie diesen Kommentar in einer GitHub-Ausgabe hinzu.

  ```
  /opencode explain this issue
  ```

  OpenCode liest den gesamten Thread, einschließlich aller Kommentare, und antwortet mit einer klaren Erklärung.

- **Ein Problem beheben**

  Sagen Sie in einer GitHub-Ausgabe:

  ```
  /opencode fix this
  ```

  Und OpenCode erstellt einen neuen Branch, implementiert die Änderungen und öffnet ein PR mit den Änderungen.

- **PRs überprüfen und Änderungen vornehmen**

  Hinterlassen Sie den folgenden Kommentar auf einem GitHub PR.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode implementiert die angeforderte Änderung und schreibt sie an denselben PR fest.

- **Überprüfen Sie bestimmte Codezeilen**

  Hinterlassen Sie einen Kommentar direkt zu den Codezeilen auf der Files Tab von PR. OpenCode erkennt automatisch die Datei, Zeilennummern und den Diff Context, um präzise Antworten bereitzustellen.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Beim Kommentieren bestimmter Zeilen erhält OpenCode:
  - Die genaue Datei, die überprüft wird
  - Die spezifischen Codezeilen
  - Der umgebende Diff Context
  - Informationen zur Zeilennummer

  Dies ermöglicht gezieltere Anfragen, ohne dass Dateipfade oder Zeilennummern manuell angegeben werden müssen.
