/** Legacy Railway env keys (still set on Railway). */
const RAILWAY_PAIRS: [string, string][] = [
  ["railway_project_id", "RAILWAY_PROJECT_ID"],
  ["railway_environment_id", "RAILWAY_ENVIRONMENT_ID"],
  ["railway_environment_name", "RAILWAY_ENVIRONMENT_NAME"],
  ["railway_service_id", "RAILWAY_SERVICE_ID"],
  ["railway_service_name", "RAILWAY_SERVICE_NAME"],
  ["railway_replica_id", "RAILWAY_REPLICA_ID"],
  ["railway_deployment_id", "RAILWAY_DEPLOYMENT_ID"],
  ["railway_public_domain", "RAILWAY_PUBLIC_DOMAIN"],
  ["railway_private_domain", "RAILWAY_PRIVATE_DOMAIN"],
  ["railway_replica_region", "RAILWAY_REPLICA_REGION"],
  ["railway_project_name", "RAILWAY_PROJECT_NAME"],
]

/** Kubernetes downward API + release tags. */
const K8S_PAIRS: [string, string][] = [
  ["pod_name", "POD_NAME"],
  ["pod_namespace", "POD_NAMESPACE"],
  ["pod_ip", "POD_IP"],
  ["node_name", "NODE_NAME"],
  ["deployment_environment", "DEPLOYMENT_ENVIRONMENT"],
  ["opencode_version", "OPENCODE_VERSION"],
]

function putPairs(out: Record<string, string>, pairs: [string, string][]) {
  for (const [jsonKey, envKey] of pairs) {
    const v = process.env[envKey]?.trim()
    if (v) out[jsonKey] = v
  }
}

/** Flat JSON for routes / PostHog-style registration. */
export function deploymentInfoFlat(): Record<string, string> {
  const out: Record<string, string> = {}
  putPairs(out, K8S_PAIRS)
  putPairs(out, RAILWAY_PAIRS)
  return out
}

/** @deprecated Use {@link deploymentInfoFlat}; kept for imports named `railwayDeploymentFlat`. */
export function railwayDeploymentFlat(): Record<string, string> {
  const out: Record<string, string> = {}
  putPairs(out, RAILWAY_PAIRS)
  return out
}

/** Prefix with `veritly.` for OpenTelemetry resource attributes. */
export function veritlyOtelResourceAttributes(): Record<string, string> {
  const flat = deploymentInfoFlat()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(flat)) {
    out[`veritly.${k}`] = v
  }
  return out
}

/** @deprecated Use {@link veritlyOtelResourceAttributes}. */
export const railwayOtelResourceAttributes = veritlyOtelResourceAttributes
