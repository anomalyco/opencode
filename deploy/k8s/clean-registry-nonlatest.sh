#!/usr/bin/env bash
# Delete every container image *manifest* in the DO registry that is not tagged "latest".
# Safe to re-run. Requires: doctl, jq
set -euo pipefail

REG="${DO_REGISTRY_NAME:-veritly-registry}"

while IFS= read -r repo; do
  [[ -n "$repo" ]] || continue
  mapfile -t digests < <(
    doctl registry repository list-manifests "$repo" -o json --registry "$REG" | jq -r \
      '.[] | select( ([.tags[]? | select(. == "latest")] | length) == 0 ) | .digest'
  )
  for d in "${digests[@]}"; do
    [[ -n "$d" ]] || continue
    echo "delete --registry ${REG} ${repo} ${d}"
    doctl registry repository delete-manifest "$repo" "$d" --registry "$REG" --force
  done
done < <(doctl registry repository list -o json | jq -r '.[].name')

echo "Done. Check: doctl registry repository list-manifests <repo> -o json | jq '[.[].tags]'"
