import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { BackgroundShell, ShellNotFound } from "../shell/background"

const parameters = z.object({
  shell_id: z.string().describe("The id of a background shell previously started via bash with run_in_background"),
})

const DESCRIPTION = `Read new output from a background shell started by the bash tool with \`run_in_background: true\`.

Each call drains the rolling output buffer for that shell — subsequent calls return only output produced since the last read. Reports the shell's status (running, exited, killed, errored) and exit code if available.

Use this to follow long-running processes (dev servers, watchers, test runs) without blocking the conversation. Pair with \`kill_shell\` to terminate when done.`

export const BashOutputTool = Tool.define(
  "bash_output",
  Effect.gen(function* () {
    const bg = yield* BackgroundShell.Service
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        bg
          .output({ shellID: params.shell_id })
          .pipe(
            Effect.map((result) => {
              const body = result.output || "(no new output)"
              const lines: string[] = [
                `shell_id: ${result.shellID}`,
                `status: ${result.status}`,
                `exit_code: ${result.exitCode ?? "n/a"}`,
              ]
              if (result.error) lines.push(`error: ${result.error}`)
              if (result.truncated) lines.push("(buffer truncated — older output dropped)")
              lines.push("")
              lines.push(body)
              return {
                title: `Output from ${result.shellID}`,
                output: lines.join("\n"),
                metadata: {
                  shellID: result.shellID,
                  status: result.status,
                  exitCode: result.exitCode,
                  truncated: result.truncated,
                },
              }
            }),
            Effect.catchTag("ShellNotFound", (err: ShellNotFound) =>
              Effect.succeed({
                title: `Shell ${err.shellID} not found`,
                output: `No background shell with id ${err.shellID}. It may have already been killed or never existed. Start a new one with bash run_in_background.`,
                metadata: {
                  shellID: err.shellID,
                  status: "errored" as const,
                  exitCode: null,
                  truncated: false,
                },
              }),
            ),
            Effect.orDie,
          ),
    }
  }),
)
