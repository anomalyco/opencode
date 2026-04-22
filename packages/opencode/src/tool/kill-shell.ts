import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { BackgroundShell, ShellNotFound } from "../shell/background"

const parameters = z.object({
  shell_id: z.string().describe("The id of the background shell to terminate"),
})

const DESCRIPTION = `Terminate a background shell previously started by the bash tool with \`run_in_background: true\`.

Sends SIGTERM, then SIGKILL after a short grace period. Returns any final buffered output along with the exit code (if the process exited cleanly before being signalled). Removes the shell from the registry — subsequent calls to \`bash_output\` for the same id will fail.`

export const KillShellTool = Tool.define(
  "kill_shell",
  Effect.gen(function* () {
    const bg = yield* BackgroundShell.Service
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, _ctx: Tool.Context) =>
        bg
          .kill({ shellID: params.shell_id })
          .pipe(
            Effect.map((result) => {
              const body = result.output || "(no remaining output)"
              const lines: string[] = [
                `shell_id: ${result.shellID}`,
                `status: ${result.status}`,
                `exit_code: ${result.exitCode ?? "n/a"}`,
              ]
              if (result.error) lines.push(`error: ${result.error}`)
              lines.push("")
              lines.push(body)
              return {
                title: `Killed ${result.shellID}`,
                output: lines.join("\n"),
                metadata: {
                  shellID: result.shellID,
                  status: result.status,
                  exitCode: result.exitCode,
                },
              }
            }),
            Effect.catchTag("ShellNotFound", (err: ShellNotFound) =>
              Effect.succeed({
                title: `Shell ${err.shellID} not found`,
                output: `No background shell with id ${err.shellID}. It may have already been killed or never existed.`,
                metadata: { shellID: err.shellID, status: "errored" as const, exitCode: null },
              }),
            ),
            Effect.orDie,
          ),
    }
  }),
)
