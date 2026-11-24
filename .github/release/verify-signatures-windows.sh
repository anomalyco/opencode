#!/usr/bin/env bash
# verify-signatures-windows.sh <dir>: fails unless every .exe and .node under <dir> has a valid Authenticode signature.
. "$(dirname "$0")/lib.sh"

if dry_run; then
  echo "dry-run: not verifying signatures in $1"
  exit 0
fi
powershell -NoProfile -Command "
  \$ErrorActionPreference = 'Stop'
  \$files = Get-ChildItem '$(cygpath -w "$(posix "$1")")' -Recurse -Include *.exe, *.node
  if (-not \$files) { throw 'No signed files found' }
  foreach (\$file in \$files) {
    \$sig = Get-AuthenticodeSignature \$file.FullName
    if (\$sig.Status -ne 'Valid') { throw \"Invalid signature for \$(\$file.FullName): \$(\$sig.Status)\" }
  }
  Write-Output \"verified \$(\$files.Count) signatures\"
"
