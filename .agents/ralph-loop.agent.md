---
name: Ralph Loop
description: Padrão de loop autônomo (Ralph Wiggum technique). Roda agent repetidamente — read → plan → execute → lint → unit → Playwright (com evidência) → fix → repeat — até DoD verde. Mapeia para comando nativo de cada ferramenta (Claude Code, Codex CLI, GitHub Copilot, Cursor, Aider). Aciona em qualquer task técnica com acceptance criteria mensurável.
tools: [edit, terminal, search]
---

# Ralph Loop

**Padrão** (não um agent customizado isolado) de execução autônoma. A técnica originalmente foi descrita por Geoffrey Huntley como **Ralph Wiggum technique** — um simples `while true` que realimenta o agent com a mesma prompt + contexto preservado em arquivos/git/testes até a tarefa estar 100% verde. OpenAI adotou oficialmente o padrão e nomeou o comando `/goal` como "Ralph Loop" interno. Anthropic publicou plugin oficial. GitHub publicou modo `--autopilot`.

Este arquivo é a **especificação do padrão** neste repo + **mapa de invocação por ferramenta**.

---

## Quando esse pattern ativa

- Toda task técnica com `acceptance criteria` testável em `.specs/sprints/sprint-XX/<id>.task.md`.
- Bugfix com reprodução conhecida (vira regression test + correção).
- Refactor com cobertura existente (loop garante que nada quebra).
- Feature web/UI/fluxo end-to-end (loop **inclui Playwright obrigatório com evidência**).
- Migrations de schema/dado com rollback testado.
- Sempre que humano pedir "executa essa task até verde" / "roda o loop" / "fecha essa task".

---

## Loop OBRIGATÓRIO (semântica)

```
┌──────────────────────────────────────────────────────────────┐
│  1. READ      → abre task.md, lê AC + test plan + DoD        │
│  2. PLAN      → plano interno: arquivos, mudanças, riscos    │
│  3. CONTEXT   → carrega PATTERNS.md + ADRs + skills          │
│  4. EXECUTE   → edits cirúrgicos, só o que a task pede       │
│  5. LINT      → npm run lint (ou equivalente da stack)       │
│  6. UNIT      → npm test --coverage (gate >= 80%)            │
│  7. E2E       → npx playwright test --reporter=list,html     │
│                 EVIDÊNCIA OBRIGATÓRIA: trace + screenshot     │
│                 + video em playwright-report/                 │
│  8. VERIFY    → DoD checklist 100% marcado                    │
│  9. FIX-LOOP  → algum vermelho? volta passo 4. repete.       │
│ 10. COMMIT    → conventional commit em inglês                 │
│ 11. PR        → gh pr create --fill com evidências anexadas  │
└──────────────────────────────────────────────────────────────┘
```

Sem pular etapa. Sem "bom o suficiente". Sem `--no-verify`. Sem `xit`/`skip`/`fixme` deixado pra trás. Cada ferramenta abaixo implementa esse loop com sua sintaxe nativa.

---

## Mapa de invocação por ferramenta

| Ferramenta | Comando nativo | Notas |
|---|---|---|
| **Claude Code** | `/ralph-loop "<prompt>" --max-iterations 10 --completion-promise "DONE"` | Plugin oficial. `/cancel-ralph` cancela. Stop hook re-feeds prompt entre iterações preservando git+files. Install: `/plugin install ralph-loop@claude-plugins-official` |
| **Codex CLI** (≥ 0.128.0) | `/goal <objective>` | Built-in. Loop persistente self-evaluating até budget exhausted ou goal met. `goals = true` em `[features]` no `config.toml` ou via `/experimental`. Subcomandos: `/goal pause`, `/goal resume`, `/goal clear`. OpenAI chama internamente de "Ralph Loop". |
| **GitHub Copilot CLI** | `copilot --autopilot --yolo --max-autopilot-continues 10 -p "<prompt>"` | Modo autopilot oficial. Stop conditions: task complete, blocking problem, manual interrupt, `--max-autopilot-continues`. Em sessão interativa: `Shift+Tab` cicla modos. |
| **GitHub Copilot (VS Code Agent Mode)** | Agent mode → permission level **Autopilot** | UI dropdown. Continuous iteration: agent itera respondendo lint/test/erro até task complete. Combine com plan mode antes pra ter spec. |
| **Cursor** (≥ 3.0) | Background Agent | Async, multi-repo, parallel. `/multitask` (3.2+) spawna sub-agents em paralelo. Cursor Automations dispara por evento (Slack, Linear, PR merge, PagerDuty). |
| **Aider** | Bash wrapper Ralph script | Sem comando nativo. Use `while`-loop chamando `aider --message "$(cat prompt.md)" --auto-commits` até flag de completion em arquivo. |
| **Hermes / OpenClaw** | Bash wrapper Ralph script | Sem comando nativo. Mesma técnica do Aider — script externo orquestra iterações. |
| **Genérico (snarktank/ralph, iannuttall/ralph)** | `ralph` CLI | Implementação portátil. PRD-driven: loop até `<promise>COMPLETE</promise>`. Memória via git history + `progress.txt` + `prd.json`. |

### Argumentos comuns (mesma semântica entre ferramentas)

- **Iterações máximas** — cap de segurança contra loop infinito improdutivo. Padrão: 10–20.
- **Completion promise / goal verificável** — string ou critério que o agent deve emitir/cumprir pra parar (`DONE`, `<promise>COMPLETE</promise>`, todos os AC marcados).
- **Auto-approve** — `--yolo`, `--allow-all`, sandbox=full em Codex. Use só em worktree isolado / sandbox.
- **Iteração com contexto fresco** — chave do Ralph: cada iteração começa limpa, progresso persiste em arquivos/git, não na memória de chat.

---

## Playwright OBRIGATÓRIO em toda task

Hard rule: **toda task que toca código de aplicação roda Playwright antes do commit**. Mesmo task de backend puro: spec mínimo verifica que a aplicação sobe e endpoint responde. Mesmo task de doc: smoke test de build/serve. Mesmo task de migration: roda app + verifica fluxo crítico.

### Cenários mínimos por task

1. **Caminho feliz** — fluxo principal da feature/fix.
2. **Erro esperado** — input inválido, 4xx/5xx, sessão expirada.
3. **Estado de auth** — anônimo vs logado vs sem permissão (se aplicável).
4. **Viewport** — mobile 375px + desktop 1280px (se UI).
5. **Edge case do review** — race condition, cache stale, CSRF, etc.

### Evidência obrigatória (anexar no PR)

- `playwright-report/index.html` (HTML report do último run verde)
- `test-results/<spec>/trace.zip` (trace zip do caminho feliz)
- Screenshot do estado final de cada cenário em `test-results/<spec>/<scenario>.png`
- Video em `test-results/<spec>/video.webm` (config: `video: 'on-first-retry'` ou `'retain-on-failure'`)

Sem evidência = task não fechada. Sem exceção. CI bloqueia merge via `.github/workflows/dod.yml`.

### Comandos de evidência

```bash
# rodar suite E2E completa
npx playwright test --reporter=list,html

# rodar so o spec da feature
npx playwright test tests/e2e/<feature>.spec.ts

# abrir report
npx playwright show-report

# inspecionar trace
npx playwright show-trace test-results/<spec>/trace.zip
```

---

## O que o loop faz (qualquer ferramenta)

1. **Lê task** — abre `.specs/sprints/sprint-XX/<id>.task.md`. Extrai AC, test plan, DoD.
2. **Planeja interno** — lista arquivos, mudanças, ordem, riscos. Se ambíguo: pergunta antes de codar (única exceção do loop).
3. **Carrega contexto** — `.specs/architecture/PATTERNS.md` + ADRs relevantes + `.skills/<applicable>/SKILL.md`.
4. **Executa cirúrgico** — só toca o pedido. Sem refactor extra. Sem renomeação. Sem reformat.
5. **Valida em ordem**: lint → unit (cov >= 80%) → Playwright (com evidência).
6. **Fix loop autônomo** — qualquer vermelho: re-planeja a sub-correção, edita, re-valida. Loop até verde.
7. **Verifica DoD** — checklist `.specs/sprints/sprint-XX/<id>.task.md` 100% marcado.
8. **Commit conventional** — `feat:` / `fix:` / `refactor:` / `test:` em inglês, body explica *why*.
9. **Abre PR** — `gh pr create --fill` + cola screenshots + link do report E2E + checklist DoD marcado.
10. **Loga** — atualiza `.specs/journal/` se houver decisão / aprendizado novo.

---

## O que o loop NÃO faz

- **Não pula Playwright** — nem em "task pequena". Smoke test sempre roda.
- **Não comita com vermelho** — hook `pre-commit` bloqueia, mas agent nem chega lá.
- **Não usa `--no-verify`** / `--force-with-lease` / `git push -f` em main.
- **Não adiciona dependência sem perguntar** — `npm install <x>`, `dotnet add <pkg>` exige confirmação humana.
- **Não inventa padrão** — se `PATTERNS.md` não cobre, abre ADR antes.
- **Não esconde flaky** — teste intermitente vira issue + `test.fixme` documentado, não `skip` silencioso.
- **Não fecha task com TODO órfão** — TODO sem dono e prazo bloqueia DoD.

---

## Exemplos de invocação

### Claude Code (este repo)

```bash
# instalar plugin (uma vez por máquina)
/plugin install ralph-loop@claude-plugins-official

# rodar loop em uma task
/ralph-loop "Fechar task .specs/sprints/sprint-01/01-magic-link-login.task.md respeitando DoD e gerando evidência Playwright" --max-iterations 15 --completion-promise "DONE"

# cancelar
/cancel-ralph
```

### Codex CLI (≥ 0.128.0)

```bash
# habilitar feature (uma vez)
echo -e "[features]\ngoals = true" >> ~/.codex/config.toml

# definir goal
codex
> /goal Fechar task .specs/sprints/sprint-01/01-magic-link-login.task.md com lint+unit+e2e verde + AC todos marcados + evidência em playwright-report/

# pausa / retoma / limpa
> /goal pause
> /goal resume
> /goal clear
```

### GitHub Copilot CLI

```bash
copilot --autopilot --yolo --max-autopilot-continues 20 \
  -p "$(cat <<'EOF'
Fechar task .specs/sprints/sprint-01/01-magic-link-login.task.md.
Loop até DoD verde: lint, unit (cov>=80%), playwright (trace+screenshot+video em playwright-report/+test-results/), AC marcados, conventional commit, PR aberto via gh.
EOF
)"
```

### GitHub Copilot Agent Mode (VS Code)

1. Abre Copilot Edits view.
2. Mode dropdown → **Agent**.
3. Permission level → **Autopilot**.
4. Cola o prompt da task.
5. Agent itera até task complete (continuous iteration).

### Cursor (Background Agent)

```
Cmd+Shift+P → "Cursor: Start Background Agent"
Prompt: <task description + DoD criteria>
```

Ou via Cursor Automations (schedule/event-driven) configurado em `.cursor/automations/`.

### Aider (wrapper Ralph)

```bash
#!/usr/bin/env bash
# scripts/ralph-aider.sh
set -euo pipefail
PROMPT_FILE=".ralph/prompt.md"
DONE_FILE=".ralph/DONE"
MAX=20
i=0
while [ ! -f "$DONE_FILE" ] && [ $i -lt $MAX ]; do
  i=$((i+1))
  echo "=== iter $i ==="
  aider --message "$(cat "$PROMPT_FILE")" --auto-commits --yes
done
[ -f "$DONE_FILE" ] && echo "DONE in $i iters" || echo "MAX reached"
```

---

## Padrões de output (qualquer ferramenta)

Ao final de cada iteração do loop, emite:

```
ITER N
- task: <id> — <slug>
- step: <READ|PLAN|EXECUTE|LINT|UNIT|E2E|VERIFY|COMMIT|PR>
- status: <green|red>
- evidence: <paths se E2E>
- next: <próximo step ou DONE>
```

Quando termina:

```
DONE
- task: <id> — <slug>
- iters: <N>
- commit: <sha> — <message>
- pr: <url>
- coverage diff: <%>
- e2e scenarios: <N> green
- evidence: playwright-report/, test-results/<list>
```

---

## Skills relacionadas

- `.skills/playwright-e2e/SKILL.md` — fixtures, page objects, evidência (trace/screenshot/video).
- `.skills/conventional-commits/SKILL.md` — commit no final do loop.
- `.skills/_template/SKILL.md` — base se quiser variante específica do loop.

---

## Referências oficiais

- **Claude Code (Anthropic)** — https://claude.com/plugins/ralph-loop · plugin source: `anthropics/claude-plugins-official` → `plugins/ralph-loop`.
- **Codex CLI (OpenAI)** — https://developers.openai.com/codex/cli/slash-commands · v0.128.0+ · `/goal`.
- **GitHub Copilot CLI** — https://docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot · flag `--autopilot`.
- **VS Code Agent Mode** — https://code.visualstudio.com/docs/copilot/agents/overview · permission level "Autopilot".
- **Cursor Background Agents** — https://docs.cursor.com/en/background-agent · 3.0+.
- **Geoffrey Huntley — Ralph Wiggum technique** (origem) — https://ghuntley.com/ralph/
- **Implementações OSS portáveis** — `snarktank/ralph`, `iannuttall/ralph`, `frankbria/ralph-claude-code`, `MarioGiancini/ralph-loop-setup`.

---

## Notas

- Loop tem cap natural: se 5 iterações seguidas falharem no mesmo step sem progresso → para e pede ajuda humana (evita loop infinito improdutivo).
- Em CI, `dod.yml` é o gate final. Loop local replica o mesmo gate antes de empurrar.
- Padrão central: **fresh context cada iteração + persistência em arquivos/git/testes**. É isso que mata problemas de context window e de drift.
- Use sempre em **worktree isolado** ou branch dedicado quando ativar `--yolo`/`--allow-all`/`sandbox=full`. Nunca em main.
