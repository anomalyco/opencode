import fs from "fs/promises"
import path from "path"
import os from "os"
import crypto from "crypto"
// FORK: 跟上游 Global/Log 迁到 @opencode-ai/core 走;Process 留 opencode 内部 2026-05-03
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Process } from "@/util/process"
import { detectSofficePath } from "./office-installer"

const log = Log.create({ service: "libreoffice" })

const CACHE_DIR = path.join(Global.Path.cache, "office-pdf-cache")
const CONVERSION_TIMEOUT_MS = 30_000

async function resolveSofficeBinary(): Promise<string | undefined> {
  return detectSofficePath()
}

async function cacheKey(filePath: string): Promise<string | undefined> {
  try {
    const st = await fs.stat(filePath)
    const hash = crypto.createHash("sha256")
    hash.update(filePath)
    hash.update("\0")
    hash.update(String(st.mtimeMs))
    hash.update("\0")
    hash.update(String(st.size))
    return hash.digest("hex")
  } catch {
    return undefined
  }
}

export async function convertToPdf(filePath: string): Promise<Uint8Array | undefined> {
  const sofficePath = await resolveSofficeBinary()
  if (!sofficePath) {
    log.debug("soffice not available, skipping conversion", { filePath })
    return undefined
  }

  const key = await cacheKey(filePath)
  if (!key) return undefined

  const cachedPath = path.join(CACHE_DIR, `${key}.pdf`)

  try {
    const cached = await fs.readFile(cachedPath)
    return cached
  } catch {}

  await fs.mkdir(CACHE_DIR, { recursive: true })

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-soffice-"))

  try {
    const result = await Process.run(
      [
        sofficePath,
        "--headless",
        "--norestore",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to",
        "pdf",
        "--outdir",
        workDir,
        filePath,
      ],
      {
        timeout: CONVERSION_TIMEOUT_MS,
        nothrow: true,
      },
    )

    if (result.code !== 0) {
      log.warn("soffice convert failed", {
        filePath,
        code: result.code,
        stderr: result.stderr.toString().slice(0, 500),
      })
      return undefined
    }

    const base = path.basename(filePath, path.extname(filePath))
    const outputPath = path.join(workDir, `${base}.pdf`)

    const bytes = await fs.readFile(outputPath).catch(() => undefined)
    if (!bytes) {
      log.warn("soffice produced no PDF output", { filePath, outputPath })
      return undefined
    }

    await fs.writeFile(cachedPath, bytes).catch((err) => {
      log.warn("failed to write office-pdf cache entry", { cachedPath, err: String(err) })
    })

    return bytes
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
