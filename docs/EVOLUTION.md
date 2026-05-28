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
