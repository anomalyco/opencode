import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../../core/test/fixture/tmpdir"
import { isolatedEnv } from "../fixture/environment"

for (const v1 of [false, true])
  test(
    v1
      ? "V1 run bridge uses the process cwd when PWD points elsewhere"
      : "run uses the process cwd when PWD points elsewhere",
    async () => {
      await using root = await tmpdir("opencode-cli-run-root-")
      const actual = path.join(root.path, "actual")
      const elsewhere = path.join(root.path, "elsewhere")
      await Promise.all([mkdir(actual), mkdir(elsewhere)])

      const model = Bun.serve({
        port: 0,
        async fetch(request) {
          if (!new URL(request.url).pathname.endsWith("/chat/completions")) return Response.json({})
          const body = (await request.json()) as { messages: { role: string }[] }
          const done = body.messages.some((message) => message.role === "tool")
          const chunks = done
            ? [
                { choices: [{ index: 0, delta: { role: "assistant", content: "done" } }] },
                { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
              ]
            : [
                {
                  choices: [
                    {
                      index: 0,
                      delta: {
                        role: "assistant",
                        tool_calls: [
                          {
                            index: 0,
                            id: "call_1",
                            type: "function",
                            function: {
                              name: "write",
                              arguments: JSON.stringify({ path: "marker.txt", content: "hi" }),
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
                { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
              ]
          const stream = chunks
            .map(
              (chunk) =>
                `data: ${JSON.stringify({ id: "chunk_1", object: "chat.completion.chunk", created: 0, model: "m", ...chunk })}\n\n`,
            )
            .join("")
          return new Response(stream + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
        },
      })

      try {
        const preload = path.join(import.meta.dir, "../../../tui/node_modules/@opentui/solid/scripts/preload.js")
        const child = Bun.spawn(
          v1
            ? [
                process.execPath,
                "--conditions=browser",
                `--preload=${preload}`,
                path.join(import.meta.dir, "../fixture/run-v1.ts"),
              ]
            : [
                process.execPath,
                "--conditions=browser",
                `--preload=${preload}`,
                path.join(import.meta.dir, "../../src/index.ts"),
                "run",
                "--standalone",
                "--format",
                "json",
                "-m",
                "mock/m",
                "Create marker.txt containing hi",
              ],
          {
            cwd: actual,
            env: isolatedEnv(root.path, {
              PWD: elsewhere,
              BUN_OPTIONS: `--conditions=browser --preload=${preload}`,
              OPENCODE_CONFIG_CONTENT: JSON.stringify({
                autoupdate: false,
                permission: { edit: "allow", bash: "deny" },
                provider: {
                  mock: {
                    npm: "@ai-sdk/openai-compatible",
                    name: "Mock",
                    options: { baseURL: `${model.url}v1`, apiKey: "x" },
                    models: { m: { name: "m", tool_call: true } },
                  },
                },
              }),
            }),
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            signal: AbortSignal.timeout(120_000),
          },
        )
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 })
        expect(await Bun.file(path.join(elsewhere, "marker.txt")).exists()).toBe(false)
        expect(await Bun.file(path.join(actual, "marker.txt")).text()).toBe("hi")
      } finally {
        model.stop(true)
      }
    },
    120_000,
  )
