---
title: GitHub
description: Utilisez OpenCode dans les issues et les pull-requests GitHub.
---

OpenCode s'intègre à votre flux de travail GitHub. Mentionnez `/opencode` ou `/oc` dans votre commentaire, et OpenCode exécutera des tâches dans votre runner GitHub Actions.

---

## Fonctionnalités

- **Triage des issues** : demandez à OpenCode d'examiner une issue et de vous l'expliquer.
- **Correction et implémentation** : demandez à OpenCode de résoudre un problème ou d'implémenter une fonctionnalité. Il travaillera dans une nouvelle branche et soumettra une PR avec tous les changements.
- **Sécurisé** : OpenCode s'exécute à l'intérieur de vos runners GitHub.

---

## Installation

Exécutez la commande suivante dans un projet qui se trouve dans un dépôt GitHub :

```bash
opencode github install
```

Cela vous guidera dans l'installation de l'application GitHub, la création du workflow et la configuration des secrets.

---

### Configuration manuelle

Ou vous pouvez le configurer manuellement.

1. **Installez l'application GitHub**

Rendez-vous sur [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Assurez-vous qu'il est installé sur le dépôt cible.

2. **Ajouter le workflow**

Ajoutez le fichier de workflow suivant à `.github/workflows/opencode.yml` dans votre dépôt. Assurez-vous de définir les clés `model` appropriées et les clés API requises dans `env`.

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

3. **Stockez les clés API dans les secrets**

Dans les **paramètres** de votre organisation ou de votre projet, développez **Secrets et variables** sur la gauche et sélectionnez **Actions**. Puis ajoutez les clés API requises.

---

## Configuration

- `model` : Le modèle à utiliser avec OpenCode. Prend le format `provider/model`. Ceci est **obligatoire**.
- `agent` : l'agent à utiliser. Doit être un agent primaire. Revient à `default_agent` à partir de la configuration ou à `"build"` s'il n'est pas trouvé.
- `share` : s'il faut partager la session OpenCode. La valeur par défaut est **true** pour les référentiels publics.
- `prompt` : prompt personnalisé facultatif pour remplacer le comportement par défaut. Utilisez-le pour personnaliser la façon dont OpenCode traite les demandes.
- `token` : jeton d'accès GitHub facultatif pour effectuer des opérations telles que la création de commentaires, le commit de modifications et l'ouverture de pull requests. Par défaut, OpenCode utilise le jeton d'accès à l'installation de l'application OpenCode GitHub, de sorte que les commits, les commentaires et les pull requests apparaissent comme provenant de l'application.

Vous pouvez également utiliser le `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) intégré du runner GitHub Actions sans installer l'application OpenCode GitHub. Assurez-vous simplement d'accorder les autorisations requises dans votre workflow :

```yaml
permissions:
  id-token: write
  contents: write
  pull-requests: write
  issues: write
```

Vous pouvez également utiliser un [jeton d'accès personnel](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) si vous préférez.

---

## Événements supportés

OpenCode peut être déclenché par les événements GitHub suivants :

| Type d'événement              | Déclenché par                                              | Détails                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issue_comment`               | Commentaire sur une issue ou une PR                        | Mentionnez `/opencode` ou `/oc` dans votre commentaire. OpenCode lit le contexte et peut créer des branches, ouvrir des PR ou répondre.                |
| `pull_request_review_comment` | Commentaire sur des lignes de code spécifiques dans une PR | Mentionnez `/opencode` ou `/oc` lors de la révision du code. OpenCode reçoit le chemin du fichier, les numéros de ligne et le contexte de comparaison. |
| `issues`                      | Issue ouverte ou modifiée                                  | Déclenchez automatiquement OpenCode lorsque des issues sont créées ou modifiées. Nécessite une entrée `prompt`.                                        |
| `pull_request`                | PR ouverte ou mise à jour                                  | Déclenchez automatiquement OpenCode lorsque les PR sont ouvertes, synchronisées ou rouvertes. Utile pour les revues automatisées.                      |
| `schedule`                    | Planification basée sur Cron                               | Exécutez OpenCode selon un planning. Nécessite une entrée `prompt`. La sortie va aux journaux et aux PR (pas de commentaire sur les issues).           |
| `workflow_dispatch`           | Déclenchement manuel depuis l'interface utilisateur GitHub | Déclenchez OpenCode à la demande via l'onglet Actions. Nécessite une entrée `prompt`. La sortie va aux journaux et aux PR.                             |

### Exemple de planification

Exécutez OpenCode selon un planning pour effectuer des tâches automatisées :

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

Pour les événements planifiés, l'entrée `prompt` est **obligatoire** car il n'y a aucun commentaire pour extraire les instructions. Les workflows planifiés s'exécutent sans contexte utilisateur pour vérifier les autorisations. Le workflow doit donc accorder `contents: write` et `pull-requests: write` si vous vous attendez à ce que OpenCode crée des branches ou des PR.

---

### Exemple de Pull Request

Examinez automatiquement les PR lorsqu'ils sont ouverts ou mis à jour :

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

Pour les événements `pull_request`, si aucun `prompt` n'est fourni, OpenCode examine par défaut la pull request.

---

### Exemple de Triage d'Issue

Triez automatiquement les nouvelles issues. Cet exemple filtre les comptes datant de plus de 30 jours pour réduire le spam :

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

Pour les événements `issues`, l'entrée `prompt` est **obligatoire** car il n'y a aucun commentaire à partir duquel extraire les instructions.

---

## Invites personnalisées

Remplacez l'invite par défaut pour personnaliser le comportement de OpenCode pour votre workflow.

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

Ceci est utile pour appliquer des critères d’évaluation spécifiques, des normes de codage ou des domaines d’intervention pertinents pour votre projet.

---

## Exemples

Voici quelques exemples de la façon dont vous pouvez utiliser OpenCode dans GitHub.

- **Expliquer une issue**

Ajoutez ce commentaire dans une issue GitHub.

```
  /opencode explain this issue
```

OpenCode lira l'intégralité du fil de discussion, y compris tous les commentaires, et répondra avec une explication claire.

- **Résoudre une issue**

Dans une issue GitHub, dites :

```
  /opencode fix this
```

Et OpenCode créera une nouvelle branche, mettra en œuvre les modifications et ouvrira une PR avec les modifications.

- **Examinez les PR et apportez des modifications**

Laissez le commentaire suivant sur une PR GitHub.

```
  Delete the attachment from S3 when the note is removed /oc
```

OpenCode mettra en œuvre la modification demandée et la validera dans la même PR.

- **Revue de lignes de code spécifiques**

Laissez un commentaire directement sur les lignes de code dans l'onglet "Fichiers" de la PR. OpenCode détecte automatiquement le fichier, les numéros de ligne et le contexte de comparaison pour fournir des réponses précises.

```
  [Comment on specific lines in Files tab]
  /oc add error handling here
```

Lorsqu'il commente des lignes spécifiques, OpenCode reçoit :

- Le fichier exact en cours d'examen
- Les lignes de code spécifiques
- Le contexte différentiel environnant
- Informations sur le numéro de ligne

Cela permet des requêtes plus ciblées sans avoir besoin de spécifier manuellement les chemins de fichiers ou les numéros de ligne.
