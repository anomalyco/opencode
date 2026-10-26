#!/usr/bin/env bun

import { Script } from "@opencode/script"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (Script.channel !== "latest" || !/^\d+\.\d+\.\d+$/.test(Script.version)) {
  throw new Error("WinGet publishing requires a latest release version")
}

const root = fileURLToPath(new URL("..", import.meta.url))
const dryRun = process.argv.includes("--dry-run")
const token = process.env.WINGET_GITHUB_TOKEN
const cli = path.resolve(process.env.OPENCODE_CLI_DIST ?? path.join(root, "packages", "cli", "dist"))
const desktop = process.env.OPENCODE_DESKTOP_DIST
if (!desktop) throw new Error("OPENCODE_DESKTOP_DIST is required")
const outdir = path.join(cli, "winget")
const manifestVersion = "1.12.0"

const packages = [
  {
    identifier: "Anomaly.OpenCode",
    name: "OpenCode CLI",
    moniker: "opencode",
    description: "The open source AI coding agent for the terminal.",
    installer: [
      "InstallerType: zip",
      "NestedInstallerType: portable",
      "NestedInstallerFiles:",
      "- RelativeFilePath: opencode.exe",
      "  PortableCommandAlias: opencode",
      "Commands:",
      "- opencode",
    ],
    files: [
      { architecture: "x64", file: path.join(cli, "opencode-windows-x64-baseline.zip") },
      { architecture: "arm64", file: path.join(cli, "opencode-windows-arm64.zip") },
    ],
  },
  {
    identifier: "Anomaly.OpenCode.Desktop",
    // Matches the display name the installer registers with Windows, without its version suffix.
    name: "OpenCode",
    moniker: "opencode-desktop",
    description: "The open source AI coding agent as a desktop app.",
    installer: [
      "InstallerType: nullsoft",
      "Scope: user",
      "UpgradeBehavior: install",
      // electron-builder derives the NSIS uninstall key from the production app ID, ai.opencode.desktop.
      "ProductCode: d074f30d-5f88-5885-b075-be1348cc7676",
      "Protocols:",
      "- opencode",
    ],
    files: [
      { architecture: "x64", file: path.join(desktop, "opencode-desktop-win-x64.exe") },
      { architecture: "arm64", file: path.join(desktop, "opencode-desktop-win-arm64.exe") },
    ],
  },
]

await rm(outdir, { recursive: true, force: true })
const prepared = await Promise.all(packages.map(prepare))
prepared.forEach((item) => console.log(`Prepared ${item.identifier} ${Script.version} in ${item.directory}`))
if (dryRun) process.exit(0)
if (!token) {
  console.log("skipped WinGet submission: WINGET_GITHUB_TOKEN is not set")
  process.exit(0)
}
for (const item of prepared) await submit(item)

async function prepare(input: (typeof packages)[number]) {
  const directory = path.join(outdir, input.identifier)
  const header = (type: string) => [
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${manifestVersion}.schema.json`,
    "",
    `PackageIdentifier: ${input.identifier}`,
    `PackageVersion: ${Script.version}`,
  ]
  const footer = (type: string) => [`ManifestType: ${type}`, `ManifestVersion: ${manifestVersion}`, ""]
  const installers = await Promise.all(
    input.files.map(async (item) => {
      const file = Bun.file(item.file)
      if (!(await file.exists()) || !file.size) throw new Error(`Missing WinGet installer: ${item.file}`)
      const sha256 = new Bun.CryptoHasher("sha256")
      for await (const chunk of file.stream()) sha256.update(chunk)
      return [
        `- Architecture: ${item.architecture}`,
        `  InstallerUrl: https://opencode.ai/files/bin/${encodeURIComponent(Script.version)}/${path.basename(item.file)}`,
        `  InstallerSha256: ${sha256.digest("hex").toUpperCase()}`,
      ]
    }),
  )
  const manifests = {
    [`${input.identifier}.yaml`]: [...header("version"), "DefaultLocale: en-US", ...footer("version")],
    [`${input.identifier}.installer.yaml`]: [
      ...header("installer"),
      ...input.installer,
      `ReleaseDate: ${new Date().toISOString().slice(0, 10)}`,
      "Installers:",
      ...installers.flat(),
      ...footer("installer"),
    ],
    [`${input.identifier}.locale.en-US.yaml`]: [
      ...header("defaultLocale"),
      "PackageLocale: en-US",
      // Matches the publisher the desktop installer registers with Windows.
      "Publisher: OpenCode",
      "PublisherUrl: https://anoma.ly/",
      "PublisherSupportUrl: https://github.com/anomalyco/opencode/issues",
      "PrivacyUrl: https://opencode.ai/legal/privacy-policy",
      `PackageName: ${input.name}`,
      "PackageUrl: https://opencode.ai/",
      "License: MIT",
      "LicenseUrl: https://github.com/anomalyco/opencode/blob/HEAD/LICENSE",
      `ShortDescription: ${input.description}`,
      `Moniker: ${input.moniker}`,
      "Tags:",
      "- ai",
      "- coding-agent",
      "- developer-tools",
      "Documentations:",
      "- DocumentLabel: Docs",
      "  DocumentUrl: https://opencode.ai/v2/docs",
      ...footer("defaultLocale"),
    ],
  }
  const files = Object.fromEntries(Object.entries(manifests).map(([name, lines]) => [name, lines.join("\n")]))
  await mkdir(directory, { recursive: true })
  await Promise.all(Object.entries(files).map(([name, content]) => Bun.write(path.join(directory, name), content)))
  return { identifier: input.identifier, directory, files }
}

// Opens the pull request from the token owner's fork, the only way to contribute to microsoft/winget-pkgs.
async function submit(input: Awaited<ReturnType<typeof prepare>>) {
  const upstream = "microsoft/winget-pkgs"
  const folder = ["manifests", "a", ...input.identifier.split("."), Script.version].join("/")
  const branch = `${input.identifier}-${Script.version}`
  if ((await github(`/repos/${upstream}/contents/${folder}`)).status === 200) {
    console.log(`${input.identifier} ${Script.version} is already in ${upstream}`)
    return
  }
  const fork: { owner: { login: string }; full_name: string } = await json(
    await github(`/repos/${upstream}/forks`, { method: "POST", body: { default_branch_only: true } }),
  )
  const pulls: unknown[] = await json(
    await github(`/repos/${upstream}/pulls?state=all&head=${encodeURIComponent(`${fork.owner.login}:${branch}`)}`),
  )
  if (pulls.length) {
    console.log(`${input.identifier} ${Script.version} already has a pull request`)
    return
  }
  // Forks share objects with their upstream, so the branch can start from upstream master without syncing the fork.
  const head: { object: { sha: string } } = await json(await github(`/repos/${upstream}/git/ref/heads/master`))
  const base: { tree: { sha: string } } = await json(await github(`/repos/${upstream}/git/commits/${head.object.sha}`))
  const tree: { sha: string } = await json(
    await github(`/repos/${fork.full_name}/git/trees`, {
      method: "POST",
      body: {
        base_tree: base.tree.sha,
        tree: Object.entries(input.files).map(([name, content]) => ({
          path: `${folder}/${name}`,
          mode: "100644",
          type: "blob",
          content,
        })),
      },
    }),
  )
  const title = `New version: ${input.identifier} version ${Script.version}`
  const commit: { sha: string } = await json(
    await github(`/repos/${fork.full_name}/git/commits`, {
      method: "POST",
      body: { message: title, tree: tree.sha, parents: [head.object.sha] },
    }),
  )
  const created = await github(`/repos/${fork.full_name}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: commit.sha },
  })
  // A retried release can find the branch from an attempt that failed before opening its pull request.
  await json(
    created.status === 422
      ? await github(`/repos/${fork.full_name}/git/refs/heads/${branch}`, {
          method: "PATCH",
          body: { sha: commit.sha, force: true },
        })
      : created,
  )
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined
  const pull: { html_url: string } = await json(
    await github(`/repos/${upstream}/pulls`, {
      method: "POST",
      body: {
        title,
        head: `${fork.owner.login}:${branch}`,
        base: "master",
        body: `Published by the [OpenCode](https://github.com/anomalyco/opencode) release workflow${run ? ` in ${run}` : ""}.`,
      },
    }),
  )
  console.log(`Opened ${pull.html_url}`)
}

function github(route: string, init?: { method?: string; body?: unknown }) {
  return fetch(`https://api.github.com${route}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

async function json(response: Response) {
  if (!response.ok) throw new Error(`GitHub ${response.url} returned ${response.status}: ${await response.text()}`)
  return response.json()
}
