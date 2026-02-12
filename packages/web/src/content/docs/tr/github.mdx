---
title: GitHub
description: GitHub sorunlarında ve çekme isteklerinde opencode'u kullanın.
---

opencode, GitHub iş akışınızla bütünleşir. Yorumunuzda `/opencode` veya `/oc`'den bahsedin; opencode, GitHub Actions çalıştırıcınızdaki görevleri yürütecektir.

---

## Özellikler

- **Sorunları önceliklendirin**: opencode'dan bir sorunu araştırıp size açıklamasını isteyin.
- **Düzelt ve uygula**: opencode'dan bir sorunu düzeltmesini veya bir özelliği uygulamasını isteyin. Ve yeni bir şubede çalışacak ve tüm değişiklikleri içeren bir PR gönderecek.
- **Güvenli**: opencode, GitHub'ınızın çalıştırıcılarının içinde çalışır.

---

## Kurulum

GitHub deposundaki bir projede aşağıdaki komutu çalıştırın:

```bash
opencode github install
```

Bu size GitHub uygulamasını yükleme, iş akışını oluşturma ve gizli dizileri ayarlama adımlarında yol gösterecektir.

---

### Manuel Kurulum

Veya manuel olarak ayarlayabilirsiniz.

1. **GitHub uygulamasını yükleyin**

   [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent)'a gidin. Hedef depoya kurulu olduğundan emin olun.

2. **İş akışını ekleyin**

   Aşağıdaki iş akışı dosyasını deponuzdaki `.github/workflows/opencode.yml`'a ekleyin. `model`'de uygun `env` ve gerekli API anahtarlarını ayarladığınızdan emin olun.

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

3. **API anahtarlarını gizli olarak saklayın**

   Kuruluşunuzda veya projenizde **ayarlarda**, soldaki **Gizli bilgiler ve değişkenler**'i genişletin ve **Eylemler**'i seçin. Ve gerekli API anahtarlarını ekleyin.

---

## Yapılandırma

- `model`: opencode ile kullanılacak model. `provider/model` biçimini alır. Bu **gerekli**.
- `agent`: Kullanılacak aracı. Birincil ajan olmalı. Yapılandırmadan `default_agent`'ye veya bulunamazsa `"build"`'ye geri döner.
- `share`: opencode hesabının paylaşılıp paylaşılmayacağı. Genel depolar için varsayılan olarak **true** olur.
- `prompt`: Varsayılan çalışma geçersiz olduğundan dolayı özel istem. opencode'un işleme biçimini kişiselleştirmek için bunu kullanın.
- `token`: Yorum oluşturma, değişiklik yapma ve çekme isteklerini açma gibi işlemleri gerçekleştirmek için isteğe bağlı GitHub erişim belirteci. Varsayılan olarak opencode, opencode GitHub Uygulamasındaki kurulum erişim belirtecini kullanır, bu nedenle taahhütler, yorumlar ve çekme istekleri uygulamadan geliyormuş gibi görünür.

  Alternatif olarak, opencode GitHub'u yüklemeden GitHub Eylem çalıştırıcısının [built-in `GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) akışını kullanabilirsiniz. İşinizde gerekli izinlere sahip olduğunuzdan emin olun:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Tercih edilirse [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) de kullanabilirsiniz.

---

## Desteklenen Olaylar

opencode aşağıdaki GitHub olayları tarafından tetiklenebilir:

| Olay Tipi                     | Tetikleyen                                    | Detaylar                                                                                                                                            |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Bir soruna veya halkla ilişkilere yorum yapın | Yorumunuzda `/opencode` veya `/oc`'den bahsedin. opencode bağlamı okur ve şubeler oluşturabilir, PR'leri açabilir veya yanıt verebilir.             |
| `pull_request_review_comment` | PR'deki belirli kod satırlarına yorum yapın   | Kodu incelerken `/opencode` veya `/oc`'den bahsedin. opencode dosya yolunu, satır numaralarını ve fark içeriğini alır.                              |
| `issues`                      | Sayı açıldı veya düzenlendi                   | Sorunlar oluşturulduğunda veya değiştirildiğinde opencode'u otomatik olarak tetikleyin. `prompt` girişi gerektirir.                                 |
| `pull_request`                | PR açıldı veya güncellendi                    | PR'ler açıldığında, senkronize edildiğinde veya yeniden açıldığında opencode'u otomatik olarak tetikleyin. Otomatik incelemeler için kullanışlıdır. |
| `schedule`                    | Cron tabanlı program                          | opencode'u bir programa göre çalıştırın. `prompt` girişi gerektirir. Çıktı, günlüklere ve PR'lere gider (yorum yapılacak bir sorun yoktur).         |
| `workflow_dispatch`           | GitHub kullanıcı arayüzünden manuel tetikleme | Eylemler sekmesi aracılığıyla opencode'u isteğe bağlı olarak tetikleyin. `prompt` girişi gerektirir. Çıktı günlüklere ve PR'lere gider.             |

### Zamanlama Örneği

Otomatik görevleri gerçekleştirmek için opencode'u bir zamanlamaya göre çalıştırın:

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

Zamanlanmış etkinlikler için, talimatların alınabileceği bir yorum bulunmadığından `prompt` girişi **gereklidir**. Zamanlanmış iş akışları, izin kontrolü yapılacak bir kullanıcı bağlamı olmadan çalışır; bu nedenle, opencode'un şubeler veya PR'ler oluşturmasını bekliyorsanız iş akışının `contents: write` ve `pull-requests: write` vermesi gerekir.

---

### Çekme İsteği Örneği

PR'leri açıldığında veya güncellendiğinde otomatik olarak inceleyin:

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

`pull_request` olaylar için, `prompt` sağlanmazsa, opencode varsayılan olarak çekme isteklerini inceler.

---

### Sorun Önceliklendirme Örneği

Yeni sorunları otomatik olarak önceliklendirin. Bu örnek, spam'i azaltmak için 30 günden eski hesapları filtreler:

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

`issues` olayları için, talimatların çıkarılacağı bir yorum olmadığından `prompt` girişi **gereklidir**.

---

## Özel istemler

opencode'un davranışını iş akışınız için özelleştirmek için varsayılan istemi geçersiz kılın.

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

Bu, projenizle ilgili spesifik inceleme kriterlerini, kodlama standartlarını veya odak alanlarını uygulamak için kullanışlıdır.

---

## Örnekler

GitHub'da opencode'u nasıl kullanabileceğinize dair bazı örnekleri burada bulabilirsiniz.

- **Bir sorunu açıklama**

  Bu yorumu GitHub sayısına ekleyin.

  ```
  /opencode explain this issue
  ```

  opencode, tüm yorumlar da dahil olmak üzere ileti dizisinin tamamını okuyacak ve net bir açıklama ile yanıt verecektir.

- **Bir sorunu düzeltme**

  In a GitHub issue, say:

  ```
  /opencode fix this
  ```

  Ve opencode yeni bir şube oluşturacak, değişiklikleri uygulayacak ve değişiklikleri içeren bir PR açacak.

- **PR'leri inceleyin ve değişiklik yapın**

  GitHub PR'a aşağıdaki yorumu bırakın.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  opencode istenen değişikliği uygulayacak ve aynı PR'ye uygulayacaktır.

- **Belirli kod satırlarını inceleme**

  PR'nin "Dosyalar" sekmesindeki kod satırlarına doğrudan yorum bırakın. opencode, kesin yanıtlar sağlamak için dosyayı, satır numaralarını ve fark içeriğini otomatik olarak algılar.

  ```
  [Comment on specific lines in Files tab]
  /oc add error handling here
  ```

  Belirli satırlara yorum yaparken opencode şunları alır:
  - İncelenmekte olan dosyanın tamamı
  - Belirli kod satırları
  - Çevreleyen fark bağlamı
  - Satır numarası bilgisi

  Bu, dosya yollarını veya satır numaralarını manuel olarak belirtmeye gerek kalmadan daha hedefli isteklere olanak tanır.
