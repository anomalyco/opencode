import path from "path"
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"

export async function extractZip(zipPath: string, destDir: string) {
  const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(zipPath).arrayBuffer()])))
  const entries = await zipFileReader.getEntries()
  for (const entry of entries) {
    const filePath = path.join(destDir, entry.filename)
    if (entry.directory) {
      await Bun.write(filePath, "")
      continue
    }
    await Bun.mkdir(path.dirname(filePath), { recursive: true })
    const blob = await entry.getData(new BlobWriter())
    await Bun.write(filePath, blob)
  }
  await zipFileReader.close()
}

export * as Archive from "./archive"
