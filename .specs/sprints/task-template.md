---
id: TASK-XXX
title: <Título curto e imperativo>
sprint: sprint-XX
owner: <handle do responsável ou @wesleysimplicio-team>
status: todo
---

# TASK-XXX — <Título curto e imperativo>

> Use este arquivo como modelo para criar novas tasks dentro de uma sprint. Copie, renomeie para `NN-slug.task.md` (ex: `02-user-signup.task.md`) e preencha cada section. Não apague seções: se não se aplica, escreva "N/A" e justifique em uma linha.

## Contexto

Descreva em 3-6 linhas:

- O problema que esta task resolve.
- Quem é impactado (ver `.specs/product/PERSONAS.md`).
- Por que agora (link com objetivo da sprint em `SPRINT.md`).
- Referência ao item de origem no `BACKLOG.md` (`#N`).

## Acceptance Criteria

Critérios objetivamente verificáveis. Cada item deve poder ser confirmado com um teste, um print ou um log. Sem AC vago do tipo "deve funcionar bem".

- [ ] AC-1 — Quando <condição/input>, o sistema deve <comportamento esperado>.
- [ ] AC-2 — Quando <erro/edge case>, o sistema deve <resposta esperada>.
- [ ] AC-3 — A interface exibe <estado/elemento> em <viewport ou contexto>.
- [ ] AC-4 — A operação completa em até <tempo/sla> sob carga de <volume>.

## Out of scope

Liste explicitamente o que **não** será feito nesta task. Tudo que for tentação de "já que estou aqui".

- Não inclui <feature relacionada> — fica para a task TASK-YYY.
- Não altera o esquema de <entidade> — depende de ADR ainda não escrita.
- Não cobre cenário <edge case raro> — abrir item separado no backlog se aparecer.

## Test plan

Descreva qual cobertura de teste a task deve entregar. Sem isso, a task não passa no DoD.

### Unit

- [ ] Cobrir <regra de domínio principal> com casos válidos e inválidos.
- [ ] Mockar dependências externas (`developer-tools` services, gateways).
- [ ] Atingir cobertura mínima de 80% nos arquivos novos/alterados.

### Integration

- [ ] Testar a integração entre <módulo A> e <módulo B> com banco real (ou container).
- [ ] Validar contrato de I/O em endpoints HTTP envolvidos.
- [ ] Cobrir caminho feliz + ao menos 1 caminho de erro.

### End-to-end (Playwright)

- [ ] Cenário feliz no fluxo completo, com screenshot do estado final.
- [ ] Cenário de erro relevante (input inválido, timeout, sessão expirada).
- [ ] Variantes de viewport (mobile 375px, desktop 1280px) quando UI é tocada.
- [ ] Evidências salvas em `test-results/` e anexadas ao PR.

```bash
# comandos esperados rodando localmente
npm run lint
npm test -- --coverage
npm run test:e2e
```

## Definition of Done

Checklist que precisa estar 100% antes de marcar como `done` no `BACKLOG.md`.

- [ ] Todos os ACs marcados e verificados.
- [ ] Testes unit, integration e e2e verdes localmente e no CI.
- [ ] Cobertura mínima respeitada (ver `.github/workflows/dod.yml`).
- [ ] PR aberto com link para esta task e para issue/ADR aplicáveis.
- [ ] Code review aprovado por pelo menos 1 revisor de `wesleysimplicio-team`.
- [ ] Documentação atualizada (`.specs/architecture/PATTERNS.md`, README, changelog).
- [ ] Mudanças de schema ou contrato registradas em ADR.
- [ ] Status atualizado em `BACKLOG.md` e em `sprint-XX/SPRINT.md`.

## Pegadinhas conhecidas

Liste armadilhas, dívida técnica encostada, comportamentos não óbvios. Atualize conforme o time descobre durante a execução.

- A integração com <serviço externo> tem rate limit baixo em ambiente sandbox.
- O componente `<NomeComponente>` tem efeito colateral em `developer-tools` que não está coberto por teste.
- Migração de banco é destrutiva: rodar somente em staging com snapshot.
- Hot-reload não recarrega <arquivo> — exige restart manual da stack `monorepo`.

## Links

Tudo que ajuda quem vai pegar a task ou revisar a entrega.

- Backlog: `.specs/sprints/BACKLOG.md` (item #N)
- Sprint: `.specs/sprints/sprint-XX/SPRINT.md`
- Vision/Domain: `.specs/product/VISION.md`, `.specs/product/DOMAIN.md`
- Arquitetura: `.specs/architecture/DESIGN.md`, `.specs/architecture/PATTERNS.md`
- ADRs relacionadas: `ADR-XXX-<slug>.md`
- Issue: `#<numero>`
- PR: `#<numero>` (preenche depois de abrir)
- Discussão prévia: `<link-doc-ou-thread>`
