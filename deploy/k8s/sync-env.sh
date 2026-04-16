#!/bin/bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$dir/../.." && pwd)"
file="${1:-$root/.env.production}"
ns="${K8S_NAMESPACE:-veritly}"

if [ ! -f "$file" ]; then
  echo "env file not found: $file" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

secret="$tmp/secret.env"
config="$tmp/config.env"
touch "$secret" "$config"

while IFS= read -r row || [ -n "$row" ]; do
  line="$(printf '%s' "$row" | sed 's/\r$//')"
  case "$line" in
    ""|\#*)
      continue
      ;;
  esac
  key="${line%%=*}"
  case "$key" in
    OPENCODE_SERVER_PASSWORD|DATABASE_URL|WORKOS_API_KEY|WORKOS_CLIENT_ID|COOKIE_PASSWORD|OTEL_EXPORTER_OTLP_HEADERS|AXIOM_TOKEN|VITE_PUBLIC_AXIOM_TOKEN|VITE_UNIVER_LICENSE)
      printf '%s\n' "$line" >> "$secret"
      ;;
    *)
      printf '%s\n' "$line" >> "$config"
      ;;
  esac
done < "$file"

kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -

kubectl create configmap veritly-config \
  --namespace "$ns" \
  --from-env-file="$config" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

kubectl create secret generic veritly-secrets \
  --namespace "$ns" \
  --from-env-file="$secret" \
  --dry-run=client \
  -o yaml | kubectl apply -f -

echo "synced $file to $ns/veritly-config and $ns/veritly-secrets"
