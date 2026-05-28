#!/usr/bin/env bash
# SessionStart hook — injeta skills always-on do LLM-Project-Mapper no contexto da sessão.
# Disparado automaticamente pelo Claude Code conforme .claude/settings.json.
# Stdout vira contexto adicional pro agent (formato livre).

set -euo pipefail

cat <<'EOF'
[LLM-Project-Mapper — Skills always-on ativas neste projeto]

Três skills são padrão obrigatório e estão ativas desde o início da sessão:

1. `caveman` (level: full) — modo terse de resposta. Drop artigos/filler/pleasantries.
   Preserva código, commits, PRs e docs canônicas em prosa normal. Desativa via
   "stop caveman" / "normal mode". Detalhe: .skills/caveman/SKILL.md

2. `ralph-loop` — toda task técnica passa pelo loop
   read → plan → execute → lint → unit → e2e → fix → repeat até DoD verde.
   Exit gate dual: indicadores + EXIT_SIGNAL: true. Detalhe: .skills/ralph-loop/SKILL.md

3. `everything-claude-code` — usar o máximo de agents ECC em paralelo a cada alteração
   (single message, múltiplas Agent calls). Reviewers da stack + security-reviewer
   obrigatórios após edits. Detalhe: .skills/everything-claude-code/SKILL.md

Loop padrão de task:
  Plan → Search (Explore + general-purpose) → Edit → Reviewers paralelo
  (typescript/python/go/rust/java/kotlin/csharp/cpp/flutter/database reviewer +
  security-reviewer) → Build-resolver se erro → Unit + E2E Playwright →
  Status block (---RALPH_STATUS---) → Commit + PR.

Padrões deste repo:
  - PT-BR para respostas/docs internas. Inglês para código, commits, docs canônicas.
  - Sem emojis em código. Conventional Commits.
  - DoD bloqueado por .github/workflows/dod.yml.
  - Nunca commitar segredos. Nunca pular testes.

EOF
