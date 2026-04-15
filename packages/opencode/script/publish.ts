#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const subPkg = await Bun.file(`./dist/${filepath}`).json()
  if (!subPkg.name.includes("windows")) {
    binaries[subPkg.name] = subPkg.version
  }
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: {
        "securecode": `./bin/opencode`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// Parse OTP if passed
const otpMatch = process.argv.find(arg => arg.startsWith('--otp='))
const otpArgs = otpMatch ? [otpMatch] : []

import { spawnSync } from "child_process"

// Publish all the native OS packages
for (const [name] of Object.entries(binaries)) {
  const folderName = name.split('/')[1] || name
  
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${folderName}`)
  }
  await $`bun pm pack`.cwd(`./dist/${folderName}`)
  
  // Use spawnSync with stdio: inherit so NPM correctly detects TTY and opens Browser for Passkey/WebAuthn
  const tgzFile = Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: `./dist/${folderName}` }))[0]
  if (tgzFile) {
    spawnSync("npm", ["publish", tgzFile, "--access", "public", "--tag", Script.channel, ...otpArgs], {
      cwd: `./dist/${folderName}`,
      stdio: "inherit"
    })
  }
}

// Publish the main wrapper package
await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
const mainTgzFile = Array.from(new Bun.Glob("*.tgz").scanSync({ cwd: `./dist/${pkg.name}` }))[0]
if (mainTgzFile) {
  spawnSync("npm", ["publish", mainTgzFile, "--access", "public", "--tag", Script.channel, ...otpArgs], {
    cwd: `./dist/${pkg.name}`,
    stdio: "inherit"
  })
}
