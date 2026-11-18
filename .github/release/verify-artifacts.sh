#!/usr/bin/env bash
# verify-artifacts.sh <dir>: checks every artifact downloaded into <dir>/<name> against its SHA256SUMS and that it
# holds exactly the listed files. Artifacts made by sign jobs (sign-*) must also match the manifest digest their
# job reported (OPENCODE_DIGESTS="name=digest ..."), so an artifact replaced after that job finished is rejected.
# Deploy jobs set OPENCODE_REQUIRE_DIGESTS=true: every artifact must match a reported digest, because the digest
# is what ties the bytes to the build job that made them.
. "$(dirname "$0")/lib.sh"

root=$(posix "$1")
# download-artifact unpacks a lone matching artifact straight into <dir>; put it back under its name, found by
# its manifest's reported digest.
if [ -f "$root/SHA256SUMS" ]; then
  lone=$(sha256 "$root/SHA256SUMS" | cut -c1-64)
  name=""
  for pair in ${OPENCODE_DIGESTS:-}; do
    if [ "${pair#*=}" = "$lone" ]; then name=${pair%%=*}; fi
  done
  [ -n "$name" ] || die "The downloaded artifact's SHA256SUMS does not have a reported digest"
  staging=$(mktemp -d)
  find "$root" -mindepth 1 -maxdepth 1 -exec mv {} "$staging/" \;
  mv "$staging" "$root/$name"
fi
shopt -s nullglob
for dir in "$root"/*/; do
  name=$(basename "$dir")
  digest=""
  for pair in ${OPENCODE_DIGESTS:-}; do
    if [ "${pair%%=*}" = "$name" ]; then digest=${pair#*=}; fi
  done
  if [ "${OPENCODE_REQUIRE_DIGESTS:-false}" = true ]; then
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "Missing digest for $name"
  else
    case "$name" in sign-*) [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "Missing digest for $name" ;; esac
  fi
  (
    cd "$dir"
    if [ -n "$digest" ] && [ "$(sha256 SHA256SUMS | cut -c1-64)" != "$digest" ]; then die "SHA256SUMS digest mismatch in $name"; fi
    sha256 -c SHA256SUMS > /dev/null || die "Checksum mismatch in $name"
    diff <(find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort) <(cut -c67- SHA256SUMS | LC_ALL=C sort) ||
      die "Unexpected files in $name"
  )
  echo "verified $name${digest:+ ($digest)}"
done
