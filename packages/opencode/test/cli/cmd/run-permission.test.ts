import { expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"

function sseLine(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function sseDone() {
  return "data: [DONE]\n\n"
}

function chunk(delta: Record<string, unknown>, finish?: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }],
  }
}

function isTitleRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false
  return JSON.stringify(body).includes("Generate a title")
}

function titleSSE() {
  return [
    sseLine(chunk({ role: "assistant" })),
    sseLine(chunk({ content: "Test" })),
    sseLine(chunk({}, "stop")),
    sseDone(),
  ].join("")
}

function taskToolSSE() {
  const args = JSON.stringify({
    description: "list files",
    prompt: "list files in the current directory",
    subagent_type: "explore",
  })
  return [
    sseLine(chunk({ role: "assistant" })),
    sseLine(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_task_1",
            type: "function",
            function: { name: "task", arguments: "" },
          },
        ],
      }),
    ),
    sseLine(
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: args } },
        ],
      }),
    ),
    sseLine(chunk({}, "tool_calls")),
    sseDone(),
  ].join("")
}

function bashToolSSE() {
  const args = JSON.stringify({ command: "ls", description: "list files" })
  return [
    sseLine(chunk({ role: "assistant" })),
    sseLine(
      chunk({
        tool_calls: [
          {
            index: 0,
            id: "call_bash_1",
            type: "function",
            function: { name: "bash", arguments: "" },
          },
        ],
      }),
    ),
    sseLine(
      chunk({
        tool_calls: [
          { index: 0, function: { arguments: args } },
        ],
      }),
    ),
    sseLine(chunk({}, "tool_calls")),
    sseDone(),
  ].join("")
}

function textSSE(text: string) {
  return [
    sseLine(chunk({ role: "assistant" })),
    sseLine(chunk({ content: text })),
    sseLine(chunk({}, "stop")),
    sseDone(),
  ].join("")
}

test("subagent permission.asked is processed with --dangerously-skip-permissions", async () => {
  let requestIndex = 0
  const responses = [
    taskToolSSE(),
    bashToolSSE(),
    textSSE("done"),
    textSSE("complete"),
  ]

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.json().catch(() => ({}))
      if (isTitleRequest(body)) {
        return new Response(titleSSE(), {
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      const response = responses[requestIndex] ?? textSSE("ok")
      requestIndex++
      return new Response(response, {
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-integ-"))
  try {
    await $`git init`.cwd(tmpDir).quiet()
    await $`git config user.email "test@test.com"`.cwd(tmpDir).quiet()
    await $`git config user.name "Test"`.cwd(tmpDir).quiet()
    await $`git commit --allow-empty -m "root"`.cwd(tmpDir).quiet()

    await fs.writeFile(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        permission: {
          bash: "ask",
        },
        provider: {
          test: {
            options: {
              baseURL: `http://127.0.0.1:${server.port}/v1`,
            },
            models: {
              "test-model": {
                name: "Test Model",
                tool_call: true,
              },
            },
          },
        },
      }),
    )

    const srcPath = path.resolve(__dirname, "../../../src/index.ts")
    const proc = Bun.spawn(
      [
        "bun",
        srcPath,
        "run",
        "--format",
        "json",
        "--dangerously-skip-permissions",
        "--model",
        "test/test-model",
        "use explore agent to list files",
      ],
      {
        cwd: tmpDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      },
    )

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => setTimeout(() => { proc.kill(); resolve(-1) }, 30000)),
    ])

    const lines = stdout.split("\n").filter((l) => l.trim())
    const toolEvents = lines
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter((e) => e && e.type === "tool_use")

    const taskEvents = toolEvents.filter(
      (e: any) => e.part?.tool === "task" && e.part?.state?.status === "completed",
    )

    expect(
      exitCode,
      `Process exited with code ${exitCode}.\nstderr:\n${stderr}\nstdout:\n${stdout}`,
    ).toBe(0)
    expect(
      taskEvents.length,
      `Expected task tool to complete but got ${taskEvents.length}. stdout:\n${lines.join("\n")}`,
    ).toBeGreaterThanOrEqual(1)
  } finally {
    server.stop()
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})
