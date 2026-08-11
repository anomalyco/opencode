# Fryn Backend — 12 licenças + roteamento free-first

Gateway privado do Fryn. Ele mantém a credencial real de IA fora do `.exe`, autoriza no máximo 12 instalações e encaminha as chamadas do app por uma cadeia automática de modelos.

## Experiência do funcionário

O funcionário recebe somente `Fryn-Setup.exe`, instala e abre. A primeira execução registra automaticamente uma das 12 vagas. No aplicativo existe apenas **Fryn AI** e o modelo lógico `assistant`: não há seletor de modelo, chave, provedor ou nome de fornecedor.

## Roteamento padrão

A cadeia padrão é:

1. `cohere/north-mini-code:free`
2. `qwen/qwen3-coder:free`
3. `openrouter/free`
4. `qwen/qwen3.7-flash` — fallback pago opcional

O backend envia os modelos gratuitos em lotes de no máximo 3, respeitando o limite atual do array `models` do OpenRouter. Se todos os gratuitos falharem por indisponibilidade/rate limit, o Fryn faz uma nova chamada separada para o fallback pago opcional. O nome concreto do modelo retornado é sanitizado antes de chegar ao desktop.

Você pode trocar os modelos sem recompilar o `.exe` usando `FRYN_FREE_MODELS` e `FRYN_PAID_FALLBACK_MODEL`.

## Configuração recomendada

1. Copie `.env.example` para `.env`.
2. Preencha `OPENROUTER_API_KEY` e um `FRYN_ADMIN_TOKEN` longo e aleatório.
3. Mantenha `FRYN_MAX_LICENSES=12`.
4. Para máxima disponibilidade no expediente, mantenha `FRYN_ENABLE_PAID_FALLBACK=true` e saldo disponível no OpenRouter. Se não quiser nenhum gasto, use `false` — quando todos os gratuitos estiverem indisponíveis/limitados, a chamada falhará em vez de gerar cobrança.
5. Rode `docker compose up -d --build` ou `node server.mjs` com as mesmas variáveis.
6. Publique em HTTPS e use a URL na variável de build `FRYN_BACKEND_URL` do desktop.
7. Abra `https://SEU_BACKEND/admin` para ver, revogar e liberar as 12 instalações.

## Privacidade

`FRYN_DATA_COLLECTION=allow` prioriza disponibilidade gratuita. Para código corporativo sensível, considere:

```env
FRYN_DATA_COLLECTION=deny
FRYN_REQUIRE_ZDR=true
```

Isso restringe os endpoints elegíveis e pode fazer o Fryn chegar ao fallback pago mais cedo ou não encontrar um endpoint gratuito compatível.

## Administração por terminal

Com `FRYN_BACKEND_URL` e `FRYN_ADMIN_TOKEN` definidos:

```bash
node admin-cli.mjs list
node admin-cli.mjs revoke INSTALLATION_ID
node admin-cli.mjs restore INSTALLATION_ID
node admin-cli.mjs delete INSTALLATION_ID
```

`delete` invalida a instalação e libera a vaga para um novo computador.

## Segurança

- A chave real de IA existe somente nas variáveis de ambiente deste servidor.
- O `.exe` recebe apenas um token de licença revogável por instalação.
- Use HTTPS antes de distribuir o app fora de uma rede local controlada.
- Não coloque `OPENROUTER_API_KEY` em arquivos enviados aos funcionários.
- Defina limites de gasto/guardrails na conta OpenRouter se habilitar o fallback pago.
