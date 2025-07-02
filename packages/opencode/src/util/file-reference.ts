import path from "path"
import { App } from "../app/app"
import { Log } from "./log"

export namespace FileReference {
  const log = Log.create({ service: "file-reference" })

  export interface Reference {
    original: string
    path: string
    resolved: string
    exists: boolean
  }

  export async function parse(text: string, rootPath?: string): Promise<Reference[]> {
    const references: Reference[] = []
    const regex = /@([^\s@]+(?:\.[^\s@]*)?)/g
    let match

    while ((match = regex.exec(text)) !== null) {
      const original = match[0]
      const filePath = match[1]
      
      let root: string
      try {
        root = rootPath ?? App.info().path.root
      } catch {
        root = process.cwd()
      }
      
      const resolved = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(root, filePath)

      let exists = false
      try {
        const file = Bun.file(resolved)
        exists = await file.exists()
      } catch {
        exists = false
      }

      references.push({
        original,
        path: filePath,
        resolved,
        exists
      })
    }

    return references
  }

  export async function resolve(text: string, rootPath?: string): Promise<{
    processedText: string
    references: Reference[]
  }> {
    const references = await parse(text, rootPath)
    let processedText = text

    for (const ref of references) {
      if (ref.exists) {
        try {
          const file = Bun.file(ref.resolved)
          const content = await file.text()
          const replacement = `${ref.original}\n\`\`\`\n${content}\n\`\`\``
          processedText = processedText.replace(ref.original, replacement)
          log.info("resolved file reference", { path: ref.path, size: content.length })
        } catch (error) {
          log.warn("failed to read referenced file", { path: ref.path, error })
          const replacement = `${ref.original} (file not readable)`
          processedText = processedText.replace(ref.original, replacement)
        }
      } else {
        log.warn("referenced file does not exist", { path: ref.path })
        const replacement = `${ref.original} (file not found)`
        processedText = processedText.replace(ref.original, replacement)
      }
    }

    return {
      processedText,
      references
    }
  }
}