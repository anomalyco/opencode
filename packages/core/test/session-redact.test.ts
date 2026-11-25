import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Model } from "@opencode/core/model"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionInboxTable, SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Base64, FileAttachment } from "@opencode/schema/prompt"
import { Money } from "@opencode/schema/money"
import { Shell } from "@opencode/schema/shell"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, SessionStore.node]),
  ),
)

const partRowsOff = Flag.testLayer([
  new Document({
    type: "document",
    info: new Info({ experimental: new ConfigExperimental.Info({ part_rows: false }) }),
  }),
])

const syntheticGithub = "gho_FAKEFAKE0000111122223333444455556666"
const syntheticNpm = "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
const credentialUrl = `https://user:${syntheticGithub}@github.com/example/repo.git`
const model = { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }

const createSession = (sessionID: Session.ID, title?: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* bus.publish(SessionEvent.Created, {
      sessionID,
      projectID: Project.ID.global,
      location: { directory: AbsolutePath.make("/project") },
      slug: "redact-test",
      version: "test",
      title,
    })
    return { db, bus }
  })

describe("session store secret redaction", () => {
  it.effect(
    "redacts tokens and URL userinfo in session_inbox and session_message while leaving clean text intact",
    () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_redact_user")
        const { db, bus } = yield* createSession(sessionID, `debug ${syntheticNpm}`)
        const store = yield* SessionStore.Service

        const inboxID = SessionMessage.ID.create()
        const pngBytes = Base64.make(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        )
        yield* bus.publish(SessionEvent.InboxEnqueued, {
          sessionID,
          inboxID,
          item: {
            type: "user",
            delivery: "steer",
            payload: {
              text: `Run export GH_TOKEN=${syntheticGithub} and clone ${credentialUrl}`,
              files: [
                FileAttachment.create({
                  data: pngBytes,
                  mime: "image/png",
                  source: { type: "inline" },
                  name: "pixel.png",
                }),
              ],
            },
          },
        })

        const pendingRow = yield* db
          .select()
          .from(SessionInboxTable)
          .where(eq(SessionInboxTable.id, inboxID))
          .get()
          .pipe(Effect.orDie)
        const serializedPending = JSON.stringify(pendingRow)
        expect(serializedPending).not.toContain(syntheticGithub)
        expect(serializedPending).toContain("export GH_TOKEN=<redacted>")
        expect(serializedPending).toContain("https://<redacted>@github.com/example/repo.git")

        yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID })

        const cleanID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.InboxEnqueued, {
          sessionID,
          inboxID: cleanID,
          item: {
            type: "user",
            delivery: "steer",
            payload: { text: "Check https://github.com/anomalyco/opencode.git" },
          },
        })
        yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: cleanID })

        const messageRows = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, sessionID))
          .all()
          .pipe(Effect.orDie)
        expect(JSON.stringify(messageRows)).not.toContain(syntheticGithub)

        const messages = yield* store.messages({ sessionID, order: "asc" })
        expect(messages[0]?.type).toBe("user")
        if (messages[0]?.type === "user") {
          expect(messages[0].text).toBe(
            "Run export GH_TOKEN=<redacted> and clone https://<redacted>@github.com/example/repo.git",
          )
          // Binary attachment bytes must remain intact.
          expect(messages[0].files?.[0]?.data).toBe(pngBytes)
        }
        expect(messages[1]?.type).toBe("user")
        if (messages[1]?.type === "user") {
          expect(messages[1].text).toBe("Check https://github.com/anomalyco/opencode.git")
        }

        const sessionRow = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        expect(sessionRow?.title).toBe("debug <redacted>")

        yield* bus.publish(SessionEvent.Renamed, { sessionID, title: `clone ${credentialUrl}` })
        const renamed = yield* store.get(sessionID)
        expect(renamed?.title).toBe("clone https://<redacted>@github.com/example/repo.git")
      }),
  )

  it.effect(
    "redacts assistant text, reasoning, tool inputs/outputs, and shell rows while preserving native replay data",
    () =>
      Effect.gen(function* () {
        const sessionID = Session.ID.make("ses_redact_assistant")
        const { db, bus } = yield* createSession(sessionID)
        const store = yield* SessionStore.Service

        const assistantID = SessionMessage.ID.create()
        const nativeSignature = { anthropic: { signature: `sig-${syntheticGithub}` } }
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID: assistantID,
          agent: Agent.defaultID,
          model,
          started: 1000,
        })
        yield* bus.publish(SessionEvent.Reasoning.Started, { sessionID, assistantMessageID: assistantID, ordinal: 0 })
        yield* bus.publish(SessionEvent.Reasoning.Ended, {
          sessionID,
          assistantMessageID: assistantID,
          ordinal: 0,
          text: `using ${syntheticNpm}`,
          native: nativeSignature,
        })
        yield* bus.publish(SessionEvent.Tool.Input.Started, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_1",
          name: "shell",
        })
        yield* bus.publish(SessionEvent.Tool.Input.Ended, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_1",
          text: JSON.stringify({ command: `export GH_TOKEN=${syntheticGithub}` }),
        })
        yield* bus.publish(SessionEvent.Tool.Called, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_1",
          input: { command: `export GH_TOKEN=${syntheticGithub} && echo "$GH_TOKEN"` },
          executed: true,
        })
        yield* bus.publish(SessionEvent.Tool.Success, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_1",
          content: [{ type: "text", text: `${syntheticGithub}\n${credentialUrl}` }],
          metadata: { remote: credentialUrl },
          executed: true,
        })
        yield* bus.publish(SessionEvent.Tool.Input.Started, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_2",
          name: "shell",
        })
        yield* bus.publish(SessionEvent.Tool.Called, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_2",
          input: { command: `curl ${credentialUrl}` },
          executed: true,
        })
        yield* bus.publish(SessionEvent.Tool.Failed, {
          sessionID,
          assistantMessageID: assistantID,
          id: "call_2",
          error: { type: "shell", message: `auth failed for ${credentialUrl}` },
          executed: true,
        })
        yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID: assistantID, ordinal: 1 })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID: assistantID,
          ordinal: 1,
          text: `Token was ${syntheticNpm}`,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID: assistantID,
          finish: "stop",
          cost: Money.USD.make(0),
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        })

        const shellID = Shell.ID.create()
        yield* bus.publish(SessionEvent.Shell.Started, {
          sessionID,
          shell: {
            id: shellID,
            status: "running",
            command: `git remote set-url origin ${credentialUrl}`,
            cwd: "/project",
            shell: "/bin/sh",
            file: "/tmp/out",
            metadata: {},
            time: { started: 1000 },
          },
        })
        yield* bus.publish(SessionEvent.Shell.Ended, {
          sessionID,
          shell: {
            id: shellID,
            status: "exited",
            command: `git remote set-url origin ${credentialUrl}`,
            cwd: "/project",
            shell: "/bin/sh",
            file: "/tmp/out",
            exit: 0,
            metadata: {},
            time: { started: 1000, completed: 1010 },
          },
          output: { output: `pushed with ${syntheticGithub}`, cursor: 10, size: 10, truncated: false },
        })

        const partRows = yield* db
          .select()
          .from(SessionPartTable)
          .where(eq(SessionPartTable.session_id, sessionID))
          .all()
          .pipe(Effect.orDie)
        const partTextWithoutNative = partRows.map((row) => {
          const { native: _, ...rest } = row.data as Record<string, unknown>
          return rest
        })
        expect(JSON.stringify(partTextWithoutNative)).not.toContain(syntheticGithub)
        expect(JSON.stringify(partTextWithoutNative)).not.toContain(syntheticNpm)

        const messages = yield* store.messages({ sessionID, order: "asc" })
        const assistant = messages.find((item) => item.type === "assistant")
        expect(assistant?.type).toBe("assistant")
        if (assistant?.type === "assistant") {
          expect(assistant.content[0]).toMatchObject({
            type: "reasoning",
            text: "using <redacted>",
            native: nativeSignature,
          })
          expect(assistant.content[1]).toMatchObject({
            type: "tool",
            state: {
              status: "completed",
              input: { command: 'export GH_TOKEN=<redacted> && echo "$GH_TOKEN"' },
              content: [{ type: "text", text: "<redacted>\nhttps://<redacted>@github.com/example/repo.git" }],
              metadata: { remote: "https://<redacted>@github.com/example/repo.git" },
            },
          })
          expect(assistant.content[2]).toMatchObject({
            type: "tool",
            state: {
              status: "error",
              input: { command: "curl https://<redacted>@github.com/example/repo.git" },
              error: { message: "auth failed for https://<redacted>@github.com/example/repo.git" },
            },
          })
          expect(assistant.content[3]).toMatchObject({
            type: "text",
            text: "Token was <redacted>",
          })
        }

        const shell = messages.find((item) => item.type === "shell")
        expect(shell?.type).toBe("shell")
        if (shell?.type === "shell") {
          expect(shell.command).toBe("git remote set-url origin https://<redacted>@github.com/example/repo.git")
          expect(shell.output?.output).toBe("pushed with <redacted>")
        }
      }),
  )

  it.effect("redacts inline assistant rows when part_rows is disabled", () =>
    Effect.gen(function* () {
      const sessionID = Session.ID.make("ses_redact_inline")
      const { db, bus } = yield* createSession(sessionID)
      const assistantID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: assistantID,
        agent: Agent.defaultID,
        model,
        started: 1000,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID: assistantID, ordinal: 0 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID,
        assistantMessageID: assistantID,
        ordinal: 0,
        text: `secret: ${syntheticNpm}`,
      })
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(JSON.stringify(rows)).not.toContain(syntheticNpm)
      expect(JSON.stringify(rows)).toContain("secret: <redacted>")
    }).pipe(Effect.provide(partRowsOff)),
  )
})
