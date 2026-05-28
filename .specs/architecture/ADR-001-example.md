# ADR-001: Adotar trunk-based development

> Exemplo fictício. Use como referência de tom, profundidade e estrutura ao escrever ADRs reais.

---

## Status

`Aceito`

---

## Data

`2025-01-15`

---

## Autores

- `wesleysimplicio-team` engineering leads
- `wesley`

---

## Contexto

`Simplicio-code` está saindo da fase de protótipo para iteração contínua. O time `wesleysimplicio-team` é pequeno (5 devs), entrega múltiplas vezes ao dia e quer reduzir ciclos.

Hoje usamos `git-flow` com branches `develop`, `release/*`, `hotfix/*` e PRs longos vivendo dias. Sintomas observados nas últimas 6 sprints:

- Conflitos de merge quase diários quando 3+ branches longos tocam o mesmo módulo.
- "Hotfix" que precisa esperar fechar o ciclo pra entrar.
- Reviews superficiais em PR de 800+ linhas.
- Feature flags inexistentes; código novo só vai pra prod quando branch fecha.
- Coverage cai porque integration acaba sendo testada só no merge final.

Restrições:
- Stack `monorepo` já tem CI rápido (menos de 5 min) e suíte verde estável.
- Time é colocado, comunicação direta funciona.
- Domínio `developer-tools` aceita feature flags (não tem regulação que proíba código dormente em prod).

Decisões anteriores: nenhum ADR tocando branching até hoje.

---

## Decisão

Adotamos trunk-based development: todos commitam direto na branch `main` via PRs curtos com vida menor que 24h.

Aplicação:

- Branches descartáveis: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Vida útil alvo: 1 dia.
- PR pequeno: alvo 200 linhas líquidas. Acima disso, justificar ou dividir.
- Toda mudança que não pode ir pra prod já vai atrás de feature flag (`flagged.<feature>`).
- `main` é sempre deployável. Falhou no CI = bloqueio imediato, todo mundo para até voltar verde.
- Releases por tag `vX.Y.Z` cortadas a partir de `main` quando o changelog acumula valor de release.
- Hotfix = PR direto em `main`, deploy normal. Sem branch separada.

Dono: tech lead da semana cuida do "build verde sempre" (rotativo).

---

## Consequências

### Positivas (+)

- Conflitos colapsam: mudanças pequenas e frequentes integram fácil.
- Code review fica viável: PR de 200 linhas é revisado bem em 15 min.
- Tempo de ciclo (commit até prod) cai de dias para horas.
- Hotfix não precisa de fluxo especial.
- Time aprende a escrever em pequenos passos (skill que escala bem).

### Negativas (-)

- Disciplina de feature flag vira obrigatória; flag esquecida em prod é dívida nova.
- Pressão sobre CI: precisa rodar rápido e ser confiável o tempo todo.
- Pull requests muito grandes ficam claramente proibidos. Devs acostumados a "lote semanal" precisam adaptar.
- Risco de quebrar `main` aumenta se DoD for relaxado; precisa hook `pre-commit` rodando teste local.

### Neutras / observações

- Dependentes externos do repo (forks, integrações) precisam saber que `main` é a fonte. Documentar em `README.md`.
- Métricas de DORA (lead time, deployment frequency, change failure rate, MTTR) começam a fazer sentido aqui.

---

## Alternativas consideradas

### Alternativa A — Continuar com git-flow
- Manter `develop`, `release/*`, `hotfix/*`.
- Descartada: foi o que gerou os sintomas. Adicionar mais cerimônia não conserta o gargalo principal (PRs longos).

### Alternativa B — GitHub Flow puro (sem release tag)
- Trunk-based, mas deploy direto a cada merge sem versionamento.
- Descartada: domínio `developer-tools` precisa rastrear versão pra changelog público e suporte a versões antigas em clientes que ainda não atualizaram.

### Alternativa C — Não decidir agora
- Esperar mais 2 sprints, ver se time se acomoda.
- Descartada: sintomas estão piorando, não estabilizando.

---

## Critério de revisão

Esta decisão volta à mesa se:

- Tamanho do time `wesleysimplicio-team` passar de 15 devs e coordenação direta deixar de funcionar.
- Domínio passar a exigir conformidade que proíba feature flag dormente em prod (ex: regulação tipo financeira pesada).
- Métrica de change failure rate ficar acima de 15% por 4 sprints seguidas (sinal de que `main` não está protegida o bastante).

Revisão obrigatória: `2025-07-15` (6 meses depois).

---

## Links

- Documentos relacionados: `[DESIGN](./DESIGN.md)`, `[PATTERNS](./PATTERNS.md)`
- Discussão original: `<link interno>`
- Referência externa: <https://trunkbaseddevelopment.com>
- Métricas DORA: <https://dora.dev>
