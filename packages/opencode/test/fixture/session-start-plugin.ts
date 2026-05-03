export default async () => ({
  "session.start": (_input: unknown, output: { context: string[] }) => {
    output.context.push("session start context")
  },
})
