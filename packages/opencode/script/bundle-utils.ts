import path from "path"
import { $ } from "bun"
import { promises as fsp } from "fs"

const SRI_PREFIX = "sha512-"

type MetaEntry = {
  version?: string
  sha512?: string
  sha?: string
}

export type BundleMeta = Record<string, MetaEntry>

export async function loadBundleMeta(hashesPath: string) {
  const input = await Bun.file(hashesPath).text()
  const parsed = JSON.parse(input ?? "{}")
  const optional = parsed.optional ?? {}
  return optional as BundleMeta
}

export async function bundleReady(modulesDir: string, name: string) {
  const marker = Bun.file(path.join(modulesDir, name, "package.json"))
  return marker.exists()
}

const parseVersion = (spec?: string) => {
  if (!spec) return
  const idx = spec.lastIndexOf("@")
  if (idx === -1) return
  return spec.slice(idx + 1)
}

type EnsureArgs = {
  name: string
  modulesDir: string
  metadata: BundleMeta
  spec?: string
}

export async function ensureBundle({ name, modulesDir, metadata, spec }: EnsureArgs) {
  if (await bundleReady(modulesDir, name)) {
    return
  }
  const info = metadata[name] ?? {}
  const expectedVersion = info.version
  const expectedSha = info.sha512 ?? info.sha
  let resolved = spec
  if (!resolved && expectedVersion) {
    resolved = `${name}@${expectedVersion}`
  }
  if (!resolved) {
    throw new Error(`Missing spec for ${name}; update nix/hashes.json`)
  }
  const specVersion = parseVersion(resolved)
  if (expectedVersion && specVersion && specVersion !== expectedVersion) {
    throw new Error(
      `Version mismatch for ${name}: resolved ${specVersion}, expected ${expectedVersion}`,
    )
  }
  if (!expectedSha) {
    throw new Error(`Missing hash for ${name}; run nix/scripts/update-hashes.sh`)
  }
  const stdout = await $`npm pack ${resolved}`.cwd(modulesDir).text()
  const tarball = stdout.trim().split("\n").pop()?.trim()
  if (!tarball) {
    throw new Error(`npm pack produced no output for ${resolved}`)
  }
  const tarPath = path.join(modulesDir, tarball)
  const file = Bun.file(tarPath)
  if (!(await file.exists())) {
    throw new Error(`Tarball ${tarPath} missing after npm pack`)
  }
  const hasher = new Bun.CryptoHasher("sha512")
  hasher.update(new Uint8Array(await file.arrayBuffer()))
  const digest = SRI_PREFIX + hasher.digest("base64")
  if (digest !== expectedSha) {
    throw new Error(
      `Hash mismatch for ${resolved}: expected ${expectedSha}, got ${digest}. Re-run hash refresh if intentional.`,
    )
  }
  const target = path.join(modulesDir, name)
  await $`mkdir -p ${target}`
  await $`tar -xf ${tarball} -C ${target} --strip-components=1`.cwd(modulesDir)
  await fsp.rm(tarPath, { force: true })
}
