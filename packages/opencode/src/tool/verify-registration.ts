// Verify command_session tool is registered
import { Effect, Context, Layer } from "effect"
import { ToolRegistry } from "./registry"

const program = Effect.gen(function* () {
  const registry = yield* ToolRegistry.Service
  const tools = yield* registry.all()
  console.log("Tool count:", tools.length)
  const cmdSession = tools.find((t: any) => t.id === "command_session")
  if (cmdSession) {
    console.log("✓ command_session tool found!")
    console.log("  ID:", cmdSession.id)
    console.log("  Description:", cmdSession.description)
  } else {
    console.log("✗ command_session tool NOT found")
    console.log("Available tools:")
    tools.forEach((t: any) => console.log("  -", t.id))
  }
})

Effect.runPromise(program).then(
  () => process.exit(0),
  (error) => {
    console.error("Error:", error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
