import { Effect } from "effect"
import { Tool } from "opencode-drive"
import type { Options } from "opencode-drive/driver"

export const catalogViewport = { cols: 118, rows: 34 } as const

export function catalogScenarioRuntime(options: { readonly opencode: string; readonly theme?: string }): Options {
  return {
    project: {
      files: {
        "fixture.txt": "before\n",
        "src/ledger.ts": [
          "export const credits = [8, 13, 21]",
          "export const total = credits.reduce((sum, value) => sum + value, 0)",
          "",
        ].join("\n"),
      },
    },
    config: {
      autoupdate: false,
      permissions: [
        { action: "*", resource: "*", effect: "ask" },
        { action: "shell", resource: "*", effect: "allow" },
        { action: "subagent", resource: "*", effect: "allow" },
      ],
      agents: {
        reviewer: { description: "Reviews deterministic UI fixtures", mode: "primary" },
        researcher: { description: "Explores fixture source code", mode: "subagent" },
      },
    },
    tools: (tools) => {
      tools.handle("shell", ({ input, progress }) =>
        Effect.gen(function* () {
          yield* progress(`streamed output: ${input.command}\n`)
          yield* Effect.sleep(1_500)
          if (input.command.includes("fail")) {
            return yield* new Tool.Failure({ message: "catalog shell failure" })
          }
          return { output: "catalog shell success\n", exit: 0 }
        }),
      )
      tools.handle("websearch", () => Effect.fail(new Tool.Failure({ message: "catalog web search provider failure" })))
    },
    setup:
      options.theme === undefined
        ? undefined
        : ({ fs }) =>
            fs.writeFile(
              ".opencode/tui.json",
              `${JSON.stringify({ $schema: "https://opencode.ai/tui.json", theme: options.theme }, undefined, 2)}\n`,
            ),
    tui: { viewport: catalogViewport },
    opencode: { dev: options.opencode },
  }
}
