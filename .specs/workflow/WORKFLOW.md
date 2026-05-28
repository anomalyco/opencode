# WORKFLOW — `Simplicio-code`

Como `wesleysimplicio-team` move código de ideia até produção em `developer-tools`. Este documento é a fonte de verdade para branch strategy, PR rules, code review, deploy pipeline e hotfix. Stack: `monorepo`.

---

## 1. Branch Strategy

### Padrão: Trunk-Based Development

Branch única de longa vida: `main`. Tudo merge em `main` via PR pequeno e rápido. Releases saem de `main` via tag.

- `main` é sempre deployável. Build verde, testes passando, sem feature half-done exposta.
- Feature branches são **curtas** (vida média < 2 dias). Branch que dura semana = sinal de task mal quebrada.
- Feature flags isolam código incompleto que já foi merged. Nunca deixe feature half-done atrás de `if (false)`.
- Rebase em cima de `main` antes do merge. Histórico linear, sem merge commits ruidosos.

### Naming convention

```
feat/<short-desc>          # nova feature      ex: feat/login-magic-link
fix/<short-desc>           # bug fix           ex: fix/checkout-double-charge
chore/<short-desc>         # manutencao        ex: chore/bump-deps
refactor/<short-desc>      # refactor sem mudar comportamento
docs/<short-desc>          # so docs
hotfix/<short-desc>        # patch urgente em producao
release/<vX.Y.Z>           # branch de release (opcional, se git-flow)
```

`<short-desc>` em kebab-case, máximo 4 palavras, sem ticket id no nome (ticket vai no commit/PR).

### Alternativa: Git-Flow (quando usar)

Adote git-flow apenas se o projeto exige releases longas com hardening, ex: software embarcado, app mobile com review de loja, produto SaaS com janela de manutenção rigorosa. Branches: `main` (produção), `develop` (integração), `feature/*`, `release/*`, `hotfix/*`. Para `Simplicio-code` web/SaaS o padrão é trunk-based.

---

## 2. Pull Request Rules

### Tamanho

- **Alvo:** PR com até 400 linhas modificadas (sem contar lock files e gerados).
- PR > 600 linhas precisa justificativa explícita no corpo. Reviewer pode pedir split.
- **1 PR = 1 propósito.** Nada de "feat: login + refactor checkout + bump deps" no mesmo PR.

### Title

Conventional Commits no título. Exemplos reais:

```
feat(auth): add passkey login flow
fix(billing): handle 3DS retry on declined card
chore(ci): cache pnpm store between runs
docs(adr): add ADR-007 about cache layer
```

### Body (template em `.github/PULL_REQUEST_TEMPLATE.md`)

Toda PR contém:
- Link pra task em `.specs/sprints/sprint-XX/<id>.task.md` (ou issue).
- Resumo do que muda em 3-5 bullets.
- Screenshots/GIF se mexe em UI.
- Evidência E2E (link pro report Playwright).
- Checklist DoD (build, lint, unit, e2e, docs, changelog).
- Riscos e plano de rollback.

### Review

- **Mínimo 1 reviewer humano.** Nunca self-merge em `main` sem aprovação.
- PRs tocando segurança (auth, input externo, secrets, permissões) exigem 2 reviewers, sendo 1 com tag `security`.
- Bot review (CodeRabbit, Greptile, agent) é complementar, não substitui humano.
- Reviewer responde em até 4h úteis. SLA quebrado = feature freeze do reviewer.

---

## 3. Code Review Protocol

### Reviewer

- Lê task antes do diff. Sem contexto, comentário fica raso.
- Comenta no diff usando convenção:
  - `nit:` opinião estética, autor pode ignorar.
  - `q:` pergunta, espera resposta.
  - `req:` mudança bloqueante antes do merge.
  - `praise:` reforço positivo de padrão bom.
- Aprova com `LGTM` apenas quando todos `req:` resolvidos.
- Se ler ADR violado, abre `req:` linkando ADR.

### Autor

- Não merga com `req:` aberto.
- Push novo commit em vez de force-push enquanto review tá ativo (reviewer perde contexto se você reescreve história no meio).
- Após aprovação, pode `git rebase -i` pra squash local antes do merge.

### Merge

- **Squash and merge** é o padrão. Mensagem squash = title do PR + corpo enxuto.
- Branch é deletada automaticamente pós-merge (config do repo).
- Build pós-merge em `main` precisa ficar verde. Vermelho = revert imediato.

---

## 4. Deploy Pipeline

### Visão geral

```
push main -> GitHub Actions
  - lint (eslint/ruff/golangci-lint conforme monorepo)
  - unit tests (cobertura minima 80%)
  - build artifact (docker image, bundle, ou binario)
  - e2e Playwright (smoke contra preview env)
  - se tudo verde: deploy staging automatico
```

### Ambientes

| Ambiente | Branch/Tag | Trigger | URL |
|----------|------------|---------|-----|
| `dev` | qualquer PR | abrir/atualizar PR | preview-<pr>.Simplicio-code.dev |
| `staging` | `main` | merge em main | staging.Simplicio-code.io |
| `production` | tag `vX.Y.Z` | tag push manual | Simplicio-code.io |

### Deploy de produção

- Disparado por tag SemVer: `git tag v1.4.2 && git push origin v1.4.2`.
- Workflow `deploy-prod.yml` em `.github/workflows/` faz: build, push image, rollout, smoke test, notify Slack.
- Janela preferida: terça e quarta, manhã. Evitar sexta e véspera de feriado.
- Rollback automático se smoke test pós-deploy falhar (revert pra tag anterior).

### Feature flags

- Toda feature de impacto entra atrás de flag em `<flag-provider>` (LaunchDarkly, Unleash, custom).
- Liga primeiro pra `wesleysimplicio-team`, depois 5%, 25%, 100%.
- Flag tem dono e data de remoção. Flag órfã > 60 dias é tech debt e vai pro BACKLOG.

---

## 5. Hotfix Process

Use quando bug crítico em produção exige patch fora do ciclo normal.

### Critério

Hotfix só pra: data loss, security incident, downtime, breakage que afeta receita ou usuário externo. Bug cosmético não é hotfix, vai pelo fluxo normal.

### Passos

```bash
# 1. Branch a partir da tag de producao atual
git checkout v1.4.2
git checkout -b hotfix/payment-double-charge

# 2. Fix minimo. Sem refactor. Sem feature extra.
# 3. Teste regressivo cobrindo o bug
# 4. PR rotulado "hotfix" com aprovacao acelerada (1 reviewer, SLA 30min)

# 5. Merge squash em main
# 6. Tag patch SemVer
git tag v1.4.3
git push origin v1.4.3

# 7. Deploy automatico via workflow
# 8. Pos-incidente: postmortem em 48h em .specs/incidents/
```

### Pós-hotfix

- Postmortem blameless: o que falhou, como detectou, o que melhorar.
- Adicionar teste que teria pego o bug.
- Se falha veio de gap arquitetural, abrir ADR.
- Atualizar `CHANGELOG.md` com entrada `Fixed` na nova versão.

---

## 6. Branch protection settings

Configuração em GitHub do repo `Simplicio-code`:
- `main`: require PR, require 1 approval, require status checks (ci, dod, e2e), require linear history, dismiss stale reviews on push, no force-push, no delete.
- Tags `v*`: protected, only `wesleysimplicio-team` maintainers podem criar.

Esta configuração é versionada via Terraform/Pulumi em `infra/repo-settings/` quando o projeto cresce.
