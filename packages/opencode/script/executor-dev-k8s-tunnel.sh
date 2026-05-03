#!/usr/bin/env bash
# Port-forward svc/executor-dev → 127.0.0.1 — waits for a Ready pod first.
# Used by humans (`bun run executor-dev:k8s-tunnel`) and executor SDK tests (fixture spawns this).
#
# Env:
#   K8S_NAMESPACE               default veritly
#   VERITLY_EXECUTOR_PF_LOCAL   local port, default 7777
#   VERITLY_EXECUTOR_PF_READY_TIMEOUT  kubectl wait timeout, default 180s

set -euo pipefail

NS="${K8S_NAMESPACE:-veritly}"
LOCAL="${VERITLY_EXECUTOR_PF_LOCAL:-7777}"
READY_TIMEOUT="${VERITLY_EXECUTOR_PF_READY_TIMEOUT:-180s}"

echo "Waiting for executor-dev pod (ready) in ${NS}..." >&2
if ! kubectl wait --for=condition=ready pod -l app=executor-dev -n "${NS}" --timeout="${READY_TIMEOUT}" 2>/dev/null; then
  echo "" >&2
  echo "No ready executor-dev pod — port-forward will hang or time out. Debug:" >&2
  kubectl get deployment,svc,pods -n "${NS}" -l app=executor-dev 2>/dev/null || true
  kubectl get pods -n "${NS}" -l app=executor-dev -o wide >&2 || true
  exit 1
fi

echo "Tunnel 127.0.0.1:${LOCAL} -> svc/executor-dev:7777 (leave running)." >&2
echo "export VERITLY_EXECUTOR_URL=http://127.0.0.1:${LOCAL}" >&2
exec kubectl port-forward -n "${NS}" svc/executor-dev "${LOCAL}:7777"
