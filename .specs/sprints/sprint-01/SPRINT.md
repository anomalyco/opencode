---
sprint: sprint-01
status: doing
start: 2026-XX-XX
end: 2026-XX-XX
owner: wesleysimplicio-team
---

# Sprint 01 — Fundamentos de acesso e pipeline

## Objetivo

Entregar a base de autenticação e o pipeline de CI/CD do Simplicio-code para destravar todas as features futuras de developer-tools.

## Datas

- **Início:** 2026-XX-XX
- **Fim previsto:** 2026-XX-XX
- **Demo/review:** 2026-XX-XX
- **Retrospectiva:** 2026-XX-XX

## Deliverables

A sprint só fecha como `done` quando os 4 entregáveis abaixo estão em produção (ou em staging com plano de promoção definido).

1. **Autenticação por email + senha** — fluxo completo de login com sessão persistente, cobertura unit + integration + e2e. Detalhes em `01-example.task.md`.
2. **Pipeline CI** — workflow `.github/workflows/ci.yml` rodando lint, unit, integration e e2e em cada PR, com upload de evidência Playwright.
3. **Deploy automático em staging** — push em `main` dispara deploy para ambiente `staging.Simplicio-code.app` via GitHub Actions.
4. **Documentação base** — `AGENTS.md`, `.specs/architecture/DESIGN.md` e ADR-001 publicados e consistentes.

## Tasks da sprint

| Arquivo                    | Status | Owner       |
| -------------------------- | ------ | ----------- |
| `01-example.task.md`       | doing  | @wesleysimplicio-team     |
| `02-ci-pipeline.task.md`   | todo   | @wesleysimplicio-team     |
| `03-staging-deploy.task.md`| todo   | @wesleysimplicio-team     |
| `04-docs-baseline.task.md` | todo   | @wesleysimplicio-team     |

## Riscos

- **Provedor de autenticação ainda não escolhido.** Mitigação: começar com solução baseada em hash local (bcrypt) e abrir ADR para integração futura.
- **Tempo de pipeline pode ultrapassar 10 minutos com Playwright.** Mitigação: paralelizar shards e desligar trace quando verde.
- **Staging depende de credenciais externas.** Mitigação: usar segredos do GitHub Actions desde o primeiro deploy.
- **Time pequeno e curva de aprendizado da stack `monorepo`.** Mitigação: pareamento nas 2 primeiras tasks.

## Dependências

- ADR-001 sobre escolha de stack precisa estar `accepted` antes da task de pipeline.
- Domínio `staging.Simplicio-code.app` precisa estar provisionado.
- Acesso de `wesleysimplicio-team` ao repositório com permissão de deploy.
- Conta de email transacional (placeholder) para futuro fluxo de recuperação — não bloqueia esta sprint.

## Critérios de pronto da sprint

- [ ] Todos os deliverables com tasks `done` no `BACKLOG.md`.
- [ ] Pipeline verde nos últimos 5 PRs.
- [ ] Staging acessível e protegido por autenticação.
- [ ] Demo gravada ou apresentada em `presentation/` com link no PR de fechamento.
- [ ] Retrospectiva registrada com 3 pontos de melhoria para a próxima sprint.

## Notas de retrospectiva (preencher no fim)

- O que funcionou bem:
- O que travou:
- O que mudar na sprint-02:
