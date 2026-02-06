import path from "path"
import { mkdir } from "fs/promises"
import { Log } from "../util/log"
import { Global } from "@/global"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })

  type Index = {
    skills: Array<{
      name: string
      description: string
      files: string[]
    }>
  }

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  async function get(url: string, dest: string): Promise<boolean> {
    if (await Bun.file(dest).exists()) return true
    try {
      const response = await fetch(url)
      if (!response.ok) {
        log.error("failed to download", { url, status: response.status })
        return false
      }
      const content = await response.text()
      await Bun.write(dest, content)
      return true
    } catch (err) {
      log.error("failed to download", { url, err })
      return false
    }
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const indexUrl = new URL("index.json", url.endsWith("/") ? url : `${url}/`).href
    const cacheDir = dir()

    try {
      log.info("fetching index", { url: indexUrl })
      const response = await fetch(indexUrl)
      if (!response.ok) {
        log.error("failed to fetch index", { url: indexUrl, status: response.status })
        return result
      }

      const index = (await response.json()) as Index
      if (!index.skills || !Array.isArray(index.skills)) {
        log.warn("invalid index format", { url: indexUrl })
        return result
      }

      for (const skill of index.skills) {
        if (!skill.name || !skill.files || !Array.isArray(skill.files)) {
          log.warn("invalid skill entry", { url: indexUrl, skill })
          continue
        }

        const skillDir = path.join(cacheDir, skill.name)
        for (const file of skill.files) {
          const fileUrl = new URL(file, `${url.replace(/\/$/, "")}/${skill.name}/`).href
          const localPath = path.join(skillDir, file)
          await mkdir(path.dirname(localPath), { recursive: true })
          await get(fileUrl, localPath)
        }

        const skillMd = path.join(skillDir, "SKILL.md")
        if (await Bun.file(skillMd).exists()) result.push(skillDir)
      }
    } catch (err) {
      log.error("failed to fetch from URL", { url, err })
    }

    return result
  }
}
