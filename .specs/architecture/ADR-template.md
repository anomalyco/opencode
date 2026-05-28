# ADR-XXX: `<título curto e imperativo da decisão>`

> Substitua `XXX` pelo próximo número sequencial. Substitua placeholders.
> Um ADR descreve uma decisão. Decisões compostas viram dois ADRs.

---

## Status

`Proposto` | `Aceito` | `Rejeitado` | `Substituído por ADR-YYY` | `Depreciado`

> Use exatamente um. Quando substituído, linkar o ADR sucessor.

---

## Data

`AAAA-MM-DD` (data da última mudança de status)

---

## Autores

- `<nome ou handle>`
- `<nome ou handle>`

---

## Contexto

Descreva o problema, restrições, forças em jogo. O que motivou abrir este ADR? O leitor que cair aqui daqui a 1 ano precisa entender o cenário sem fazer arqueologia.

- Qual sintoma trouxe a discussão.
- Qual restrição técnica ou de negócio existe.
- Qual a relação com `Simplicio-code`, `monorepo`, `wesleysimplicio-team` ou `developer-tools`.
- Quais decisões anteriores tocam neste tema (linkar ADRs).

---

## Decisão

Frase única e imperativa. Exemplo: "Adotamos PostgreSQL como banco primário."

Em seguida, detalhar o suficiente pra implementar:

- Escopo: o que entra, o que não entra.
- Como aplicar (passos curtos).
- Quem é dono / mantenedor.

---

## Consequências

### Positivas (+)

- `<benefício 1, concreto>`
- `<benefício 2>`
- `<benefício 3>`

### Negativas (-)

- `<custo / trade-off 1>`
- `<dívida nova introduzida>`
- `<risco que aceitamos correr>`

### Neutras / observações

- `<efeito colateral que não é claramente bom nem ruim>`

---

## Alternativas consideradas

Listar pelo menos duas alternativas reais avaliadas. Para cada uma:

### Alternativa A — `<nome>`
- Resumo.
- Por que foi descartada.

### Alternativa B — `<nome>`
- Resumo.
- Por que foi descartada.

> Se a única alternativa é "não fazer nada", documente também. É uma escolha válida.

---

## Critério de revisão

Como saberemos se essa decisão precisa ser revisitada?

- Métrica X passa de Y.
- Restrição Z deixa de existir.
- Daqui a `<N>` meses, revisar incondicionalmente.

---

## Links

- Issue / task: `<link>`
- PR de implementação: `<link>`
- Documentos relacionados: `[DESIGN](./DESIGN.md)`, `[PATTERNS](./PATTERNS.md)`
- ADRs relacionados: `[ADR-001](./ADR-001-example.md)`
- Referências externas: `<link>`
