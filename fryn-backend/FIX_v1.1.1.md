# Fryn Backend v1.1.1 — correção de roteamento

Corrige o erro `models array must have 3 items or fewer`.

O OpenRouter recebe no máximo 3 modelos por `models`. O Fryn agora:

1. envia os modelos gratuitos em lotes de até 3;
2. se todos os gratuitos falharem com erro recuperável/rate limit, tenta o fallback pago em uma nova requisição separada;
3. continua expondo somente o modelo lógico `assistant` para o desktop;
4. continua sanitizando nomes reais de modelos/provedores nas respostas.

Não é necessário recompilar o `.exe` se apenas o backend estiver sendo atualizado e a URL do backend continuar a mesma.
