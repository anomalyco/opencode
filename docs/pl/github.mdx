---
title: GitHub
description: Użyj opencode w problemach z GitHubem i zastosujch ściągnięcia.
---

opencode integruje się z przepływem pracy w GitHub. Wspomnij o `/opencode` lub `/oc` w swoim komentarzu, a opencode wykonaj zadania w ramach modułu uruchamiającego GitHub Actions.

---

## Cechy

- **Problem związany z segregacją**: Poproś opencode o szczegółowe wyjaśnienie problemu i wyjaśnienie go.
- **Napraw i zaimplementuj**: Poproś opencode o naprawienie problemu lub zaimplementowanie funkcji. Będzie dostępny w następnym oddziale i wysyłać PR ze stosowaniem dodatku.
- **Bezpieczny**: opencode działa w modułach sprzętowych GitHuba.

---

## Instalacja

Uruchomione dalsze postępowanie w przypadku wystąpienia w repozytorium GitHub:

```bash
opencode github install
```

Aby przeprowadzić Cię przez proces instalacji aplikacji GitHub, utwórz działanie i skonfiguruj wpisy tajnych.

---

### Konfiguracja ręczna

Można też uszkodzić to rozwiązanie.

1. **Zainstaluj aplikację GitHub**

   Wejdź na [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). wystąpienie się, że jest natychmiastowe w repozytorium usuwam.

2. **Dodaj przepływ pracy**

   Dodaj zdalny plik pracy do `.github/workflows/opencode.yml` w swoim repozytorium. wystąpił, że ustawiłeś sędziego `model` i wymagany klucz API w `env`.

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

3. **Przechowuj klucze API w tajemnicy**

   W **ustawieniach** swojej organizacji lub projektu rozwiń **Sekretne i zmienne** po lewej stronie i wybierz **Działania**. Dodałem wymagane klucze API.

---

## Konfiguracja

- `model`: Model używany z opencode. Przyjmuje format `provider/model`. To **wymagane**.
- `agent`: Agent, którego należy używać. Musi być odległym agentem. Wraca do `default_agent` z konfiguracją lub `"build"`, jeśli nie został znaleziony.
- `share`: Czyć funkcję sesji opencode. Domyślnie **true** dla repozytoriów publicznych.
- `prompt`: Opcjonalny niestandardowy monit o zastąpienie przestrzegania zachowania. Wykorzystanie tego, aby dostosować sposób przetwarzania przez opencode.
- `token`: opcjonalny token dostępu GitHub podstawowe operacje, takie jak tworzenie komentarzy, zatwierdzanie zmian i otwieranie zastosowania ściągnięcia. Domyślnie opencode używa tokena dostępu do instalacji z aplikacji opencode GitHub, więc zatwierdzenia, komentarze i zasady ściągnięcia widoczne jako źródło z aplikacji.

  Alternatywnie możesz użyć [wbudowanego `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) modułu uruchamiającego GitHub Action bez instalacji aplikacji opencode GitHub. Pamiętaj tylko o przyznaniu wymaganych mocy w przepływie pracy:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Jeśli chcesz, możesz także użyć [osobistych tokenów dostępu](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT).

---

## Obsługiwane wydarzenia

opencode może zostać wywołany przez zdarzenie GitHub:

| Typ zdarzenia                 | Wywołane przez                                   | Szczegóły                                                                                                                                             |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Skomentuj problem lub PR                         | Wspomnij o `/opencode` lub `/oc` w swoim komentarzu. opencode odczytuje kontekst i może być częścią składową, otwieraną przez PR lub odpowiedzialną.  |
| `pull_request_review_comment` | Komentarz określonym kodem w PR                  | Wspomnij o `/opencode` lub `/oc` podczas przeglądania kodu. opencode źródło pochodzenia, numery linii i kontekst różnicowy.                           |
| `issues`                      | Wydanie otwarte lub edytowane                    | Automatycznie wyzwalaj opencode po utworzeniu lub zmodyfikowaniu problemów. Wymaga wejścia `prompt`.                                                  |
| `pull_request`                | PR otwarty lub zaktualizowany                    | Automatycznie wyzwalaj opencode, gdy PR są otwierane, synchronizowane lub ponownie otwierane. Przydatne w przypadku automatycznych znajomych.         |
| `schedule`                    | Harmonogram oparty na Cron                       | Uruchom opencode zgodnie z harmonogramem. Wymagane wejście `prompt`. Dane wejściowe trafiają do dzienników i trafiań PR (nie ma problemu z recenzją). |
| `workflow_dispatch`           | Ręczny wyłącznik z interfejsu użytkownika GitHub | Uruchom opencode na karcie Akcje. Wymagane wejście `prompt`. Dane wejściowe trafiają do dzienników i odbiorców PR.                                    |

### Przykład harmonogramu

Uruchamiaj opencode zgodnie z harmonogramem, aby wykonać zautomatyzowane zadania:

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

W przypadku wystąpienia danych wyjściowych `prompt` są **wymagane**, które nie są dostarczane, z których można wyodrębnić instrukcje. Zaplanowane przepływomierze pracy bez kontekstu użytkownika, który został uruchomiony, więc przepływ pracy musi `contents: write` i `pull-requests: write`, wystąpisz, że opencode utworzył główne lub PR.

---

### Przykład żądania ściągnięcia

Automatycznie przeglądaj żądania ściągnięcia po ich otwarciu lub aktualizacji:

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

W przypadku zdarzenia `pull_request`, jeśli nie podano `prompt`, opencode użytkownika przeglądającego ściągnięcie.

---

### Przykład segregacji problemów

Automatycznie segreguj nowe problemy. Dziesięć przykładów filtruje do kont starszych niż 30 dni w celu ograniczenia spamu:

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

W przypadku zdarzenia `issues` wprowadzenie `prompt` jest **wymagane**, ponieważ nie ma komentarza, z którego można wyodrębnić instrukcje.

---

## Niestandardowe monity

Zastąp domyślne monit, aby zastosować zachowanie opencode do twojego własnego pracy.

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

Jest to przepis wykonawczy, który podlega przepisom kodowania lub zakresów tematycznych dla twojego projektu.

---

## Przykłady

Oto kilka możliwości wykorzystania opencode w GitHubie.

- **Wyjaśnij problem**

  Dodaj dziesięć komentarzy w numerze GitHub.

  ```
  /opencode explain this issue
  ```

  opencode przeczytaj całość, zawierając dodatek z komentarzami i odpowiedzią z jasnym wyjaśnieniem.

- **Napraw problem**

  W numerze GitHub powiedz:

  ```
  /opencode fix this
  ```

  A opencode utworzy nową podstawę, wdroży zmiany i zastąpi PR ze zmiany.

- **Przegląd zmiany PR i wprowadzenie zmiany**

  Zostaw komentarz w PR GitHub.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  opencode zaimplementuje uruchomioną zmianę i zatwierdzi ją do tego samego PR.

- **Przejrzyj konkretne linie kodu**

  Zostaw komentarz bezpośrednio w wierszu kodu w dodatku „Pliki” PR. opencode automatyczne wykrywanie pliku, numery linii i kontekst różnicowy, aby sprawdzić odpowiedzi.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Komentując określone linie, opencode otrzymuje:
  - Dokładny plik, który jest sprawdzany
  - Konkretne linie kodu
  - Otaczający kontekst różnicowy
  - Informacje o numerze linii

  Dostępne na bardziej szczegółowe rozwiązanie bez konieczności stosowania ręcznego określania plików lub numerów wierszy.
