#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const packages = ["@opencode-ai/simulation", "@opencode-ai/server"]
const publish = Bun.argv.includes("--publish")

if (!publish) {
  console.log("Package names to reserve:")
  for (const name of packages) console.log(`- ${name}`)
  console.log("\nRun `bun run reserve-packages --publish` to log in and publish reservation placeholders.")
  process.exit(0)
}

if (run(["npm", "whoami"]) !== 0) {
  if (run(["npm", "login"]) !== 0) throw new Error("npm login failed")
  if (run(["npm", "whoami"]) !== 0) throw new Error("npm authentication failed")
}

const directory = await mkdtemp(path.join(tmpdir(), "opencode-package-reservations-"))
try {
  for (const name of packages) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
    if (response.ok) {
      console.log(`Skipping ${name}: already exists on npm`)
      continue
    }
    if (response.status !== 404) throw new Error(`Failed to check ${name}: npm returned ${response.status}`)

    const target = path.join(directory, name.slice("@opencode-ai/".length))
    await mkdir(target, { recursive: true })
    await Bun.write(
      path.join(target, "package.json"),
      JSON.stringify(
        {
          name,
          version: "0.0.0-reserved",
          description: "Reserved for OpenCode",
          license: "MIT",
          repository: {
            type: "git",
            url: "git+https://github.com/anomalyco/opencode.git",
          },
          publishConfig: {
            access: "public",
            tag: "reserved",
          },
        },
        null,
        2,
      ) + "\n",
    )
    await Bun.write(path.join(target, "README.md"), `# ${name}\n\nReserved for OpenCode.\n`)

    console.log(`Reserving ${name}`)
    if (run(["npm", "publish", "--access", "public", "--tag", "reserved"], target) !== 0) {
      throw new Error(`Failed to reserve ${name}`)
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}

function run(command: string[], cwd?: string) {
  return Bun.spawnSync(command, {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exitCode
}
