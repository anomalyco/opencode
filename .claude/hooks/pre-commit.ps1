# Hook pre-commit do Claude Code (PowerShell sibling de pre-commit.sh).
# Roda a suite de testes em modo silencioso e BLOQUEIA o commit se vermelho.
# Mensagens em pt-BR para feedback rapido. CI roda o set completo (lint + e2e);
# aqui o foco e evitar commit obviamente quebrado.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'

Write-Host '[pre-commit] Rodando testes locais antes do commit...'

# Garante que existe package.json antes de tentar npm test.
if (-not (Test-Path -LiteralPath 'package.json' -PathType Leaf)) {
    Write-Host '[pre-commit] package.json nao encontrado. Pulando testes.'
    exit 0
}

# Roda a menor suite real deste pacote. Se falhar, bloqueia.
$npmCmd = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
$packageJson = Get-Content -LiteralPath 'package.json' -Raw

if ($packageJson -match '"test:cli"\s*:') {
    & $npmCmd run test:cli --silent
} elseif ($packageJson -match '"test"\s*:') {
    & $npmCmd test --silent
} else {
    Write-Host '[pre-commit] Nenhum script de teste encontrado. Pulando testes.'
    exit 0
}

$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host '[pre-commit] FALHOU: testes vermelhos. Commit bloqueado.'
    Write-Host '[pre-commit] Corrija os testes antes de commitar.'
    Write-Host "[pre-commit] Para depurar: rode o script de teste configurado no package.json e leia o output."
    exit 1
}

Write-Host '[pre-commit] Testes verdes. Seguindo com o commit.'
exit 0
