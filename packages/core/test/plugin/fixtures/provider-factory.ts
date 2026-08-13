export function createFixtureProvider(options: Record<string, unknown>) {
  const captured = Object.fromEntries(Object.entries(options))
  return Object.assign((modelID: string) => ({ modelID, options: captured }), {
    options: captured,
    languageModel(modelID: string) {
      return { modelID, options: captured }
    },
  })
}
