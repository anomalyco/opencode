import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"

/**
 * Creates a minimal package on disk and returns its path.
 * The returned path is NOT a .tgz — it's a directory. Use makeTarball() to pack it.
 */
export async function makePackageDir(opts: {
  name: string
  version: string
  main?: string
  mainContents?: string
}): Promise<string> {
  const root = path.join(tmpdir(), `mock-pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(root, { recursive: true })
  const main = opts.main ?? "index.js"
  const pkgJson = {
    name: opts.name,
    version: opts.version,
    main,
  }
  await writeFile(path.join(root, "package.json"), JSON.stringify(pkgJson, null, 2))
  await writeFile(path.join(root, main), opts.mainContents ?? 'module.exports = { marker: "mock-pkg" }\n')
  return root
}

/**
 * Pack a directory into a .tgz using `tar`. Returns the path to the created tarball.
 * Uses npm-style layout: contents appear under `package/` inside the tarball.
 */
export async function makeTarball(dir: string): Promise<string> {
  const out = `${dir}.tgz`
  const proc = Bun.spawn(
    ["tar", "-czf", out, "-C", path.dirname(dir), "--transform=s,^[^/]*,package,", path.basename(dir)],
    { stdout: "pipe", stderr: "pipe" },
  )
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`tar failed: ${err}`)
  }
  return out
}
