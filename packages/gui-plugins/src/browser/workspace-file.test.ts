import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { previewRoot } from "@opencode/util/preview-scope"
import { resolvePreviewRequest, workspaceFile, type PreviewSource } from "./workspace-file"
import { workspacePages } from "./workspace-pages"

test("external hand-off uses a live grant, its pinned root and the physical HTML file", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "handoff-"))
  await using cleanup = new AsyncDisposableStack()
  cleanup.defer(() => rm(temp, { recursive: true, force: true }))
  const root = await realpath(temp)
  const reports = path.join(root, "reports")
  const file = path.join(reports, "report.html")
  await mkdir(reports)
  await writeFile(file, "report")
  await writeFile(path.join(root, "other.html"), "outside grant")
  const host = "11111111-1111-1111-1111-111111111111"

  const pages = workspacePages({ grant: () => ({ host, release() {} }) }, root,
    { type: "local", roots: () => [root] }, new AbortController().signal, () => undefined)

  const url = await pages.load(pathToFileURL(file).href, () => {})

  if (!url) throw new Error("missing preview")
  const launches: string[] = []
  const open = (url: string) => pages.external(url, async (target) => { launches.push(target) })
  expect(await open(url)).toBe(true)

  await writeFile(path.join(reports, "notes.txt"), "not HTML")

  const linked = await symlink(path.join(reports, "notes.txt"), path.join(reports, "alias.html")).then(() => true, (error: NodeJS.ErrnoException) => {
    // Some Windows workers lack permission to create file symlinks.
    if (process.platform === "win32" && error.code === "EPERM") return false
    throw error
  })

  if (linked) expect(await open(new URL("alias.html", url).href)).toBe(false)

  for (const address of [url.replace(host, "other"), pathToFileURL(file).href, new URL("../other.html", url).href, new URL("file.exe", url).href])
    expect(await open(address)).toBe(false)

  pages.dispose()
  expect(await open(url)).toBe(false)
  expect(launches).toEqual([file])
})

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
    const doc = path.join(repo, "reports", "index.html")
    await mkdir(path.dirname(doc))
    await writeFile(doc, "report")
    await symlink(repo, path.join(repo, "reports", "alias"), directoryLink)
    const identity = (await previewRoot(repo)).id
    const restricted = new Map<string, PreviewSource>([["scoped", {type:"local", identity, roots:()=>[repo], document:"reports/index.html", takeEntry:()=>false, denied:()=>{}}]])
    const scoped = (path: string) => resolvePreviewRequest(pathToFileURL(path).href.replace("file://", "oc-preview://scoped"), "GET", "oc-preview://scoped", restricted, new AbortController().signal)
    const control = await scoped(doc)
    expect(control?.type).toBe("local")

    if (control?.type === "local") await control.file.close()
    expect(await scoped(file)).toBeUndefined()
    expect(await scoped(path.join(repo, "reports", "alias", name))).toBeUndefined()
    expect(await lookup(path.join(sibling, name))).toBeUndefined()
    expect(await lookup(repo)).toBeUndefined()
    expect(await lookup(path.join(repo, "missing"))).toBeUndefined()
    expect(await lookup(path.join(temp, "deleted", name), path.join(temp, "deleted"))).toBeUndefined()
    await link(file, path.join(repo, "hardlink"))
    expect(await lookup(path.join(repo, "hardlink"))).toMatchObject({ size: 6 })

    const scope = { identity, document:"index.html", takeEntry:()=>false, denied:()=>{} }
    const grants = new Map([["first", { ...scope,type: "local" as const, roots: () => [repo] }]])
    const url = pathToFileURL(file).href.replace("file://", "oc-preview://first")
    const request = (method: string) => resolvePreviewRequest(url, method, "oc-preview://first", grants, new AbortController().signal)

    for (const method of ["GET", "HEAD"]) {
      const opened = await request(method)

      if (opened?.type !== "local") throw new Error("missing local control")
      expect((await opened.file.stat()).size).toBe(opened.size)
      expect(opened.size).toBe(6)
      await opened.file.close()
    }

    for (const method of ["POST", "PUT", "DELETE"]) expect(await request(method)).toBeUndefined()
    const pending = request("GET")
    grants.delete("first")
    expect(await pending).toBeUndefined()
    expect(await request("HEAD")).toBeUndefined()

    const remotePaths: string[] = []

    const sources = new Map<string, PreviewSource>([
      ["local", { ...scope,type: "local", roots: () => [repo] }],
      ["remote", { ...scope,type: "remote",root:"/work", prefix: "workspace://session/", pin:async()=>identity, stat: async (path) => {
        remotePaths.push(path)

        return path === "server-only.html" ? 17 : null
      }, read: () => Promise.reject(new Error("unexpected byte read")) }],
    ])

    const resolve = (address: string, method = "GET", initiator?: string) => resolvePreviewRequest(address, method, initiator, sources, new AbortController().signal)
    expect(await resolve("oc-preview://remote/server-only.html")).toMatchObject({ type: "remote", size: 17 })
    expect(await resolve("oc-preview://local/server-only.html")).toBeUndefined()
    const disk = pathToFileURL(file).href.replace("file://", "oc-preview://local")
    const local = await resolve(disk)
    expect(local).toMatchObject({ type: "local", size: 6 })

    if (local?.type === "local") await local.file.close()
    expect(await resolve(disk.replace("//local", "//remote"))).toBeUndefined()
    remotePaths.length = 0

    for (const path of ["%2e%2e/x", "a%2fb", "a%5cb", "/x", "a/../x", "c:/x"])
      expect(await resolve(`oc-preview://remote/${path}`)).toBeUndefined()
    expect(await resolve("oc-preview://remote/server-only.html", "GET", "oc-preview://local")).toBeUndefined()
    expect(await resolve("oc-preview://remote/server-only.html", "POST")).toBeUndefined()
    expect(remotePaths).toEqual([])
    const resolving = resolve("oc-preview://remote/server-only.html", "HEAD", "oc-preview://remote")
    sources.delete("remote")
    expect(await resolving).toBeUndefined()

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
