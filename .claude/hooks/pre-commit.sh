#!/usr/bin/env bash
# Hook pre-commit do Claude Code.
# Roda a suite de testes em modo silencioso e BLOQUEIA o commit se vermelho.
# Mensagens em pt-BR para feedback rápido. CI roda o set completo (lint + e2e);
# aqui o foco é evitar commit obviamente quebrado.

set -euo pipefail

echo "[pre-commit] Rodando testes locais antes do commit..."

# Garante que existe package.json antes de tentar npm test.
if [[ ! -f "package.json" ]]; then
  echo "[pre-commit] package.json não encontrado. Pulando testes."
  exit 0
fi

# Roda a menor suite real deste pacote. Se falhar, bloqueia.
if grep -q '"test:cli"\s*:' package.json; then
  TEST_CMD=(npm run test:cli --silent)
elif grep -q '"test"\s*:' package.json; then
  TEST_CMD=(npm test --silent)
else
  echo "[pre-commit] Nenhum script de teste encontrado. Pulando testes."
  exit 0
fi

if ! "${TEST_CMD[@]}"; then
  echo ""
  echo "[pre-commit] FALHOU: testes vermelhos. Commit bloqueado."
  echo "[pre-commit] Corrija os testes antes de commitar."
  echo "[pre-commit] Para depurar: rode o script de teste configurado no package.json e leia o output."
  exit 1
fi

echo "[pre-commit] Testes verdes. Seguindo com o commit."
exit 0
