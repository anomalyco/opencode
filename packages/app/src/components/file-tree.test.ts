import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { JSX } from "solid-js"
import type { FileNode } from "@opencode-ai/sdk/v2"

let FileTree: typeof import("./file-tree").default
let shouldListRoot: typeof import("./file-tree").shouldListRoot
let shouldListExpanded: typeof import("./file-tree").shouldListExpanded
let dirsToExpand: typeof import("./file-tree").dirsToExpand
let parentDirectoryPath: typeof import("./file-tree").parentDirectoryPath
let fileTreeOpenLocationPath: typeof import("./file-tree").fileTreeOpenLocationPath
let openFileTreeLocation: typeof import("./file-tree").openFileTreeLocation

const openPath = mock((_path: string) => Promise.resolve())
const contextMenuItems: { onSelect?: () => void }[] = []
const contextMenuLabels: string[] = []
let contextMenuRoots = 0
let contextMenuTriggers = 0
let fileTreeNodes: FileNode[] = []
let platformOpenPath: ((path: string) => Promise<void>) | undefined = openPath
let platformName = "desktop"
let localServer = true

type ElementType = string | ((props: Record<string, unknown>) => unknown)

const createElement = (type: ElementType, props: Record<string, unknown> | null, ...children: unknown[]) => {
  const propsWithChildren: Record<string, unknown> = { ...(props ?? {}) }
  if (children.length === 1) propsWithChildren.children = children[0]
  if (children.length > 1) propsWithChildren.children = children
  if (typeof type === "function") return type(propsWithChildren)
  return propsWithChildren.children
}

const clearContextMenuCaptures = () => {
  contextMenuItems.length = 0
  contextMenuLabels.length = 0
  contextMenuRoots = 0
  contextMenuTriggers = 0
}

const resetEnvironment = () => {
  openPath.mockClear()
  clearContextMenuCaptures()
  fileTreeNodes = []
  platformOpenPath = openPath
  platformName = "desktop"
  localServer = true
  document.body.innerHTML = ""
}

const fileNode = (absolute?: string) =>
  ({
    name: "index.ts",
    path: "src/index.ts",
    absolute,
    type: "file",
    ignored: false,
  }) as FileNode

const folderNode = (absolute?: string) =>
  ({
    name: "components",
    path: "src/components",
    absolute,
    type: "directory",
    ignored: false,
  }) as FileNode

const renderTree = (nodes: FileNode[]) => {
  fileTreeNodes = nodes
  FileTree({ path: "root", draggable: false })
  return () => undefined
}

const expectNoContextMenuAction = (node: FileNode, configure?: () => void) => {
  resetEnvironment()
  configure?.()
  const dispose = renderTree([node])

  expect(contextMenuRoots).toBe(0)
  expect(contextMenuTriggers).toBe(0)
  expect(contextMenuItems).toHaveLength(0)
  expect(contextMenuLabels).toEqual([])
  expect(openPath).not.toHaveBeenCalled()

  dispose()
}

beforeAll(async () => {
  Reflect.set(globalThis, "React", { createElement })
  mock.module("solid-js/web", () => ({
    Dynamic: (props: { component?: ElementType; children?: JSX.Element }) => {
      if (typeof props.component === "function") return props.component(props)
      return props.children
    },
  }))
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@/context/file", () => ({
    useFile: () => ({
      normalize: (path: string) => path,
      tree: {
        state: () => ({ loaded: true, expanded: false }),
        list: () => Promise.resolve(),
        children: (path: string) => (path === "root" ? fileTreeNodes : []),
        expand: () => {},
        collapse: () => {},
      },
    }),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      platform: platformName,
      openPath: platformOpenPath,
    }),
  }))
  mock.module("@/context/server", () => ({
    useServer: () => ({
      isLocal: () => localServer,
    }),
  }))
  mock.module("@opencode-ai/ui/collapsible", () => ({
    Collapsible: Object.assign((props: { children?: unknown }) => props.children, {
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    }),
  }))
  mock.module("@opencode-ai/ui/context-menu", () => {
    const passthrough = (props: { children?: JSX.Element }) => props.children
    return {
      ContextMenu: Object.assign(
        (props: { children?: JSX.Element }) => {
          contextMenuRoots++
          return props.children
        },
        {
          Trigger: (props: { children?: JSX.Element }) => {
            contextMenuTriggers++
            return props.children
          },
          Portal: passthrough,
          Content: passthrough,
          Item: (props: { children?: JSX.Element; onSelect?: () => void }) => {
            contextMenuItems.push({ onSelect: props.onSelect })
            return props.children
          },
          ItemLabel: (props: { children?: JSX.Element }) => {
            contextMenuLabels.push(String(props.children))
            return props.children
          },
        },
      ),
    }
  })
  mock.module("@opencode-ai/ui/file-icon", () => ({ FileIcon: () => null }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/toast", () => ({ showToast: () => undefined }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  const mod = await import("./file-tree")
  FileTree = mod.default
  shouldListRoot = mod.shouldListRoot
  shouldListExpanded = mod.shouldListExpanded
  dirsToExpand = mod.dirsToExpand
  parentDirectoryPath = mod.parentDirectoryPath
  fileTreeOpenLocationPath = mod.fileTreeOpenLocationPath
  openFileTreeLocation = mod.openFileTreeLocation
})

beforeEach(() => {
  resetEnvironment()
})

describe("file tree fetch discipline", () => {
  test("root lists on mount unless already loaded or loading", () => {
    expect(shouldListRoot({ level: 0 })).toBe(true)
    expect(shouldListRoot({ level: 0, dir: { loaded: true } })).toBe(false)
    expect(shouldListRoot({ level: 0, dir: { loading: true } })).toBe(false)
    expect(shouldListRoot({ level: 1 })).toBe(false)
  })

  test("nested dirs list only when expanded and stale", () => {
    expect(shouldListExpanded({ level: 1 })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: false } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true } })).toBe(true)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loaded: true } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loading: true } })).toBe(false)
    expect(shouldListExpanded({ level: 0, dir: { expanded: true } })).toBe(false)
  })

  test("allowed auto-expand picks only collapsed dirs", () => {
    const expanded = new Set<string>()
    const filter = { dirs: new Set(["src", "src/components"]) }

    const first = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(first).toEqual(["src", "src/components"])

    for (const dir of first) expanded.add(dir)

    const second = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(second).toEqual([])
    expect(dirsToExpand({ level: 1, filter, expanded: () => false })).toEqual([])
  })
})

describe("file tree open location path", () => {
  test("resolves a file path to its parent directory", () => {
    expect(parentDirectoryPath("E:\\works\\opencode\\src\\index.ts")).toBe("E:\\works\\opencode\\src")
  })

  test("resolves a folder path to its parent directory", () => {
    expect(parentDirectoryPath("E:\\works\\opencode\\src\\components")).toBe("E:\\works\\opencode\\src")
  })

  test("does not resolve missing, empty, or root-only paths", () => {
    expect(parentDirectoryPath()).toBeUndefined()
    expect(parentDirectoryPath("")).toBeUndefined()
    expect(parentDirectoryPath("/")).toBeUndefined()
    expect(parentDirectoryPath("E:\\")).toBeUndefined()
    expect(fileTreeOpenLocationPath({} as Pick<FileNode, "absolute">)).toBeUndefined()
  })
})

describe("file tree open location action", () => {
  test("opens the resolved parent directory for file and folder rows", () => {
    openFileTreeLocation({
      path: fileTreeOpenLocationPath({ absolute: "E:\\works\\opencode\\src\\index.ts" }),
      openPath,
      onError: () => undefined,
    })

    expect(openPath).toHaveBeenLastCalledWith("E:\\works\\opencode\\src")

    openPath.mockClear()
    openFileTreeLocation({
      path: fileTreeOpenLocationPath({ absolute: "E:\\works\\opencode\\src\\components" }),
      openPath,
      onError: () => undefined,
    })

    expect(openPath).toHaveBeenLastCalledWith("E:\\works\\opencode\\src")
  })

  test("skips openPath when the node has no parent target", () => {
    openFileTreeLocation({
      path: fileTreeOpenLocationPath({} as Pick<FileNode, "absolute">),
      openPath,
      onError: () => undefined,
    })

    expect(openPath).not.toHaveBeenCalled()
  })
})

describe("file tree row context menu", () => {
  test("renders an i18n open-folder action for file rows and opens the parent directory", () => {
    const dispose = renderTree([fileNode("E:\\works\\opencode\\src\\index.ts")])

    expect(contextMenuRoots).toBeGreaterThan(0)
    expect(contextMenuTriggers).toBeGreaterThan(0)
    expect(contextMenuLabels).toContain("session.files.openFolder")

    contextMenuItems[0]?.onSelect?.()

    expect(openPath).toHaveBeenLastCalledWith("E:\\works\\opencode\\src")

    dispose()
  })

  test("renders an i18n open-folder action for folder rows and opens the parent directory", () => {
    const dispose = renderTree([folderNode("E:\\works\\opencode\\src\\components")])

    expect(contextMenuRoots).toBeGreaterThan(0)
    expect(contextMenuTriggers).toBeGreaterThan(0)
    expect(contextMenuLabels).toContain("session.files.openFolder")

    contextMenuItems[0]?.onSelect?.()

    expect(openPath).toHaveBeenLastCalledWith("E:\\works\\opencode\\src")
    expect(openPath).not.toHaveBeenCalledWith("E:\\works\\opencode\\src\\components")

    dispose()
  })

  test("hides the custom action when the row path or opener gate is unavailable", () => {
    expectNoContextMenuAction(fileNode())
    expectNoContextMenuAction(fileNode(""))
    expectNoContextMenuAction(folderNode("E:\\"))
    expectNoContextMenuAction(fileNode("E:\\works\\opencode\\src\\index.ts"), () => {
      platformOpenPath = undefined
    })
    expectNoContextMenuAction(folderNode("E:\\works\\opencode\\src\\components"), () => {
      localServer = false
    })
    expectNoContextMenuAction(fileNode("E:\\works\\opencode\\src\\index.ts"), () => {
      platformName = "web"
    })
  })
})
