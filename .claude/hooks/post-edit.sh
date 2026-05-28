#!/usr/bin/env bash
# Hook post-edit do Claude Code.
# Roda Prettier + ESLint --fix em arquivos JS/TS recém-editados.
# Falhas das ferramentas não bloqueiam o fluxo (best-effort): formatamos
# se possível e seguimos o jogo. O gate forte fica no pre-commit/CI.

set -euo pipefail

# Primeiro argumento = caminho do arquivo editado pelo Claude.
FILE="${1:-}"

# Sem arquivo, nada a fazer.
[[ -z "$FILE" ]] && exit 0

# Só formata se o arquivo existir (pode ter sido deletado).
[[ ! -f "$FILE" ]] && exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    # Prettier formata, ESLint corrige o que dá.
    npx --no-install prettier --write "$FILE" 2>/dev/null || true
    npx --no-install eslint --fix "$FILE" 2>/dev/null || true
    ;;
  *)
    # Outros tipos de arquivo: ignora silenciosamente.
    ;;
esac

exit 0
