---
title: GitHub
description: Используйте opencode в задачах и пул-реквестах GitHub.
---

opencode интегрируется с вашим рабочим процессом GitHub. Упомяните `/opencode` или `/oc` в своем комментарии, и opencode выполнит задачи в вашем средстве выполнения действий GitHub.

---

## Возможности

- **Триаж задач (Issue Triage)**. Попросите opencode разобраться в проблеме и объяснить ее вам.
- **Исправление и реализация**. Попросите opencode исправить проблему или реализовать функцию. Он будет работать в новой ветке и создаст PR со всеми изменениями.
- **Безопасность**: opencode запускается внутри ваших GitHub Runners.

---

## Установка

Запустите следующую команду в проекте, который находится в репозитории GitHub:

```bash
opencode github install
```

Это поможет вам установить приложение GitHub, создать рабочий процесс и настроить secrets (секреты).

---

### Ручная настройка

Или вы можете настроить его вручную.

1. **Установите приложение GitHub**

   Перейдите на [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Убедитесь, что он установлен в целевом репозитории.

2. **Добавьте рабочий процесс**

   Добавьте следующий файл рабочего процесса в `.github/workflows/opencode.yml` в своем репозитории. Обязательно установите соответствующий `model` и необходимые ключи API в `env`.

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

3. **Храните ключи API в секрете**

   В **настройках** вашей организации или проекта разверните **Секреты и переменные** слева и выберите **Действия**. И добавьте необходимые ключи API.

---

## Настройка

- `model`: модель для использования с opencode. Принимает формат `provider/model`. Это **обязательно**.
- `agent`: используемый агент. Должен быть основным агентом. Возвращается к `default_agent` из конфигурации или к `"build"`, если не найден.
- `share`: следует ли предоставлять общий доступ к сеансу opencode. По умолчанию **true** для общедоступных репозиториев.
- `prompt`: дополнительный настраиваемый запрос для переопределения поведения по умолчанию. Используйте это, чтобы настроить обработку запросов opencode.
- `token`: дополнительный токен доступа GitHub для выполнения таких операций, как создание комментариев, фиксация изменений и открытие запросов на включение. По умолчанию opencode использует токен доступа к установке из приложения opencode GitHub, поэтому фиксации, комментарии и запросы на включение отображаются как исходящие из приложения.

  Кроме того, вы можете использовать [встроенный `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) средства запуска действий GitHub без установки приложения opencode GitHub. Просто не забудьте предоставить необходимые разрешения в вашем рабочем процессе:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Вы также можете использовать [токены личного доступа](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT), если предпочитаете.

---

## Поддерживаемые события

opencode может быть запущен следующими событиями GitHub:

| Тип события                   | Инициировано                                          | Подробности                                                                                                                          |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `issue_comment`               | Комментарий к проблеме или PR                         | Упомяните `/opencode` или `/oc` в своем комментарии. opencode считывает контекст и может создавать ветки, открывать PR или отвечать. |
| `pull_request_review_comment` | Комментируйте конкретные строки кода в PR.            | Упоминайте `/opencode` или `/oc` при просмотре кода. opencode получает путь к файлу, номера строк и контекст сравнения.              |
| `issues`                      | Issue открыт или изменен                              | Автоматически запускать opencode при создании или изменении проблем. Требуется ввод `prompt`.                                        |
| `pull_request`                | PR открыт или обновлен                                | Автоматически запускать opencode при открытии, синхронизации или повторном открытии PR. Полезно для автоматических обзоров.          |
| `schedule`                    | Расписание на основе Cron                             | Запускайте opencode по расписанию. Требуется ввод `prompt`. Вывод поступает в журналы и PR (комментариев нет).                       |
| `workflow_dispatch`           | Ручной триггер из пользовательского интерфейса GitHub | Запускайте opencode по требованию на вкладке «Действия». Требуется ввод `prompt`. Вывод идет в логи и PR.                            |

### Пример: Расписание

Запускайте opencode по расписанию для выполнения автоматизированных задач:

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

Для запланированных событий вход `prompt` **обязателен**, поскольку нет комментария, из которого можно было бы извлечь инструкции. Запланированные рабочие процессы выполняются без пользовательского контекста для проверки разрешений, поэтому рабочий процесс должен предоставлять `contents: write` и `pull-requests: write`, если вы ожидаете, что opencode будет создавать ветки или PR.

---

### Пример: Pull Request

Автоматически просматривать PR при их открытии или обновлении:

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

Если для событий `pull_request` не указан `prompt`, opencode по умолчанию проверяет запрос на включение.

---

### Пример: Сортировка Issue

Автоматически сортируйте новые проблемы. В этом примере фильтруется аккаунты, созданные более 30 дней назад, чтобы уменьшить количество спама:

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

Для событий `issues` вход `prompt` **обязателен**, поскольку нет комментария, из которого можно было бы извлечь инструкции.

---

## Пользовательские промпты

Переопределите приглашение по умолчанию, чтобы настроить поведение opencode для вашего рабочего процесса.

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

Это полезно для обеспечения соблюдения конкретных критериев проверки, стандартов кодирования или приоритетных областей, имеющих отношение к вашему проекту.

---

## Примеры

Вот несколько примеров того, как вы можете использовать opencode в GitHub.

- **Объяснение проблемы**

  Добавьте этот комментарий в выпуск GitHub.

  ```
  /opencode explain this issue
  ```

  opencode прочитает всю ветку, включая все комментарии, и ответит с четким объяснением.

- **Исправление проблемы**

  В выпуске GitHub скажите:

  ```
  /opencode fix this
  ```

  А opencode создаст новую ветку, внедрит изменения и откроет PR с изменениями.

- **Проверка Pull Request и внесение изменений**

  Оставьте следующий комментарий к PR на GitHub.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  opencode внедрит запрошенное изменение и зафиксирует его в том же PR.

- **Проверка отдельных строк кода**

  Оставляйте комментарии непосредственно к строкам кода на вкладке «Файлы» PR. opencode автоматически определяет файл, номера строк и контекст различий, чтобы предоставить точные ответы.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  При комментировании определенных строк opencode получает:
  - Точный файл, который просматривается
  - Конкретные строки кода
  - Окружающий контекст различий
  - Информация о номере строки

  Это позволяет выполнять более целевые запросы без необходимости вручную указывать пути к файлам или номера строк.
