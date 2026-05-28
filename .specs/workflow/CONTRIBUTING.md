# CONTRIBUTING — `Simplicio-code`

Guia step-by-step para adicionar uma feature, fix ou refactor em `Simplicio-code` (`developer-tools`, stack `monorepo`). Funciona pra humano e pra agent. Time: `wesleysimplicio-team`.

---

## Pré-requisitos

- Repo clonado, deps instaladas, build verde local.
- Leu `AGENTS.md` (raiz) e `.specs/architecture/PATTERNS.md`.
- Tem acesso a abrir PR e rodar CI.

---

## Fluxo padrão (8 passos)

### 1. Criar `task.md` em sprint atual

Toda mudança não-trivial nasce em `task.md`. Caminho:

```
.specs/sprints/sprint-XX/<id>-<short-desc>.task.md
```

Use `task-template.md` como base. Preencha:
- Contexto e problema.
- Acceptance Criteria testáveis (checkboxes).
- Out of scope explícito.
- Test plan (unit, integration, e2e).
- Definition of Done.
- Pegadinhas conhecidas e links.

Exemplo: `.specs/sprints/sprint-03/12-magic-link-login.task.md`.

> Mudança trivial (typo em string, bump patch sem risco, formatação) pode pular task. Mas qualquer coisa que toque comportamento, schema ou UX exige task.

### 2. Criar branch

A partir de `main` atualizada:

```bash
git checkout main
git pull --rebase origin main
git checkout -b feat/magic-link-login
```

Convenção de nome em `WORKFLOW.md` seção 1.

### 3. Implementar seguindo PATTERNS

- **Não invente padrão novo.** Se `.specs/architecture/PATTERNS.md` define como criar endpoint, componente, teste, hook, repository, siga.
- Mudou padrão? Abra ADR antes (`.specs/architecture/ADR-template.md`).
- Não adicione dependência sem confirmar com `wesleysimplicio-team` (perde aprovação técnica e onera bundle/manutenção).
- Edite só o pedido. Sem refactor oportunista. Refactor é PR separado.

### 4. Testes (unit + e2e)

Antes do PR, todo verde local:

```bash
# stack-agnostic - substitua pelo comando real do monorepo
npm run lint
npm run test           # unit + integration, cobertura >= 80%
npm run test:e2e       # Playwright contra ambiente local
```

- Bug fix sem teste regressivo é **inaceitável**. Escreva teste que falha sem o fix.
- E2E tem evidência: trace, screenshot, video em `test-results/`.
- Cobertura caiu? Justifica no PR ou adiciona teste.

### 5. Abrir PR usando template

Push e abre PR via gh:

```bash
git push -u origin feat/magic-link-login
gh pr create --fill --web
```

Template em `.github/PULL_REQUEST_TEMPLATE.md` é preenchido automático. Complete:
- Link para `task.md`.
- Resumo (3-5 bullets).
- Screenshots/GIF se UI.
- Link pro report E2E (artifact CI).
- Checklist DoD marcada.
- Riscos e rollback.

Title segue Conventional Commits: `feat(auth): add magic link login`.

### 6. Review

- CI verde é pré-requisito. PR com vermelho não vai pra review.
- Reviewer humano em até 4h úteis. PR de hotfix tem SLA 30min.
- Endereça todos `req:` antes de pedir re-review.
- Discussão de design vai no diff. Discussão de arquitetura ampla vira ADR.

### 7. Merge squash

Após aprovação:

```bash
gh pr merge --squash --delete-branch
```

Mensagem squash = title do PR. Histórico de `main` fica linear e legível.

### 8. Deploy

- Merge em `main` dispara `deploy-staging.yml` automaticamente.
- Verifica smoke em staging (link no Slack pós-deploy).
- Para produção: bump versão e tag SemVer (ver `RELEASE.md`).
- Para mudanças **release-relevant** neste repositório, o padrão é fechar tudo no mesmo ciclo: npm publicado, tag GitHub criada, GitHub Release correspondente e `main` limpa/sincronizada.

### 9. Fechamento release-relevant neste repositório

Antes de considerar o trabalho encerrado, executar:

```bash
npm run lint
npm test
npm run docs:build
npm run test:e2e -- --reporter=list,html
```

Se tudo estiver verde:

```bash
# version + lockfile
npm install --package-lock-only

# publish
npm publish --access public

# tag + release
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <release-notes-file>
```

Objetivo: evitar divergência entre `package.json`, npm, tags, releases e `main`.

---

## Skills/Agents que você pode usar

Skills e agents reduzem trabalho repetitivo e enforçam padrão. Ver `.skills/` no repo.

### Skills disponíveis (em `.skills/`)

| Skill | Quando trigar | Caminho |
|-------|---------------|---------|
| `playwright-e2e` | Escrever ou ajustar teste E2E. Já tem fixtures, page objects, evidências configuradas. | `.skills/playwright-e2e/SKILL.md` |
| `conventional-commits` | Compor mensagem de commit ou title de PR. Cobre `feat`, `fix`, `chore`, breaking change. | `.skills/conventional-commits/SKILL.md` |
| `_template` | Criar nova skill pro projeto. Ponto de partida com frontmatter e seções. | `.skills/_template/SKILL.md` |

### Agents customizados (em `.agents/`)

| Agent | Uso |
|-------|-----|
| `ralph-loop.agent.md` | **Executor autônomo padrão.** Loop `read → plan → execute → lint → unit → Playwright (com evidência) → fix → repeat` até DoD verde. Aciona em toda task técnica. |
| `tdd.agent.md` | TDD specialist. Escreve teste falhando, depois código. Loop red-green-refactor. |
| `reviewer.agent.md` | Code review sem editar. Comenta padrões, sugere melhorias, valida ADRs. |
| `architect.agent.md` | Desenha arquitetura, cria ADRs, não escreve código de produção. |

> `.agents/` é a fonte canônica (padrão AGENTS.md ecosystem). Espelhado em `.github/copilot/agents/` para o GitHub Copilot Workspace. Detalhes em [`.agents/README.md`](../../.agents/README.md).

### Como invocar

- Em Claude Code: `Skill(playwright-e2e)` ou referencia em prompt.
- Em Copilot Agent Mode: seleciona agent custom no chat.
- Skills com trigger explícito tem prefixo `$skill-name` em comentário ou prompt.

---

## Checklist rápido antes do PR

- [ ] `task.md` criado e linkado.
- [ ] Branch nome segue convenção.
- [ ] Build, lint, unit, e2e verdes local.
- [ ] Cobertura >= 80% (ou justificativa no PR).
- [ ] PATTERNS.md respeitado, ou ADR aberta.
- [ ] Sem dependência nova não-aprovada.
- [ ] PR title em Conventional Commits.
- [ ] Template de PR preenchido com evidências.
- [ ] Sem secrets em diff (`git diff | grep -i 'secret\|token\|key'`).
- [ ] CHANGELOG atualizado se mudança visível ao usuário.

---

## Erros comuns (não faça)

- Branch que vive 2 semanas: quebra task em pedaços menores.
- PR de 2000 linhas com "vários ajustes": split.
- Test que mocka tudo e não roda lógica real: falso verde.
- Mudar padrão sem ADR: dívida invisível.
- Force-push em branch de PR aberto: reviewer perde contexto.
- Merge com CI vermelho: bloqueia o time inteiro depois.
- Esquecer de remover feature flag concluída: lixo composto.

Em dúvida, pergunte em `wesleysimplicio-team` antes de abrir PR. Custo de pergunta < custo de revert.
