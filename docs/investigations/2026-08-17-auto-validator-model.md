# Investigação: modelo do validador de permissões no modo auto

Data: 2026-08-17
Escopo: instalação local e código desta branch, sem alteração de runtime.

## Resultado

O modelo do agente oculto `command-validator` já é configurável em
`opencode.json`:

```json
{
  "agent": {
    "command-validator": {
      "model": "provider/model"
    }
  }
}
```

O valor configurado explicitamente vence o modelo principal da sessão. Sem
esse campo, o código usa o small model do provider da sessão e, como fallback,
o modelo da sessão (`packages/opencode/src/permission/validator.ts:158-164`).

Não há hoje um seletor no TUI para escolher esse modelo por sessão. A troca da
configuração global pode reciclar as instâncias do servidor; uma edição direta
do arquivo precisa de reinício/dispose para que as instâncias já carregadas
releiam a configuração.

## Distinção importante

Existem dois conceitos chamados “auto”:

- O agente primário `auto` envia solicitações que chegaram a `ask` para o
  `command-validator` (`packages/opencode/src/permission/index.ts:99-110`).
- A flag `--auto` e o comando de paleta `permission.mode` respondem
  automaticamente às solicitações pendentes com `once`; eles não escolhem o
  modelo do validador (`packages/opencode/src/cli/cmd/run.ts:796-815`,
  `packages/tui/src/context/sync.tsx:227-237`).

Regras estáticas `allow` não chamam LLM; regras `deny` também não chamam LLM.
Somente regras que resultam em `ask` podem chegar ao validador.

## Evidência do runtime local

- O binário instalado é `0.0.0-host-guardrails-202608151516`.
- O servidor compartilhado é `opencode-server.service`, em
  `127.0.0.1:4096`, com dois frontends `attach` observados.
- A API autenticada `/agent` mostrou o agente oculto usando
  `opencode/deepseek-v4-flash-free`.
- O banco de auditoria ativo da instalação é
  `~/.local/share/opencode/opencode-host-guardrails.db`. Ele continha 113
  decisões: 91 `allow`, 14 `uncertain`, 4 `deny` e 4 `fallback`. Os quatro
  `fallback` chegaram a aproximadamente 15 segundos; os logs também
  registraram timeouts recentes para `bash`, `skill` e
  `external_directory`.

Isso confirma o sintoma. A causa específica ainda é hipótese: a rota/modelo
gratuito `opencode/deepseek-v4-flash-free` é o principal suspeito, mas a
evidência não separa provedor lento, fila FIFO por sessão, rede ou saturação.
O endpoint de health não foi chamado para não gerar uma chamada LLM adicional.

## Procedimento imediato recomendado

1. Esperar as sessões compartilhadas ficarem ociosas.
2. Fazer backup e editar somente `agent.command-validator.model` em
   `~/.config/opencode/opencode.json`.
3. Escolher um modelo de baixa latência já validado no catálogo local. A
   documentação do projeto contém exemplos OpenRouter e Ollama; Ollama só deve
   ser usado se o endpoint local estiver realmente disponível.
4. Reciclar a instância global ou reiniciar `opencode-server.service`. As
   sessões persistem, mas um turno que esteja executando pode ser interrompido.
5. Reabrir/continuar a mesma sessão e comparar as latências da tabela
   `permission_decisions`.

Remover o campo `model` faz herdar o small model da sessão; remover o agente ou
defini-lo como `disable` não cria uma política permissiva por si só: a falha do
validador cai no fluxo normal de permissão. Para permitir mais comandos, deve-se
preferir regras estáticas `allow` específicas; `"*": "allow"` é equivalente a
remover a proteção e deve ser tratado como decisão perigosa.

## Plano de implementação de UX por sessão

1. Adicionar em cada sessão uma configuração opcional de validador:
   `inherit`, `provider/model` ou `disabled`.
2. Fazer a resolução explícita
   `session override > agent.command-validator.model > session small model >
session model`.
3. Expor `GET/PATCH /session/:id/permission-validator` e emitir evento para o
   TUI; uma mudança vale para a próxima validação, não para uma chamada que já
   está em andamento.
4. Adicionar no TUI uma ação “Modelo do validador” com os modelos disponíveis,
   indicador de latência/health e confirmação forte para `disabled`.
5. Adicionar uma política separada para `validator disabled`, deixando claro se
   a sessão fica em `ask` humano ou usa apenas regras estáticas/`--auto`.
6. Tornar configuráveis, com limites, os budgets atuais de 15s por validação,
   45s por fila + validação e 20s do resumo; registrar modelo, latência,
   fallback e fila no painel de diagnóstico.
7. Cobrir precedência, mudança em sessão existente, timeout, fallback e
   reinício com testes de unidade e integração.

## Estado após implementação

A primeira fatia foi implementada nesta branch:

- `Session.Info` persiste `permissionValidator` com `model`, `disabled` ou
  `inherit`;
- a precedência agora é `disabled`/modelo explícito da sessão, depois
  `agent.command-validator.model`, small model da sessão e modelo da sessão;
- `GET/PATCH /session/:id/permission-validator` permite alterar sessões já
  abertas sem reiniciar o servidor;
- o TUI expõe **Choose permission validator** na paleta dentro da sessão;
- `disabled` mantém o fluxo humano e não chama resumo, LLM ou auditoria.

Os testes de validador cobrem modelo persistido e desativação; o teste HTTP
cobre herança, seleção, desativação e limpeza do override. Health, latência
por modelo e circuit breaker continuam como evolução separada.

## Critério de aceite

Uma sessão ociosa e uma sessão já existente devem conseguir trocar apenas o
modelo do validador sem alterar o modelo principal; uma nova solicitação deve
mostrar no audit store o novo `provider/model`. Em caso de indisponibilidade,
nenhuma permissão deve ser aprovada silenciosamente pelo validador.
