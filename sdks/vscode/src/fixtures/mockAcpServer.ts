import { EventEmitter } from "events"
import { Readable, Writable } from "stream"
import * as net from "net"

/**
 * Mock ACP server for integration testing.
 * Simulates the real ACP server protocol.
 */
export class MockAcpServer extends EventEmitter {
  private server: net.Server | null = null
  private socket: net.Socket | null = null
  private port: number = 0

  constructor(private readonly respondDelay = 10) {
    super()
  }

  /**
   * Start the mock ACP server on a random available port.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.socket = socket
        this.setupSocket(socket)
      })

      this.server.on("error", reject)

      this.server!.listen(0, () => {
        const address = this.server!.address() as net.AddressInfo
        this.port = address.port
        resolve(this.port)
      })
    })
  }

  private setupSocket(socket: net.Socket) {
    let buffer = ""

    socket.on("data", (data) => {
      buffer += data.toString()

      // Process complete JSON-RPC messages
      while (true) {
        const newlineIndex = buffer.indexOf("\n")
        if (newlineIndex === -1) break
        const message = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)

        if (message.trim()) {
          this.handleMessage(message, socket)
        }
      }
    })

    socket.on("close", () => {
      this.emit("clientDisconnected")
    })

    socket.on("error", (err) => {
      this.emit("error", err)
    })
  }

  private handleMessage(message: string, socket: net.Socket) {
    try {
      const request = JSON.parse(message)

      // Handle different methods
      if (request.method === "initialize") {
        this.sendResponse(socket, request.id, {
          protocolVersion: "2.0",
          capabilities: {
            tools: true,
            prompts: true,
            resources: true,
          },
          serverInfo: {
            name: "opencode-mock",
            version: "1.0.0",
          },
        })
      } else if (request.method === "tools/list") {
        this.sendResponse(socket, request.id, {
          tools: [
            {
              name: "terminal_run",
              description: "Run a terminal command",
              inputSchema: {
                type: "object",
                properties: {
                  command: { type: "string" },
                },
              },
            },
          ],
        })
      } else if (request.method === "ping") {
        this.sendResponse(socket, request.id, { pong: true })
      } else if (request.method === "session/start") {
        this.sendResponse(socket, request.id, {
          sessionId: "mock-session-123",
        })
      } else if (request.method === "session/end") {
        this.sendResponse(socket, request.id, { success: true })
      } else if (request.method === "prompts/list") {
        this.sendResponse(socket, request.id, {
          prompts: [
            {
              name: "test",
              description: "A test prompt",
            },
          ],
        })
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  private sendResponse(socket: net.Socket, id: number | string, result: any) {
    setTimeout(() => {
      const response =
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        }) + "\n"
      socket.write(response)
    }, this.respondDelay)
  }

  /**
   * Stop the mock server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.end()
      }

      if (this.server) {
        this.server.close(() => {
          this.server = null
          this.socket = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  getPort(): number {
    return this.port
  }
}

/**
 * Create mock stdin/stdout streams for testing the AcpProcess.
 */
export function createMockProcessStreams() {
  const stdin = new Writable({
    write(chunk, encoding, callback) {
      stdin.written.push(chunk.toString())
      callback()
    },
  }) as Writable & { written: string[] }
  stdin.written = []

  const stdout = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stdout.pushData = (data: string) => stdout.push(data)

  const stderr = new Readable({ read() {} }) as Readable & { pushData: (data: string) => void }
  stderr.pushData = (data: string) => stderr.push(data)

  return { stdin, stdout, stderr }
}
