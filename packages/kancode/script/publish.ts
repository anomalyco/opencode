#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@kancode/script"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// Workspace package is `@kancode/cli`; npm distribution stays `@puetsua/kancode` with `kancode` bin.
const publishName = "@puetsua/kancode"
const binName = Object.keys(pkg.bin ?? {})[0] ?? "kancode"

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

const binaryDirs: Record<string, string> = {}
const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  const dirName = path.dirname(filepath)
  binaryDirs[pkg.name] = dirName
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

const wrapperDirName = publishName.replaceAll("/", "-")
const wrapperDir = `./dist/${wrapperDirName}`
await $`mkdir -p ${wrapperDir}/bin`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`
await Bun.file(`${wrapperDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${wrapperDir}/bin/${binName}.exe`).write(
  [
    `echo "Error: ${publishName}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${publishName} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${publishName} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

const skipBinaries =
  process.env["KANCODE_SKIP_BINARIES"] === "1" || process.env["OPENCODE_SKIP_BINARIES"] === "1"
// Default: refuse to publish the wrapper unless every platform binary is on the registry.
// Override with KANCODE_ALLOW_MISSING_BINARIES=1 (or OPENCODE_*) for emergency / partial publishes.
const allowMissingBinaries =
  process.env["KANCODE_ALLOW_MISSING_BINARIES"] === "1" ||
  process.env["OPENCODE_ALLOW_MISSING_BINARIES"] === "1"

const availableBinaries: Record<string, string> = {}
const missingBinaries: string[] = []

if (!skipBinaries) {
  const tasks = Object.entries(binaryDirs).map(async ([name, dirName]) => {
    try {
      await publish(`./dist/${dirName}`, name, binaries[name])
    } catch (e: any) {
      console.error(`failed to publish ${name}: ${e.stderr || e.message}`)
    }
    if (await published(name, binaries[name])) {
      availableBinaries[name] = binaries[name]
      return
    }
    missingBinaries.push(name)
  })
  await Promise.all(tasks)

  if (missingBinaries.length > 0) {
    const list = missingBinaries.map((name) => `${name}@${binaries[name]}`).join(", ")
    if (!allowMissingBinaries) {
      throw new Error(
        [
          `Refusing to publish ${publishName}@${version}: platform binaries missing from npm: ${list}.`,
          "Configure OIDC trusted publishing for each package, then re-run.",
          "To override (partial publish), set KANCODE_ALLOW_MISSING_BINARIES=1.",
        ].join("\n"),
      )
    }
    console.warn(`allowing missing binaries (KANCODE_ALLOW_MISSING_BINARIES=1): ${list}`)
  }
} else {
  console.log("skipping binary package publishes (KANCODE_SKIP_BINARIES=1)")
}

await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: publishName,
      bin: {
        [binName]: `./bin/${binName}.exe`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      repository: {
        type: "git",
        url: "https://github.com/puetsua/kancode",
      },
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      // Only advertise binaries that are actually installable from the registry.
      optionalDependencies: skipBinaries ? {} : availableBinaries,
    },
    null,
    2,
  ),
)

await publish(wrapperDir, publishName, version)

const ghRepo = process.env.GH_REPO || (await $`git remote get-url origin`.text()).trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")