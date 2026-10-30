#!/usr/bin/env bash
# verify-artifacts.sh <dir>: checks every artifact downloaded into <dir>/<name> against its SHA256SUMS and that it
# holds exactly the listed files. Artifacts made by sign jobs (sign-*) must also match the manifest digest their
# job reported (OPENCODE_DIGESTS="name=digest ..."), so an artifact replaced after that job finished is rejected.
. "$(dirname "$0")/lib.sh"

root=$(posix "$1")
for dir in "$root"/*/; do
  name=$(basename "$dir")
  digest=""
  for pair in ${OPENCODE_DIGESTS:-}; do
    if [ "${pair%%=*}" = "$name" ]; then digest=${pair#*=}; fi
  done
  case "$name" in sign-*) [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "Missing digest for $name" ;; esac
  (
    cd "$dir"
    if [ -n "$digest" ] && [ "$(sha256 SHA256SUMS | cut -c1-64)" != "$digest" ]; then die "SHA256SUMS digest mismatch in $name"; fi
    sha256 -c SHA256SUMS > /dev/null || die "Checksum mismatch in $name"
    diff <(find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort) <(cut -c67- SHA256SUMS | LC_ALL=C sort) ||
      die "Unexpected files in $name"
  )
  echo "verified $name${digest:+ ($digest)}"
done
