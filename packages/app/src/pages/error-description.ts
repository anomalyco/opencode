export function errorDescriptionKey(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "localServerStartup" in error &&
    error.localServerStartup === true
  ) {
    return "error.page.description.localServerStartup" as const
  }
  return "error.page.description" as const
}
