import type { ChildProcessWithoutNullStreams } from "child_process"
import { spawn } from "child_process"

export function isAcpMockEnabled(): boolean {
  return process.env.OPENCODE_ACP_MOCK === "1"
}

export function startMockAcp(): ChildProcessWithoutNullStreams {
  const script = [
    "const { stdin, stdout } = process",
    "const write = (msg) => stdout.write(JSON.stringify(msg) + '\n')",
    "stdin.setEncoding('utf8')",
    "let buffer = ''",
    "stdin.on('data', (chunk) => {",
    "  buffer += chunk",
    "  let idx = buffer.indexOf('\n')",
    "  while (idx >= 0) {",
    "    const line = buffer.slice(0, idx)",
    "    buffer = buffer.slice(idx + 1)",
    "    idx = buffer.indexOf('\n')",
    "    if (!line.trim()) continue",
    "    let msg",
    "    try { msg = JSON.parse(line) } catch { continue }",
    "    if (!msg || msg.jsonrpc !== '2.0') continue",
    "    if (msg.method === 'initialize') {",
    "      write({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'opencode-mock', version: '1.0.0' }, serverCapabilities: {} } })",
    "      continue",
    "    }",
    "    if (msg.method === 'session/create') {",
    "      write({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'mock-session' } })",
    "      continue",
    "    }",
    "    if (msg.method === 'session/load') {",
    "      write({ jsonrpc: '2.0', id: msg.id, result: { sessionId: msg.params?.sessionId ?? 'mock-session' } })",
    "      continue",
    "    }",
    "    if (msg.method === 'session/sendPrompt') {",
    "      const sessionId = msg.params?.sessionId ?? 'mock-session'",
    "      const text = 'OpenCode mock response'",
    "      write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { text } } } })",
    "      write({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'stop', usage: { totalTokens: 1, inputTokens: 1, outputTokens: 1 } } })",
    "      continue",
    "    }",
    "    if (msg.method === 'session/cancel') {",
    "      write({ jsonrpc: '2.0', id: msg.id, result: {} })",
    "      continue",
    "    }",
    "    if (msg.method === 'dispose') {",
    "      write({ jsonrpc: '2.0', id: msg.id, result: {} })",
    "      continue",
    "    }",
    "    write({ jsonrpc: '2.0', id: msg.id, result: {} })",
    "  }",
    "})",
  ].join("\n")

  return spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_ACP_MOCK: "1",
    },
  })
}

export function bindMockOutput(proc: ChildProcessWithoutNullStreams): void {
  void proc
}

export function bindMockInput(proc: ChildProcessWithoutNullStreams): void {
  void proc
}
