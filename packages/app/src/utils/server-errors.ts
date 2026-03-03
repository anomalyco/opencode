export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

type Label = {
  unknown: string
  invalidConfiguration: string
}

const fallback: Label = {
  unknown: "Unknown error",
  invalidConfiguration: "Invalid configuration",
}

function resolveLabel(labels: Partial<Label> | undefined): Label {
  return {
    unknown: labels?.unknown ?? fallback.unknown,
    invalidConfiguration: labels?.invalidConfiguration ?? fallback.invalidConfiguration,
  }
}

export function formatServerError(error: unknown, labels?: Partial<Label>) {
  if (isConfigInvalidErrorLike(error)) return parseReabaleConfigInvalidError(error, labels)
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return resolveLabel(labels).unknown
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

export function parseReabaleConfigInvalidError(errorInput: ConfigInvalidError, labels?: Partial<Label>) {
  const head = resolveLabel(labels).invalidConfiguration
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : ""
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? []).map((issue) => {
    return `${issue.path.join(".")}: ${issue.message}`
  })
  if (issues.length) return [head, file, "", ...issues].filter(Boolean).join("\n")
  return [head, file, detail].filter(Boolean).join("\n")
}
