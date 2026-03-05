import type { GitLabConfig } from "./gitlab/gitlab"

export type ValidationResult = {
  valid: boolean
  errors?: string[]
}

export async function validateGitLabConfig(config: GitLabConfig): Promise<ValidationResult> {
  const errors: string[] = []

  // Required fields
  if (!config.baseUrl) {
    errors.push("baseUrl is required")
  }
  if (!config.token) {
    errors.push("token is required")
  }

  // Test connection
  if (config.baseUrl && config.token) {
    try {
      const response = await fetch(`${config.baseUrl}/user`, {
        headers: { "PRIVATE-TOKEN": config.token },
        signal: AbortSignal.timeout(5000),
      })

      if (response.status === 401) {
        errors.push("Invalid token")
      } else if (response.status === 404) {
        errors.push("Invalid GitLab URL")
      } else if (!response.ok) {
        errors.push(`GitLab API error: ${response.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
        errors.push("Cannot reach GitLab instance")
      } else {
        errors.push(`Connection error: ${message}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  }
}
