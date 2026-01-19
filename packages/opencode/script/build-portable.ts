#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const bunVersion = process.env.BUN_VERSION ?? Bun.version

const builds = [
  {
    artifact: "opencode-linux-x64-musl",
    platform: "linux/amd64",
    rust: "x86_64-unknown-linux-musl",
    ld: "ld-musl-x86_64.so.1",
    libc: "libc.musl-x86_64.so.1",
    cpu: "x64",
  },
  {
    artifact: "opencode-linux-x64-baseline-musl",
    platform: "linux/amd64",
    rust: "x86_64-unknown-linux-musl",
    ld: "ld-musl-x86_64.so.1",
    libc: "libc.musl-x86_64.so.1",
    cpu: "x64",
  },
  {
    artifact: "opencode-linux-arm64-musl",
    platform: "linux/arm64",
    rust: "aarch64-unknown-linux-musl",
    ld: "ld-musl-aarch64.so.1",
    libc: "libc.musl-aarch64.so.1",
    cpu: "arm64",
  },
]

// Register qemu binfmt for cross-platform builds
await $`docker run --rm --privileged multiarch/qemu-user-static --reset -p yes`.quiet(true)

for (const item of builds) {
  if (!Bun.file(`dist/${item.artifact}/bin/opencode`).exists()) {
    console.error(`Artifact dist/${item.artifact}/bin/opencode does not exist. Please build it first.`)
    process.exit(1)
  }

  // If the binary is already statically linked, skip it
  const fileResult = await $`file dist/${item.artifact}/bin/opencode`.quiet(true)
  const fileOutput = fileResult.stdout.toString()

  if (fileOutput.includes("static-pie linked") || fileOutput.includes("statically linked")) {
    console.log(`Skipping ${item.artifact}, already statically linked`)
    continue
  }

  console.log(`Making ${item.artifact} portable`)
  await $`docker build \
    --platform=${item.platform} \
    --build-context dist=dist \
    --output=type=local,dest=dist/${item.artifact}/bin \
    --target output-step \
    --build-arg BUN_VERSION=${bunVersion} \
    --build-arg RUST_TARGET=${item.rust} \
    --build-arg OPENCODE_ARTIFACT=${item.artifact} \
    --build-arg LD_NAME=${item.ld} \
    --build-arg LIBC_NAME=${item.libc} \
    --build-arg CPU=${item.cpu} \
    portable`
    .quiet(true)
    .catch((e) => {
      console.error(`Failed to make ${item.artifact} portable:`, e.stderr.toString())
      process.exit(e.exitCode)
    })
}
