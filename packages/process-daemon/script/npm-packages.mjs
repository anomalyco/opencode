#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const dist = path.resolve(root, process.argv[2] ?? "dist")
const output = path.join(dist, "npm")
const manifest = JSON.parse(await readFile(path.join(root, "npm/package.json"), "utf8"))
const targets = [
  { target: "aarch64-apple-darwin", platform: "darwin", arch: "arm64" },
  { target: "x86_64-apple-darwin", platform: "darwin", arch: "x64" },
  { target: "aarch64-unknown-linux-gnu", platform: "linux", arch: "arm64", libc: "glibc", suffix: "gnu" },
  { target: "aarch64-unknown-linux-musl", platform: "linux", arch: "arm64", libc: "musl", suffix: "musl" },
  { target: "x86_64-unknown-linux-gnu", platform: "linux", arch: "x64", libc: "glibc", suffix: "gnu" },
  { target: "x86_64-unknown-linux-musl", platform: "linux", arch: "x64", libc: "musl", suffix: "musl" },
  { target: "aarch64-pc-windows-msvc", platform: "win32", arch: "arm64" },
  { target: "x86_64-pc-windows-msvc", platform: "win32", arch: "x64" },
]

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

for (const target of targets) {
  const suffix = [target.platform, target.arch, target.suffix].filter(Boolean).join("-")
  const name = `@opencode-ai/pty-${suffix}`
  const directory = path.join(output, `opencode-pty-${suffix}`)
  const archive = path.join(dist, `opencode-pty-${manifest.version}-${target.target}.tar.gz`)
  const binary = target.platform === "win32" ? "opencode-pty.exe" : "opencode-pty"
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-npm-"))
  try {
    execFileSync("tar", ["-xzf", archive, "-C", temporary])
    const executable = path.join(temporary, `opencode-pty-${manifest.version}-${target.target}`, binary)
    await mkdir(path.join(directory, "bin"), { recursive: true })
    await copyFile(executable, path.join(directory, "bin", binary))
    await copyFile(path.join(root, "LICENSE"), path.join(directory, "LICENSE"))
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          name,
          version: manifest.version,
          description: `OpenCode persistent PTY service for ${suffix}`,
          license: "MIT",
          repository: manifest.repository,
          os: [target.platform],
          cpu: [target.arch],
          ...(target.libc ? { libc: [target.libc] } : {}),
          exports: { "./package.json": "./package.json", [`./bin/${binary}`]: `./bin/${binary}` },
          files: ["bin"],
          publishConfig: { access: "public" },
        },
        null,
        2,
      ) + "\n",
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  console.log(name)
}

const dispatcher = path.join(output, "opencode-pty")
await cp(path.join(root, "npm"), dispatcher, { recursive: true })
await copyFile(path.join(root, "LICENSE"), path.join(dispatcher, "LICENSE"))
console.log(manifest.name)
