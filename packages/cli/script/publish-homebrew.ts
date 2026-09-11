#!/usr/bin/env bun
import { Script } from "@opencode/script"
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { UpdateArtifact } from "../../../script/update-artifact"

if (Script.channel !== "beta" && Script.channel !== "latest") {
  throw new Error("Homebrew publishing requires the beta or latest channel")
}
if (!(Script.channel === "beta" ? /^\d+\.\d+\.\d+-beta[.-]\d+(?:\.\d+)?$/ : /^\d+\.\d+\.\d+$/).test(Script.version)) {
  throw new Error(`Expected a ${Script.channel} release version`)
}

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = path.resolve(process.env.OPENCODE_CLI_DIST ?? path.join(dir, "dist"))
const outdir = path.join(root, "homebrew-tap")
const dryRun = process.argv.includes("--dry-run")

const targets = await Promise.all(
  [
    { name: "darwin-arm64", archive: "zip" },
    { name: "darwin-x64-baseline", archive: "zip" },
    { name: "linux-arm64", archive: "tar.gz" },
    { name: "linux-x64-baseline", archive: "tar.gz" },
  ].map(async (target) => {
    const name = `opencode2-${target.name}.${target.archive}`
    const file = Bun.file(path.join(root, name))
    if (!(await file.exists()) || !file.size) throw new Error(`Missing Homebrew archive: ${name}`)
    const sha256 = new Bun.CryptoHasher("sha256")
    for await (const chunk of file.stream()) sha256.update(chunk)
    return {
      ...target,
      url: `https://opencode.ai/files/bin/${encodeURIComponent(Script.version)}/${name}`,
      sha256: sha256.digest("hex"),
    }
  }),
)

await rm(outdir, { recursive: true, force: true })
if (dryRun) await mkdir(outdir, { recursive: true })
if (!dryRun) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error("GITHUB_TOKEN is required to update the Homebrew tap")
  await $`git clone ${`https://x-access-token:${token}@github.com/anomalyco/homebrew-tap.git`} ${outdir}`
  await $`git checkout -B master`.cwd(outdir)
}

const target = (name: string) => {
  const result = targets.find((item) => item.name === name)
  if (!result) throw new Error(`Missing Homebrew target: ${name}`)
  return result
}
const macArm = target("darwin-arm64")
const macIntel = target("darwin-x64-baseline")
const linuxArm = target("linux-arm64")
const linuxIntel = target("linux-x64-baseline")

await Bun.write(
  path.join(outdir, "opencode-v2.rb"),
  [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "class OpencodeV2 < Formula",
    '  desc "OpenCode V2 - the AI coding agent for the terminal"',
    '  homepage "https://github.com/anomalyco/opencode"',
    `  version "${Script.version}"`,
    '  license "MIT"',
    "",
    '  depends_on "ripgrep"',
    "",
    "  on_macos do",
    "    if Hardware::CPU.arm?",
    `      url "${macArm.url}"`,
    `      sha256 "${macArm.sha256}"`,
    "    else",
    `      url "${macIntel.url}"`,
    `      sha256 "${macIntel.sha256}"`,
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.arm?",
    `      url "${linuxArm.url}"`,
    `      sha256 "${linuxArm.sha256}"`,
    "    else",
    `      url "${linuxIntel.url}"`,
    `      sha256 "${linuxIntel.sha256}"`,
    "    end",
    "  end",
    "",
    "  def install",
    '    bin.install "opencode2"',
    "  end",
    "end",
    "",
  ].join("\n"),
)
console.log(`Prepared opencode-v2 ${Script.version} in ${outdir}`)
if (dryRun) process.exit(0)

await $`git add opencode-v2.rb`.cwd(outdir)
if ((await $`git diff --cached --quiet`.cwd(outdir).nothrow()).exitCode !== 0) {
  await $`git commit -m ${`chore: update opencode-v2 to ${Script.version}`}`.cwd(outdir)
  await $`git push origin master`.cwd(outdir)
}
await UpdateArtifact.publish({
  channel: Script.channel,
  name: "cli",
  distribution: "homebrew",
  version: Script.version,
  metadata: { package: "anomalyco/tap/opencode-v2" },
})
