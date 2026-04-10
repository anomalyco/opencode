---
title: GitHub
description: Brug OpenCode i GitHub-problemer og Pull Requests.
---

OpenCode integreres med din GitHub arbejdsgang. Nævn `/opencode` eller `/oc` i din kommentar, og OpenCode vil udføre opgaver i din GitHub Actions-løber.

---

## Funktioner

- **Triageproblemer**: Bed OpenCode om at undersøge et problem og forklare dig det.
- **Ret og implementer**: Bed OpenCode om at løse et problem eller implementere en funktion. Og det vil fungere i en ny branch og indsende en PR med alle ændringerne.
- **Sikker**: OpenCode løber inde i din GitHubs løbere.

---

## Installation

Kør følgende kommando i et projekt, der er i en GitHub repo:

```bash
opencode github install
```

Dette vil lede dig gennem installation af GitHub-appen, oprettelse af arbejdsgangen og opsætning af hemmeligheder.

---

### Manuel opsætning

Eller du kan indstille det manuelt.

1. **Installationsprogrammet GitHub-appen**

   Gå over til [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Sørg for, at det er installeret på mållageret.

2. **Tilføj arbejdsgangen**

   Tilføj følgende workflow-fil til `.github/workflows/opencode.yml` i din repo. Sørg for at indstille de relevante `model` og nødvendige API-nøgler i `env`.

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

3. **Opbevar API-nøglerne i hemmeligheder**

   I din organisation eller dit projekt **indstillinger** skal du udvide **Hemmeligheder og variabler** til venstre og vælge **Handlinger**. Og tilføj de nødvendige API-nøgler.

---

## Konfiguration

- `model`: Den model, der skal bruges med OpenCode. Antager formatet `provider/model`. Dette er **påkrævet**.
- `agent`: Agenten, der skal bruges. Skal være en primær agent. Falder tilbage til `default_agent` fra config eller `"build"`, hvis den ikke findes.
- `share`: Om OpenCode-sessionen skal dele. Standard er **true** for offentlige arkiver.
- `prompt`: Valgfri brugerdefineret prompt for at tilsidesætte standardadfærden. Brug dette til at tilpasse, hvordan OpenCode behandler anmodninger.
- `token`: Valgfrit GitHub adgangstoken til at udføre operationer såsom oprettelse af kommentarer, begå ændringer og åbning af Pull Requests. Som standard bruger OpenCode installationsadgangstokenet fra OpenCode GitHub-appen, så commits, kommentarer og Pull Requests ser ud til at komme fra appen.

  Alternativt kan du bruge GitHub Action runners [built-in `GITHUB_TOKEN`](OpenCode) uden at installere OpenCode GitHub appen. Bare sørg for at give de nødvendige tilladelser i dit workflow:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Du kan også bruge en [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT), hvis det foretrækkes.

---

## Understøttede begivenheder

OpenCode kan udløses af følgende GitHub hændelser:

| Begivenhedstype               | Udløst af                               | Detaljer                                                                                                                |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Kommentarer og problemer eller PR       | Nævn `/opencode` eller `/oc` i din kommentar. OpenCode læser kontekst og kan oprette brancher, åbne PR'er eller svare.  |
| `pull_request_review_comment` | Kommenter specifikke kodelinjer i en PR | Nævn `/opencode` eller `/oc`, mens du gennemgår koden. OpenCode modtager filsti, linjenumre og diff-kontekst.           |
| `issues`                      | Udgave åbnet eller redigeret            | Udløs automatisk OpenCode, når problemer oprettes eller ændres. Kræver `prompt` input.                                  |
| `pull_request`                | PR åbnet eller opdateret                | Udløs automatisk OpenCode, når PR'er åbnes, synkroniseres eller genåbnes. Nyttigt til automatiserede kodegennemgange.   |
| `schedule`                    | Cron-baseret tidsplan                   | Kør OpenCode efter en tidsplan. Kræver `prompt` input. Output går til logfiler og PR'er (intet problem ved kommentere). |
| `workflow_dispatch`           | Manuel trigger fra GitHub UI            | Udløs OpenCode efter behov via fanen Handlinger. Kræver `prompt` input. Output går til logfiler og PR'er.               |

### Tidsplan eksempel

Kør OpenCode efter en tidsplan for at udføre automatiske opgaver:

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

For planlagte begivenheder er `prompt` input **påkrævet**, da der ikke er nogen kommentarer at udtrække instruktioner fra. Planlagte arbejdsgange kører uden en brugerkontekst til kontrol af tilladelser, så arbejdsgangen skal give `contents: write` og `pull-requests: write`, hvis du forventer, at OpenCode skal oprette brancher eller PR'er.

---

### Pull Request eksempel

Gennemgå automatisk PR'er, når de åbnes eller opdateres:

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

For `pull_request` hændelser, hvis der ikke er angivet nogen `prompt`, vil OpenCode som standard gennemgå Pull Requesten.

---

### Issues Triage eksempel

Triage automatisk nye problemer. Dette eksempel filtrerer til konti ældre end 30 dage for at reducere spam:

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

For `issues` begivenheder er `prompt` input **påkrævet**, da der ikke er nogen kommentarer at udtrække instruktioner fra.

---

## Brugerdefinerede prompter

Tilsidesæt standardprompten for at tilpasse OpenCodes adfærd til din arbejdsgang.

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

Dette er nyttigt til at håndhæve specifikke gennemgangskriterier, kodningsstandarder eller fokusområder, der er relevante for dit projekt.

---

## Eksempler

Her er nogle eksempler på, hvordan du kan bruge OpenCode i GitHub.

- **Forklar et problem**

  Tilføj denne kommentar i et GitHub-nummer.

  ```
  /opencode explain this issue
  ```

  OpenCode vil læse hele tråden, inklusive alle kommentarer, og svare med en klar forklaring.

- **Løs et problem**

  I et GitHub-problem skal du sige:

  ```
  /opencode fix this
  ```

  Og OpenCode vil oprette en ny branch, implementere ændringer og åbne en PR med ændringer.

- **Gennemgå PR'er og foretag ændringer**

  Efterlad følgende kommentar på en GitHub PR.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  OpenCode vil implementere den ønskede ændring og forpligtelse til den samme PR.

- **Gennemgå specifikke kodelinjer**

  Efterlad en kommentar direkte på kodelinjer i PR's faneblad "Filer". OpenCode detekterer automatisk filer, linjenumrene og diff-konteksten for at give præcise svar.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Når du kommenterer på specifikke linjer, modtager OpenCode:
  - Den nøjagtige fil bliver gennemgået
  - De specifikke kodelinjer
  - Den omgivende forskellig kontekst
  - Linjenummeroplysninger

  Dette giver mulighed for mere målrettede anmodninger uden at skulle angive filstier eller linjenumre manuelt.
