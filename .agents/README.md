# `.agents/` — sub-agents customizados

Local **canônico** dos sub-agents customizados deste repo, seguindo a convenção do ecossistema [AGENTS.md](https://agents.md/).

Todo agent custom (TDD, reviewer, architect, etc.) mora aqui em `<nome>.agent.md`.

---

## Por que aqui

Padrão `.agents/` é lido por:

- **GitHub Copilot Coding Agent** (workspace agents) — espelhado em `.github/copilot/agents/` por compat.
- **Cursor** (via referência manual ou regra `.cursor/rules/`).
- **Aider** (referenciado via `--read .agents/<arquivo>`).
- **Claude Code / Codex / Hermes / OpenClaw** (lidos como contexto adicional pelo `AGENTS.md` master).

Cada ferramenta resolve seu próprio caminho, mas todos convergem no conteúdo de `.agents/`.

---

## Convenção de arquivo

```
.agents/
├── README.md                  # este arquivo
├── _template.agent.md         # base (opcional) pra criar agent novo
├── ralph-loop.agent.md        # Ralph Loop (executor autônomo padrão)
├── tdd.agent.md               # TDD Specialist
├── reviewer.agent.md          # Code Reviewer
├── architect.agent.md         # Software Architect
└── <novo>.agent.md            # próximo agent
```

Nome do arquivo: `<slug-kebab-case>.agent.md`. Slug curto, sem espaço.

---

## Frontmatter

Todo `.agent.md` começa com YAML:

```yaml
---
name: <Nome Humano>
description: <Quando ativa este agent — frase única, clara, com gatilho>
tools: [<lista de tools permitidas: edit, terminal, search, web, etc.>]
---
```

Campos:

- `name` — display name (humano).
- `description` — gatilho de ativação. Quando o agent deve ser chamado. Curto e específico.
- `tools` — lista de capacidades. Restringe o que o agent pode fazer. Se omitir, herda permissões padrão do CLI.

---

## Estrutura do corpo

Depois do frontmatter:

1. **Quando esse agent ativa** — bullets concretos, não vago.
2. **O que ele faz** — passo a passo.
3. **O que ele NÃO faz** — explicitar limites.
4. **Padrões de output** — formato esperado de resposta.
5. **Exemplos** — pelo menos 1-2 casos reais (input → output).

Veja `tdd.agent.md`, `reviewer.agent.md`, `architect.agent.md` como referência.

---

## Como criar agent novo

```bash
cp .agents/_template.agent.md .agents/<slug>.agent.md
# edita frontmatter + corpo
# adiciona linha em AGENTS.md > "Agents disponíveis"
```

Espelha em `.github/copilot/agents/` se quer disponibilizar pro Copilot Workspace:

```bash
cp .agents/<slug>.agent.md .github/copilot/agents/<slug>.agent.md
```

---

## Por que duplicar em `.github/copilot/agents/`?

Copilot Workspace (versão antiga) lê estritamente desse caminho. Symlink quebraria no Windows nativo (não suporta `ln -s` sem dev-mode). Cópia simples evita o problema.

CI pode automatizar a sincronização via hook `pre-commit` se preferir manter um único source of truth.

---

## Convivência com outras ferramentas

| Ferramenta | Caminho que ela lê | Estratégia |
|---|---|---|
| GitHub Copilot Coding Agent | `.github/copilot/agents/` | Cópia espelhada |
| Cursor | `.cursor/rules/*.mdc` | Referência cruzada (opcional) |
| Aider | qualquer (`--read`) | Carrega via flag |
| Claude Code | `.claude/agents/` (opcional) ou contexto manual | Lê via `AGENTS.md` |
| Codex CLI | contexto manual | Lê via `AGENTS.md` |
| Hermes / OpenClaw | `AGENTS.md` master | Lê via `AGENTS.md` |

`.agents/` é o ponto de verdade. Outros caminhos são adaptadores.
