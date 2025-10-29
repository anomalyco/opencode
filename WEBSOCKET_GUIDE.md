# OpenCode WebSocket Guide

## Overview

O OpenCode agora suporta comunicação em tempo real via WebSocket, permitindo que aplicações web se conectem ao servidor e recebam atualizações ao vivo sobre sessões, mensagens e eventos do sistema.

## Recursos

- ✅ **Conexão WebSocket bidirecional** - Comunicação em tempo real entre cliente e servidor
- ✅ **Sistema de eventos** - Receba notificações sobre mudanças em sessões
- ✅ **Envio de prompts** - Envie mensagens diretamente via WebSocket
- ✅ **Subscrição por sessão** - Filtragem automática de eventos por sessão
- ✅ **Compatibilidade com API REST** - Use WebSocket junto com endpoints HTTP existentes

## Endpoint WebSocket

```
ws://localhost:3000/ws
```

## Protocolo de Mensagens

### Mensagens do Cliente → Servidor

#### 1. Subscrever a uma Sessão

```json
{
  "type": "subscribe",
  "sessionID": "01JHQX..."
}
```

**Resposta:**
```json
{
  "type": "subscribed",
  "data": {
    "sessionID": "01JHQX..."
  }
}
```

Após a subscrição, você receberá:
1. Confirmação de subscrição
2. Estado atual da sessão (session info + mensagens)
3. Todos os eventos futuros relacionados à sessão

---

#### 2. Enviar um Prompt

```json
{
  "type": "prompt",
  "sessionID": "01JHQX...",
  "content": "Write a function to reverse a string",
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-3-5-sonnet-20241022"
  },
  "agent": "general"
}
```

**Campos opcionais:**
- `model` - Especifica o modelo LLM (usa padrão da sessão se omitido)
- `agent` - Especifica o agente (usa padrão da sessão se omitido)

**Eventos recebidos após envio:**
- `session.message.created` - Nova mensagem criada
- `session.message.part.created` - Partes da resposta sendo geradas
- `tool.*` - Eventos de execução de ferramentas
- `session.message.completed` - Mensagem completa

---

#### 3. Ping

```json
{
  "type": "ping"
}
```

**Resposta:**
```json
{
  "type": "pong"
}
```

---

### Mensagens do Servidor → Cliente

#### 1. Evento

```json
{
  "type": "event",
  "data": {
    "type": "session.message.created",
    "properties": {
      "sessionID": "01JHQX...",
      "messageID": "01JHQY...",
      ...
    }
  }
}
```

Tipos de eventos comuns:
- `server.connected` - Conexão estabelecida
- `session.created` - Nova sessão criada
- `session.updated` - Sessão atualizada
- `session.message.created` - Nova mensagem na sessão
- `session.message.part.created` - Nova parte de mensagem
- `tool.call` - Ferramenta sendo executada
- `tool.result` - Resultado da ferramenta

---

#### 2. Erro

```json
{
  "type": "error",
  "error": "Session not found"
}
```

---

## Exemplo de Uso - JavaScript

### Conexão Básica

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('Connected to OpenCode WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'event':
      handleEvent(message.data);
      break;
    case 'error':
      console.error('Error:', message.error);
      break;
    case 'subscribed':
      console.log('Subscribed to session:', message.data.sessionID);
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket disconnected');
};
```

### Criar Sessão e Subscrever

```javascript
// 1. Criar sessão via API REST
async function createAndSubscribe() {
  const response = await fetch('http://localhost:3000/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const session = await response.json();
  console.log('Session created:', session.id);

  // 2. Subscrever via WebSocket
  ws.send(JSON.stringify({
    type: 'subscribe',
    sessionID: session.id
  }));
}
```

### Enviar Prompt

```javascript
function sendPrompt(sessionID, content) {
  ws.send(JSON.stringify({
    type: 'prompt',
    sessionID: sessionID,
    content: content
  }));
}

// Uso
sendPrompt('01JHQX...', 'Explain how async/await works in JavaScript');
```

### Receber Eventos

```javascript
function handleEvent(event) {
  console.log('Event type:', event.type);

  switch (event.type) {
    case 'session.message.created':
      console.log('New message:', event.properties);
      break;

    case 'session.message.part.created':
      // Streaming de resposta
      console.log('Message part:', event.properties);
      break;

    case 'tool.call':
      console.log('Tool executing:', event.properties.tool);
      break;

    case 'tool.result':
      console.log('Tool completed:', event.properties);
      break;
  }
}
```

---

## Exemplo de Uso - React/SolidJS

```typescript
import { createSignal, onMount, onCleanup } from 'solid-js';

function ChatComponent() {
  const [messages, setMessages] = createSignal([]);
  let ws: WebSocket | null = null;

  onMount(() => {
    // Conectar ao WebSocket
    ws = new WebSocket('ws://localhost:3000/ws');

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'event' &&
          message.data.type === 'session.message.created') {
        setMessages(prev => [...prev, message.data.properties]);
      }
    };

    onCleanup(() => {
      ws?.close();
    });
  });

  const sendMessage = (content: string) => {
    ws?.send(JSON.stringify({
      type: 'prompt',
      sessionID: currentSessionID,
      content
    }));
  };

  return (
    <div>
      {/* UI components */}
    </div>
  );
}
```

---

## Fluxo de Trabalho Completo

### 1. Iniciar Servidor

```bash
cd packages/opencode
bun run dev serve --port 3000
```

### 2. Testar com Cliente HTML

```bash
# Abra o arquivo de teste no navegador
open packages/opencode/test-websocket.html
```

Ou use um servidor HTTP local:

```bash
cd packages/opencode
python -m http.server 8080
# Abra http://localhost:8080/test-websocket.html
```

### 3. Workflow Típico

1. **Conectar** ao WebSocket
2. **Criar sessão** via API REST (`POST /session`)
3. **Subscrever** à sessão via WebSocket (`subscribe`)
4. **Enviar prompts** via WebSocket (`prompt`)
5. **Receber eventos** em tempo real
6. **Visualizar** mensagens e resultados de ferramentas

---

## Comparação: WebSocket vs SSE vs REST

| Recurso | WebSocket | SSE (Server-Sent Events) | REST |
|---------|-----------|--------------------------|------|
| Bidirecional | ✅ Sim | ❌ Não (apenas servidor→cliente) | ❌ Não |
| Tempo Real | ✅ Sim | ✅ Sim | ❌ Polling necessário |
| Overhead | Baixo | Médio | Alto (nova conexão por request) |
| Uso Recomendado | Apps interativos | Notificações, logs | CRUD, operações pontuais |

**Recomendação:**
- Use **WebSocket** para aplicações web interativas que precisam de comunicação bidirecional
- Use **SSE** (`/event` endpoint) para apenas receber notificações
- Use **REST** para operações CRUD e busca de dados

---

## Eventos do Sistema

### Eventos de Sessão

- `session.created` - Sessão criada
- `session.updated` - Sessão atualizada
- `session.deleted` - Sessão deletada
- `session.error` - Erro na sessão

### Eventos de Mensagem

- `session.message.created` - Mensagem criada
- `session.message.part.created` - Parte da mensagem criada (streaming)
- `session.message.updated` - Mensagem atualizada
- `session.message.deleted` - Mensagem deletada

### Eventos de Ferramenta

- `tool.call` - Ferramenta sendo chamada
- `tool.result` - Resultado da ferramenta
- `tool.error` - Erro na execução da ferramenta

### Eventos do Servidor

- `server.connected` - Cliente conectado ao servidor

---

## Tratamento de Erros

### Erros Comuns

#### 1. Session not found
```json
{
  "type": "error",
  "error": "Session not found: 01JHQX..."
}
```
**Solução:** Verifique se o sessionID está correto ou crie uma nova sessão.

#### 2. WebSocket upgrade failed
**Solução:** Verifique se o servidor está rodando e se a URL está correta.

#### 3. Invalid message format
```json
{
  "type": "error",
  "error": "Invalid message format"
}
```
**Solução:** Verifique o formato JSON da mensagem enviada.

---

## Monitoramento

### Verificar Conexões Ativas

O servidor registra logs de conexões:

```
[server] client connected { clientID: "a1b2c3..." }
[server] client subscribed to session { clientID: "a1b2c3...", sessionID: "01JHQX..." }
[server] client disconnected { clientID: "a1b2c3..." }
```

---

## Próximos Passos

1. ✅ **WebSocket implementado** - Comunicação bidirecional funcionando
2. ⏳ **Frontend SolidJS** - Criar interface web que usa o WebSocket
3. ⏳ **Autenticação** - Adicionar tokens JWT para autenticação
4. ⏳ **Rate Limiting** - Limitar frequência de mensagens por cliente
5. ⏳ **Reconnection** - Reconexão automática com recuperação de estado

---

## Segurança

### Considerações de Produção

1. **Use WSS (WebSocket Secure)** em produção
2. **Implemente autenticação** via tokens JWT
3. **Valide todas as mensagens** no servidor
4. **Limite conexões por IP** para prevenir DoS
5. **Use CORS apropriadamente** para APIs públicas

### Exemplo com Autenticação (TODO)

```javascript
// Cliente
const ws = new WebSocket('wss://api.opencode.com/ws?token=JWT_TOKEN');

// Servidor (futuro)
// Validar token antes de aceitar upgrade
```

---

## FAQ

**P: Posso usar WebSocket e REST API juntos?**
R: Sim! Use REST para operações CRUD e WebSocket para atualizações em tempo real.

**P: O que acontece se a conexão cair?**
R: O cliente deve implementar lógica de reconexão. O servidor irá remover o cliente da lista ativa.

**P: Quantas conexões simultâneas são suportadas?**
R: Depende dos recursos do servidor. Bun é muito eficiente e pode lidar com milhares de conexões.

**P: Posso enviar arquivos via WebSocket?**
R: Atualmente não. Use a API REST (`POST /project/file`) para operações de arquivo.

---

## Recursos Adicionais

- [Documentação do Bun WebSocket](https://bun.sh/docs/api/websockets)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [OpenCode API Documentation](http://localhost:3000/doc) (quando servidor está rodando)

---

**Criado em:** 2025-10-29
**Versão:** 1.0.0
**Status:** ✅ Implementado e testado
