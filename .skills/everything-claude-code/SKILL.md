---
name: everything-claude-code
description: Bundle de ~60 agents + ~221 skills cobrindo reviewers, build-resolvers, TDD, E2E, security, autonomous loops. Padrão do projeto — usar o MÁXIMO de agents possível em paralelo a cada alteração.
status: always-on
source: https://github.com/affaan-m/everything-claude-code
---

# Skill: `everything-claude-code`

Catálogo + protocolo de uso da suite ECC. Padrão do projeto: **toda alteração dispara o máximo de agents ECC aplicáveis em paralelo**. Single message, múltiplas tool calls.

> **Sempre ativo.** Não opcional. Ignorar = task incompleta.

---

## Trigger

- Qualquer edição de código → review agent da stack + security-reviewer (se toca auth/input/segredo).
- Build falhou → `*-build-resolver` da stack.
- Bug → `engineering:debug` skill + reviewer agent.
- Feature nova / refactor amplo → `planner` + `architect` paralelo antes de codar.
- E2E → `e2e-runner`.
- Docs → `doc-updater` + `docs-lookup` (Context7).
- Performance → `performance-optimizer`.
- Dead code → `refactor-cleaner`.

---

## Protocolo de invocação (HARD RULE)

**Paralelo agressivo é o padrão.** Single message com 3-5+ agents simultâneos sempre que trabalho independente.

### Fluxo por fase

| Fase | Agents (paralelo) |
|---|---|
| Plan (feature/refactor) | `Plan` + `everything-claude-code:planner` + `everything-claude-code:architect` |
| Search/Explore | `Explore` (quick/medium/thorough) + `general-purpose` |
| Stack review (após edit) | `everything-claude-code:<lang>-reviewer` + `everything-claude-code:code-reviewer` + `everything-claude-code:security-reviewer` |
| Build error | `everything-claude-code:<lang>-build-resolver` |
| Testes | `everything-claude-code:tdd-guide` + `test-runner` |
| E2E | `everything-claude-code:e2e-runner` |
| Performance | `everything-claude-code:performance-optimizer` |
| Cleanup | `everything-claude-code:refactor-cleaner` |
| Docs | `everything-claude-code:doc-updater` + `docs-lookup` |

### Reviewers por stack

| Stack | Reviewer |
|---|---|
| TS/JS | `everything-claude-code:typescript-reviewer` |
| Python | `everything-claude-code:python-reviewer` |
| Go | `everything-claude-code:go-reviewer` |
| Rust | `everything-claude-code:rust-reviewer` |
| Java/Spring | `everything-claude-code:java-reviewer` |
| Kotlin/Android | `everything-claude-code:kotlin-reviewer` |
| C# / .NET | `everything-claude-code:csharp-reviewer` |
| C++ | `everything-claude-code:cpp-reviewer` |
| Flutter/Dart | `everything-claude-code:flutter-reviewer` |
| SQL/migration | `everything-claude-code:database-reviewer` |
| Healthcare/PHI | `everything-claude-code:healthcare-reviewer` |
| Genérico | `everything-claude-code:code-reviewer`, `code-architect` |

### Build resolvers por stack

| Stack | Resolver |
|---|---|
| TS/genérico | `everything-claude-code:build-error-resolver` |
| Go | `everything-claude-code:go-build-resolver` |
| Rust | `everything-claude-code:rust-build-resolver` |
| Java/Maven/Gradle | `everything-claude-code:java-build-resolver` |
| Kotlin/Gradle | `everything-claude-code:kotlin-build-resolver` |
| C++/CMake | `everything-claude-code:cpp-build-resolver` |
| Dart/Flutter | `everything-claude-code:dart-build-resolver` |
| PyTorch | `everything-claude-code:pytorch-build-resolver` |

### Skills stack-specific (carregar via Skill tool ANTES de codar)

| Stack | Skills |
|---|---|
| Python | `python-patterns` + `python-testing` |
| TS/Node | `frontend-patterns` + `nextjs-turbopack` + `bun-runtime` |
| Go | `golang-patterns` + `golang-testing` |
| Rust | `rust-patterns` + `rust-testing` |
| Java/Spring | `springboot-patterns` + `springboot-tdd` + `springboot-security` + `jpa-patterns` |
| Kotlin | `kotlin-patterns` + `kotlin-testing` + `kotlin-coroutines-flows` |
| C# / .NET | `dotnet-patterns` + `csharp-testing` |
| C++ | `cpp-coding-standards` + `cpp-testing` |
| Flutter | `dart-flutter-patterns` |
| Laravel | `laravel-patterns` + `laravel-tdd` + `laravel-security` |
| Django | `django-patterns` + `django-tdd` + `django-security` |
| Postgres | `postgres-patterns` + `database-migrations` |

---

## Regra de invocação (passo a passo)

1. Identifica stack do arquivo tocado.
2. Carrega `*-patterns` + `*-security` + `*-testing` da stack (Skill tool, paralelo).
3. Para feature/refactor amplo: dispara `planner` + `architect` paralelo.
4. Edita código.
5. Dispara reviewer(s) da stack + `security-reviewer` (se aplicável) **paralelo num único message**.
6. Build falhou → `*-build-resolver`.
7. Testes via `tdd-guide` + `test-runner`. E2E via `e2e-runner`.
8. Docs via `doc-updater` + Context7 (`docs-lookup`).
9. Endereça feedback de TODOS reviewers ou justifica trade-off.

---

## Padrões

- **Paralelo > sequencial** sempre que independente. Single message com múltiplas Agent calls.
- **Trust mas verify** — agent summary é intenção, não fato. Conferir diff real.
- **Subagent prompt self-contained** — paths, line numbers, contexto. Não "based on findings".
- **Foreground vs background** — foreground quando precisa resultado; background quando paralelo livre.
- **Hard limit**: nunca delegar entendimento. "Implementa baseado nas findings" = anti-pattern.

---

## Slash commands úteis (ECC)

`/ecc:plan`, `/multi-plan`, `/multi-execute`, `/loop-start`, `/loop-status`, `/code-review`, `/security-scan`, `/quality-gate`, `/test-coverage`, `/refactor-clean`, `/update-docs`, `/update-codemaps`, `/skill-create`, `/skill-stocktake`.

---

## Definition of Done

- [ ] Reviewer agent da stack rodado sobre o diff.
- [ ] `security-reviewer` rodado se toca auth/input/segredo/cripto.
- [ ] Build/test failures resolvidos via `*-build-resolver` (se aplicável).
- [ ] Feedback de reviewers endereçado ou justificado.
- [ ] Patterns da stack carregadas ANTES de codar (não depois).
- [ ] Agents disparados em paralelo num single message (não sequencial).

---

## Notas

- Origem: https://github.com/affaan-m/everything-claude-code (v2.0.0-rc.1).
- Requer Claude Code CLI ≥ 2.1.0.
- Plugin global já registrado — agents/skills disponíveis sob namespace `everything-claude-code:*`.
- Runtime knobs: `ECC_HOOK_PROFILE=standard|strict|minimal`, `ECC_DISABLED_HOOKS`, `ECC_SESSION_START_MAX_CHARS`.
