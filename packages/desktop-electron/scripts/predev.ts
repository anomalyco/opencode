import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

async function main() {
  await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

  const target = Bun.env.RUST_TARGET
  const sidecar = getCurrentSidecar(target)
  const name = sidecar.ocBinary

  const run = async (baseline: boolean) => {
    const cmd = baseline
      ? $`cd ../opencode && bun run build --single --baseline`
      : $`cd ../opencode && bun run build --single`
    return await cmd.nothrow()
  }

  if (!name.includes("-baseline")) {
    const res = await run(false)
    if (res.exitCode !== 0) throw new Error(res.stderr.toString() || res.stdout.toString())
    await copyBinaryToSidecarFolder(windowsify(`../opencode/dist/${name}/bin/opencode`), target)
    return
  }

  const res = await run(true)
  if (res.exitCode === 0) {
    await copyBinaryToSidecarFolder(windowsify(`../opencode/dist/${name}/bin/opencode`), target)
    return
  }

  console.log(res.stderr.toString() || res.stdout.toString())
  console.log("Baseline build failed; falling back to native build for dev")

  const alt = name.replace("-baseline", "")
  const res2 = await run(false)
  if (res2.exitCode !== 0) throw new Error(res2.stderr.toString() || res2.stdout.toString())

  await copyBinaryToSidecarFolder(windowsify(`../opencode/dist/${alt}/bin/opencode`), target)
}

await main()
