import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { Browser } from "@opencode/plugin-browser/rpc"
import { createBrowserFiles } from "./files"

test("files distinguish pending, failed, unknown and missing desktop copies", async () => {
  const files = createBrowserFiles(() => ["https://example.com"])
  await files.ready
  try {
    const pending = files.add("download.txt", "text/plain")
    expect(() => files.get(pending.id)).toThrow("do not start a duplicate download")
    pending.state = "failed"
    expect(() => files.get(pending.id)).toThrow("Inspect browser.console")
    expect(() => files.get(Browser.FileID.make(`file_${crypto.randomUUID()}`))).toThrow(
      "not a server path or request ID",
    )
    const id = await files.save("capture.json", "application/json", new TextEncoder().encode("{}"))
    await rm(files.get(id).path)
    await expect(files.transfer(id)).rejects.toThrow("on the desktop")
    await expect(
      files.save("large.bin", "application/octet-stream", new Uint8Array(Browser.MAX_FILE_BYTES + 1)),
    ).rejects.toThrow("Do not retry an identical capture")
    // The page sees the temp basename as File.name: spaces and non-ASCII stay, only characters no
    // filesystem accepts change, and a bare dot or separator cannot leave the per-file directory.
    expect(path.basename(files.add("Quarter 1 日本語.csv", "text/csv").path)).toBe("Quarter 1 日本語.csv")
    expect(path.basename(files.add("a/b:c?.txt", "text/plain").path)).toBe("a_b_c_.txt")
    expect(path.basename(files.add("..", "text/plain").path)).toBe("file")
    expect(path.dirname(files.add(".", "text/plain").path).startsWith(files.directory)).toBe(true)
  } finally {
    await files.dispose()
  }
})
