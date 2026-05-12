import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { expect, test } from "bun:test"
import { loadScriptDefault } from "./script"
import { SessionAssembleTemplate } from "./assemble-template"

test("loadScriptDefault caches unchanged source and reloads changed source", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "opencode-script-")), "assemble.ts")

  await Bun.write(
    file,
    `export default async function assemble(input) {
  return input.messages
}
`,
  )

  const first = await loadScriptDefault(file)
  const same = await loadScriptDefault(file)

  expect(first).toBeFunction()
  expect(same).toBe(first)
  expect(await first?.({ messages: ["a"] })).toEqual(["a"])

  await Bun.write(
    file,
    `export default async function assemble(input) {
  return input.messages.concat("b")
}
`,
  )

  const second = await loadScriptDefault(file)

  expect(second).toBeFunction()
  expect(second).not.toBe(first)
  expect(await second?.({ messages: ["a"] })).toEqual(["a", "b"])
})

test("assemble template ensure creates script and schema without overwriting existing files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-assemble-template-"))

  await SessionAssembleTemplate.ensure(dir)

  expect(await Bun.file(path.join(dir, "assemble.ts")).text()).toContain("MessageV2.WithParts[] format")
  expect(await Bun.file(path.join(dir, "assemble-schema.md")).text()).toContain("# assemble.ts Schema Reference")

  await Bun.write(path.join(dir, "assemble.ts"), "custom script")
  await Bun.write(path.join(dir, "assemble-schema.md"), "custom schema")
  await SessionAssembleTemplate.ensure(dir)

  expect(await Bun.file(path.join(dir, "assemble.ts")).text()).toBe("custom script")
  expect(await Bun.file(path.join(dir, "assemble-schema.md")).text()).toBe("custom schema")
})

test("default assemble template discovers json context and updates countdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-assemble-discovery-"))
  await SessionAssembleTemplate.ensure(dir)
  await Bun.write(
    path.join(dir, "context.json"),
    JSON.stringify(
      { assemble: true, content: "remember schema contract", position: "suffix", timestamp: 30, countdown: 2 },
      null,
      2,
    ),
  )

  const execute = await loadScriptDefault(path.join(dir, "assemble.ts"))
  const result = await execute?.({
    sessionID: "ses_test",
    sessionDir: dir,
    workspaceRoot: dir,
    directory: dir,
    step: 1,
    session: {},
    agent: { name: "build" },
    model: { id: "model", providerID: "provider" },
    messages: [
      {
        info: {
          id: "msg_user",
          sessionID: "ses_test",
          role: "user",
          time: { created: 20 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        },
        parts: [
          {
            id: "prt_user",
            sessionID: "ses_test",
            messageID: "msg_user",
            type: "text",
            text: "hello",
          },
        ],
      },
    ],
  })

  expect(result).toHaveLength(2)
  expect(result?.at(-1)?.info.id).toStartWith("msg_assemble_")
  expect(result?.at(-1)?.parts[0]).toMatchObject({
    id: expect.stringMatching(/^prt_assemble_/),
    sessionID: "ses_test",
    type: "text",
    synthetic: true,
    text: "remember schema contract",
  })
  expect(await Bun.file(path.join(dir, "context.json")).json()).toMatchObject({ countdown: 1 })
})
