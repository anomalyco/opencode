---
title: GitHub
description: استخدم OpenCode في GitHub Issues وPull Requests.
---

يتكامل OpenCode مع سير عمل GitHub لديك. اذكر `/opencode` أو `/oc` في تعليقك، وسيقوم OpenCode بتنفيذ المهام داخل GitHub Actions runner لديك.

---

## الميزات

- **فرز Issues**: اطلب من OpenCode الاطلاع على Issue وشرحها لك.
- **إصلاح وتنفيذ**: اطلب من OpenCode إصلاح Issue أو تنفيذ ميزة. وسيعمل على فرع جديد ويقدّم PR يضم كل التغييرات.
- **آمن**: يعمل OpenCode داخل GitHub runners لديك.

---

## التثبيت

شغّل الأمر التالي داخل مشروع موجود في مستودع GitHub:

```bash
opencode github install
```

سيأخذك هذا خلال تثبيت GitHub app، وإنشاء workflow، وإعداد secrets.

---

### الإعداد اليدوي

أو يمكنك إعداده يدويًا.

1. **تثبيت GitHub app**

   انتقل إلى [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). تأكد من تثبيته على المستودع الهدف.

2. **إضافة الـworkflow**

   أضف ملف الـworkflow التالي إلى `.github/workflows/opencode.yml` في مستودعك. تأكد من ضبط `model` المناسب ومفاتيح API المطلوبة ضمن `env`.

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

3. **تخزين مفاتيح API ضمن secrets**

   في **settings** الخاصة بالمؤسسة أو المشروع، وسّع **Secrets and variables** في الشريط الجانبي الأيسر ثم اختر **Actions**، وأضف مفاتيح API المطلوبة.

---

## الإعدادات

- `model`: النموذج الذي سيستخدمه OpenCode. يأخذ الصيغة `provider/model`. هذا **مطلوب**.
- `agent`: الـagent الذي سيتم استخدامه. يجب أن يكون agent أساسيًا. يعود افتراضيًا إلى `default_agent` من الإعدادات أو `"build"` إذا لم يُعثر عليه.
- `share`: هل تتم مشاركة جلسة OpenCode. القيمة الافتراضية **true** للمستودعات العامة.
- `prompt`: موجه مخصص اختياري لتجاوز السلوك الافتراضي. استخدمه لتخصيص كيفية معالجة OpenCode للطلبات.
- `token`: GitHub access token اختياري لتنفيذ عمليات مثل إنشاء التعليقات، وcommit للتغييرات، وفتح Pull Requests. افتراضيًا يستخدم OpenCode installation access token الخاص بـOpenCode GitHub App، لذا تظهر commits والتعليقات وPull Requests وكأنها صادرة من التطبيق.

  بدلًا من ذلك، يمكنك استخدام [`GITHUB_TOKEN` المدمج](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) في GitHub Action runner دون تثبيت OpenCode GitHub App. فقط تأكد من منح الأذونات المطلوبة في الـworkflow:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  يمكنك أيضًا استخدام [رموز الوصول الشخصية](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) إن فضّلت ذلك.

---

## الأحداث المدعومة

يمكن تشغيل OpenCode عبر أحداث GitHub التالية:

| نوع الحدث                     | يتم تشغيله عبر                 | التفاصيل                                                                                                |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | تعليق على Issue أو PR          | اذكر `/opencode` أو `/oc` في تعليقك. يقرأ OpenCode السياق ويمكنه إنشاء فروع، وفتح PRs، أو الرد.         |
| `pull_request_review_comment` | تعليق على أسطر كود محددة في PR | اذكر `/opencode` أو `/oc` أثناء مراجعة الكود. يستلم OpenCode مسار الملف وأرقام الأسطر وسياق الـdiff.    |
| `issues`                      | فتح Issue أو تعديلها           | تشغيل OpenCode تلقائيًا عند إنشاء Issues أو تعديلها. يتطلب إدخال `prompt`.                              |
| `pull_request`                | فتح PR أو تحديثه               | تشغيل OpenCode تلقائيًا عند فتح PRs أو مزامنتها أو إعادة فتحها. مفيد للمراجعات الآلية.                  |
| `schedule`                    | جدول يعتمد على Cron            | تشغيل OpenCode وفق جدول. يتطلب إدخال `prompt`. يذهب الناتج إلى logs وPRs (لا يوجد Issue للتعليق عليها). |
| `workflow_dispatch`           | تشغيل يدوي من واجهة GitHub     | تشغيل OpenCode عند الطلب عبر Actions tab. يتطلب إدخال `prompt`. يذهب الناتج إلى logs وPRs.              |

### مثال للجدولة

شغّل OpenCode وفق جدول لتنفيذ مهام آلية:

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

بالنسبة لأحداث `schedule`، يكون إدخال `prompt` **مطلوبًا** لعدم وجود تعليق لاستخراج التعليمات منه. تعمل عمليات الـworkflow المجدولة دون سياق مستخدم للتحقق من الأذونات، لذا يجب أن يمنح الـworkflow صلاحيات `contents: write` و`pull-requests: write` إذا كنت تتوقع أن ينشئ OpenCode فروعًا أو PRs.

---

### مثال Pull Request

راجع PRs تلقائيًا عند فتحها أو تحديثها:

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

بالنسبة لأحداث `pull_request`، إذا لم يتم توفير `prompt`، فإن OpenCode يراجع Pull Request افتراضيًا.

---

### مثال فرز Issues

قم بفرز Issues الجديدة تلقائيًا. يقوم هذا المثال بتصفية الحسابات الأقدم من 30 يومًا لتقليل الرسائل المزعجة:

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

بالنسبة لأحداث `issues`، يكون إدخال `prompt` **مطلوبًا** لعدم وجود تعليق لاستخراج التعليمات منه.

---

## الموجهات المخصصة

قم بتجاوز الموجه الافتراضي لتخصيص سلوك OpenCode ضمن الـworkflow لديك.

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

يفيد ذلك في فرض معايير مراجعة محددة، أو معايير كتابة الكود، أو مجالات تركيز تناسب مشروعك.

---

## أمثلة

إليك بعض الأمثلة على كيفية استخدام OpenCode في GitHub.

- **شرح Issue**

  أضف هذا التعليق داخل GitHub Issue.

  ```
  /opencode explain this issue
  ```

  سيقرأ OpenCode كامل النقاش، بما في ذلك جميع التعليقات، ويرد بشرح واضح.

- **إصلاح Issue**

  داخل GitHub Issue، اكتب:

  ```
  /opencode fix this
  ```

  وسيُنشئ OpenCode فرعًا جديدًا، وينفّذ التغييرات، ويفتح PR يتضمنها.

- **مراجعة PRs وإجراء تغييرات**

  اترك التعليق التالي على GitHub PR.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  سينفّذ OpenCode التغيير المطلوب ويعمل له commit إلى نفس PR.

- **مراجعة أسطر كود محددة**

  اترك تعليقًا مباشرة على أسطر الكود في تبويب "Files" داخل PR. يكتشف OpenCode تلقائيًا الملف وأرقام الأسطر وسياق الـdiff لتقديم ردود دقيقة.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  عند التعليق على أسطر محددة، يستلم OpenCode:
  - الملف الدقيق الذي تتم مراجعته
  - أسطر الكود المحددة
  - سياق الـdiff المحيط
  - معلومات أرقام الأسطر

  يسمح ذلك بطلبات أكثر تحديدًا دون الحاجة لذكر مسارات الملفات أو أرقام الأسطر يدويًا.
