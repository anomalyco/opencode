/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { PersistentPtyInfo } from "@opencode/client"
import { mkdirSync } from "fs"
import path from "path"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { SessionTerminalsProvider, useSessionTerminals } from "../../src/context/session-terminals"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { TuiAppProvider } from "../../src/context/runtime"
import { createApi, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("explicit endpoints cannot adopt or change legacy local selections", async () => {
  await using temporary = await tmpdir()
  const file = path.join(temporary.path, "test", "tui", "session-terminal-selection.json")
  mkdirSync(path.dirname(file), { recursive: true })
  const legacy = { sessions: { shared: "pty_shared", untouched: "pty_legacy" } }
  await Bun.write(file, JSON.stringify(legacy))
  await using app = await mounted(temporary.path, ["https://first.example", "https://second.example"])
  for (const server of app.servers) {
    expect(server.terminals.get("shared").selectedTerminalID).toBeNull()
    await server.terminals.refresh("shared")
  }
  await app.storage.flush()
  expect(await Bun.file(file).json()).toEqual(legacy)

  await app.servers[0].terminals.selectTerminal("shared", "pty_shared")
  expect(await Bun.file(file).json()).toEqual({
    ...legacy,
    servers: { "https://first.example/": { sessions: { shared: "pty_shared" } } },
  })
  expect(app.servers[1].terminals.get("shared").selectedTerminalID).toBeNull()
  expect(app.servers[0].terminals.get("untouched").selectedTerminalID).toBeNull()
})

test("managed local reads and writes legacy selections across endpoint changes", async () => {
  await using temporary = await tmpdir()
  const file = path.join(temporary.path, "test", "tui", "session-terminal-selection.json")
  mkdirSync(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify({ sessions: { shared: "pty_shared", untouched: "pty_legacy" } }))
  {
    await using local = await mounted(temporary.path, ["http://127.0.0.1:54321"], true)
    await using remote = await mounted(temporary.path, ["http://127.0.0.1:54321"])
    expect(local.servers[0].terminals.get("shared").selectedTerminalID).toBe("pty_shared")
    expect(remote.servers[0].terminals.get("shared").selectedTerminalID).toBeNull()
    await local.servers[0].terminals.selectTerminal("shared", null)
    expect((await Bun.file(file).json()).sessions).toEqual({ shared: null, untouched: "pty_legacy" })
    await local.servers[0].terminals.refresh("shared")
    await local.servers[0].terminals.selectTerminal("shared", "pty_shared")
  }
  await using restored = await mounted(temporary.path, ["http://127.0.0.1:54322"], true)
  expect(restored.servers[0].terminals.get("shared").selectedTerminalID).toBe("pty_shared")
  restored.servers[0].items.length = 0
  await restored.servers[0].terminals.refresh("shared")
  expect((await Bun.file(file).json()).sessions).toEqual({ shared: null, untouched: "pty_legacy" })
})

test("isolates terminal lists and writes selection, null, and missing-terminal clearing through to disk", async () => {
  await using temporary = await tmpdir()
  const file = path.join(temporary.path, "test", "tui", "session-terminal-selection.json")
  await using app = await mounted(temporary.path, ["https://first.example", "https://second.example"])
  const first = app.servers[0]
  const second = app.servers[1]
  await first.terminals.refresh("shared")
  expect(second.terminals.get("shared").terminals).toEqual([])
  await second.terminals.refresh("shared")
  expect(first.terminals.get("shared").terminals[0].title).toBe("https://first.example")
  expect(second.terminals.get("shared").terminals[0].title).toBe("https://second.example")

  await first.terminals.selectTerminal("shared", "pty_shared")
  expect(first.terminals.get("shared").selectedTerminalID).toBe("pty_shared")
  expect(second.terminals.get("shared").selectedTerminalID).toBeNull()
  expect((await Bun.file(file).json()).servers).toEqual({
    "https://first.example/": { sessions: { shared: "pty_shared" } },
  })
  await second.terminals.selectTerminal("shared", "pty_shared")
  await first.terminals.selectTerminal("shared", null)
  expect((await Bun.file(file).json()).servers).toEqual({
    "https://first.example/": { sessions: { shared: null } },
    "https://second.example/": { sessions: { shared: "pty_shared" } },
  })
  await first.terminals.selectTerminal("shared", "pty_shared")
  first.items.length = 0
  await first.terminals.refresh("shared")
  expect(first.terminals.get("shared").selectedTerminalID).toBeNull()
  expect(second.terminals.get("shared").selectedTerminalID).toBe("pty_shared")
  expect(second.terminals.get("shared").terminals).toHaveLength(1)
  expect((await Bun.file(file).json()).servers).toEqual({
    "https://first.example/": { sessions: { shared: null } },
    "https://second.example/": { sessions: { shared: "pty_shared" } },
  })
})

test("merges concurrent writes from independent storage providers and restores them after remount", async () => {
  await using temporary = await tmpdir()
  {
    await using first = await mounted(temporary.path, ["https://first.example"])
    await using second = await mounted(temporary.path, ["https://second.example"])
    await Promise.all([first.servers[0].terminals.refresh("shared"), second.servers[0].terminals.refresh("shared")])
    await Promise.all([
      first.servers[0].terminals.selectTerminal("shared", "pty_shared"),
      second.servers[0].terminals.selectTerminal("shared", "pty_shared"),
    ])
  }
  await using restored = await mounted(temporary.path, ["HTTPS://FIRST.example:443/", "https://second.example"])
  for (const server of restored.servers) {
    expect(server.terminals.get("shared").selectedTerminalID).toBe("pty_shared")
    expect(server.terminals.get("shared").terminals).toEqual([])
  }
})

async function mounted(state: string, urls: string[], managed = false) {
  const servers = urls.map((url) => {
    const items: PersistentPtyInfo[] = [
      {
        id: "pty_shared",
        title: url,
        command: "sh",
        args: [],
        cwd: directory,
        status: "running",
        pid: 123,
        sessionID: "shared",
        foregroundProcess: null,
        size: { cols: 80, rows: 24 },
        output: { head: 0, tail: 0 },
      },
    ]
    const calls = createFetch(async (request) => {
      if (request.pathname === "/api/experimental/session/shared/terminal") return json({ data: items })
      return undefined
    })
    return { url, items, api: createApi(calls.fetch), terminals: undefined! as ReturnType<typeof useSessionTerminals> }
  })
  let storage!: ReturnType<typeof useStorage>
  function Probe(props: { server: (typeof servers)[number] }) {
    props.server.terminals = useSessionTerminals()
    storage = useStorage()
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider config={createTuiResolvedConfig({ session: { terminal: true } })}>
            {servers.map((server) => (
              <ClientProvider
                api={server.api}
                url={server.url}
                service={
                  managed
                    ? {
                        reconnect: async () => ({ api: server.api }),
                        restart: async () => {},
                      }
                    : undefined
                }
              >
                <DataProvider directory={directory}>
                  <SessionTerminalsProvider>
                    <Probe server={server} />
                  </SessionTerminalsProvider>
                </DataProvider>
              </ClientProvider>
            ))}
          </ConfigProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))
  return {
    servers,
    storage,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await storage.flush()
    },
  }
}
