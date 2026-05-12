import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { InstanceRef } from "@/effect/instance-ref"
import { SessionAssemble } from "./assemble"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import { ProjectID } from "@/project/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Session } from "./session"
import { MessageID, PartID, SessionID } from "./schema"
import type { MessageV2 } from "./message-v2"

const sid = SessionID.descending("ses_assemble_test")
const providerID = ProviderID.make("provider")
const modelID = ModelID.make("model")

const session = {
  id: sid,
  slug: "assemble-test",
  projectID: ProjectID.make("prj_assemble_test"),
  workspaceID: "wrk_assemble_test",
  directory: tmpdir(),
  title: "Assemble Test",
  version: "test",
  time: {
    created: 1,
    updated: 1,
  },
} as Session.Info

const agent = {
  name: "build",
  mode: "primary",
  permission: [],
  options: {},
} as Agent.Info

const model = {
  id: modelID,
  providerID,
} as Provider.Model

const messages = [
  {
    info: {
      id: MessageID.ascending("msg_user"),
      sessionID: session.id,
      role: "user",
      time: { created: 1 },
      agent: agent.name,
      model: { providerID, modelID },
    },
    parts: [
      {
        id: PartID.ascending("prt_user"),
        sessionID: session.id,
        messageID: MessageID.ascending("msg_user"),
        type: "text",
        text: "hello",
      },
    ],
  },
] satisfies MessageV2.WithParts[]

async function run(script: string) {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-assemble-run-"))
  const dir = path.join(Global.Path.data, "session", session.id)
  await Bun.$`rm -rf ${dir}`.quiet()
  await Bun.$`mkdir -p ${dir}`.quiet()
  await Bun.write(path.join(dir, "assemble.ts"), script)
  return await Effect.runPromise(
    SessionAssemble.run({ session, agent, model, step: 1, messages }).pipe(
      Effect.provideService(InstanceRef, {
        directory: root,
        worktree: root,
        project: {
          id: session.projectID,
          worktree: root,
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
      }),
    ),
  )
}

test("assemble run returns script messages when output has internal message shape", async () => {
  const result = await run(`export default async function assemble(input) {
  return input.messages.concat({
    info: {
      id: "msg_extra",
      sessionID: input.sessionID,
      role: "user",
      time: { created: 2 },
      agent: input.agent.name,
      model: { providerID: input.model.providerID, modelID: input.model.id },
    },
    parts: [{
      id: "prt_extra",
      sessionID: input.sessionID,
      messageID: "msg_extra",
      type: "text",
      synthetic: true,
      text: "extra context",
    }],
  })
}`)

  expect(result).toHaveLength(2)
  expect(result.at(-1)?.parts[0]).toMatchObject({ text: "extra context", synthetic: true })
})

function text(part: MessageV2.Part) {
  if (part.type === "text") return part.text
  return ""
}

test("assemble run falls back and adds reminder when script throws", async () => {
  const result = await run(`export default async function assemble() {
  throw new Error("broken")
}`)

  expect(result).toHaveLength(2)
  expect(result[0]).toEqual(messages[0])
  expect(result.at(-1)?.parts[0]).toMatchObject({
    type: "text",
    synthetic: true,
  })
  expect(text(result.at(-1)!.parts[0])).toContain("execution error")
})

test("assemble run falls back and adds reminder when script returns provider messages", async () => {
  const result = await run(`export default async function assemble() {
  return [{ role: "user", content: "provider shape is invalid here" }]
}`)

  expect(result).toHaveLength(2)
  expect(result[0]).toEqual(messages[0])
  expect(text(result.at(-1)!.parts[0])).toContain("invalid return value")
})

test("assemble run recovers after invalid script is replaced", async () => {
  const first = await run(`export default async function assemble() {
  return "bad"
}`)
  const second = await run(`export default async function assemble(input) {
  return input.messages
}`)

  expect(text(first.at(-1)!.parts[0])).toContain("invalid return value")
  expect(second).toEqual(messages)
})
