import { createEffect, createMemo, createSignal, Show, type JSX } from "solid-js"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { showToast } from "@/utils/toast"
import { detectOpenAppOS, type OpenAppOS } from "@/components/session/open-in-app"

const VSCODE_OPEN_WITH: Record<OpenAppOS, string> = {
  macos: "Visual Studio Code",
  windows: "code",
  linux: "code",
  unknown: "code",
}

const REVEAL_LABEL: Record<OpenAppOS, string> = {
  macos: "session.header.reveal.finder",
  windows: "session.header.reveal.fileExplorer",
  linux: "session.header.reveal.containingFolder",
  unknown: "session.header.reveal.containingFolder",
}

export function resolveAbsoluteFilePath(path: string, directory: string) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path
  const base = directory.replace(/[\\/]+$/, "")
  if (!base) return path
  return `${base}/${path}`
}

// Right-click menu for file rows: open in VS Code, copy path, and reveal in
// the OS file manager. Native actions need the desktop app and a local
// server; copy works everywhere.
export function FileContextMenu(props: { path: string; children: JSX.Element }) {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()

  const os = createMemo(() => detectOpenAppOS(platform))
  // Diff and snapshot paths are git-worktree relative, which can differ from
  // the session directory when the server runs in a project subdirectory.
  const root = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const absolute = createMemo(() => resolveAbsoluteFilePath(props.path, root()))
  const local = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())

  const [vscode, setVscode] = createSignal<boolean>()
  createEffect(() => {
    if (!local() || !platform.checkAppExists) return
    const app = VSCODE_OPEN_WITH[os()]
    Promise.resolve(platform.checkAppExists(app))
      .then((ok) => setVscode(Boolean(ok)))
      .catch(() => setVscode(false))
  })

  const fail = (err: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const openInVSCode = () => {
    if (!platform.openPath) return
    platform.openPath(absolute(), VSCODE_OPEN_WITH[os()]).catch(fail)
  }

  const reveal = () => {
    if (!platform.revealPath) return
    platform
      .revealPath(absolute())
      .then((ok) => {
        if (!ok) fail(new Error(absolute()))
      })
      .catch(fail)
  }

  const copy = () => {
    navigator.clipboard
      .writeText(absolute())
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: absolute(),
        }),
      )
      .catch(fail)
  }

  return (
    <ContextMenu>
      <ContextMenu.Trigger style={{ display: "contents" }}>{props.children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <Show when={local() && vscode()}>
            <ContextMenu.Item onSelect={openInVSCode}>
              <ContextMenu.ItemLabel>
                {language.t("session.file.openInApp", { app: language.t("session.header.open.app.vscode") })}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
          <ContextMenu.Item onSelect={copy}>
            <ContextMenu.ItemLabel>{language.t("session.header.open.copyPath")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <Show when={local() && platform.revealPath}>
            <ContextMenu.Item onSelect={reveal}>
              <ContextMenu.ItemLabel>{language.t(REVEAL_LABEL[os()])}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
