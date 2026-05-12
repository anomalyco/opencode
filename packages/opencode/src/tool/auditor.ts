/**
 * ShellAuditor — Shell environment credential leak auditor
 * 
 * Redacts credential env vars before shell execution.
 */

const CREDENTIAL_KEYS: RegExp[] = [
  /^(AWS_ACCESS_KEY|AWS_SECRET|AWS_SESSION_TOKEN)$/i,
  /^(GITHUB_TOKEN|GH_TOKEN|GH_ENTERPRISE_TOKEN)$/i,
  /^(DOCKER_PASSWORD|DOCKER_TOKEN)$/i,
  /^(NPM_TOKEN|NPM_AUTH_TOKEN)$/i,
  /^(PYPI_TOKEN|PYPI_PASSWORD)$/i,
  /^(ANTHROPIC_API_KEY|OPENAI_API_KEY|COHERE_API_KEY)$/i,
  /^(DEEPSEEK_API_KEY|HUOSHAN_API_KEY)$/i,
  /.*(_PASSWORD|_SECRET|_TOKEN|_KEY)$/i,
]

export interface AuditResult {
  redacted: string[]
  warning?: string
}

export function shellAudit(env: Record<string, string>): AuditResult {
  const redacted: string[] = []
  for (const key of Object.keys(env)) {
    for (const pattern of CREDENTIAL_KEYS) {
      if (pattern.test(key) && env[key] && env[key].length > 8) {
        redacted.push(key)
        env[key] = "[REDACTED]"
      }
    }
  }
  return {
    redacted,
    warning: redacted.length ? `Redacted credential env vars: ${redacted.join(", ")}` : undefined,
  }
}
