#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// The bin command name is the unscoped part of the package name.
const binName = pkg.name.includes("/") ? pkg.name.split("/").pop()! : pkg.name

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

const wrapperName = pkg.name
const wrapperDirName = wrapperName.replaceAll("/", "-")
const wrapperDir = `./dist/${wrapperDirName}`
await $`mkdir -p ${wrapperDir}/bin`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`
await Bun.file(`${wrapperDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${wrapperDir}/bin/${binName}.exe`).write(
  [
    `echo "Error: ${wrapperName}'s postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when using --ignore-scripts during installation, or when using a" >&2',
    'echo "package manager like pnpm that does not run postinstall scripts by default." >&2',
    'echo "" >&2',
    'echo "To fix this, run the postinstall script manually:" >&2',
    `echo "  cd node_modules/${wrapperName} && node postinstall.mjs" >&2`,
    'echo "" >&2',
    `echo "Or reinstall ${wrapperName} without the --ignore-scripts flag." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)

const skipBinaries = process.env["OPENCODE_SKIP_BINARIES"] === "1"

await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: wrapperName,
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
      optionalDependencies: skipBinaries ? {} : binaries,
    },
    null,
    2,
  ),
)

if (!skipBinaries) {
  const tasks = Object.entries(binaryDirs).map(async ([name, dirName]) => {
    try {
      await publish(`./dist/${dirName}`, name, binaries[name])
    } catch (e: any) {
      console.error(`failed to publish ${name}: ${e.stderr || e.message}`)
    }
  })
  await Promise.all(tasks)
} else {
  console.log("skipping binary package publishes (OPENCODE_SKIP_BINARIES=1)")
}
await publish(wrapperDir, wrapperName, version)

const ghRepo = process.env.GH_REPO || (await $`git remote get-url origin`.text()).trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "")