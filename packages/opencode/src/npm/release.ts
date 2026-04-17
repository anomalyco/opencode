import { mkdir, rename, rm } from "fs/promises"
import path from "path"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import { Readable } from "stream"
import type { Spec } from "./spec"

const DEFAULT_API_BASE = "https://api.github.com"

function apiBase(): string {
  return process.env.TEST_GITHUB_API_BASE ?? DEFAULT_API_BASE
}

export async function preResolveReleaseAsset(
  spec: Extract<Spec, { kind: "release" }>,
  opts: { cacheRoot: string; token?: string | undefined },
): Promise<string> {
  const pkgDir = path.join(opts.cacheRoot, "packages", sanitizeSpec(spec))
  const finalPath = path.join(pkgDir, "asset.tgz")
  // Cache hit
  if (await exists(finalPath)) return finalPath

  await mkdir(pkgDir, { recursive: true })

  const token = "token" in opts ? opts.token : await resolveToken()

  const metaUrl = `${apiBase()}/repos/${spec.owner}/${spec.repo}/releases/tags/${spec.tag}`
  const metaRes = await fetch(metaUrl, {
    headers: authHeaders(token, { accept: "application/vnd.github+json" }),
    redirect: "follow",
  })
  if (!metaRes.ok) {
    throw new Error(
      `release asset not found, or missing/insufficient GitHub authentication (${metaRes.status} on ${metaUrl})`,
    )
  }
  const meta = (await metaRes.json()) as { assets: Array<{ id: number; name: string }> }
  const asset = meta.assets.find((a) => a.name === spec.asset)
  if (!asset) {
    throw new Error(
      `authenticated metadata lookup confirmed asset missing: ${spec.asset} not in release ${spec.owner}/${spec.repo}@${spec.tag}`,
    )
  }

  const assetUrl = `${apiBase()}/repos/${spec.owner}/${spec.repo}/releases/assets/${asset.id}`
  const dlRes = await fetch(assetUrl, {
    headers: authHeaders(token, {
      accept: "application/octet-stream",
      "x-github-api-version": "2022-11-28",
    }),
    redirect: "follow",
  })
  if (!dlRes.ok || !dlRes.body) {
    if (dlRes.status === 404 || dlRes.status === 401 || dlRes.status === 403) {
      throw new Error(
        `release asset not found, or missing/insufficient GitHub authentication (${dlRes.status} on ${assetUrl})`,
      )
    }
    throw new Error(`release asset download failed: ${dlRes.status} on ${assetUrl}`)
  }

  // Atomic write: stream to .tmp then rename
  const tmpPath = `${finalPath}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await pipeline(Readable.fromWeb(dlRes.body as never), createWriteStream(tmpPath))
    await rename(tmpPath, finalPath)
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
  return finalPath
}

function authHeaders(token: string | undefined, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...extra }
  if (token) out.authorization = `Bearer ${token}`
  return out
}

async function resolveToken(): Promise<string | undefined> {
  const env = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (env) return env
  return ghToken()
}

async function ghToken(): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], { stderr: "pipe", stdout: "pipe" })
    const code = await proc.exited
    if (code !== 0) return undefined
    const out = (await new Response(proc.stdout).text()).trim()
    return out || undefined
  } catch {
    return undefined
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await Bun.file(p).stat()
    return true
  } catch {
    return false
  }
}

function sanitizeSpec(spec: Extract<Spec, { kind: "release" }>): string {
  return `github-release-${spec.owner}-${spec.repo}-${spec.tag}-${spec.asset}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
}
