const PAIRS: [string, string][] = [
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

/** Flat JSON for PostHog `register` and `GET /global/veritly-deployment` (empty keys omitted). */
export function railwayDeploymentFlat(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [jsonKey, envKey] of PAIRS) {
    const v = process.env[envKey]?.trim()
    if (v) out[jsonKey] = v
  }
  return out
}

/** Prefix with `veritly.` for OpenTelemetry resource attributes. */
export function railwayOtelResourceAttributes(): Record<string, string> {
  const flat = railwayDeploymentFlat()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(flat)) {
    out[`veritly.${k}`] = v
  }
  return out
}
