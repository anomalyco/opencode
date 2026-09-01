export function errorDetails(input: { title: string; error: string; context?: string; diagnosticRef?: string }) {
  const text = [
    input.title,
    ...(input.context ? [input.context] : []),
    `Error: ${input.error}`,
    ...(input.diagnosticRef ? [`Reference: ${input.diagnosticRef}`] : []),
  ].join("\n")
  return {
    text,
    prompt: [
      "Investigate why this OpenCode component failed in the current project.",
      text,
      ...(input.diagnosticRef
        ? [
            `Find the server log entry matching reference ${input.diagnosticRef} and inspect its original cause. If the server logs are not accessible from this session, say so and ask for the matching log entry; do not infer the cause from the reference alone.`,
          ]
        : []),
      "Inspect the relevant project and global OpenCode configuration, startup or loading behavior, required environment variables or credentials, dependencies, and logs. Identify the root cause and recommend a fix. Do not expose credentials.",
    ].join("\n\n"),
  }
}
