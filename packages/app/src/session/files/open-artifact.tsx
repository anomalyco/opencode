import { createEffect, onCleanup, type ParentProps } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { useBrowserAttachments } from "@/session/browser/attachments"
import type { SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { artifactKind, resolveArtifactPath } from "@/workspaces/files/artifact"
import { encodeFilePath } from "@/workspaces/files/path"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useSessionLayout } from "@/session/session-layout"
import { createOpenSessionFileTab } from "@/session/helpers"
import type { createSessionBrowser } from "@/session/browser/model"

/** Routes local links in timeline markdown to the artifact opener while keeping image loading. */
export function ArtifactMarkdownProvider(props: ParentProps) {
  const markdown = useMarkdown()
  const artifacts = useArtifactOpener()
  return (
    <MarkdownProvider readImage={markdown?.readImage} openLocalFile={(path) => artifacts.open(path)}>
      {props.children}
    </MarkdownProvider>
  )
}

/**
 * Opens files the agent references as side-panel tabs, inside or outside the workspace, or as
 * a browser tab for HTML when the desktop can load the file directly.
 */
export const { use: useArtifactOpener, provider: ArtifactOpenerProvider } = createSimpleContext({
  name: "ArtifactOpener",
  init: (props: { session: SessionModel; browser: ReturnType<typeof createSessionBrowser> }) => {
    const file = useFile()
    const server = useServer()
    const location = useWorkspaceLocation()
    const attachments = useBrowserAttachments()
    const { tabs, view } = useSessionLayout()

    const root = () => location().directory.replaceAll("\\", "/").replace(/\/+$/, "")

    /**
     * Turn a link into a path `useFile` can load: workspace-relative when it is under the root,
     * otherwise absolute. Relative links resolve against `base`; ones that climb past the root
     * become absolute too, so a `../../shared/report.pdf` still opens.
     */
    const resolve = (href: string, base?: string) => {
      // Agents cite locations as path:line or path:line:col; the file is what opens.
      const value = href.replaceAll("\\", "/").replace(/:\d+(?::\d+)?$/, "")
      if (/^[a-z]:\//i.test(value) || value.startsWith("/")) return file.normalize(value)
      const relative = resolveArtifactPath(base ?? "", value)
      if (relative !== undefined) return file.normalize(relative)
      // Climbing past the workspace root: resolve from the referencing folder's absolute location.
      const dir = base ? `${root()}/${base.replace(/\/+$/, "")}` : root()
      return file.normalize(resolveArtifactPath(dir, value) ?? value)
    }

    const showTab = createOpenSessionFileTab({
      normalizeTab: (tab) => tab,
      openTab: (tab) => tabs().open(tab),
      pathFromTab: file.pathFromTab,
      loadFile: () => undefined,
      openReviewPanel: () => {
        if (!view().reviewPanel.opened()) view().reviewPanel.open()
      },
      setActive: (tab) => tabs().setActive(tab),
    })

    // Inline paths are guessed from text, so confirm the file exists before a tab appears for it.
    const openTab = (path: string) => {
      void file.load(path).then(() => {
        if (file.get(path)?.loaded) showTab(file.tab(path))
      })
    }

    // The desktop's own sidecar shares this disk, and its browser pane accepts file:// URLs inside the
    // session workspace only. Forwarded loopback servers do not qualify, matching the desktop policy.
    const canOpenInBrowser = (path?: string) =>
      ServerConnection.builtin(server.conn) &&
      props.browser.available() &&
      props.browser.attached() &&
      (path === undefined || !file.absolute(path))

    const openInBrowser = (path: string) => {
      props.browser.command({ type: "tabs.open", url: `file://${encodeFilePath(`${root()}/${path}`)}` })
    }

    /** Open `href` as referenced from `base` (a workspace-relative directory, "" for the root). */
    const open = (href: string, base?: string) => {
      const path = resolve(href, base)
      if (!path) return
      if (artifactKind(path) === "html" && canOpenInBrowser(path)) return openInBrowser(path)
      openTab(path)
    }

    // The agent's browser.preview tool arrives through the desktop browser pane attachment.
    createEffect(() => {
      const sessionID = props.session.identity.sessionID()
      if (!sessionID) return
      onCleanup(attachments.onPreview(server, sessionID, (path) => open(path)))
    })

    return { canOpenInBrowser, openInBrowser, open }
  },
})
