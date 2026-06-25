#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pack } from "./pack.js"

const run = async (command: ReadonlyArray<string>, cwd: string) => {
  const process = Bun.spawn(command, { cwd, env: globalThis.process.env, stdout: "inherit", stderr: "inherit" })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`)
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

const options: HttpRecorder.RecorderOptions = { redact: { jsonFields: ["access_token"] } }
HttpRecorder.http("consumer", options) satisfies Layer.Layer<HttpClient.HttpClient>
HttpRecorder.socket("consumer/socket", options).pipe(
  Layer.provide(NodeSocket.layerWebSocket("wss://example.test")),
) satisfies Layer.Layer<Socket.Socket>
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
          // Required by effect@4.0.0-beta.74: its schema.d.ts references an undeclared SchemaErrorTypeId.
          skipLibCheck: true,
          lib: ["ES2022", "DOM", "ESNext.Disposable"],
        },
        include: ["consumer.ts"],
      }),
    )

    await run(["npm", "install", archive, "typescript@5.8.2"], directory)
    await run(
      [
        "node",
        "--input-type=module",
        "-e",
        'import("@opencode-ai/http-recorder").then((module) => { const root = Object.keys(module).sort(); const namespace = Object.keys(module.HttpRecorder).sort(); if (JSON.stringify(root) !== JSON.stringify(["HttpRecorder"])) throw new Error(`Unexpected root exports: ${root}`); if (JSON.stringify(namespace) !== JSON.stringify(["http", "socket"])) throw new Error(`Unexpected namespace exports: ${namespace}`) })',
      ],
      directory,
    )
    await run([path.join(directory, "node_modules", ".bin", "tsc"), "--noEmit"], directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const archive = await pack()
  try {
    await verifyPackage(archive)
  } finally {
    await Bun.file(archive).delete()
  }
}
