import { expect, test } from "bun:test"
import type { ClientMcpTool } from "@opencode/client/mcp"
import { browserTools, normalizeAction } from "./mcp"
import { Browser } from "./operations"

const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)

const tab: Browser.Tab = {
  id: tabID,
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}

const signal = new AbortController().signal

const navigate = (url: string) => normalizeAction({ type: "navigate", tabID, url })

const tool = (tools: ClientMcpTool[], name: string) => {
  const found = tools.find((item) => item.name === name)

  if (!found) throw new Error(`missing tool ${name}`)

  return found
}

test("every operation is a tool with object input and output schemas", () => {
  const tools = browserTools(() => undefined)
  expect(tools.map((item) => item.name)).toEqual(Browser.Operations.map((item) => item.name.replaceAll(".", "_")))

  for (const item of tools) {
    expect(item.name).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(item.inputSchema).toMatchObject({ type: "object" })
    expect(item.outputSchema).toMatchObject({ type: "object" })
  }
})

test("a session that no pane shows gets a disconnected error, not a call", async () => {
  const result = await tool(
    browserTools(() => undefined),
    "tabs_list",
  ).handler({}, { sessionID: "ses_other", signal })

  expect(result.isError).toBe(true)
  expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("[browser.disconnected]") })
})

test("results reach the server as checked structured output, with images attached and other files as resources", async () => {
  const commands: Browser.Command[] = []

  const files: Browser.File[] = [
    {
      id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
      name: "shot.png",
      mime: "image/png",
      data: new Uint8Array([1]),
    },
    {
      id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
      name: "report.json",
      mime: "application/json",
      data: new Uint8Array([123, 125]),
    },
  ]

  const tools = browserTools((sessionID) =>
    sessionID === "ses_pane"
      ? {
          execute: async (command) => {
            commands.push(command)

            return { value: { tab: { ...tab } }, files }
          },
          read: async () => new Uint8Array(),
        }
      : undefined,
  )

  const result = await tool(tools, "screenshot").handler({ tabID }, { sessionID: "ses_pane", signal })

  expect(commands).toEqual([{ action: { type: "screenshot", tabID }, files: [] }])
  expect(result.isError).toBeUndefined()
  expect(result.structuredContent).toEqual({
    tab: { ...tab },
    files: files.map((file) => ({ id: file.id, name: file.name, mime: file.mime, bytes: file.data.byteLength })),
  })
  expect(result.content.slice(1)).toEqual([
    { type: "image", data: "AQ==", mimeType: "image/png" },
    {
      type: "resource",
      resource: { uri: `browser-file:///${files[1]!.id}/report.json`, mimeType: "application/json", blob: "e30=" },
    },
  ])
})

test("output that breaks the operation's schema never reaches the server", async () => {
  const tools = browserTools(() => ({
    execute: async () => ({ value: { tab: { ...tab, generation: -1 } }, files: [] }),
    read: async () => new Uint8Array(),
  }))

  await expect(tool(tools, "reload").handler({ tabID }, { sessionID: "ses_pane", signal })).rejects.toThrow()
})

test("uploads read workspace files from the server and send their names, not server paths", async () => {
  const commands: Browser.Command[] = []
  const reads: string[] = []

  const tools = browserTools(() => ({
    execute: async (command) => {
      commands.push(command)

      return { value: { ...tab }, files: [] }
    },
    read: async (path) => {
      reads.push(path)

      return new TextEncoder().encode("a,b")
    },
  }))

  await tool(tools, "files_upload").handler(
    { tabID, ref: "e1", paths: ["data/table.csv"] },
    { sessionID: "ses_pane", signal },
  )

  expect(reads).toEqual(["data/table.csv"])
  expect(commands[0]?.action).toEqual({
    type: "files.upload",
    tabID,
    ref: Browser.Ref.make("e1"),
    paths: ["table.csv"],
  })
  expect(commands[0]?.files.map((file) => [file.name, file.mime, new TextDecoder().decode(file.data)])).toEqual([
    ["table.csv", "text/csv", "a,b"],
  ])
})

test("URL normalization rejects filesystem paths instead of treating them as hostnames", () => {
  for (const path of ["/tmp/page.html", "./page.html", "../page.html", "C:\\Users\\me\\page.html", "D:/page.html"])
    expect(() => navigate(path)).toThrow("Invalid browser URL")
  expect(navigate("example.com/docs")).toEqual({ type: "navigate", tabID, url: "https://example.com/docs" })
  expect(navigate("localhost:8000")).toEqual({ type: "navigate", tabID, url: "http://localhost:8000/" })
  expect(normalizeAction({ type: "tabs.open" })).toEqual({ type: "tabs.open" })
  expect(normalizeAction({ type: "tabs.open", url: " " })).toEqual({ type: "tabs.open", url: "about:blank" })
})

test("URL normalization fails fast when percent-encoding exceeds the URL bound", () => {
  const input = `https://example.com/${"é".repeat(400)}`
  expect(input.length).toBeLessThan(2_048)
  expect(new URL(input).href.length).toBeGreaterThan(2_048)
  expect(() => navigate(input)).toThrow()
})
