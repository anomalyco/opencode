import { expect, test } from "bun:test"
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tempRoots } from "@opencode/plugin-browser/workspace"
import { createHandlePath, previewRoot } from "./disk"
import { resolvePreviewRequest, workspaceFile, type PreviewSource } from "./workspace-file"
import { workspacePages } from "./workspace-pages"

test("external hand-off uses a live grant, its pinned root and the physical HTML file", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "handoff-"))
  await using cleanup = new AsyncDisposableStack()
  cleanup.defer(() => rm(temp, { recursive: true, force: true }))
  const verifier = createHandlePath()
  cleanup.defer(() => verifier.close())
  const root = await realpath(temp)
  const reports = path.join(root, "reports")
  const file = path.join(reports, "report.html")
  await mkdir(reports)
  await writeFile(file, "report")
  await writeFile(path.join(root, "other.html"), "outside grant")
  const host = "11111111-1111-1111-1111-111111111111"

  const pages = workspacePages({ grant: () => ({ host, release() {} }) }, verifier, root,
    { type: "local", roots: () => [root] }, new AbortController().signal)

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
  const verifier = createHandlePath()
  const lookup = (candidate: string, root = repo) => workspaceFile(verifier, pathToFileURL(candidate).href, [root])

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
    const scoped = (path: string) => resolvePreviewRequest(pathToFileURL(path).href.replace("file://", "oc-preview://scoped"), "GET", "oc-preview://scoped", restricted, new AbortController().signal, verifier)
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
    const request = (method: string) => resolvePreviewRequest(url, method, "oc-preview://first", grants, new AbortController().signal, verifier)

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
      ["remote", { document: scope.document, takeEntry: scope.takeEntry, denied: scope.denied, type: "remote", root: "/work", prefix: "workspace://session/", stat: async (path) => {
        remotePaths.push(path)

        return path === "server-only.html" ? 17 : null
      }, read: () => Promise.reject(new Error("unexpected byte read")) }],
    ])

    const resolve = (address: string, method = "GET", initiator?: string) => resolvePreviewRequest(address, method, initiator, sources, new AbortController().signal, verifier)
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
    await verifier.close()
    await rm(temp, { recursive: true, force: true })
  }
})

test("approved temp roots serve subfolder HTML previews with relative assets while blocking cross-root, sibling and traversal reads", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "tmp-preview-"))
  await using cleanup = new AsyncDisposableStack()
  cleanup.defer(() => rm(temp, { recursive: true, force: true }))
  const verifier = createHandlePath()
  cleanup.defer(() => verifier.close())

  const base = await realpath(temp)
  const workspace = path.join(base, "workspace")
  const opencodeTmp = path.join(base, "opencode")
  const opencodeTmpLink = path.join(base, "opencode-link")
  const siblingTmp = path.join(base, "opencode-other")
  const reportDir = path.join(opencodeTmp, "my-report")
  const uploadsDir = path.join(opencodeTmp, "uploads")
  const directoryLink = process.platform === "win32" ? "junction" : "dir"

  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(path.join(reportDir, "assets"), { recursive: true }),
    mkdir(uploadsDir, { recursive: true }),
    mkdir(siblingTmp, { recursive: true }),
  ])
  await symlink(opencodeTmp, opencodeTmpLink, directoryLink)

  const workspaceDoc = path.join(workspace, "index.html")
  const workspaceSecret = path.join(workspace, "secret.txt")
  const reportDoc = path.join(reportDir, "index.html")
  const reportAsset = path.join(reportDir, "assets", "app.js")
  const reportHidden = path.join(reportDir, ".env")
  const soloDoc = path.join(opencodeTmp, "solo.html")
  const uploadFile = path.join(uploadsDir, "private.txt")
  const siblingFile = path.join(siblingTmp, "leak.html")
  await Promise.all([
    writeFile(workspaceDoc, "<h1>workspace</h1>"),
    writeFile(workspaceSecret, "workspace-secret"),
    writeFile(reportDoc, "<h1>report</h1>"),
    writeFile(reportAsset, "console.log('ok')"),
    writeFile(reportHidden, "API_KEY=secret"),
    writeFile(soloDoc, "<h1>solo</h1>"),
    writeFile(uploadFile, "other-session-upload"),
    writeFile(siblingFile, "<h1>sibling</h1>"),
  ])
  await symlink(siblingTmp, path.join(reportDir, "escape"), directoryLink)

  const sharedRoots = await tempRoots(opencodeTmpLink)
  expect(sharedRoots).toEqual([opencodeTmp, opencodeTmpLink])
  const allRoots = [workspace, ...sharedRoots]
  const grants = new Map<string, PreviewSource>()

  const previews = {
    grant(source: PreviewSource) {
      const host = crypto.randomUUID()
      grants.set(host, source)

      return { host, release: () => void grants.delete(host) }
    },
  }

  const signal = new AbortController().signal
  const pages = workspacePages(previews, verifier, workspace, { type: "local", roots: () => allRoots }, signal, sharedRoots)
  cleanup.defer(() => pages.dispose())

  // Opening via canonical temp path AND via symlinked temp path (macOS /var -> /private/var) both work.
  for (const docPath of [reportDoc, path.join(opencodeTmpLink, "my-report", "index.html")]) {
    const fileURL = pathToFileURL(docPath).href
    const previewURL = await pages.load(fileURL, () => {})

    if (!previewURL) throw new Error(`missing preview for ${docPath}`)
    const origin = `oc-preview://${new URL(previewURL).host}`
    expect(pages.display(previewURL)).toBe(fileURL)
    expect(await pages.exists(previewURL, signal)).toBe(true)

    const entry = await resolvePreviewRequest(previewURL, "GET", undefined, grants, signal, verifier)
    expect(entry?.type).toBe("local")

    if (entry?.type === "local") await entry.file.close()

    // workspaceFile and external launch both resolve the physical temp HTML file.
    expect(await workspaceFile(verifier, fileURL, allRoots)).toMatchObject({ path: reportDoc })
    const launched: string[] = []
    expect(await pages.external(previewURL, async (file) => void launched.push(file))).toBe(true)
    expect(launched).toEqual([reportDoc])

    const assetURL = new URL("assets/app.js", previewURL).href
    const asset = await resolvePreviewRequest(assetURL, "GET", origin, grants, signal, verifier)
    expect(asset?.type).toBe("local")

    if (asset?.type === "local") {
      expect(await asset.file.readFile("utf8")).toBe("console.log('ok')")
      await asset.file.close()
    }

    // Blocked: hidden file, sibling dir, parent uploads dir, symlink escape, workspace file, and /etc/passwd.
    for (const denied of [
      new URL(".env", previewURL).href,
      new URL("escape/leak.html", previewURL).href,
      new URL("../uploads/private.txt", previewURL).href,
      `${origin}${pathToFileURL(uploadFile).href.slice("file://".length)}`,
      `${origin}${pathToFileURL(siblingFile).href.slice("file://".length)}`,
      `${origin}${pathToFileURL(workspaceSecret).href.slice("file://".length)}`,
      `${origin}/etc/passwd`,
    ]) {
      expect(await resolvePreviewRequest(denied, "GET", origin, grants, signal, verifier)).toBeUndefined()
    }
  }

  // Standalone HTML directly in the shared temp root loads as an entry document, but cannot read sibling/upload files.
  const soloURL = await pages.load(pathToFileURL(soloDoc).href, () => {})

  if (!soloURL) throw new Error("missing solo preview")
  const soloOrigin = `oc-preview://${new URL(soloURL).host}`
  expect(pages.display(soloURL)).toBe(pathToFileURL(soloDoc).href)
  const soloEntry = await resolvePreviewRequest(soloURL, "GET", undefined, grants, signal, verifier)
  expect(soloEntry?.type).toBe("local")

  if (soloEntry?.type === "local") await soloEntry.file.close()
  expect(await resolvePreviewRequest(new URL("uploads/private.txt", soloURL).href, "GET", soloOrigin, grants, signal, verifier)).toBeUndefined()
  expect(await resolvePreviewRequest(new URL("my-report/index.html", soloURL).href, "GET", soloOrigin, grants, signal, verifier)).toBeUndefined()

  // A workspace grant cannot read temp files either.
  const wsURL = await pages.load(pathToFileURL(workspaceDoc).href, () => {})

  if (!wsURL) throw new Error("missing workspace preview")
  const wsOrigin = `oc-preview://${new URL(wsURL).host}`
  expect(
    await resolvePreviewRequest(
      `${wsOrigin}${pathToFileURL(reportDoc).href.slice("file://".length)}`,
      "GET",
      wsOrigin,
      grants,
      signal,
      verifier,
    ),
  ).toBeUndefined()

  // workspaceFile rejects sibling directories outside temp roots and symlink escapes inside temp roots.
  expect(await workspaceFile(verifier, pathToFileURL(siblingFile).href, allRoots)).toBeUndefined()
  expect(await workspaceFile(verifier, pathToFileURL(path.join(reportDir, "escape", "leak.html")).href, allRoots)).toBeUndefined()

  // A remote server can never load local temp files from disk.
  const remotePages = workspacePages(
    previews,
    verifier,
    "/remote/repo",
    {
      type: "remote",
      root: "/remote/repo",
      prefix: "workspace://ses_remote/",
      stat: async () => 10,
      read: () => Promise.reject(new Error("unexpected read")),
    },
    signal,
    sharedRoots,
  )

  cleanup.defer(() => remotePages.dispose())

  expect(await remotePages.load(pathToFileURL(reportDoc).href, () => {})).toBeUndefined()
  expect(await remotePages.load(pathToFileURL(soloDoc).href, () => {})).toBeUndefined()
})
