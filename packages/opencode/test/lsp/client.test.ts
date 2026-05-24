import { beforeEach, describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { requireInstance, TestInstance } from "../fixture/fixture"
import { LSPClient } from "@/lsp/client"
import * as LSPServer from "@/lsp/server"
import * as Log from "@opencode-ai/core/util/log"

const it = testEffect(AppFileSystem.defaultLayer)

function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

const createClient = (handle: LSPServer.Handle, initialization?: LSPServer.Handle["initialization"]) =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const instance = yield* requireInstance
    return yield* Effect.promise(() =>
      LSPClient.create({
        serverID: "fake",
        server: initialization ? { ...handle, initialization } : handle,
        root: test.directory,
        directory: test.directory,
        instance,
      }),
    )
  })

const createScopedClient = (handle: LSPServer.Handle, initialization?: LSPServer.Handle["initialization"]) =>
  Effect.gen(function* () {
    const client = yield* createClient(handle, initialization)
    yield* Effect.addFinalizer(() => Effect.promise(() => client.shutdown()).pipe(Effect.ignore))
    return client
  })

const writeFile = (file: string, content: string) => AppFileSystem.use.writeWithDirs(file, content)

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  it.instance("handles workspace/workspaceFolders request", () =>
    Effect.gen(function* () {
      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendNotification("test/trigger", {
          method: "workspace/workspaceFolders",
        }),
      )

      yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {}))
      expect(client.connection).toBeDefined()
    }),
  )

  it.instance("handles client/registerCapability request", () =>
    Effect.gen(function* () {
      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendNotification("test/trigger", {
          method: "client/registerCapability",
        }),
      )

      yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {}))
      expect(client.connection).toBeDefined()
    }),
  )

  it.instance("handles client/unregisterCapability request", () =>
    Effect.gen(function* () {
      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendNotification("test/trigger", {
          method: "client/unregisterCapability",
        }),
      )

      yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {}))
      expect(client.connection).toBeDefined()
    }),
  )

  it.instance("initialize does not overclaim unsupported diagnostics capabilities", () =>
    Effect.gen(function* () {
      const client = yield* createScopedClient(spawnFakeServer())

      const params = yield* Effect.promise(() =>
        client.connection.sendRequest<{
          capabilities: {
            workspace: { diagnostics: { refreshSupport: boolean } }
            textDocument: { publishDiagnostics: { versionSupport: boolean } }
          }
        }>("test/get-initialize-params", {}),
      )
      expect(params.capabilities.workspace.diagnostics.refreshSupport).toBe(false)
      expect(params.capabilities.textDocument.publishDiagnostics.versionSupport).toBe(false)
    }),
  )

  it.instance("workspace/configuration returns one result per requested item", () =>
    Effect.gen(function* () {
      const initialization = {
        alpha: {
          beta: 1,
        },
        gamma: true,
      }

      const client = yield* createScopedClient(spawnFakeServer(), initialization)

      const response = yield* Effect.promise(() =>
        client.connection.sendRequest<unknown[]>("test/request-configuration", {
          items: [{ section: "alpha" }, { section: "alpha.beta" }, { section: "missing" }, {}],
        }),
      )

      expect(response).toEqual([{ beta: 1 }, 1, null, initialization])
    }),
  )

  it.instance("sends ranged didChange for incremental sync servers", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.ts")
      yield* writeFile(file, "first\n")

      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() => client.notify.open({ path: file }))
      yield* writeFile(file, "second\nthird\n")
      yield* Effect.promise(() => client.notify.open({ path: file }))

      const change = yield* Effect.promise(() =>
        client.connection.sendRequest<{
          textDocument: { version: number }
          contentChanges: {
            range?: { start: { line: number; character: number }; end: { line: number; character: number } }
            text: string
          }[]
        }>("test/get-last-change", {}),
      )
      expect(change.textDocument.version).toBe(1)
      expect(change.contentChanges).toEqual([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
          text: "second\nthird\n",
        },
      ])
    }),
  )

  it.instance("document mode falls back to push diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.ts")
      yield* writeFile(file, "const x = 1\n")

      const client = yield* createScopedClient(spawnFakeServer())

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      const wait = client.waitForDiagnostics({ path: file, version, mode: "document" })
      yield* Effect.promise(() =>
        client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        }),
      )
      yield* Effect.promise(() => wait)

      const diagnostics = client.diagnostics.get(file) ?? []
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.message).toBe("push diagnostic")

      const count = yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {}))
      expect(count).toBe(0)
    }),
  )

  it.instance("document mode accepts matching push diagnostics published before waiting", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.ts")
      yield* writeFile(file, "const x = 1\n")

      const client = yield* createScopedClient(spawnFakeServer())

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      yield* Effect.promise(() =>
        client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        }),
      )

      const diagnostic = yield* pollWithTimeout(
        Effect.sync(() => client.diagnostics.get(file)?.[0]),
        "push diagnostic was not published",
      )
      expect(diagnostic.message).toBe("push diagnostic")

      const started = Date.now()
      yield* Effect.promise(() => client.waitForDiagnostics({ path: file, version, mode: "document" }))
      expect(Date.now() - started).toBeLessThan(1_000)
    }),
  )

  it.instance("document mode waits for pull diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.cs")
      yield* writeFile(file, "class C {}\n")

      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [{ identifier: "DocumentCompilerSemantic" }],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "pull diagnostic",
                severity: 1,
              },
            ],
          },
        }),
      )

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      yield* Effect.promise(() => client.waitForDiagnostics({ path: file, version, mode: "document" }))

      const diagnostics = client.diagnostics.get(file) ?? []
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]?.message).toBe("pull diagnostic")

      const count = yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {}))
      expect(count).toBeGreaterThan(0)
    }),
  )

  it.instance("document mode does not wait for the slowest pull identifier after current-file diagnostics arrive", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.cs")
      yield* writeFile(file, "class C {}\n")

      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendRequest("test/configure-pull-diagnostics", {
          registrations: [{ identifier: "fast" }, { identifier: "slow" }],
          documentDiagnosticsByIdentifier: {
            fast: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "fast diagnostic",
                severity: 1,
              },
            ],
            slow: [],
          },
          documentDelayMsByIdentifier: {
            slow: 2_500,
          },
        }),
      )

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      yield* Effect.promise(() => client.connection.sendRequest("test/register-configured-pull-diagnostics", {}))
      const started = Date.now()
      yield* Effect.promise(() => client.waitForDiagnostics({ path: file, version, mode: "document" }))

      expect(Date.now() - started).toBeLessThan(1_000)
      expect(client.diagnostics.get(file)?.[0]?.message).toBe("fast diagnostic")
      expect(
        yield* Effect.promise(() => client.connection.sendRequest("test/get-diagnostic-request-count", {})),
      ).toBeGreaterThan(1)
    }),
  )

  it.instance("full mode includes workspace pull diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.cs")
      const related = path.join(test.directory, "other.cs")
      yield* writeFile(file, "class C {}\n")
      yield* writeFile(related, "class D {}\n")

      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [
            { identifier: "DocumentCompilerSemantic" },
            { identifier: "WorkspaceDocumentsAndProject", workspaceDiagnostics: true },
          ],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "current file",
                severity: 1,
              },
            ],
          },
          workspaceDiagnosticsByIdentifier: {
            WorkspaceDocumentsAndProject: [
              {
                uri: pathToFileURL(related).href,
                items: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 5 },
                    },
                    message: "workspace file",
                    severity: 1,
                  },
                ],
              },
            ],
          },
        }),
      )

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      yield* Effect.promise(() => client.waitForDiagnostics({ path: file, version, mode: "full" }))

      expect(client.diagnostics.get(file)?.[0]?.message).toBe("current file")
      expect(client.diagnostics.get(related)?.[0]?.message).toBe("workspace file")
    }),
  )

  it.instance("full mode treats an empty workspace pull response as handled", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "client.cs")
      yield* writeFile(file, "class C {}\n")

      const client = yield* createScopedClient(spawnFakeServer())

      yield* Effect.promise(() =>
        client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [{ identifier: "WorkspaceDocumentsAndProject", workspaceDiagnostics: true }],
          workspaceDiagnosticsByIdentifier: {
            WorkspaceDocumentsAndProject: [],
          },
        }),
      )

      const version = yield* Effect.promise(() => client.notify.open({ path: file }))
      const started = Date.now()
      yield* Effect.promise(() => client.waitForDiagnostics({ path: file, version, mode: "full" }))

      expect(Date.now() - started).toBeLessThan(1_000)
    }),
  )
})
