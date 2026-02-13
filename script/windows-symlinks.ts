import { $ } from "bun"

if (process.platform !== "win32") {
  process.exit(0)
}

console.log("Configuring git symlinks for Windows...")
await $`git config core.symlinks true`.quiet()

const symlinks = ["packages/app/src/custom-elements.d.ts", "packages/enterprise/src/custom-elements.d.ts"]

for (const file of symlinks) {
  await $`git restore ${file}`.quiet()
}

console.log("Done!")
