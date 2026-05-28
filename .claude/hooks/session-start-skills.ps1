# SessionStart hook do Claude Code.
# Injeta no contexto da sessao as skills always-on do LLM Project Mapper.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

@'
[LLM-Project-Mapper - Skills always-on ativas neste projeto]

Tres skills sao padrao obrigatorio e estao ativas desde o inicio da sessao:

1. `caveman` (level: full) - modo terse de resposta. Drop artigos/filler/pleasantries.
   Preserva codigo, commits, PRs e docs canonicas em prosa normal. Desativa via
   "stop caveman" / "normal mode". Detalhe: .skills/caveman/SKILL.md

2. `ralph-loop` - toda task tecnica passa pelo loop
   read -> plan -> execute -> lint -> unit -> e2e -> fix -> repeat ate DoD verde.
   Exit gate dual: indicadores + EXIT_SIGNAL: true. Detalhe: .skills/ralph-loop/SKILL.md

3. `everything-claude-code` - usar o maximo de agents ECC em paralelo a cada alteracao
   (single message, multiplas Agent calls). Reviewers da stack + security-reviewer
   obrigatorios apos edits. Detalhe: .skills/everything-claude-code/SKILL.md

Loop padrao de task:
  Plan -> Search (Explore + general-purpose) -> Edit -> Reviewers paralelo
  (typescript/python/go/rust/java/kotlin/csharp/cpp/flutter/database reviewer +
  security-reviewer) -> Build-resolver se erro -> Unit + E2E Playwright ->
  Status block (---RALPH_STATUS---) -> Commit + PR.

Padroes deste repo:
  - PT-BR para respostas/docs internas. Ingles para codigo, commits, docs canonicas.
  - Sem emojis em codigo. Conventional Commits.
  - DoD bloqueado por .github/workflows/dod.yml.
  - Nunca commitar segredos. Nunca pular testes.
'@
