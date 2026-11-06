# Shared helpers for the release scripts. Sourced, never executed.
#
# These scripts run in sign and publish jobs that hold secrets. They must never execute repository code
# or artifact contents: artifacts are data, and every value that names a destination comes from the
# environment the workflow sets (OPENCODE_VERSION, OPENCODE_CHANNEL, OPENCODE_DRY_RUN, ...).

set -euo pipefail
# Without this, set -e does not apply inside $(...), so a failing command in a function called as
# files=$(upload_files ...) is ignored. macOS /bin/bash is 3.2, which lacks the option.
if [ "${BASH_VERSINFO[0]}" -gt 4 ] || { [ "${BASH_VERSINFO[0]}" = 4 ] && [ "${BASH_VERSINFO[1]}" -ge 4 ]; }; then
  shopt -s inherit_errexit
fi

# shellcheck disable=SC2034 # used by the scripts that source this file
release_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

die() {
  echo "::error::$*" >&2
  exit 1
}

dry_run() {
  [ "${OPENCODE_DRY_RUN:-false}" = true ]
}

sha256() {
  if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# Windows runners pass D:\a\_temp style paths; Git Bash tools want /d/a/_temp.
posix() {
  if command -v cygpath > /dev/null; then cygpath -u "$1"; else printf '%s' "$1"; fi
}

size() {
  wc -c < "$1" | tr -d ' '
}

# Uploads files to opencode.ai/files/bin/<version>/ and prints the update-server file map.
upload_files() {
  local credentials=false
  for file in "$@"; do
    test -s "$file" || die "Missing release file: $file"
    local name type
    name=$(basename "$file")
    case "$name" in
      *.tar.gz) type=application/gzip ;;
      *.zip) type=application/zip ;;
      *) type=application/octet-stream ;;
    esac
    if dry_run; then
      echo "dry-run upload: bin/$OPENCODE_VERSION/$name" >&2
    else
      if [ "$credentials" = false ]; then
        r2_credentials
        credentials=true
      fi
      upload_file "$file" "$name" "$type" || die "Upload failed: $name"
    fi
    jq -n --arg name "$name" --arg url "https://opencode.ai/files/bin/$OPENCODE_VERSION/$name" \
      --arg sha256 "$(sha256 "$file" | cut -c1-64)" --argjson size "$(size "$file")" \
      '{($name): {url: $url, sha256: $sha256, size: $size}}'
  done | jq -s 'add'
}

# Uploads one file to R2 and confirms the stored object has the local size: upload_file <file> <name> <type>.
# R2 intermittently rejects CompleteMultipartUpload with InvalidPart, so failed uploads are retried.
upload_file() {
  local key="bin/$OPENCODE_VERSION/$2" endpoint="https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" attempt
  for attempt in 1 2 3; do
    if aws s3 cp "$1" "s3://opencode-production-files/$key" --only-show-errors --endpoint-url "$endpoint" \
      --content-type "$3" --content-disposition "attachment; filename=\"$2\"" \
      --cache-control "public, max-age=31536000, immutable" >&2 &&
      [ "$(aws s3api head-object --bucket opencode-production-files --key "$key" --endpoint-url "$endpoint" \
        --query ContentLength --output text)" = "$(size "$1")" ]; then
      return
    fi
    echo "::warning::Upload attempt $attempt failed: $2" >&2
    sleep $((attempt * 5))
  done
  return 1
}

# R2 accepts the API token ID as the access key and SHA-256(token) as the secret.
r2_credentials() {
  local id
  id=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" | jq -er .result.id) ||
    die "Could not resolve R2 credentials"
  export AWS_ACCESS_KEY_ID="$id"
  AWS_SECRET_ACCESS_KEY=$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256 | cut -c1-64)
  export AWS_SECRET_ACCESS_KEY
  export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  # Larger parts mean fewer CompleteMultipartUpload parts for the 200-350 MB desktop builds.
  AWS_CONFIG_FILE=$(mktemp)
  export AWS_CONFIG_FILE
  printf '[default]\ns3 =\n  multipart_threshold = 64MB\n  multipart_chunksize = 64MB\n' > "$AWS_CONFIG_FILE"
}

# Registers one artifact with the update server: publish_update <name> <distribution> <metadata json>.
publish_update() {
  local body status token attempt
  body=$(jq -n --arg channel "$OPENCODE_CHANNEL" --arg version "$OPENCODE_VERSION" --arg name "$1" --arg distribution "$2" \
    --argjson metadata "$3" '{channel: $channel, name: $name, distribution: $distribution, version: $version, metadata: $metadata}')
  echo "$body" | jq .
  if dry_run; then return; fi
  token=$(curl -fsS -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://update.opencode.ai" | jq -er .value)
  for attempt in 1 2 3; do
    status=$(curl -sS -o "$RUNNER_TEMP/update-response" -w '%{http_code}' -X POST https://opencode.ai/update/api/publish \
      -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data "$body")
    if [ "$status" -lt 300 ]; then return; fi
    cat "$RUNNER_TEMP/update-response"
    # D1 can commit the upsert and still time out. Replaying the same artifact is safe.
    if [ "$status" -lt 500 ] || [ "$attempt" = 3 ]; then die "Update server returned $status"; fi
    sleep "$attempt"
  done
}

# Clones a repository, lets a render script fill it, then commits and pushes any change:
# push_git <clone url> <commit message> <render script> [args...]. Dry runs render into an empty directory.
push_git() {
  local url=$1 message=$2 dir
  shift 2
  dir=$(mktemp -d)
  if ! dry_run; then git clone -q "$url" "$dir"; fi
  "$@" "$dir"
  if dry_run; then return; fi
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --quiet; then return; fi
  git -C "$dir" -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$message"
  git -C "$dir" push -q origin HEAD:master
}
