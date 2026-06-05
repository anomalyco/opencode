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
      `import { HttpRecorder, type RecorderOptions } from "@opencode-ai/http-recorder"
import { HttpClient } from "effect/unstable/http/HttpClient"
import { Socket } from "effect/unstable/socket/Socket"

const options: RecorderOptions = { redact: { jsonFields: ["access_token"] } }
HttpRecorder.layer("consumer/custom", options) satisfies import("effect/Layer").Layer<HttpClient, never, HttpClient>
HttpRecorder.layerFetch("consumer/fetch", options) satisfies import("effect/Layer").Layer<HttpClient>
HttpRecorder.layerSocket("consumer/socket", { url: "wss://example.test" }) satisfies import("effect/Layer").Layer<Socket, never, Socket>
HttpRecorder.layerWebSocket("consumer/websocket", "wss://example.test") satisfies import("effect/Layer").Layer<Socket>
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
        'import("@opencode-ai/http-recorder").then((module) => console.log(Object.keys(module.HttpRecorder).sort()))',
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
