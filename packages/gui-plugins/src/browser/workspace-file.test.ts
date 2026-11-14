import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { resolvePreviewRequest, workspaceFile } from "./workspace-file"

test("preview and reveal resolve existing regular files under the real workspace, including a linked root", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "preview-"))
  const repo = path.join(temp, "repo")
  const sibling = path.join(temp, "repo-other")
  const alias = path.join(temp, "alias")
  const name = process.platform === "win32" ? "50% #[日本語].txt" : "50% #?[日本語].txt"
  const file = path.join(repo, name)
  const lookup = (candidate: string, root = repo) => workspaceFile(pathToFileURL(candidate).href, [root])

  try {
    await Promise.all([mkdir(repo), mkdir(sibling)])
    await Promise.all([writeFile(file, "inside"), writeFile(path.join(sibling, name), "sibling")])
    const directoryLink = process.platform === "win32" ? "junction" : "dir"
    await symlink(repo, alias, directoryLink)
    await symlink(sibling, path.join(repo, "linked"), directoryLink)
    expect(await lookup(path.join(alias, name), alias)).toMatchObject({ path: await realpath(file), size: 6 })
    expect(await lookup(path.join(repo, "linked", name))).toBeUndefined()
    expect(await lookup(path.join(sibling, name))).toBeUndefined()
    expect(await lookup(repo)).toBeUndefined()
    expect(await lookup(path.join(repo, "missing"))).toBeUndefined()
    expect(await lookup(path.join(temp, "deleted", name), path.join(temp, "deleted"))).toBeUndefined()
    await link(file, path.join(repo, "hardlink"))
    expect(await lookup(path.join(repo, "hardlink"))).toMatchObject({ size: 6 })

    const grants = new Map([["first", () => [repo]]])
    const url = pathToFileURL(file).href.replace("file://", "oc-preview://first")
    const request = (method: string) => resolvePreviewRequest(url, method, "oc-preview://first", grants)

    for (const method of ["GET", "HEAD"]) expect(await request(method)).toMatchObject({ size: 6 })

    for (const method of ["POST", "PUT", "DELETE"]) expect(await request(method)).toBeUndefined()
    const pending = request("GET")
    grants.delete("first")
    expect(await pending).toBeUndefined()
    expect(await request("HEAD")).toBeUndefined()

    // Junctions above exercise real directory links on Windows without SeCreateSymbolicLinkPrivilege.
    if (process.platform !== "win32") {
      await symlink(path.join(sibling, name), path.join(repo, "external"))
      await symlink(path.join(repo, "missing"), path.join(repo, "broken"))
      expect(await lookup(path.join(repo, "external"))).toBeUndefined()
      expect(await lookup(path.join(repo, "broken"))).toBeUndefined()
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
