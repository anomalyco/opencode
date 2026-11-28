# Glossário e estilo: pt-BR (`br`)

Registro informal-profissional brasileiro, tratando o leitor por **você**. Frases curtas e diretas, voz ativa, sem
calques. Português padrão com aspas curvas “ ”, reticências … e travessão — cercado de espaços. Títulos de seção em
caixa de frase. Não use dois-pontos onde o português pede outra construção.

## Mantenha em inglês

- Produtos: OpenCode, Zen, Go, Go Plus, Go Teams, OpenCode Models, OpenCode Console, Console, Desktop, Anomaly.
- Nomes de provedores, modelos, empresas, apps, ferramentas e pacotes.
- Siglas: MCP, LSP, SDK, CLI, API, TUI, JSON, ZDR, SSO, SCIM, OIDC, SAML, ACP, RPC, GUI, HTTP, URL, IDE, LLM, PTY.
- `harness`, `skill`/`skills`, `token`/`tokens`, `prompt`, `endpoint`, `gateway`, `loopback`, `bundle`, `checkpoint`,
  `commit`, `branch`, `plugin`/`plugins`, `Code Mode`, `composer`, `Diff`, `AGENTS.md`, `SKILL.md`.
- Comandos, flags, chaves e valores de configuração, variáveis de ambiente, caminhos, código, URLs.
- Rótulos de UI citados em negrito, como **Settings › Billing**, **Add credits**, **Extra Usage**.
- Nomes de planos e preços em dólar: `$10/mês`, `Go`, `Go Plus`, `Go Teams`.

## Termos

| Inglês | pt-BR | Notas |
| --- | --- | --- |
| agent, subagent | agente, subagente | `coding agent` → agente de codificação; `child agent` → subagente |
| OpenCode (the product) | OpenCode | nunca “OpenCode” traduzido nem “o OpenCode” quando soar como marca |
| workspace / team / member | espaço de trabalho / equipe / membro | Console: o espaço de trabalho é o contêiner; a equipe são as pessoas |
| Console (product) | Console | “OpenCode Console” fica inteiro |
| provider | provedor | provedor de modelos |
| model | modelo | |
| session | sessão | |
| tool, tool call | ferramenta, chamada de ferramenta | |
| permission / policy | permissão / política | |
| policy statement | regra de política | Em contexto inequívoco, só “regra” |
| config / settings | configuração / configurações | `Config` como título → Configuração |
| command / flag / option | comando / flag / opção | |
| slash command / prompt template | comando com barra / template de prompt | “Modelo” fica reservado para o modelo de IA nesses contextos |
| formatter | formatador | |
| references (feature) | referências | seção “Reference” da API → Referência |
| attachment | anexo | |
| compaction | compactação | |
| snapshot | snapshot | |
| checkpoint | checkpoint | |
| transcript | transcrição | |
| scrollback | histórico de rolagem | |
| reasoning / effort | raciocínio / esforço | |
| inference | inferência | |
| usage | uso | Console: “Uso” |
| request | requisição | Console: “requisições” |
| budget / spend limit | orçamento / limite de gastos | |
| allowance | cota de uso / limite de gastos | Go: “cota mensal”; orçamento: “limite mensal” |
| seat / seat fees | licença de usuário / cobrança por usuário | Go Teams: “a segunda licença já está incluída” |
| bearer token | token Bearer | Não use “token de portador” |
| profile (Codex) | profile | Em outros contextos, “perfil” |
| credits / balance / invoice | créditos / saldo / fatura | |
| subscription / plan | assinatura / plano | |
| API key | chave de API | |
| sign in / log in | entrar / fazer login | |
| self-hosted | auto-hospedado | |
| deploy (verb) | implantar | substantivo: deploy |
| keybind / keybinding | atalho / atalho de teclado | página “Keybinds” → Atalhos |
| theme | tema | |
| hue / hue step (theme) | matiz / nível do matiz | Preserve `hue` e outras chaves de configuração |
| home directory | diretório pessoal | Não use “diretório inicial” |
| free (tier) | grátis | “modelos grátis” |
| default | padrão | |
| enabled / disabled | ativado / desativado | |
| deprecated / legacy | obsoleto / legado | |
| preview | prévia | |
| docs / documentation | docs / documentação | “Docs” como nome da seção |

## Convenções

- Links internos continuam relativos à raiz dos docs (`/config`), nunca `/docs/...` nem `/<locale>/docs/...`.
- Preserve exatamente componentes MDX, props, blocos de código, código inline, caminhos, URLs e nomes de produtos.
- Frontmatter: traduza só `title` e `description`; mantenha as demais chaves e valores.
- Mantenha a mesma estrutura de títulos do inglês (quantidade, ordem e profundidade): os anchors dependem disso.
- Tabelas: traduza cabeçalhos e células de prosa, não valores de código nem nomes de modelos.
- Não acrescente nem omita informação. Preços, números, IDs e versões exatos.
- Evite “você pode” em excesso; prefira o imperativo ou a forma direta (“Use”, “Defina”, “Execute”).
- “Para” em vez de “a fim de”; “para que” em vez de “de modo que”.
- Não use “o mesmo” como pronome; reformule.
- Gerúndio só quando realmente simultâneo; evite “estará sendo”.

## Console marketing (`packages/site/src/i18n/br`)

| Inglês | pt-BR | Notas |
| --- | --- | --- |
| seat | licença de usuário | licenças do Claude ou do ChatGPT; “seat fees” → cobrança por usuário |
| plan / subscribe | plano / assinar | “Subscribe to Go Plus” → “Assinar o Go Plus” |
| top up credit | recarregar crédito | |
| allowance | cota de uso | cota mensal, cota de requisições |
| spend / spending | gasto / gastos | |
| open-weight models | modelos de pesos abertos | |
| frontier models | modelos de fronteira | |
| agentic coding | codificação com agentes | |
| single sign-on | login único | SSO continua SSO em contextos técnicos |
| directory sync | sincronização de diretório | |
| data handling | tratamento de dados | |
| inference | inferência | |
| Disclaimer “AI agent” | “agente de IA” only where the English says AI; OpenCode itself is always “agente de codificação de código aberto”, never “agente de codificação de IA” | |
