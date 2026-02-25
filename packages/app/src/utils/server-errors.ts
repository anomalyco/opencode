export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export function formatServerError(error: unknown) {
  if (isConfigInvalidErrorLike(error)) return parseReabaleConfigInvalidError(error)
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Unknown error"
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

export function parseReabaleConfigInvalidError(errorInput: ConfigInvalidError) {
  const head = "Invalid configuration"
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : ""
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? []).map((issue) => {
    return `${issue.path.join(".")}: ${issue.message}`
  })
  if (issues.length) return [head, file, "", ...issues].filter(Boolean).join("\n")
  return [head, file, detail].filter(Boolean).join("\n")
}
