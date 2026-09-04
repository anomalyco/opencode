import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDraftAttachmentMaterializer } from "./draft-attachments"

test("materializes a draft blob as an application-owned temporary text file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-draft-attachment-"))
  const bytes = new TextEncoder().encode("first\n第二行\n")
  const materializer = createDraftAttachmentMaterializer({
    directory,
    getBlob: (id) => (id === "blob-1" ? bytes : null),
  })

  try {
    const attachment = await materializer.materialize("blob-1")
    expect(attachment.path.startsWith(directory)).toBe(true)
    expect(new TextDecoder().decode(await readFile(attachment.path))).toBe("first\n第二行\n")
    await materializer.cleanup(attachment.id)
    expect(await readFile(attachment.path).then(() => true, () => false)).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
