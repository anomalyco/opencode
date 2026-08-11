#!/usr/bin/env bun
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getCurrentCli, windowsify } from "./utils"

const version = "v1.9.2"
const commit = "306c88f4d1286aec1bf96e544632897886af5501"
const destination = windowsify("resources/whisper/whisper-cli")
const manifest = "resources/whisper/runtime.json"

export async function buildWhisperToResources(target = getCurrentCli().rustTarget) {
  const current = await Bun.file(manifest)
    .json()
    .catch(() => undefined)
  if (
    current?.version === version &&
    current?.commit === commit &&
    current?.target === target &&
    (await Bun.file(destination).exists())
  )
    return

  const directory = await mkdtemp(join(tmpdir(), "opencode-whisper-"))
  const source = join(directory, "source")
  const build = join(directory, "build")
  try {
    await run([
      "git",
      "clone",
      "--filter=blob:none",
      "--depth",
      "1",
      "--branch",
      version,
      "https://github.com/ggml-org/whisper.cpp.git",
      source,
    ])
    const revision = (await commandText(["git", "rev-parse", "HEAD"], source)).trim()
    if (revision !== commit) throw new Error(`Unexpected whisper.cpp revision: ${revision}`)

    const platform = target.includes("windows")
      ? target.startsWith("aarch64")
        ? ["-A", "ARM64"]
        : ["-A", "x64"]
      : target.includes("apple")
        ? [`-DCMAKE_OSX_ARCHITECTURES=${target.startsWith("aarch64") ? "arm64" : "x86_64"}`]
        : []
    await run([
      "cmake",
      "-S",
      source,
      "-B",
      build,
      ...platform,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DGGML_OPENMP=OFF",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_SERVER=OFF",
      "-DWHISPER_BUILD_EXAMPLES=ON",
    ])
    await run(["cmake", "--build", build, "--config", "Release", "--target", "whisper-cli", "--parallel"])

    await mkdir("resources/whisper", { recursive: true })
    await copyFile(
      process.platform === "win32"
        ? join(build, "bin", "Release", "whisper-cli.exe")
        : join(build, "bin", "whisper-cli"),
      destination,
    )
    await copyFile(join(source, "LICENSE"), "resources/whisper/LICENSE.whisper.cpp")
    if (process.platform !== "win32") await chmod(destination, 0o755)
    if (process.platform === "darwin") await run(["codesign", "--force", "--sign", "-", destination])
    await writeFile(manifest, `${JSON.stringify({ version, commit, target }, null, 2)}\n`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function run(command: string[], cwd?: string) {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) throw new Error(`${command[0]} exited with code ${code}`)
}

async function commandText(command: string[], cwd?: string) {
  const child = Bun.spawn(command, { cwd, stdin: "ignore", stdout: "pipe", stderr: "inherit" })
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  if (code !== 0) throw new Error(`${command[0]} exited with code ${code}`)
  return output
}

if (import.meta.main) await buildWhisperToResources()
