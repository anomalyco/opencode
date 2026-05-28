# Hook post-edit do Claude Code (PowerShell sibling de post-edit.sh).
# Roda Prettier + ESLint --fix em arquivos JS/TS recem-editados.
# Falhas das ferramentas nao bloqueiam o fluxo (best-effort): formatamos
# se possivel e seguimos o jogo. O gate forte fica no pre-commit/CI.

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$FilePath = ''
)

$ErrorActionPreference = 'Continue'

# Sem arquivo, nada a fazer.
if ([string]::IsNullOrWhiteSpace($FilePath)) {
    exit 0
}

# So formata se o arquivo existir (pode ter sido deletado).
if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    exit 0
}

$ext = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
$jsTsExtensions = @('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')

if ($jsTsExtensions -contains $ext) {
    # Prettier formata, ESLint corrige o que da.
    try {
        & npx --no-install prettier --write $FilePath 2>$null
    } catch { }
    try {
        & npx --no-install eslint --fix $FilePath 2>$null
    } catch { }
}

exit 0
