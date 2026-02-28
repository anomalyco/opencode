---
title: GitHub
description: Koristite OpenCode u GitHub problemima i zahtjevima za povlačenjem.
---

OpenCode se integriše sa vašim GitHub tokovom rada. Spomenite `/opencode` ili `/oc` u svom komentaru i OpenCode će izvršiti zadatke unutar vašeg GitHub Actions runnera.

---

## Funkcije

- **Problemi trijaže**: Zamolite OpenCode da ispita problem i objasni vam ga.
- **Popravi i implementiraj**: Zamolite OpenCode da popravi problem ili implementira funkciju. I radit će u novoj poslovnici i dostavljati PR sa svim promjenama.
- **Secure**: OpenCode se pokreće unutar pokretača vašeg GitHub-a.

---

## Instalacija

Pokrenite sljedeću naredbu u projektu koji se nalazi u GitHub repo:

```bash
opencode github install
```

Ovo će vas provesti kroz instalaciju GitHub aplikacije, kreiranje toka posla i postavljanje tajni.

---

### Ručno podešavanje

Ili ga možete postaviti ručno.

1. **Instalirajte GitHub aplikaciju**
   Idite na [**github.com/apps/opencodegent**](https://github.com/apps/opencodegent). Uvjerite se da je instaliran na ciljnom spremištu.
2. **Dodajte radni tok**
   Dodajte sljedeći fajl toka posla u `.github/workflows/opencode.yml` u svoj repo. Obavezno postavite odgovarajuće `model` i potrebne API ključeve u `env`.

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

3. **Sačuvaj API ključeve u tajne**
   U **postavkama** organizacije ili projekta proširite **Tajne i varijable** na lijevoj strani i odaberite **Radnje**. I dodajte potrebne API ključeve.

---

## Konfiguracija

- `model`: Model za korištenje s OpenCode. Uzima format `provider/model`. Ovo je **obavezno**.
- `agent`: Agent za korištenje. Mora biti primarni agent. Vraća se na `default_agent` iz konfiguracije ili `"build"` ako nije pronađen.
- `share`: Da li dijeliti OpenCode sesiju. Podrazumevano je **true** za javna spremišta.
- `prompt`: Opcioni prilagođeni upit za nadjačavanje zadanog ponašanja. Koristite ovo da prilagodite kako OpenCode obrađuje zahtjeve.
- `token`: Opcionalni GitHub pristupni token za izvođenje operacija kao što su kreiranje komentara, upisivanje promjena i otvaranje zahtjeva za povlačenjem. OpenCode prema zadanim postavkama koristi token za pristup instalaciji iz aplikacije OpenCode GitHub, tako da se urezivanje, komentari i zahtjevi za povlačenjem pojavljuju kao da dolaze iz aplikacije.
  Alternativno, možete koristiti GitHub Action runner [ugrađeni `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) bez instaliranja OpenCode GitHub aplikacije. Samo se pobrinite da date potrebna odobrenja u svom toku rada:

```yaml
permissions:
  id-token: write
  contents: write
  pull-requests: write
  issues: write
```

Također možete koristiti [Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) ako želite.

---

## Podržani događaji

OpenCode se može pokrenuti sljedećim GitHub događajima:
| Vrsta događaja | Pokrenuo | Detalji
|----------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `issue_comment` | Komentirajte problem ili PR | Navedite `/opencode` ili `/oc` u svom komentaru. OpenCode čita kontekst i može kreirati grane, otvarati PR-ove ili odgovarati. |
| `pull_request_review_comment` | Komentirajte određene linije koda u PR-u | Navedite `/opencode` ili `/oc` dok pregledavate kod. OpenCode prima putanju datoteke, brojeve redova i kontekst razlike. |
| `issues` | Broj otvoren ili uređen | Automatski pokrenite OpenCode kada se problemi kreiraju ili modificiraju. Zahtijeva `prompt` unos. |
| `pull_request` | PR otvoren ili ažuriran | Automatski pokrenite OpenCode kada se PR-ovi otvore, sinkroniziraju ili ponovo otvore. Korisno za automatske recenzije. |
| `schedule` | Cron baziran raspored | Pokrenite OpenCode prema rasporedu. Zahtijeva `prompt` unos. Izlaz ide u dnevnike i PR-ove (nema problema za komentarisanje). |
| `workflow_dispatch` | Ručni okidač iz GitHub korisničkog sučelja | Aktivirajte OpenCode na zahtjev preko kartice Akcije. Zahtijeva `prompt` unos. Izlaz ide u dnevnike i PR-ove. |

### Primjer rasporeda

Pokrenite OpenCode po rasporedu za obavljanje automatiziranih zadataka:

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

Za zakazane događaje, unos `prompt` je **potreban** jer nema komentara za izvlačenje instrukcija. Planirani tokovi posla se pokreću bez korisničkog konteksta za provjeru dozvola, tako da tok posla mora odobriti `contents: write` i `pull-requests: write` ako očekujete da će OpenCode kreirati grane ili PR-ove.

---

### Primjer zahtjeva za povlačenjem

Automatski pregledajte PR-ove kada se otvore ili ažuriraju:

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

Za `pull_request` događaje, ako nije naveden `prompt`, OpenCode podrazumevano pregledava zahtjev za povlačenjem.

---

### Primjer trijaže problema

Automatski triažirajte nove probleme. Ovaj primjer filtrira na račune starije od 30 dana radi smanjenja neželjene pošte:

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

Za `issues` događaje, `prompt` unos je **potreban** jer nema komentara za izvlačenje instrukcija.

---

## Prilagođeni upiti

Zaobiđite zadani prompt da biste prilagodili ponašanje OpenCode za vaš tok posla.

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

Ovo je korisno za provođenje specifičnih kriterija pregleda, standarda kodiranja ili fokusnih područja relevantnih za vaš projekt.

---

## Primjeri

Evo nekoliko primjera kako možete koristiti OpenCode u GitHub.

- **Objasnite problem**
  Dodajte ovaj komentar u GitHub izdanje.

```
  /opencode explain this issue
```

OpenCode će pročitati cijelu temu, uključujući sve komentare, i odgovoriti s jasnim objašnjenjem.

- **Popravi problem**
  U izdanju na GitHub-u recite:

```
  /opencode fix this
```

I OpenCode će kreirati novu granu, implementirati promjene i otvoriti PR sa promjenama.

- **Pregledajte PR-ove i izvršite izmjene**
  Ostavite sljedeći komentar na GitHub PR-u.

```
  Delete the attachment from S3 when the note is removed /oc
```

OpenCode će implementirati traženu promjenu i posvetiti je istom PR-u.

- **Pregledajte određene linije koda**
  Ostavite komentar direktno na linije koda u PR kartici "Files". OpenCode automatski detektuje datoteku, brojeve redova i kontekst razlike kako bi pružio precizne odgovore.

```
  [Comment on specific lines in Files tab]
  /oc add error handling here
```

Kada komentarišete određene linije, OpenCode prima:

- Tačan fajl se pregleda
- Specifične linije koda
- Okolni diff kontekst
- Informacije o broju linije
  Ovo omogućava više ciljanih zahtjeva bez potrebe za ručno specificiranjem putanja datoteka ili brojeva linija.
