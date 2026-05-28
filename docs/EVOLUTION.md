# Evolução SimplicioCode — Registro Item a Item

> Documento canônico de evolução. Cada modificação é registrada em ordem cronológica
> com data, escopo, status e arquivos tocados. Anexar aqui qualquer mudança futura.

## Sumário dos Requisitos (origem: sessão 2026-05-28)

| # | Issue | Requisito | Status |
|---|-------|-----------|--------|
| R1 | [#3](https://github.com/wesleysimplicio/Simplicio-code/issues/3) | Mapeamento do projeto com `simplicio-mapper` antes de programar | EM ANDAMENTO |
| R2 | [#4](https://github.com/wesleysimplicio/Simplicio-code/issues/4) | Programar sempre com `simplicio-dev-cli` (pip `simplicio-cli`) | EM ANDAMENTO |
| R3 | [#5](https://github.com/wesleysimplicio/Simplicio-code/issues/5) | Menu **Sprints** espelhando Jira/Azure/GitHub Issues via `simplicio-sprint` | EM ANDAMENTO |
| R4 | [#6](https://github.com/wesleysimplicio/Simplicio-code/issues/6) | IA local obrigatória **Qwen 2.5 Coder 3B** apelidada **Simplicio1**, gratuita, sem limite de tokens | EM ANDAMENTO |
| R5 | [#7](https://github.com/wesleysimplicio/Simplicio-code/issues/7) | Renomear **OpenCode → SimplicioCode** em todo o repositório | EM ANDAMENTO |
| R6 | [#8](https://github.com/wesleysimplicio/Simplicio-code/issues/8) | Cron diário às **10:00** e **17:30** para verificar atualizações das ferramentas Simplicio | EM ANDAMENTO |
| R7 | [#9](https://github.com/wesleysimplicio/Simplicio-code/issues/9) | Modo CLI sempre executa o mesmo fluxo (mapper → dev-cli → sprint quando aplicável) | EM ANDAMENTO |
| R8 | [#10](https://github.com/wesleysimplicio/Simplicio-code/issues/10) | Simplicio1 = família com auto-seleção (Qwen 1.5B/3B/7B/14B + DeepSeek V4 Pro via HF, budget US$5) | EM ANDAMENTO |
| R9 | [#11](https://github.com/wesleysimplicio/Simplicio-code/issues/11) | (Substituída por R10) Plano único US$20 com Auto-Sprints | SUPERSEDED |
| R10 | [#12](https://github.com/wesleysimplicio/Simplicio-code/issues/12) | SimplicioCode SaaS fechado — Free / Plus($20) / Pro($50) + Stripe + segurança JWT | EM ANDAMENTO |

Issue mestre: [#2](https://github.com/wesleysimplicio/Simplicio-code/issues/2).

## Repositórios upstream (sempre instalar a última versão)

| Repo | Pacote | Linguagem | Como atualizar |
|------|--------|-----------|----------------|
| `wesleysimplicio/simplicio-mapper` | `@wesleysimplicio/llm-project-mapper` | Node/JS (npx) | `npx -y @wesleysimplicio/llm-project-mapper@latest` |
| `wesleysimplicio/simplicio-dev-cli` | `simplicio-cli` | Python | `pip install -U simplicio-cli` |
| `wesleysimplicio/simplicio-sprint` | `simplicio-sprint` | Python | `pip install -U simplicio-sprint` |
| `wesleysimplicio/simplicio-prompt` | `simplicio-prompt` | Python | `pip install -U simplicio-prompt` |

## IA Local — Simplicio1 (Qwen 2.5 Coder 3B)

- Provider: **Ollama** (`http://localhost:11434/v1`, OpenAI-compatible)
- Modelo upstream: `qwen2.5-coder:3b`
- Alias exposto no SimplicioCode: **`Simplicio1`**
- Política: gratuita, sem limite de tokens, default quando nenhuma chave de provider remoto está configurada
- Bootstrap: `ollama pull qwen2.5-coder:3b` (executado pelo script `script/simplicio/install-tools.sh`)

## Fluxo CLI obrigatório

Toda invocação CLI segue o pipeline:

1. **map**  → `simplicio map` (gera `.simplicio/project-map.json`)
2. **task** → `simplicio task "<descrição>"` (executa contrato de 6 camadas; usa Simplicio1 por padrão)
3. **sprint** (quando há issue/sprint vinculado) → `sendsprint run`

O wrapper `script/simplicio/flow.sh` aplica esse fluxo de forma idempotente.

## Cron diário

Como o ambiente de execução remoto é efêmero, o cron real é implementado via:

- **GitHub Actions** (`.github/workflows/simplicio-update.yml`) com `schedule: cron`
  - `0 13 * * *` (10:00 BRT = 13:00 UTC)
  - `30 20 * * *` (17:30 BRT = 20:30 UTC)
- **systemd timer** opcional para hosts locais (`infra/simplicio-update.timer`)

Ambos chamam `script/simplicio/update.sh`.

---

## Changelog cronológico

### 2026-05-28 — Setup inicial (este commit)

Branch: `claude/simplicio-setup-config-9PXIm`

- **docs/EVOLUTION.md** — criado este documento (rastreio item a item).
- **.simplicio/config.json** — configuração canônica das ferramentas Simplicio (mapper, dev-cli, sprint, Simplicio1).
- **script/simplicio/install-tools.sh** — instala/atualiza simplicio-mapper, simplicio-cli, simplicio-sprint, simplicio-prompt e baixa modelo Qwen via Ollama.
- **script/simplicio/update.sh** — verifica e atualiza para últimas versões (chamado pelo cron).
- **script/simplicio/flow.sh** — wrapper CLI canônico (map → task → sprint).
- **.opencode/command/sprint.md** — comando slash `/sprint` que aciona o menu de Sprints espelho do Jira/Azure/GitHub via simplicio-sprint.
- **.opencode/command/map.md** — comando `/map` para rodar o mapeamento via simplicio-mapper.
- **.opencode/command/simplicio.md** — comando `/simplicio <task>` que aciona simplicio-cli com Simplicio1 como provider default.
- **.github/workflows/simplicio-update.yml** — cron diário 10:00 e 17:30 BRT.
- **docs/RENAME_PLAN.md** — plano detalhado da renomeação OpenCode→SimplicioCode (a executar em commits seguintes para manter o diff revisável).
- **README.md** — adicionado bloco "SimplicioCode" no topo apontando para este documento de evolução.

### 2026-05-28 — Issues criadas para rastreio item a item

Branch: `claude/simplicio-setup-config-9PXIm`

- Habilitada a feature Issues no repositório.
- Criada issue mestre [#2](https://github.com/wesleysimplicio/Simplicio-code/issues/2) com checklist R1–R7.
- Criadas 7 sub-issues: [#3](https://github.com/wesleysimplicio/Simplicio-code/issues/3) R1, [#4](https://github.com/wesleysimplicio/Simplicio-code/issues/4) R2, [#5](https://github.com/wesleysimplicio/Simplicio-code/issues/5) R3, [#6](https://github.com/wesleysimplicio/Simplicio-code/issues/6) R4, [#7](https://github.com/wesleysimplicio/Simplicio-code/issues/7) R5, [#8](https://github.com/wesleysimplicio/Simplicio-code/issues/8) R6, [#9](https://github.com/wesleysimplicio/Simplicio-code/issues/9) R7.
- Cada sub-issue contém: objetivo, repo upstream, estado atual (o que já entrou no PR #1), pendências e critério de aceite.
- Sub-issues linkadas via `sub_issue_write` à mestre para hierarquia nativa do GitHub.
- `docs/EVOLUTION.md`: tabela de requisitos passou a referenciar as issues.

Resultado: PARCIAL — issues abertas e rastreáveis; trabalho a partir daqui sempre referencia a sub-issue correspondente via `Refs #N` ou `Closes #N`.

### 2026-05-28 — Smoke real da toolchain + correções de CLI

Branch: `claude/simplicio-setup-config-9PXIm`

**Toolchain instalada e testada neste container:**
- `npx -y @wesleysimplicio/llm-project-mapper@latest` → **v0.3.2** ✅
- `pip install --user simplicio-cli simplicio-sprint simplicio-prompt` → instalado em `~/.local/bin/` ✅
- `simplicio --help` → comandos disponíveis: `index | task | bench | smoke | init | detect` ✅
- `sendsprint version` → **3.0.0** ✅

**Bugs descobertos no PR original (corrigidos neste commit):**

1. **Mapper não tem subcomando `map`** — o README upstream estava desatualizado. CLI real: `npx @wesleysimplicio/llm-project-mapper --yes` (binário invocado sem subcomando = o map em si).
   - `script/simplicio/flow.sh` corrigido (chamada direta + `--no-update-check --cli skip --append-gitignore no --skip-meta`).
   - `.opencode/command/map.md` atualizado.

2. **`sendsprint run` recebe `<source> <sprint>` posicionais** — não `--issue <ID>` como eu havia documentado. Assinatura real: `sendsprint run jira|azuredevops|github <sprint-id> --repo <path>`.
   - `script/simplicio/flow.sh --sprint` corrigido.
   - `.opencode/command/sprint.md` atualizado.

3. `flow.sh` agora exporta `PATH="$HOME/.local/bin:$PATH"` para encontrar `simplicio`/`sendsprint` instalados via pip user.

**Mapper executado pela primeira vez no repo (artefatos commitados):**
- `.specs/` — backlog, sprint board, product/architecture/workflow docs (também serve a R3).
- `.agents/`, `.codex/`, `.skills/`, `.claude/` — dirs de instruções para múltiplos agents.
- `CLAUDE.md`, `INIT.md` — arquivos de bootstrap para agents.
- `docs/architecture-map.md`, `docs/domain-map.md`, `docs/local-setup.md`, `docs/troubleshooting.md`, `docs/evidence/`, `docs/features/`.

**Removidos por conflito com a infra existente:**
- `tests/` (raiz) — havia colisão com testes per-package.
- `scripts/` (raiz) — duplicava o `script/` já existente (singular).
- `playwright.config.ts` (raiz) — já existe `packages/app/playwright.config.ts`.
- `bootstrap.sh`, `bootstrap.ps1`, `_BOOTSTRAP.md`, `INSTALL.md`, `README.pt-BR.md` — material de bootstrap para repos greenfield.

**Validação:** `bash script/simplicio/flow.sh --map-only` rodou com `exit=0`.

Resultado: PARCIAL — toolchain real validada, flow corrigido. Ainda pendente: smoke do `simplicio task` (precisa de Ollama rodando) e `sendsprint run` (precisa credenciais Jira/ADO ou milestone GH real).

### 2026-05-28 — R5 Fases 1+2 + scripts npm + board Sprints MVP

Branch: `claude/simplicio-setup-config-9PXIm`. Commit: `9e2e020`.

**R5 Fase 1 concluída** (visíveis-only):
- 21 variantes `README.??.md` agora têm banner SimplicioCode no topo (alt texts já trocados em commit anterior).
- `CONTRIBUTING.md`, `SECURITY.md`, `STATS.md` headers rebranded.

**R5 Fase 2 concluída** (pacote npm renomeado + alias):
- `packages/opencode/package.json#name`: `opencode` → `simpliciocode`.
- `bin`: agora expõe `simpliciocode` E o legado `opencode` (compat de 1 release).
- `packages/web/package.json` dep: `opencode` → `simpliciocode`.
- 5 imports em `packages/web/src` atualizados para `from "simpliciocode/..."`.
- `bun.lock` regenerado com sucesso.
- `bun --cwd packages/opencode typecheck` → **PASS** (clean).
- `bun astro check` em `packages/web` → 20 erros, todos pré-existentes (confirmado via stash + retest).

**Scripts npm visíveis** (R7):
- `bun run simplicio:bootstrap` → instala toolchain + roda map.
- `bun run simplicio:update` → idem ao cron diário.
- `bun run simplicio:task "<desc>"` → atalho do flow.
- `bun run sprints` → board ASCII unificado Jira/ADO/GitHub/local.

**R3 MVP board** (`script/simplicio/sprints.sh`):
- Lê `.simplicio/config.json` e detecta credenciais (`JIRA_*`, `AZDO_*`).
- Renderiza colunas TO DO / IN PROGRESS / REVIEW / DONE.
- Modos: `local | github | jira | azuredevops | all` (default).
- Aponta para `flow.sh --sprint` para entregar cards.

**`.specs/sprints/sprint-01/SPRINT.md`** atualizado com o board real de R1–R7 ligado às issues #3–#9.

Resultado: PARCIAL avançado — Fase 2 do rename validada via typecheck. Falta Fases 3–5 (dirs, imports profundos, URLs).

### 2026-05-28 — R8 (família de modelos) + R9 (plano Pro) abertas

Branch: `claude/simplicio-setup-config-9PXIm`.

**Novos requisitos do usuário:**
- **R8 (#10)**: Simplicio1 deixa de ser um único modelo e vira uma **família com auto-seleção** baseada em RAM/saldo HF.
  - 5 tiers: 1.5B / 3B / 7B / 14B (Qwen local) + DeepSeek V4 Pro (HF, budget US$5).
  - Quando saldo HF acaba, cai automaticamente para o maior Qwen que a máquina aguenta.
- **R9 (#11)**: Assinatura Pro US$20/mês — tokens ilimitados em modelos premium + **Auto-Sprints** (sendsprint watch 24/7) exclusivo para pagantes.

**Configuração materializada agora:**
- `.simplicio/config.json` → `localAi.tiers[]` com 5 entradas + `localAi.autoSelect: true` + bloco `subscription.{free,pro}`.
- `.opencode/opencode.jsonc` → providers `ollama` (4 modelos Qwen) e `huggingface` (DeepSeek V4 Pro) registrados.
- Issues #10 e #11 linkadas como sub-issues de #2.

**Falta (em PRs futuros):**
- [ ] Lógica de detecção de RAM em `packages/opencode/src/provider/`.
- [ ] Tracker de saldo HF (consumindo `https://huggingface.co/api/billing/usage`).
- [ ] Gateway/billing para o plano Pro (#11).
- [ ] Feature flag bloqueando `sendsprint watch` para usuários free.

### 2026-05-28 — R5 Fases 3+4+5 + lógica Simplicio1 com testes

Branch: `claude/simplicio-setup-config-9PXIm`. Commits: `51f6d63`, `bee9821`, `592c127`, `<próximo>`.

**R5 Fase 3** (`51f6d63`): `git mv packages/opencode → packages/simpliciocode` + 20 arquivos com paths atualizados. Typecheck PASS.

**R5 Fase 4** (`bee9821`): scope `@opencode-ai/*` → `@simpliciocode/*` em **789 arquivos**. `bun turbo typecheck` → **19/19 packages PASS** em 31s.

**R5 Fase 5** (`592c127`): URLs `anomalyco/opencode` → `wesleysimplicio/simplicio-code` em 84 arquivos. `nix/opencode.nix` → `nix/simpliciocode.nix` com `pname=simpliciocode`. `flake.nix` atualizado. Domínio `opencode.ai` mantido (aguarda decisão).

**R8 lógica Simplicio1** (`<próximo>`):
- Novo `packages/simpliciocode/src/provider/simplicio1.ts` com `selectTier()`:
  - Override manual via env `SIMPLICIO_MODEL_TIER`.
  - Prefere DeepSeek V4 Pro quando `HF_TOKEN` setado e saldo ≥ $0.10.
  - Fallback ordenado: 14B → 7B → 3B → 1.5B conforme `os.totalmem()`.
- Testes: `packages/simpliciocode/test/provider/simplicio1.test.ts` — **9/9 PASS**.

Resultado: R5 efetivamente fechada (exceto domínio); R8 com lógica real + tests.

### 2026-05-28 — Provider "Simplicio1" + Stripe (R9) + plan gating

Branch: `claude/simplicio-setup-config-9PXIm`. Commit: `<próximo>`.

**Decisões aplicadas (input do usuário):**
- Domínio: mantém `opencode.ai` por enquanto (fica em aberto em R5).
- Ollama: deixa de ser exposto como "ollama"; vira backend transparente do nosso provider **`simplicio1`** (com o variante **`simplicio1-pro`** para o HF/DeepSeek).
- Billing: **Stripe** confirmado.

**Mudanças:**
- `.opencode/opencode.jsonc`: providers renomeados → `simplicio1` (ollama backend) + `simplicio1-pro` (HF backend). Usuário nunca vê "ollama" no seletor.
- `.simplicio/config.json#localAi.tiers[]`: cada tier ganha `provider` (label voltado ao usuário) + `backend` (engine interno).
- `.simplicio/config.json#subscription.billing`: bloco Stripe com envs `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO` e URLs de success/cancel.
- `packages/simpliciocode/src/billing/stripe.ts`: cliente Stripe sem SDK — `createCheckoutSession`, `subscriptionStatus`, `verifyWebhook` com HMAC SHA-256 nativo.
- `packages/simpliciocode/src/billing/gate.ts`: `capabilities(plan)`, `requirePro(plan, feature)`, `ProRequiredError`, `resolvePlan({ lookup })`.
- `packages/simpliciocode/test/billing/gate.test.ts`: **10 testes** (capabilities free/pro, require throw/no-throw, mensagem de upgrade, override `SIMPLICIO_PLAN`, lookup status).

**Validação:**
- `bun --cwd packages/simpliciocode typecheck` → PASS clean.
- `bun test` em billing + provider → **19/19 PASS** em 1.4s.

Resultado: R9 saiu de scaffold para implementação real (~50% — falta apenas wirar `requirePro("autoSprintWatcher")` no `sendsprint watch` e o endpoint `/billing/checkout`).

### 2026-05-28 — R10 (3 tiers + segurança JWT) substitui R9

Branch: `claude/simplicio-setup-config-9PXIm`.

**Decisão do usuário:**
- SimplicioCode = **projeto fechado**, concorrente do Cursor.
- 3 tiers:
  - **Free** US$0 — só app, Simplicio1 local (Qwen).
  - **Plus** US$20/mo — tokens infinitos + Simplicio1 (local + Pro remoto).
  - **Pro** US$50/mo — tudo do Plus + Auto-Sprints (`sendsprint watch`).
- **Segurança**: cada usuário deve ter subscription Stripe ativa, verificada via JWT assinado pelo backend.

**Materializado:**
- `packages/simpliciocode/src/billing/gate.ts` reescrito:
  - `Plan = "free" | "plus" | "pro"`.
  - `capabilities()` com 4 features (`remoteModels`, `unlimitedTokens`, `autoSprintWatcher`, `manualSprintRun`).
  - `requireFeature(plan, feature)` indica menor plan exigido na mensagem de erro.
  - `verifyJwt(token, secret)` com HMAC SHA-256 via WebCrypto; rejeita exp/sig/plan inválidos.
  - `resolvePlan({ jwt, jwtSecret, enforce })` honra JWT verificado; `SIMPLICIO_PLAN` env só funciona fora de produção (`NODE_ENV=production + SIMPLICIO_ENFORCE=1` bloqueia o bypass).
- `packages/simpliciocode/test/billing/gate.test.ts` reescrito com **15 testes** (capabilities por tier, requireFeature, verifyJwt com HMAC real, expiry, plan invalido, override env).
- `.simplicio/config.json#subscription` ganha blocos `free/plus/pro` + `security.jwt*Env` + `billing.priceIdPlusEnv`.
- `script/simplicio/plan.ts` mostra Plan + capabilities + upgrade path; aceita `--jwt $TOKEN --secret $SECRET`.
- `bun run simplicio:plan` adicionado ao package.json.

**Validação:**
- `bun test test/billing/gate.test.ts test/provider/simplicio1.test.ts` → **24/24 PASS** em 1.4s.

Resultado: R10 ~60% — falta o backend de auth (login/OTP/JWT signing) e a integração no `sendsprint watch`.

### Pendências para próximos commits

- [ ] R5 — rename OpenCode→SimplicioCode (em fases, ver `docs/RENAME_PLAN.md`):
  - [ ] Fase 1: strings de display/marketing (README, package.json `description`)
  - [ ] Fase 2: nome do pacote `opencode` → `simpliciocode` (breaking, requer atualização de imports)
  - [ ] Fase 3: diretório `packages/opencode` → `packages/simpliciocode` + workspace
  - [ ] Fase 4: `.opencode/` → `.simpliciocode/` (com symlink temporário de compat)
  - [ ] Fase 5: domínios/URLs (`opencode.ai` → manter via aliases até decisão de domínio)
- [ ] R4 — registrar Simplicio1 como provider default em `packages/llm/src` e no resolver de modelos
- [ ] R3 — view nativa do menu Sprints na TUI (atual: comando slash; próximo: painel dedicado)
- [ ] R7 — hook `SessionStart` validando que o fluxo foi inicializado

---

## Convenção para entradas futuras

Cada entrada deve conter:

```
### YYYY-MM-DD — <título curto>
Branch: <branch>
Commit: <sha curto se aplicável>

- <arquivo> — <o que mudou e por quê>
- ...
Resultado: <PASS/FAIL/PARCIAL> — <observação>
```
