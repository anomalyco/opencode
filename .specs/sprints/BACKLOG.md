# Backlog — Simplicio-code

Lista priorizada de tudo que precisa ser feito. É a fonte da verdade de pendências do produto.

## Como usar este backlog

- Cada linha é um item rastreável que vira uma `task.md` quando entra em sprint.
- Prioridades:
  - **P0** — bloqueador, sem isso o produto não funciona.
  - **P1** — importante, planejado pra próximas 1-2 sprints.
  - **P2** — desejável, fica no radar mas pode esperar.
- Status:
  - `todo` — não começou.
  - `doing` — em andamento na sprint atual.
  - `done` — entregue, em produção.
- Ordenação dentro da tabela: P0 primeiro, depois P1, depois P2. Dentro da mesma prioridade, ordenar por `sprint alvo`.

## Regras de manutenção

- Toda nova ideia entra como P2 até alguém defender priorizar.
- Itens `done` ficam no histórico por uma sprint e depois são arquivados em `BACKLOG-archive.md`.
- Se um item passa 2 sprints como `todo`, reavalia: ainda faz sentido? Reprioriza ou remove.
- Quem altera prioridade ou move pra `doing` deve atualizar a tabela no mesmo PR.

## Backlog atual

| #   | Título                                              | Prioridade | Sprint alvo | Status |
| --- | --------------------------------------------------- | ---------- | ----------- | ------ |
| 1   | Implementar autenticação por email + senha         | P0         | sprint-01   | doing  |
| 2   | Criar pipeline CI com lint + unit + e2e            | P0         | sprint-01   | todo   |
| 3   | Configurar deploy automático em staging            | P0         | sprint-01   | todo   |
| 4   | Tela de cadastro de usuário com validação          | P1         | sprint-02   | todo   |
| 5   | Recuperação de senha por email                     | P1         | sprint-02   | todo   |
| 6   | Dashboard inicial com métricas-chave do developer-tools   | P1         | sprint-02   | todo   |
| 7   | Logging estruturado + tracing distribuído          | P1         | sprint-03   | todo   |
| 8   | Internacionalização pt-BR + en + es                | P2         | sprint-04   | todo   |
| 9   | Modo escuro na interface                           | P2         | backlog     | todo   |
| 10  | Exportação de relatórios em PDF                    | P2         | backlog     | todo   |

## Histórico recente (últimos done)

| #   | Título                              | Sprint     | Concluído em |
| --- | ----------------------------------- | ---------- | ------------ |
| 0   | Bootstrap de repositório + AGENTS.md | sprint-00 | 2026-XX-XX   |

## Itens descartados ou movidos pra fora

Manter aqui referência rápida do que foi removido pra não reabrir discussão sem motivo.

- Nenhum item descartado ainda.

## Próximas decisões pendentes

Itens que precisam de decisão de produto ou arquitetura antes de entrar como task formal:

- Provedor de email transacional para item #5 (depende de ADR de infra externa).
- Estratégia de feature flags para item #6 (avaliar contra item #7).
- Política de retenção de relatórios PDF do item #10 (impacta storage).
