#!/usr/bin/env bash
# Mints a short-lived Cloudflare token for the current job from the token issuer
# (anomalyco/secrets). Run after aws-actions/configure-aws-credentials has assumed
# arn:aws:iam::604439173067:role/github/opencode-<stage> (release, dev or production): the Lambda
# identifies the role from the SigV4 signature and mints only that stage's token. No repo, stage,
# permission or TTL is sent in the request, and the token is pinned to the runner's IP.
#
# Step-scoped by default: the token goes to $GITHUB_OUTPUT and only steps that list
# `CLOUDFLARE_API_TOKEN: ${{ steps.<id>.outputs.token }}` in their env receive it.
set -euo pipefail
set +x

url=${CLOUDFLARE_TOKEN_URL:-https://kjivkui2evldapbok5fhrrl6oy0fctkp.lambda-url.us-east-1.on.aws/}
account=${CLOUDFLARE_ACCOUNT_ID:-15d29c8639fd3733b1b5486a2acfd968}
if [[ $# == 1 ]]; then
  . "$(dirname "$0")/lib.sh"
  account=$(stage_account "$1")
fi

# One argv value, never a line in curl's config: a newline in an override must not be able to
# inject curl options or move the AWS credentials into Basic auth.
url_pattern='^https://[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws/$'
if ! [[ "$url" =~ $url_pattern ]]; then
  echo "::error::CLOUDFLARE_TOKEN_URL is not the token issuer's function URL." >&2
  exit 1
fi
case "$account" in
  *[!0-9a-f]*|"")
    echo "::error::CLOUDFLARE_ACCOUNT_ID must be a 32-character lowercase hex id." >&2
    exit 1
    ;;
esac
if [ ${#account} -ne 32 ]; then
  echo "::error::CLOUDFLARE_ACCOUNT_ID must be a 32-character lowercase hex id." >&2
  exit 1
fi
for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  if [ -z "${!name:-}" ]; then
    echo "::error::$name is not set; run aws-actions/configure-aws-credentials first." >&2
    exit 1
  fi
done

# The response is captured, never streamed: it contains the token. AWS credentials go to curl
# through stdin, not argv, so they stay out of `ps` and any trace of this script.
response=$(
  printf 'user = "%s:%s"\nheader = "x-amz-security-token: %s"\n' \
    "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" |
    curl --config - \
      --proto '=https' --proto-redir '=https' \
      --aws-sigv4 "aws:amz:us-east-1:lambda" \
      --request POST --url "$url" \
      --fail-with-body --silent --show-error --max-time 20
)

token=$(printf '%s' "$response" | jq -er 'if (.token | type) == "string" then .token else error("token") end' 2>/dev/null)
expires=$(printf '%s' "$response" | jq -er 'if (.expires_on | type) == "string" then .expires_on else error("expires_on") end' 2>/dev/null)

# Validate before any output. No error below includes the token value.
case "$token" in
  ""|*[[:space:]]*)
    echo "::error::The token issuer returned an invalid token." >&2
    exit 1
    ;;
esac
if [ ${#token} -lt 8 ] || [ ${#token} -gt 512 ]; then
  echo "::error::The token issuer returned an invalid token length." >&2
  exit 1
fi
case "$expires" in
  ""|*[[:space:]]*)
    echo "::error::The token issuer returned an invalid expires_on." >&2
    exit 1
    ;;
esac
iso_pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
if ! printf '%s' "$response" | jq -e --arg re "$iso_pattern" '(.expires_on | type) == "string" and (.expires_on | test($re))' > /dev/null; then
  echo "::error::The token issuer returned an invalid expires_on." >&2
  exit 1
fi
if ! [[ "$expires" =~ $iso_pattern ]]; then
  echo "::error::The token issuer returned an invalid expires_on." >&2
  exit 1
fi

# GitHub masks the exact string everywhere after this, including accidental traces and our own
# error messages. This is the first output that contains it.
printf '::add-mask::%s\n' "$token"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'token=%s\n' "$token"
    printf 'expires_on=%s\n' "$expires"
  } >> "$GITHUB_OUTPUT"
elif [ -n "${GITHUB_ENV:-}" ]; then
  printf 'CLOUDFLARE_API_TOKEN=%s\n' "$token" >> "$GITHUB_ENV"
fi

# Verify immediately, with the token on curl's stdin rather than argv. A runner whose Cloudflare
# egress address differs from the address Lambda saw (IPv4 vs IPv6, or a different NAT address)
# fails here instead of part way through an upload.
verify_url="https://api.cloudflare.com/client/v4/accounts/$account/tokens/verify"
if ! verify=$(printf 'header = "Authorization: Bearer %s"\nurl = "%s"\n' "$token" "$verify_url" |
  curl --config - --proto '=https' --proto-redir '=https' --silent --show-error --fail-with-body --max-time 20); then
  echo "::error::Cloudflare rejected the freshly minted token. The runner's egress IP to Cloudflare may differ from the IP Lambda saw (IPv4 vs IPv6 or a different NAT address). Use a runner with stable egress." >&2
  exit 1
fi

if ! printf '%s' "$verify" | jq -e '.success == true and .result.status == "active"' > /dev/null; then
  echo "::error::Cloudflare did not report the freshly minted token as active." >&2
  exit 1
fi

echo "::notice::Cloudflare token ready; expires $expires"
