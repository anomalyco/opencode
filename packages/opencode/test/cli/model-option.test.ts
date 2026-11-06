import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"
import { testProviderConfig } from "../lib/test-provider"
import path from "node:path"

describe("global model option", () => {
  cliIt.live("utilities accept a model prefix without resolving it", ({ opencode }) =>
    Effect.gen(function* () {
      for (const prefix of [["--model", "missing/unused"], ["--model=missing/unused"]]) {
        const result = yield* opencode.spawn([...prefix, "session", "list", "--format", "json"])
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("")
      }
      const help = yield* opencode.spawn(["--model", "missing/unused", "upgrade", "--help"])
      opencode.expectExit(help, 0)
      expect(help.stderr).toMatch(/-m, --method/)
      expect(help.stderr).not.toMatch(/-m, --model/)
    }),
  )

  cliIt.live(
    "run, resume and fork retain explicit model selection and export accepts the same prefix",
    ({ llm, opencode, home }) =>
      Effect.gen(function* () {
        const config = testProviderConfig(llm.url)
        const env = {
          // The suite preload uses :memory:; independent CLI processes need one owned durable store.
          OPENCODE_DB: path.join(home, "model-option.sqlite"),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            ...config,
            model: "test/test-model",
            provider: {
              test: {
                ...config.provider.test,
                models: {
                  ...config.provider.test.models,
                  other: { ...config.provider.test.models["test-model"], id: "other", name: "Other Model" },
                },
              },
            },
          }),
        }
        yield* llm.textMatch((hit) => hit.body.model === "other", "first")
        const first = yield* opencode.spawn(["--model", "test/other", "run", "--format", "json", "export"], { env })
        opencode.expectExit(first, 0)
        expect(opencode.parseJsonEvents(first.stdout)).toContainEqual(
          expect.objectContaining({
            type: "text",
            part: expect.objectContaining({ text: "first" }),
          }),
        )
        const session = opencode.parseJsonEvents(first.stdout)[0].sessionID
        if (typeof session !== "string") throw new Error("run must produce a session ID")

        for (const fork of [true, false]) {
          yield* llm.textMatch((hit) => hit.body.model === "test-model", "next")
          const resumed = yield* opencode.spawn(
            [
              "--pure",
              "--log-level",
              "ERROR",
              "--model",
              "test/test-model",
              "run",
              "--session",
              session,
              ...(fork ? ["--fork"] : []),
              "--agent",
              "build",
              "--format",
              "json",
              "--",
              "literal",
              "--model",
              "test/other",
            ],
            { env },
          )
          opencode.expectExit(resumed, 0)
          expect(opencode.parseJsonEvents(resumed.stdout)).toContainEqual(
            expect.objectContaining({
              type: "text",
              part: expect.objectContaining({ text: "next" }),
            }),
          )
          const id = opencode.parseJsonEvents(resumed.stdout)[0].sessionID
          if (typeof id !== "string") throw new Error("resumed run must produce a session ID")
          expect(id === session).toBe(!fork)
          const exported = yield* opencode.spawn(["--model", "missing/unused", "export", id], { env })
          opencode.expectExit(exported, 0)
          const messages = JSON.parse(exported.stdout).messages
          const users = messages.filter((message: { info: { role: string } }) => message.info.role === "user")
          expect(users.at(-1).info.model).toEqual({ providerID: "test", modelID: "test-model" })
          expect(
            users.at(-1).parts.some((part: { text?: string }) => part.text?.includes("literal --model test/other")),
          ).toBe(true)
        }
        for (const flag of ["--model", "-m"]) {
          yield* llm.textMatch((hit) => hit.body.model === "other", "override")
          const override = yield* opencode.spawn(
            ["--model", "test/test-model", "run", flag, "test/other", "explicit override"],
            { env },
          )
          opencode.expectExit(override, 0)
          expect(override.stdout).toBe("override\n")
        }
      }),
    120_000,
  )
})
