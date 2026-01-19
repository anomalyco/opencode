#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { buildNotes, getLatestRelease } from "./changelog-lash"

let notes: string[] = []


// Check branch
const branch = await $`git branch --show-current`.text().then(t => t.trim())
const isLashBranch = branch === "lash"
const shouldRelease = !Script.preview || isLashBranch

console.log("=== publishing lash ===\n")
if (isLashBranch) console.log("Running on 'lash' branch (forcing release)...")

if (shouldRelease) {
    const previous = await getLatestRelease()
    notes = await buildNotes(previous, "HEAD")
}

const pkgjsons = await Array.fromAsync(
    new Bun.Glob("**/package.json").scan({
        absolute: true,
    }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

// Version bumping logic - keeping strict sync with Script.version
for (const file of pkgjsons) {
    let pkg = await Bun.file(file).text()
    pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
    console.log("updated:", file)
    await Bun.file(file).write(pkg)
}

// Update Extension toml if needed (optional for Lash, but safe)
try {
    const extensionToml = new URL("../packages/extensions/zed/extension.toml", import.meta.url).pathname
    let toml = await Bun.file(extensionToml).text()
    toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
    toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
    console.log("updated:", extensionToml)
    await Bun.file(extensionToml).write(toml)
} catch (e) {
    // ignore if missing
}

await $`bun install`

console.log("\n=== opencode (lash) ===\n")
// Call our new lash publish script, but DEFER the registry/npm steps until we have released on GitHub
process.env.DEFER_PUBLISH_TASKS = "true"
const publishModule = await import(`../packages/opencode/script/publish-lash.ts`)

// Skip SDK/Plugin publishing if not needed, or assume they are shared.
// If we want to fork them too, we'd need more scripts.
// User request focused on Lash CLI (NPM/Brew).

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

let output = `version=${Script.version}\n`

if (shouldRelease) {
    // Commit and Tag
    await $`git commit -am "release: v${Script.version}"`
    await $`git tag v${Script.version}`
    await $`git fetch origin`
    // Cherry pick dev? Maybe not for Lash if we are divergent.
    // await $`git cherry-pick HEAD..origin/dev`.nothrow()

    await $`git push origin HEAD --tags --no-verify --force-with-lease`

    // Validating presence of artifacts before creating release
    console.log("Verifying artifacts for release...")
    const releaseFiles = await Array.fromAsync(new Bun.Glob("./packages/opencode/dist/*.{zip,tar.gz}").scan())
    if (releaseFiles.length === 0) {
        console.warn("WARNING: No distribution files found to upload to GitHub Release!")
    }

    // Create Release on Lash repo
    // Ensure 'gh' is authenticated for lacymorrow/lash or use token
    await $`gh release create v${Script.version} --repo lacymorrow/lash --title "v${Script.version}" --notes ${notes.join("\n") || "No notable changes"} ./packages/opencode/dist/*.zip ./packages/opencode/dist/*.tar.gz`

    const release = await $`gh release view v${Script.version} --repo lacymorrow/lash --json id,tagName`.json()

    output += `release=${release.id}\n`
    output += `tag=${release.tagName}\n`

    console.log("GitHub Release verified. Proceeding to update registries...")

    // NOW update Homebrew (which depends on the GH Release/Assets existing)
    // We need to pass the binaries map if possible, mostly it just iterates them by name
    if (publishModule.updateRegistries) {
        await publishModule.updateRegistries(publishModule.lashBinaries)
    } else {
        console.error("Could not find updateRegistries in publish module")
    }

    // Interactive NPM Publish
    if (publishModule.publishWithInteractiveOtp) {
        await publishModule.publishWithInteractiveOtp(publishModule.publishQueue, "latest")
    }
}

if (process.env.GITHUB_OUTPUT) {
    await Bun.write(process.env.GITHUB_OUTPUT, output)
}

