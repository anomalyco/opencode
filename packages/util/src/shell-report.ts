// A shell tool result leads with a model-facing header: `Exit code: `, any status lines, then `Output:`.
const marker = "\nOutput:\n"

export function formatShellReport(input: {
  exitCode: number | string
  status?: ReadonlyArray<string>
  output: string
}) {
  return [`Exit code: ${input.exitCode}`, ...(input.status ?? []), `Output:\n${input.output || "(no output)"}`].join(
    "\n",
  )
}

export function shellReportOutput(text: string) {
  const index = text.indexOf(marker)
  if (index === -1 || !text.startsWith("Exit code: ")) return text
  return text.slice(index + marker.length)
}
