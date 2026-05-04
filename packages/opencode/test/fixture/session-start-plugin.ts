export default async () => ({
  "session.start": (input: { parentSessionID?: string; agent?: string; parentAgent?: string }, output: { context: string[] }) => {
    output.context.push(
      [
        "session start context",
        `parent=${input.parentSessionID ?? "none"}`,
        `agent=${input.agent ?? "none"}`,
        `parentAgent=${input.parentAgent ?? "none"}`,
      ].join(" "),
    )
  },
})
