import { describe, expect, test } from "bun:test"
import { OpenCode } from "../src/promise"
import { createPtyClient } from "../src/solid"

describe("createPtyClient", () => {
  test("mints an authenticated ticket before opening the terminal socket", async () => {
    let request: Request | undefined
    let socketURL: URL | undefined
    const socket = { binaryType: "blob" } as unknown as WebSocket
    const api = OpenCode.make({
      baseUrl: "https://server.example/base",
      headers: { Authorization: "Basic credential" },
      fetch: async (input, init) => {
        request = input instanceof Request ? input : new Request(input, init)
        return Response.json({
          location: {
            directory: "/repo/worktree",
            project: { id: "project_1", directory: "/repo", canonical: "/repo" },
          },
          data: { ticket: "ticket-1", expires_in: 60 },
        })
      },
    })
    const pty = createPtyClient(api, {
      url: "https://server.example/base",
      openSocket(url) {
        socketURL = url
        return socket
      },
    })

    expect(
      await pty.connect({
        ptyID: "pty_1",
        location: { directory: "/repo/worktree", workspace: "workspace_1" },
        cursor: 42,
      }),
    ).toBe(socket)
    expect(request?.method).toBe("POST")
    expect(request?.url).toBe(
      "https://server.example/api/pty/pty_1/connect-token?location%5Bdirectory%5D=%2Frepo%2Fworktree&location%5Bworkspace%5D=workspace_1",
    )
    expect(request?.headers.get("authorization")).toBe("Basic credential")
    expect(request?.headers.get("x-opencode-ticket")).toBe("1")
    expect(socketURL?.toString()).toBe(
      "wss://server.example/api/pty/pty_1/connect?location%5Bdirectory%5D=%2Frepo%2Fworktree&location%5Bworkspace%5D=workspace_1&cursor=42&ticket=ticket-1",
    )
    expect(socket.binaryType).toBe("arraybuffer")
  })

  test("does not open a socket when ticket minting fails", async () => {
    let opened = false
    const api = OpenCode.make({
      baseUrl: "http://localhost:4096",
      fetch: async () => new Response(null, { status: 401 }),
    })
    const pty = createPtyClient(api, {
      url: "http://localhost:4096",
      openSocket() {
        opened = true
        return { binaryType: "blob" } as unknown as WebSocket
      },
    })

    await expect(pty.connect({ ptyID: "pty_1", location: { directory: "/repo" } })).rejects.toThrow()
    expect(opened).toBe(false)
  })
})
