---
title: GitHub
description: Use o opencode em problemas e pull-requests do GitHub.
---

O opencode integra-se ao seu fluxo de trabalho do GitHub. Mencione `/opencode` ou `/oc` em seu comentário, e o opencode executará tarefas dentro do seu runner do GitHub Actions.

---

## Recursos

- **Triagem de problemas**: Peça ao opencode para analisar um problema e explicá-lo para você.
- **Corrigir e implementar**: Peça ao opencode para corrigir um problema ou implementar um recurso. E ele trabalhará em um novo branch e enviará um PR com todas as alterações.
- **Seguro**: O opencode é executado dentro dos runners do seu GitHub.

---

## Instalação

Execute o seguinte comando em um projeto que está em um repositório do GitHub:

```bash
opencode github install
```

Isso o guiará pela instalação do aplicativo GitHub, criação do fluxo de trabalho e configuração de segredos.

---

### Configuração Manual

Ou você pode configurá-lo manualmente.

1. **Instale o aplicativo GitHub**

   Acesse [**github.com/apps/opencode-agent**](https://github.com/apps/opencode-agent). Certifique-se de que está instalado no repositório de destino.

2. **Adicione o fluxo de trabalho**

   Adicione o seguinte arquivo de fluxo de trabalho em `.github/workflows/opencode.yml` no seu repositório. Certifique-se de definir o `model` apropriado e as chaves de API necessárias em `env`.

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

3. **Armazene as chaves de API em segredos**

   Nas **configurações** da sua organização ou projeto, expanda **Segredos e variáveis** à esquerda e selecione **Ações**. E adicione as chaves de API necessárias.

---

## Configuração

- `model`: O modelo a ser usado com o opencode. Tem o formato de `provider/model`. Isso é **obrigatório**.
- `agent`: O agente a ser usado. Deve ser um agente primário. Retorna ao `default_agent` da configuração ou `"build"` se não encontrado.
- `share`: Se deve compartilhar a sessão do opencode. O padrão é **true** para repositórios públicos.
- `prompt`: Prompt personalizado opcional para substituir o comportamento padrão. Use isso para personalizar como o opencode processa solicitações.
- `token`: Token de acesso do GitHub opcional para realizar operações como criar comentários, confirmar alterações e abrir pull requests. Por padrão, o opencode usa o token de acesso da instalação do aplicativo GitHub opencode, então commits, comentários e pull requests aparecem como se fossem da aplicação.

  Alternativamente, você pode usar o [`GITHUB_TOKEN`](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) embutido do runner do GitHub Action sem instalar o aplicativo GitHub opencode. Apenas certifique-se de conceder as permissões necessárias em seu fluxo de trabalho:

  ```yaml
  permissions:
    id-token: write
    contents: write
    pull-requests: write
    issues: write
  ```

  Você também pode usar um [token de acesso pessoal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)(PAT) se preferir.

---

## Eventos Suportados

O opencode pode ser acionado pelos seguintes eventos do GitHub:

| Tipo de Evento                | Acionado Por                                        | Detalhes                                                                                                                               |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_comment`               | Comentário em um problema ou PR                     | Mencione `/opencode` ou `/oc` em seu comentário. O opencode lê o contexto e pode criar branches, abrir PRs ou responder.               |
| `pull_request_review_comment` | Comentário em linhas de código específicas em um PR | Mencione `/opencode` ou `/oc` enquanto revisa o código. O opencode recebe o caminho do arquivo, números das linhas e contexto do diff. |
| `issues`                      | Problema aberto ou editado                          | Aciona automaticamente o opencode quando problemas são criados ou modificados. Requer entrada de `prompt`.                             |
| `pull_request`                | PR aberto ou atualizado                             | Aciona automaticamente o opencode quando PRs são abertos, sincronizados ou reabertos. Útil para revisões automatizadas.                |
| `schedule`                    | Cron baseado em agendamento                         | Execute o opencode em um cronograma. Requer entrada de `prompt`. A saída vai para logs e PRs (sem problema para comentar).             |
| `workflow_dispatch`           | Acionamento manual pela interface do GitHub         | Acione o opencode sob demanda através da aba Ações. Requer entrada de `prompt`. A saída vai para logs e PRs.                           |

### Exemplo de Agendamento

Execute o opencode em um cronograma para realizar tarefas automatizadas:

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
             Revise a base de código para quaisquer comentários TODO e crie um resumo.
             Se encontrar problemas que valham a pena resolver, abra um issue para rastreá-los.
```

Para eventos agendados, a entrada `prompt` é **obrigatória** uma vez que não há comentário para extrair instruções. Fluxos de trabalho agendados são executados sem um contexto de usuário para verificação de permissões, então o fluxo de trabalho deve conceder `contents: write` e `pull-requests: write` se você espera que o opencode crie branches ou PRs.

---

### Exemplo de Pull Request

Revise automaticamente PRs quando forem abertos ou atualizados:

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
             Revise este pull request:
             - Verifique problemas de qualidade de código
             - Procure por potenciais bugs
             - Sugira melhorias
```

Para eventos de `pull_request`, se nenhum `prompt` for fornecido, o opencode padrão será revisar o pull request.

---

### Exemplo de Triagem de Problemas

Triagem automática de novos problemas. Este exemplo filtra contas com mais de 30 dias para reduzir spam:

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
             Revise este issue. Se houver uma correção clara ou docs relevantes:
             - Forneça links de documentação
             - Adicione orientação sobre tratamento de erros para exemplos de código
             Caso contrário, não comente.
```

Para eventos de `issues`, a entrada `prompt` é **obrigatória** uma vez que não há comentário para extrair instruções.

---

## Prompts Personalizados

Substitua o prompt padrão para personalizar o comportamento do opencode para seu fluxo de trabalho.

```yaml title=".github/workflows/opencode.yml"
- uses: anomalyco/opencode/github@latest
  with:
    model: anthropic/claude-sonnet-4-5
    prompt: |
      Revise este pull request:
      - Verifique problemas de qualidade de código
      - Procure por potenciais bugs
      - Sugira melhorias
```

Isso é útil para impor critérios de revisão específicos, padrões de codificação ou áreas de foco relevantes para seu projeto.

---

## Exemplos

Aqui estão alguns exemplos de como você pode usar o opencode no GitHub.

- **Explicar um problema**

  Adicione este comentário em um problema do GitHub.

  ```
  /opencode explain this issue
  ```

  O opencode lerá toda a conversa, incluindo todos os comentários, e responderá com uma explicação clara.

- **Corrigir um problema**

  Em um problema do GitHub, diga:

  ```
  /opencode fix this
  ```

  E o opencode criará um novo branch, implementará as alterações e abrirá um PR com as mudanças.

- **Revisar PRs e fazer alterações**

  Deixe o seguinte comentário em um PR do GitHub.

  ```
  Delete the attachment from S3 when the note is removed /oc
  ```

  O opencode implementará a alteração solicitada e a confirmará no mesmo PR.

- **Revisar linhas de código específicas**

  Deixe um comentário diretamente nas linhas de código na aba "Files" do PR. O opencode detecta automaticamente o arquivo, os números das linhas e o contexto do diff para fornecer respostas precisas.

  ```
  [Comentário em linhas específicas na aba Files]
  /oc add error handling here
  ```

  Ao comentar sobre linhas específicas, o opencode recebe:
  - O arquivo exato sendo revisado
  - As linhas específicas de código
  - O contexto do diff ao redor
  - Informações sobre números de linha

  Isso permite solicitações mais direcionadas sem precisar especificar caminhos de arquivos ou números de linhas manualmente.
