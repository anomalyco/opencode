---
name: ralph-loop
description: Loop autônomo de coding (read → plan → execute → lint → unit → e2e → fix → repeat) até DoD verde. Padrão deste projeto em TODA task técnica com acceptance criteria mensurável.
status: always-on
source: https://github.com/frankbria/ralph-claude-code
---

# Skill: `ralph-loop`

Padrão Ralph Wiggum technique adaptado pro LLM-Project-Mapper. Toda task técnica passa por este loop. Não opcional.

> **Sempre ativo neste projeto.** Disparado via `/ralph-loop "<objetivo>"`, `$ralph-loop` no prompt, ou implicitamente quando task tem AC mensurável.

---

## Trigger

- Task técnica com acceptance criteria mensurável em `.specs/sprints/sprint-XX/<id>.task.md`.
- Pedido com verbo: "implementa", "corrige", "refatora", "adiciona", "finaliza".
- Comando explícito: `/ralph-loop "<objetivo>"`, `$ralph-loop`.
- Bug com reprodução clara + critério de fix.

NÃO ativa pra: pergunta one-off, lookup, exploração read-only, decisão arquitetural (esse é `architect` agent).

---

## Steps (loop até DoD verde)

1. **Read** — abre task em `.specs/sprints/sprint-XX/<id>.task.md`. Lê Contexto + AC + Test plan + DoD + Pegadinhas. Lê ADRs linkadas em `.specs/architecture/`.
2. **Plan** — escreve plano interno curto: arquivos que mudam, ordem, como verificar, efeitos colaterais. Task ambígua → pergunta antes de codar. Task grande → dispara agents `planner` + `architect` paralelo.
3. **Execute** — edits cirúrgicos. Só toca o pedido. Sem refactor extra. Sem rename. Sem comentário a mais.
4. **Lint** — `npm run lint` (ou equivalente da stack). Vermelho → volta passo 3.
5. **Unit** — `npm test`. Coverage diff ≥ 80%. Vermelho → volta passo 3.
6. **E2E** — `npx playwright test --reporter=list,html` com trace + screenshot + video (todos, não "ou"). Cobre cenários: happy path, erro, auth states, locales, viewports. Vermelho → volta passo 3.
7. **Status block** — emitir bloco abaixo no fim de cada iteração:

   ```
   ---RALPH_STATUS---
   STATUS: IN_PROGRESS | COMPLETE | BLOCKED
   TASKS_COMPLETED_THIS_LOOP: <n>
   FILES_MODIFIED: <n>
   TESTS_STATUS: PASSING | FAILING | NOT_RUN
   WORK_TYPE: IMPLEMENTATION | TESTING | DOCUMENTATION | REFACTORING
   EXIT_SIGNAL: false | true
   RECOMMENDATION: <próximo passo curto>
   ---END_RALPH_STATUS---
   ```

8. **Exit gate (dual)** — só sai quando AMBOS verdadeiros:
   - Indicadores: AC todos `[x]`, lint+unit+E2E verdes, sem erro/warning novo, sem TODO sem dono.
   - `EXIT_SIGNAL: true` no status block.

9. **Commit + PR** — Conventional Commits inglês. PR via `gh pr create --fill`. Anexa evidências Playwright (`playwright-report/`, `test-results/`).

---

## Padrões

- **Uma task por loop** — foca no item de maior prioridade. Não acumula escopo.
- **Search before assume** — `Explore` agent antes de declarar "não existe".
- **Subagents pra trabalho independente** — disparar 3-5+ paralelo (research, read, review).
- **Testes proporcionais ao risco e ao DoD** — escrever os testes mínimos necessários para validar a mudança, cobrir regressão e cumprir unit + E2E + coverage diff exigidos pelo loop/DoD. Não impor quota fixa de esforço. Não escrever teste pra comportamento ainda não implementado nesta loop.
- **Files protegidos**: `.specs/sprints/*/SPRINT.md` em curso, `.claude/settings.json` (só via `update-config`), `AGENTS.md`/`CLAUDE.md` (só com aprovação).
- **Stack-aware**: identifica linguagem → carrega `*-patterns` + `*-security` + `*-testing` da stack ANTES de codar.
- **Reviewer agents obrigatório** após edits: `*-reviewer` da stack + `security-reviewer` se toca auth/input/segredo.

---

## Integração com agents

Dispara em paralelo conforme contexto:

| Fase | Agents |
|---|---|
| Plan | `Plan`, `everything-claude-code:planner`, `everything-claude-code:architect` |
| Search | `Explore` (quick/medium/thorough), `general-purpose` |
| Review | `*-reviewer` da stack, `everything-claude-code:code-reviewer`, `everything-claude-code:security-reviewer` |
| Build error | `*-build-resolver` da stack |
| E2E | `everything-claude-code:e2e-runner` |
| Docs | `everything-claude-code:doc-updater` |

Padrão: research + read + review independentes num só message.

---

## Definition of Done

- [ ] AC da task todos `[x]`.
- [ ] `npm run lint` verde.
- [ ] `npm test` verde + coverage diff ≥ 80%.
- [ ] `npx playwright test` verde com evidência salva (`playwright-report/index.html` + traces + screenshots + videos).
- [ ] Status block emitido com `STATUS: COMPLETE` + `EXIT_SIGNAL: true`.
- [ ] Conventional commit em inglês.
- [ ] PR aberto via `gh pr create --fill` com evidências anexadas.
- [ ] ADR criada em `.specs/architecture/` se decisão arquitetural.
- [ ] Changelog atualizado se release-relevant.

---

## Notas

- Origem: https://github.com/frankbria/ralph-claude-code (MIT, v0.11.5).
- Plugin global equivalente: `ralph-loop:ralph-loop` (já instalado em `~/.claude/`).
- Para iteração mecânica use skill `loop`: `/loop /ralph-loop "<obj>"`.
- Circuit breaker: 3 loops sem progresso ou 5 mesmo erro → para e pede revisão humana.
