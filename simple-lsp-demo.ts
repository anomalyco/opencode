/**
 * ============================================================================
 * 简化的 LSP 工具示例
 * ============================================================================
 *
 * 这是一个教学示例，展示 LSP (Language Server Protocol) 的核心工作原理
 *
 * 核心概念：
 * 1. LSP 是基于 JSON-RPC 2.0 的协议
 * 2. 客户端（编辑器）与服务端（语言服务器）通过 stdin/stdout 通信
 * 3. 消息格式：Content-Length: xxx\r\n\r\n{JSON}
 */

// ============================================================================
// 1. 基础类型定义
// ============================================================================

/**
 * LSP 位置（0-based）
 */
interface Position {
  line: number      // 行号，从 0 开始
  character: number // 字符偏移，从 0 开始
}

/**
 * LSP 范围
 */
interface Range {
  start: Position
  end: Position
}

/**
 * 文件位置
 */
interface Location {
  uri: string   // 文件 URI，如 "file:///path/to/file.ts"
  range: Range
}

/**
 * 诊断信息（错误、警告）
 */
interface Diagnostic {
  range: Range
  severity: number  // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string
}

/**
 * 符号信息（变量、函数、类等）
 */
interface SymbolInfo {
  name: string
  kind: number  // 12=Function, 13=Class, 14=Variable 等
  location: Location
}

// ============================================================================
// 2. JSON-RPC 消息格式
// ============================================================================

/**
 * LSP 请求消息
 */
interface LSPRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

/**
 * LSP 响应消息
 */
interface LSPResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

/**
 * LSP 通知消息（无响应）
 */
interface LSPNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

/**
 * 序列化 LSP 消息（添加 Content-Length 头）
 */
function serializeMessage(message: LSPRequest | LSPNotification): string {
  const content = JSON.stringify(message)
  return `Content-Length: ${content.length}\r\n\r\n${content}`
}

/**
 * 解析 LSP 消息
 */
function* parseMessages(raw: string): Generator<unknown> {
  let remaining = raw

  while (remaining.length > 0) {
    // 1. 读取 Content-Length
    const lengthMatch = remaining.match(/Content-Length: (\d+)\r\n\r\n/)
    if (!lengthMatch) break

    const contentLength = parseInt(lengthMatch[1], 10)
    const headerEnd = lengthMatch[0]!.length
    const contentStart = headerEnd

    // 2. 提取 JSON 内容
    if (remaining.length < contentStart + contentLength) break

    const jsonContent = remaining.slice(contentStart, contentStart + contentLength)
    remaining = remaining.slice(contentStart + contentLength)

    // 3. 解析 JSON
    try {
      yield JSON.parse(jsonContent)
    } catch {
      // 忽略无效 JSON
    }
  }
}

// ============================================================================
// 3. 简化的 LSP 客户端
// ============================================================================

/**
 * LSP 方法枚举
 */
enum LSPMethod {
  // 生命周期
  Initialize = "initialize",
  Initialized = "initialized",
  Shutdown = "shutdown",
  Exit = "exit",

  // 文件同步
  DidOpen = "textDocument/didOpen",
  DidChange = "textDocument/didChange",
  DidClose = "textDocument/didClose",

  // 语言功能
  Completion = "textDocument/completion",
  Hover = "textDocument/hover",
  Definition = "textDocument/definition",
  References = "textDocument/references",
  DocumentSymbol = "textDocument/documentSymbol",
}

/**
 * 简化的 LSP 客户端
 */
class SimpleLSPClient {
  private requestId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  /**
   * 发送请求并等待响应
   */
  async request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId

      this.pendingRequests.set(id, { resolve, reject })

      const request: LSPRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      }

      // 在实际实现中，这里会写入进程的 stdin
      console.log(`[Client → Server] ${method}`)
      console.log(serializeMessage(request))
    })
  }

  /**
   * 发送通知（不需要响应）
   */
  notify(method: string, params?: unknown): void {
    const notification: LSPNotification = {
      jsonrpc: "2.0",
      method,
      params,
    }

    console.log(`[Client → Server] ${method} (notification)`)
    console.log(serializeMessage(notification))
  }

  /**
   * 处理服务端响应
   */
  handleResponse(message: LSPResponse): void {
    const { id, result, error } = message
    const pending = this.pendingRequests.get(typeof id === "number" ? id : 0)

    if (pending) {
      this.pendingRequests.delete(typeof id === "number" ? id : 0)

      if (error) {
        pending.reject(new Error(error.message))
      } else {
        pending.resolve(result)
      }
    }
  }

  // ==================== 常用方法 ====================

  /**
   * 初始化 LSP 会话
   */
  async initialize(rootUri: string): Promise<unknown> {
    return this.request(LSPMethod.Initialize, {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: true },
          definition: { dynamicRegistration: true },
          completion: { dynamicRegistration: true },
        },
      },
    })
  }

  /**
   * 打开文档
   */
  didOpen(uri: string, languageId: string, content: string): void {
    this.notify(LSPMethod.DidOpen, {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    })
  }

  /**
   * 获取定义位置
   */
  async goToDefinition(uri: string, position: Position): Promise<Location[]> {
    const result = await this.request(LSPMethod.Definition, {
      textDocument: { uri },
      position,
    })
    return result as Location[]
  }

  /**
   * 获取悬停信息
   */
  async hover(uri: string, position: Position): Promise<string | null> {
    const result = await this.request(LSPMethod.Hover, {
      textDocument: { uri },
      position,
    })

    // 简化处理，实际返回的是 Hover 对象
    const hover = result as { contents?: string }
    return hover?.contents ?? null
  }

  /**
   * 获取文档符号
   */
  async documentSymbol(uri: string): Promise<SymbolInfo[]> {
    const result = await this.request(LSPMethod.DocumentSymbol, {
      textDocument: { uri },
    })
    return result as SymbolInfo[]
  }
}

// ============================================================================
// 4. 模拟 LSP 服务器（用于演示）
// ============================================================================

/**
 * 模拟的 LSP 服务器 - 响应常见请求
 */
class MockLSPServer {
  private files = new Map<string, string>()

  /**
   * 处理请求
   */
  handleRequest(message: LSPRequest): LSPResponse {
    const { id, method, params } = message

    let result: unknown = null
    let error: { code: number; message: string } | undefined

    switch (method) {
      case LSPMethod.Initialize:
        result = {
          capabilities: {
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            completionProvider: {
              triggerCharacters: ["."],
            },
          },
        }
        break

      case LSPMethod.Definition:
        // 模拟返回一个定义位置
        result = [
          {
            uri: "file:///demo/src/utils.ts",
            range: {
              start: { line: 10, character: 0 },
              end: { line: 15, character: 0 },
            },
          },
        ]
        break

      case LSPMethod.Hover:
        result = {
          contents: "```typescript\nfunction hello(name: string): void\n```\n\n打印问候语",
        }
        break

      case LSPMethod.DocumentSymbol:
        result = [
          {
            name: "myFunction",
            kind: 12, // Function
            location: {
              uri: (params as { textDocument: { uri: string } }).textDocument.uri,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 5, character: 0 },
              },
            },
          },
        ]
        break

      default:
        error = { code: -32601, message: `Method not found: ${method}` }
    }

    return {
      jsonrpc: "2.0",
      id,
      result,
      error,
    }
  }
}

// ============================================================================
// 5. 使用示例
// ============================================================================

async function demo() {
  console.log("=== 简化 LSP 工具演示 ===\n")

  // 创建客户端
  const client = new SimpleLSPClient()

  // 创建模拟服务器
  const server = new MockLSPServer()

  // 模拟通信
  console.log("\n【步骤1：初始化】")
  const initRequest: LSPRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: LSPMethod.Initialize,
    params: { rootUri: "file:///demo" },
  }

  console.log("客户端发送:")
  console.log(serializeMessage(initRequest))

  const initResponse = server.handleRequest(initRequest)
  console.log("\n服务器响应:")
  console.log(JSON.stringify(initResponse, null, 2))

  // 模拟 goToDefinition
  console.log("\n【步骤2：跳转到定义】")
  const defRequest: LSPRequest = {
    jsonrpc: "2.0",
    id: 2,
    method: LSPMethod.Definition,
    params: {
      textDocument: { uri: "file:///demo/src/main.ts" },
      position: { line: 5, character: 10 },
    },
  }

  console.log("客户端发送:")
  console.log(serializeMessage(defRequest))

  const defResponse = server.handleRequest(defRequest)
  console.log("\n服务器响应:")
  console.log(JSON.stringify(defResponse, null, 2))

  // 解释结果
  console.log("\n【结果解读】")
  const locations = defResponse.result as Location[]
  if (locations?.[0]) {
    const loc = locations[0]!
    console.log(`定义位于: ${loc.uri}`)
    console.log(`行号: ${loc.range.start.line + 1} (转换为编辑器显示的1-based)`)
    console.log(`列号: ${loc.range.start.character + 1}`)
  }

  console.log("\n【消息格式说明】")
  console.log("LSP 消息格式：Content-Length: xxx\\r\\n\\r\\n{JSON}")
  console.log("- Content-Length: JSON 内容的字节长度")
  console.log("- \\r\\n\\r\\n: 双换行分隔头部和内容")
  console.log("- JSON: 实际的请求数据")
}

// 运行演示
// demo()

// ============================================================================
// 6. 实际使用示例（使用 Deno 或 Node.js child_process）
// ============================================================================

/**
 * 实际 LSP 客户端实现模板
 */
class RealLSPClient {
  private process: any // 实际中是 ChildProcess
  private requestId = 0
  private responseHandlers = new Map<number, (response: unknown) => void>()

  constructor(command: string, args: string[]) {
    // 实际实现：
    // this.process = spawn(command, args)
    // this.process.stdout.on('data', this.handleMessage.bind(this))
  }

  async request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const id = ++this.requestId
      this.responseHandlers.set(id, resolve)

      const message: LSPRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      }

      // const content = serializeMessage(message)
      // this.process.stdin.write(content)
    })
  }

  private handleMessage(data: Buffer): void {
    // 解析消息并调用对应的 handler
    // const messages = parseMessages(data.toString())
    // for (const msg of messages) { ... }
  }
}

// ============================================================================
// 导出
// ============================================================================

export {
  // 类型
  type Position,
  type Range,
  type Location,
  type Diagnostic,
  type SymbolInfo,
  type LSPRequest,
  type LSPResponse,
  type LSPNotification,

  // 枚举
  LSPMethod,

  // 客户端
  SimpleLSPClient,
  RealLSPClient,

  // 工具函数
  serializeMessage,
  parseMessages,
}
