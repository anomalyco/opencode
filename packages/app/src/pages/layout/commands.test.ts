import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import type { Locale } from "@/context/language"

let registerLayoutCommands: typeof import("./commands").registerLayoutCommands

const toasts: Array<Record<string, unknown>> = []

const session = (id: string, directory: string) =>
  ({
    id,
    slug: id,
    directory,
    projectID: "p1",
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
  }) as unknown as Session

const project = (vcs: LocalProject["vcs"] = "git") =>
  ({
    id: "p1",
    worktree: "/repo",
    vcs,
    expanded: true,
  }) as LocalProject

function input() {
  let cb = () => [] as Array<{ id: string; onSelect?: () => void; disabled?: boolean }>
  const calls = {
    chosen: 0,
    edited: [] as LocalProject[],
    moved: [] as number[],
    unseen: [] as number[],
    archived: [] as Session[],
    workspaces: [] as LocalProject[],
    toggled: [] as string[],
    dialog: 0,
    sidebar: 0,
    locale: [] as Locale[],
    theme: [] as number[],
    scheme: [] as number[],
    lang: [] as number[],
  }
  const state = {
    params: { dir: "/repo", id: "s1" },
    sessions: [session("s1", "/repo")],
    project: project(),
    workspace: true,
    workspaceOn: true,
    themes: [["ocean", { name: "Ocean" }]] as [string, { name?: string }][],
  }

  const cfg = {
    command: {
      register(key: string, next: () => unknown) {
        expect(key).toBe("layout")
        cb = next as typeof cb
      },
    },
    params: state.params,
    dialog: {
      show: () => {
        calls.dialog += 1
      },
    },
    language: {
      t: (key: string, args?: Record<string, string | number | boolean>) => {
        if (!args) return key
        return `${key}:${Object.values(args).join(",")}`
      },
      locales: ["en", "de"] as const,
      label: (locale: Locale) => `label:${locale}`,
    },
    layout: {
      sidebar: {
        toggle: () => {
          calls.sidebar += 1
        },
        workspaces: () => () => state.workspaceOn,
        toggleWorkspaces: (dir: string) => {
          calls.toggled.push(dir)
        },
      },
    },
    currentProject: () => state.project,
    currentSessions: () => state.sessions,
    workspaceSetting: () => state.workspace,
    availableThemeEntries: () => state.themes,
    colorSchemeOrder: ["system", "light", "dark"] as const,
    colorSchemeLabel: (scheme: "system" | "light" | "dark") => `scheme:${scheme}`,
    chooseProject: () => {
      calls.chosen += 1
    },
    showEditProjectDialog: (item: LocalProject) => {
      calls.edited.push(item)
    },
    navigateSessionByOffset: (offset: number) => {
      calls.moved.push(offset)
    },
    navigateSessionByUnseen: (offset: number) => {
      calls.unseen.push(offset)
    },
    archiveSession: (item: Session) => {
      calls.archived.push(item)
    },
    createWorkspace: (item: LocalProject) => {
      calls.workspaces.push(item)
    },
    cycleTheme: (dir = 1) => {
      calls.theme.push(dir)
    },
    cycleColorScheme: (dir = 1) => {
      calls.scheme.push(dir)
    },
    cycleLanguage: (dir = 1) => {
      calls.lang.push(dir)
    },
    setLocale: (locale: Locale) => {
      calls.locale.push(locale)
    },
    theme: {
      commitPreview: () => undefined,
      previewTheme: () => undefined,
      cancelPreview: () => undefined,
      previewColorScheme: () => undefined,
    },
  }

  return {
    cfg,
    calls,
    state,
    options: () => cb() as Array<{ id: string; onSelect?: () => void; disabled?: boolean }>,
  }
}

beforeAll(async () => {
  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (opts: Record<string, unknown>) => {
      toasts.push(opts)
      return 0
    },
  }))
  mock.module("@/components/dialog-select-provider", () => ({ DialogSelectProvider: () => null }))
  mock.module("@/components/dialog-select-server", () => ({ DialogSelectServer: () => null }))
  mock.module("@/components/dialog-settings", () => ({ DialogSettings: () => null }))
  ;({ registerLayoutCommands } = await import("./commands"))
})

beforeEach(() => {
  toasts.length = 0
})

describe("layout commands", () => {
  test("registers base and generated commands", () => {
    const ctx = input()
    registerLayoutCommands(ctx.cfg)

    const ids = ctx.options().map((item) => item.id)
    expect(ids).toContain("sidebar.toggle")
    expect(ids).toContain("workspace.toggle")
    expect(ids).toContain("project.edit")
    expect(ids).toContain("theme.set.ocean")
    expect(ids).toContain("theme.scheme.dark")
    expect(ids).toContain("language.set.de")
  })

  test("runs workspace toggle from shared helper", () => {
    const ctx = input()
    registerLayoutCommands(ctx.cfg)

    ctx
      .options()
      .find((item) => item.id === "workspace.toggle")
      ?.onSelect?.()

    expect(ctx.calls.toggled).toEqual(["/repo"])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.title).toBe("toast.workspace.disabled.title")
  })

  test("archives the active session and opens dialogs from commands", () => {
    const ctx = input()
    registerLayoutCommands(ctx.cfg)

    ctx
      .options()
      .find((item) => item.id === "session.archive")
      ?.onSelect?.()
    ctx
      .options()
      .find((item) => item.id === "provider.connect")
      ?.onSelect?.()
    ctx
      .options()
      .find((item) => item.id === "project.edit")
      ?.onSelect?.()
    ctx
      .options()
      .find((item) => item.id === "settings.open")
      ?.onSelect?.()

    expect(ctx.calls.archived.map((item) => item.id)).toEqual(["s1"])
    expect(ctx.calls.edited.map((item) => item.id)).toEqual(["p1"])
    expect(ctx.calls.dialog).toBe(2)
  })
})
