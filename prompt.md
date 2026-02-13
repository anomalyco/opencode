
# Plano Completo: Multi-Auth para OpenCode

## 1. Objetivo

Permitir multiplas contas por provider no OpenCode (exemplo: `openai/work` e `openai/personal`) com:

- troca rapida de conta ativa
- selecao explicita por projeto/sessao quando necessario
- compatibilidade total com formato legado de credenciais
- zero regressao para usuarios com uma unica conta

## 2. Problema Atual

Hoje o armazenamento de auth eh indexado por `providerID` com apenas uma credencial por provider.
Isso impede cenarios comuns:

- separar conta pessoal e conta corporativa no mesmo provider
- alternar billing sem relogar
- padronizar por projeto (repo A usa `work`, repo B usa `personal`)

## 3. Escopo

### Em escopo

- novo modelo de dados para auth com contas nomeadas
- comandos CLI para gerenciar contas
- interface no TUI/app para trocar conta ativa sem depender apenas de CLI
- selecao de conta no runtime com regras de precedencia
- migracao compativel com auth legado
- testes unitarios e de integracao de fluxo principal
- documentacao de uso e troubleshooting

### Fora de escopo (fase inicial)

- sincronizacao cloud de multiplas contas
- politicas de equipe via servidor remoto (pode vir na fase 2)

## 4. Requisitos Funcionais

1. Cadastrar varias contas para o mesmo provider.
2. Definir conta default por provider.
3. Trocar conta default sem novo login.
4. Selecionar conta por projeto/sessao via config/env.
5. Listar contas e visualizar qual esta ativa.
6. Remover conta especifica sem apagar as demais.
7. Remover provider inteiro quando desejado.
8. Ler auth legado sem erro.
9. Ter interface no TUI/app para selecionar e trocar conta ativa por provider.

## 5. Requisitos Nao Funcionais

1. Backward compatibility total.
2. Armazenamento local com permissao `0600`, igual ao comportamento atual.
3. Sem uso de `any`.
4. Sem degradar tempo de inicializacao de forma perceptivel.
5. Cobertura de testes para paths criticos (legacy + novo).
6. Build e typecheck devem passar ao final da implementacao.

## 6. Arquitetura Proposta

### 6.1 Modelo de dados (auth.json v2)

Formato proposto:

```json
{
  "openai": {
    "default": "work",
    "accounts": {
      "work": {
        "type": "oauth",
        "access": "...",
        "refresh": "...",
        "expires": 1769999999,
        "accountId": "org_work"
      },
      "personal": {
        "type": "api",
        "key": "sk-..."
      }
    }
  },
  "anthropic": {
    "default": "default",
    "accounts": {
      "default": {
        "type": "api",
        "key": "..."
      }
    }
  }
}
```

### 6.2 Compatibilidade com legado

Formato legado atual:

```json
{
  "openai": { "type": "api", "key": "..." }
}
```

Regra:

- leitura: se valor de provider estiver no formato legado, tratar em memoria como:
  - `default = "default"`
  - `accounts.default = <credencial_legada>`
- escrita: qualquer mutacao salva no formato v2

### 6.3 Schema em codigo

Arquivo principal: `packages/opencode/src/auth/index.ts`

Adicionar:

- `Auth.Accounts` (objeto com `default` e `accounts`)
- `Auth.Storage` (record provider -> Accounts)
- parser que aceite `Info | Accounts` no input e normalize para `Accounts`

## 7. API Interna de Auth

Evolucao da namespace `Auth`:

1. `all(): Promise<Record<string, Accounts>>`
2. `list(providerID?: string): Promise<Record<string, Info> | Record<string, Record<string, Info>>>`
3. `get(providerID: string, account?: string): Promise<Info | undefined>`
4. `set(providerID: string, info: Info, account?: string): Promise<void>`
5. `use(providerID: string, account: string): Promise<void>`
6. `remove(providerID: string, account?: string): Promise<void>`
7. `default(providerID: string): Promise<string | undefined>`

Regras:

- `account` default para `"default"` no `set` quando provider nao existir
- `set` em conta nova nao deve alterar default automaticamente se ja existir default
- `remove(provider, account)`:
  - se remover conta ativa e houver outras, promover uma conta deterministica (ordem alfabetica)
  - se remover ultima conta, remover provider inteiro

## 8. Design CLI

Arquivo: `packages/opencode/src/cli/cmd/auth.ts`

### 8.1 `opencode auth login`

Fluxo:

1. selecionar provider (igual hoje)
2. executar fluxo de auth (oauth/api/plugin)
3. perguntar alias da conta:
   - default sugestao: `default`
   - validacao: `^[a-z0-9][a-z0-9-_]{0,31}$`
4. opcional: "usar como conta padrao agora?" (sim/nao)

### 8.2 `opencode auth list`

Exibir por provider:

- provider name
- tipo de cada conta (`api`, `oauth`, `wellknown`)
- marcador da conta ativa (`*`)
- metadados relevantes quando existirem (`accountId`)

Exemplo:

```txt
OpenAI
  * work      oauth  accountId=org_work
    personal  api
```

### 8.3 `opencode auth use`

Novo comando:

```bash
opencode auth use
opencode auth use openai personal
```

Com argumento opcional para modo nao interativo.
Sem argumentos, abre prompt provider -> conta.

### 8.4 `opencode auth logout`

Ajustar para permitir:

- remover conta especifica
- remover provider inteiro (acao explicita)

Fluxo recomendado:

1. selecionar provider
2. selecionar conta ou "all accounts"
3. confirmar quando for "all accounts"

### 8.5 Interface obrigatoria para troca de conta (TUI/app)

Objetivo: permitir troca de conta ativa sem sair da interface principal.

Requisitos minimos:

1. Expor acao no TUI (slash command ou dialog de provider) para "Switch account".
2. Listar contas por provider com marcador da conta ativa.
3. Permitir trocar conta com confirmacao visual imediata.
4. Reutilizar backend de `Auth.use` para manter consistencia com a CLI.
5. Cobrir fluxo com teste de integracao (quando aplicavel ao modulo).

## 9. Resolucao de Conta no Runtime

Arquivos alvo:

- `packages/opencode/src/provider/auth.ts`
- `packages/opencode/src/config/config.ts`
- pontos de chamada que leem credencial para provider

### 9.1 Precedencia de resolucao

1. override explicito da chamada (quando existir)
2. config de projeto (`opencode.json`) para conta do provider
3. env var dedicada (opcional na fase 1, recomendado fase 1.5)
4. conta default do provider

### 9.2 Chave de configuracao sugerida

No `opencode.json`:

```json
{
  "auth": {
    "account": {
      "openai": "work",
      "anthropic": "personal"
    }
  }
}
```

Se essa chave for adicionada na fase 1, deve entrar no schema de config com docs.
Se ficar para fase 2, manter apenas default global via `auth use`.

## 10. OAuth e Plugins

Nos fluxos OAuth/plugin:

- continuar salvando `accountId` quando o provider retornar esse campo
- associar resultado ao alias escolhido no CLI
- manter comportamento atual para providers que retornam `provider` custom no callback

## 11. Migracao

### 11.1 Estrategia

- migracao lazy na leitura
- persistencia no novo formato na primeira escrita
- sem comando manual obrigatorio

### 11.2 Integridade

- parse robusto por item
- entradas invalidas sao ignoradas (como hoje), sem derrubar carga inteira
- escrita atomica via `Bun.write`

### 11.3 Rollback

Nao ha rollback automatico de arquivo.
Para seguranca operacional, documentar backup manual:

```bash
cp ~/.local/share/opencode/auth.json ~/.local/share/opencode/auth.json.bak
```

## 12. Plano de Testes

### 12.1 Unitarios (Auth core)

Arquivo sugerido: `packages/opencode/test/auth/auth.test.ts`

Cenarios:

1. ler formato legado e normalizar corretamente
2. `set` cria provider e conta default
3. `set` adiciona segunda conta sem trocar default
4. `use` troca default para conta existente
5. `remove` conta nao default preserva default
6. `remove` conta default promove outra
7. `remove` ultima conta apaga provider
8. parser ignora entradas invalidas

### 12.2 CLI integration

Arquivos em `packages/opencode/test/...`

1. `auth list` mostra marcador de default
2. `auth use` altera conta ativa
3. `auth logout` remove somente conta escolhida

### 12.3 Runtime integration

1. provider resolve conta por default
2. provider resolve conta por override de config
3. fallback legado continua funcional

## 13. Riscos e Mitigacoes

1. Risco: quebrar leitura de auth legado.
   Mitigacao: parser dual + testes de fixture legado.

2. Risco: confusao de UX com muitas opcoes.
   Mitigacao: defaults fortes e fluxo interativo curto.

3. Risco: conflito de nomes de conta.
   Mitigacao: validacao e confirmacao de overwrite.

4. Risco: providers com oauth diferente por tenant.
   Mitigacao: preservar `accountId` e expor no `auth list`.

## 14. Fases de Entrega

### Fase 1 (core)

- schema/auth storage v2
- compat legado
- API interna (`get/set/use/remove/list`)
- testes unitarios de auth

### Fase 2 (CLI)

- `auth login` com alias
- `auth list` com contas
- `auth use`
- `auth logout` granular
- interface no TUI/app para troca de conta ativa
- testes de CLI

### Fase 3 (runtime/config)

- resolucao por conta ativa
- override por config/env (se aprovado no escopo)
- testes de integracao de provider

### Fase 4 (docs e hardening)

- docs de comandos novos
- troubleshooting multi-auth
- validacao final com cenarios work/personal

## 15. Definicao de Pronto (DoD)

1. Usuario consegue autenticar duas contas OpenAI no mesmo ambiente.
2. Usuario alterna conta ativa com um comando (`auth use`) sem relogar.
3. Sessao usa a conta esperada conforme regra de precedencia.
4. Usuarios legados nao precisam fazer nenhuma acao manual.
5. Suite de testes adicionada e passando nos modulos afetados.
6. Docs publicadas com exemplos reais.
7. Existe interface no TUI/app para trocar conta ativa por provider.
8. `typecheck` e `build` passam sem erros nos pacotes afetados.

## 16. Checklist de Implementacao

1. Atualizar `Auth` schema e normalizacao legado.
2. Implementar API interna multi-account.
3. Atualizar fluxos de `auth login/list/logout`.
4. Adicionar `auth use`.
5. Integrar resolucao de conta no runtime.
6. Adicionar/atualizar testes.
7. Atualizar docs PT-BR + EN.
8. Validar manualmente com duas contas no mesmo provider.
9. Implementar interface no TUI/app para troca de conta.
10. Garantir `build` e `typecheck` verdes antes de merge.

## 17. Exemplos de Uso Final

```bash
# login da conta corporativa
opencode auth login
# alias: work

# login da conta pessoal
opencode auth login
# alias: personal

# ver estado
opencode auth list

# trocar conta ativa
opencode auth use openai personal

# remover so a conta pessoal
opencode auth logout
```

## 18. Open Questions

1. Queremos incluir override por config ja na primeira entrega?
2. Precisamos de suporte explicito por sessao (`--account`) na CLI principal?
3. Qual UX final preferimos para troca no TUI: comando dedicado (`/account`) ou dentro de `/connect`?
