import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// The app consumes a frozen V2 client, not the workspace's current client.
// Port anomalyco/opencode#47442 without replacing that client's API contract.
const archive = path.resolve(import.meta.dir, "../vendor/opencode-ai-client-1.17.13-v2.tgz")
const output = archive.replace("-v2.tgz", "-prefix.tgz")
const directory = await mkdtemp(path.join(tmpdir(), "opencode-client-prefix-"))
try {
  await $`tar -xzf ${archive} -C ${directory}`
  const file = Bun.file(path.join(directory, "package/dist/promise/generated/client.js"))
  const source = await file.text()
  const previous = 'const url = new URL(options.baseUrl.replace(/[/]+$/, "") + descriptor.path);'
  const patched = `const base = new URL(options.baseUrl);
        base.pathname = base.pathname.replace(/[/]+$/, "") + "/";
        const url = new URL(descriptor.path.replace(/^[/]+/, ""), base);`
  if (!source.includes(patched)) {
    if (!source.includes(previous)) throw new Error("Vendored client changed: review the prefix patch before repacking")
    await Bun.write(file, source.replace(previous, patched))
    await $`tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${output} -C ${directory} package`
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
