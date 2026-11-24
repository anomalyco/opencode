import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHandlePath } from "./handle-path"
import { previewAllowed, previewRoot, openPreviewFile } from "./preview-scope"

test("an existing grant cannot follow a replaced root; a fresh grant may use a recreated workspace", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pin-root-"))
  const workspace = join(temp, "workspace")
  const other = join(temp, "other")
  const verifier = createHandlePath()

  try {
    await Promise.all([mkdir(workspace), mkdir(other)])
    await writeFile(join(other, "index.html"), "outside")
    const pin = (await previewRoot(workspace)).id
    const read = (id: string) => openPreviewFile(verifier, workspace, "index.html", "index.html", true, id)
    await rename(workspace, join(temp, "original"))
    await symlink(other, workspace, process.platform === "win32" ? "junction" : "dir")
    expect(await read(pin)).toBe("denied")
    await rm(workspace)
    await mkdir(workspace)
    await writeFile(join(workspace, "index.html"), "recreated")
    expect(await read(pin)).toBe("denied")
    const opened = await read((await previewRoot(workspace)).id)

    if (!opened || opened === "denied") throw new Error("missing fresh grant control")

    try {
      expect(await opened.file.readFile("utf8")).toBe("recreated")
    } finally {
      await opened.file.close()
    }
  } finally {
    await verifier.close()
    await rm(temp, { recursive: true, force: true })
  }
})

test.each([
  ["/home/u/repo", "/home/u", "/"],
  ["C:\\Users\\U\\repo", "C:\\Users\\U", "\\"],
  ["/home/u/.local/share/opencode/worktree/credentials", "/home/u", "/"],
  ["C:\\Users\\U\\.config\\secrets.json\\", "C:\\Users\\U", "\\"],
])("document scope on %s", (root, home, sep) => {
  const allowed = (doc: string, path: string, entry = false) =>
    previewAllowed(root, doc.replaceAll("/", sep), path.replaceAll("/", sep), entry, home)

  for (const doc of ["index.html", "dist/index.htm"]) {
    const dir = doc.slice(0, doc.lastIndexOf("/") + 1)
    expect(allowed(doc, dir + "assets/main.js")).toBe(true)

    for (const file of [
      ".env",
      ".git/config",
      "assets/.hidden/ok.js",
      "keys/id_ed25519",
      "private.pem",
      "A.P12",
      "secrets.json",
      "credentials",
    ])
      expect(allowed(doc, dir + file)).toBe(false)
  }

  expect(allowed("dist/index.html", "assets/main.js")).toBe(false)
  expect(allowed("dist/index.html", "data.json")).toBe(false)
  expect(allowed(".well-known/index.html", ".well-known/index.html", true)).toBe(true)
  expect(allowed(".well-known/index.html", ".well-known/index.html")).toBe(false)
  expect(allowed(".well-known/index.html", ".well-known/x.html", true)).toBe(false)
  expect(allowed(".env", ".env", true)).toBe(false)
  expect(previewAllowed(home, "index.html", "other.txt", false, home)).toBe(false)
  expect(previewAllowed(home, "site/index.html", "site/assets/x", false, home)).toBe(true)
})
