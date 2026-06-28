import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"
import { Option } from "effect"

export default Runtime.handler(
  Commands.commands.task.commands.logs,
  Effect.fn("cli.task.logs")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const taskID = input.taskId
    const lines = Option.getOrUndefined(input.lines)
    const follow = input.follow

    if (follow) {
      const transport = yield* daemon.transport()
      const url = new URL(`/api/task/${taskID}/logs/stream`, transport.url)
      url.searchParams.set("location[directory]", process.cwd())

      const headers = new Headers(transport.headers)
      process.stdout.write(`Streaming logs for task ${taskID} (Press Ctrl+C to exit)...${EOL}`)

      yield* Effect.callback<void, Error>((resume) => {
        let active = true

        const runStream = async () => {
          try {
            const response = await fetch(url.toString(), { headers })
            const reader = response.body?.getReader()
            if (!reader) {
              process.stderr.write(`Stream body reader not available${EOL}`)
              resume(Effect.fail(new Error("Stream reader not available")))
              return
            }

            const decoder = new TextDecoder()
            while (active) {
              const { done, value } = await reader.read()
              if (done) break
              const chunk = decoder.decode(value, { stream: true })
              const chunkLines = chunk.split("\n")
              for (const line of chunkLines) {
                if (line.startsWith("data: ")) {
                  const rawData = line.slice(6).trim()
                  try {
                    const parsed = JSON.parse(rawData)
                    process.stdout.write(parsed.data + EOL)
                  } catch {
                    process.stdout.write(rawData + EOL)
                  }
                }
              }
            }
            resume(Effect.void)
          } catch (err: any) {
            if (active) resume(Effect.fail(err))
          }
        }

        runStream()

        process.on("SIGINT", () => {
          active = false
          resume(Effect.void)
        })
      })
    } else {
      const response = yield* Effect.promise(() =>
        client.v2.task.logs({
          taskID,
          location: { directory: process.cwd() },
          lines: lines !== undefined ? String(lines) : undefined,
        }),
      )

      if (response.data) {
        process.stdout.write(response.data.data + EOL)
      } else {
        process.stderr.write(`Failed to get logs: ${JSON.stringify(response.error)}${EOL}`)
      }
    }
  }),
)
