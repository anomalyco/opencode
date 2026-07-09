#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { withPackedArchive } from "./pack.js"

const run = async (command: ReadonlyArray<string>, cwd: string) => {
  const process = Bun.spawn(command, { cwd, env: globalThis.process.env, stdout: "inherit", stderr: "inherit" })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`)
}

const reject = async (command: ReadonlyArray<string>, cwd: string) => {
  const process = Bun.spawn([...command], { cwd, env: globalThis.process.env, stdout: "ignore", stderr: "ignore" })
  if ((await process.exited) === 0) throw new Error(`${command.join(" ")} unexpectedly succeeded`)
}

export const verifyPackage = async (archive: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "http-recorder-consumer-"))
  try {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "http-recorder-consumer", private: true, type: "module" }),
    )
    await writeFile(
      path.join(directory, "consumer.ts"),
      `import { HttpRecorder } from "@opencode-ai/http-recorder"
import { NodeSocket } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"

const options: HttpRecorder.RecorderOptions = { match: () => true, redact: { jsonFields: ["access_token"] } }
const socketOptions: HttpRecorder.SocketRecorderOptions = { redact: { jsonFields: ["access_token"] } }
HttpRecorder.layer("consumer", options) satisfies Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient>
HttpRecorder.layerFetch("consumer", options) satisfies Layer.Layer<HttpClient.HttpClient>
HttpRecorder.hasCassetteSync("consumer", { directory: "recordings" }) satisfies boolean
HttpRecorder.removeCassetteSync("consumer", { directory: "recordings" })
HttpRecorder.layerSocket("consumer/socket", socketOptions).pipe(
  Layer.provide(NodeSocket.layerWebSocket("wss://example.test")),
) satisfies Layer.Layer<Socket.Socket>
HttpRecorder.layerWebSocketConstructor("consumer/websocket", socketOptions).pipe(
  Layer.provide(NodeSocket.layerWebSocketConstructor),
) satisfies Layer.Layer<Socket.WebSocketConstructor>
// @ts-expect-error HTTP request matching does not apply to WebSocket frames.
HttpRecorder.layerSocket("consumer/socket", { match: () => true })
`,
    )
    await writeFile(
      path.join(directory, "exports.mjs"),
      `import { HttpRecorder } from "@opencode-ai/http-recorder"

const root = Object.keys(await import("@opencode-ai/http-recorder")).sort()
if (JSON.stringify(root) !== JSON.stringify(["HttpRecorder"])) {
  throw new Error(\`Unexpected root exports: \${root}\`)
}

const namespace = Object.keys(HttpRecorder).sort()
if (JSON.stringify(namespace) !== JSON.stringify(["hasCassetteSync", "layer", "layerFetch", "layerSocket", "layerWebSocketConstructor", "removeCassetteSync"])) {
  throw new Error(\`Unexpected HttpRecorder exports: \${namespace}\`)
}
`,
    )
    await writeFile(
      path.join(directory, "deep-import.mjs"),
      `import "@opencode-ai/http-recorder/internal"
`,
    )
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          // Required by effect@4.0.0-beta.83: its declarations currently contain unresolved internal symbols.
          skipLibCheck: true,
          lib: ["ES2022", "DOM", "ESNext.Disposable"],
        },
        include: ["consumer.ts"],
      }),
    )

    await run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        archive,
        "typescript@5.8.2",
        "effect@4.0.0-beta.83",
        "@effect/platform-node@4.0.0-beta.83",
      ],
      directory,
    )
    await run(["node", path.join(directory, "exports.mjs")], directory)
    await run(["bun", path.join(directory, "exports.mjs")], directory)
    await reject(["node", path.join(directory, "deep-import.mjs")], directory)
    await run([path.join(directory, "node_modules", ".bin", "tsc"), "--noEmit"], directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) await withPackedArchive(verifyPackage)
