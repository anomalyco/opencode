import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

export default defineScript({
  tools: ["shell"],
  run: ({ tools, artifacts }) =>
    Effect.gen(function* () {
      const shells = yield* tools.control("shell")
      const options = yield* Effect.tryPromise(async () => {
        const config: unknown = await Bun.file(
          `${artifacts}/files/.opencode/opencode.jsonc`,
        ).json()
        if (typeof config !== "object" || config === null || !("plugins" in config))
          throw new Error("script config has no plugins")
        const plugins = config.plugins
        if (!Array.isArray(plugins)) throw new Error("script plugins are not an array")
        const plugin = plugins.find(
          (value) => typeof value === "object" && value !== null && "options" in value,
        )
        if (typeof plugin !== "object" || plugin === null || !("options" in plugin))
          throw new Error("Drive tool plugin is missing")
        const value = plugin.options
        if (
          typeof value !== "object" ||
          value === null ||
          !("endpoint" in value) ||
          typeof value.endpoint !== "string" ||
          !("token" in value) ||
          typeof value.token !== "string"
        )
          throw new Error("Drive tool plugin options are invalid")
        return { endpoint: value.endpoint, token: value.token }
      })
      const response = yield* Effect.tryPromise((signal) =>
        fetch(`${options.endpoint}/execute/shell`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: { command: "controlled from script" },
            context: { callID: "call_script_control" },
          }),
          signal,
        }).then((value) => value.text()),
      ).pipe(Effect.forkScoped)
      const shell = yield* shells.take("call_script_control")
      yield* shell.progress("script progress\n")
      yield* shell.succeed({ output: "script success\n", exit: 0 })
      const events = yield* Fiber.join(response)
      yield* Effect.promise(() =>
        Bun.write(`${artifacts}/tool-control-events.jsonl`, events),
      )
    }),
})
