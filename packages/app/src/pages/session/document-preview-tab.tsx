import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { DocumentPreviewPanel, type DocumentKind } from "@opencode-ai/session-ui/document-preview"
import { OfficePreview, type OfficePreviewResult } from "@opencode-ai/session-ui/office-preview"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSessionLayout } from "@/pages/session/session-layout"
import { pluginInvoke } from "@/utils/plugin-invoke"

export type PreviewPayload =
  | { source: "builtin"; filename: string; kind: DocumentKind; url: string; path?: string }
  | {
      source: "plugin"
      filename: string
      pluginId: string
      result: OfficePreviewResult
      path: string
      sessionID: string
    }

export const previewTabKey = (filename: string) => `preview:${filename}`
export const isPreviewTab = (tab: string) => tab.startsWith("preview:")
export const previewLabel = (tab: string) => tab.slice("preview:".length)

// ponytail: payloads live in memory only; preview tabs are dropped from persisted state on load
const [payloads, setPayloads] = createStore<Record<string, PreviewPayload>>({})

export const setPreviewPayload = (tab: string, payload: PreviewPayload) => setPayloads(tab, payload)
export const clearPreviewPayload = (tab: string) => setPayloads({ [tab]: undefined })

export function DocumentPreviewTabContent(props: { tab: string }) {
  const language = useLanguage()
  const platform = usePlatform()
  const { tabs } = useSessionLayout()
  // ponytail: the payload is set before the tab mounts and cleared on close, so no reactivity is needed
  const payload = payloads[props.tab]
  if (!payload) return <Tabs.Content value={props.tab} class="flex h-full flex-col" />

  const close = () => {
    clearPreviewPayload(props.tab)
    tabs().close(props.tab)
  }
  const path = payload.path
  const openInApp = path && platform.openInApp ? () => void platform.openInApp?.(path) : undefined
  const downloadUrl = payload.source === "builtin" ? payload.url : payload.result.fileUrl
  const download = () => {
    if (!downloadUrl) return
    const anchor = document.createElement("a")
    anchor.href = downloadUrl
    anchor.download = payload.filename
    anchor.click()
  }
  const actions = (
    <>
      <Show when={openInApp}>
        <Button variant="ghost" onClick={openInApp}>
          {language.t("session.attachment.openInApp")}
        </Button>
      </Show>
      <Show when={downloadUrl}>
        <Button variant="primary" onClick={download}>
          {language.t("session.attachment.download")}
        </Button>
      </Show>
    </>
  )
  const shell = "flex h-full flex-col overflow-hidden contain-strict"
  if (payload.source === "plugin")
    return (
      <Tabs.Content value={props.tab} class={shell}>
        <OfficePreview
          embedded
          result={payload.result}
          invoke={(name, input) =>
            pluginInvoke(payload.pluginId, name, { filePath: payload.path, sessionID: payload.sessionID, ...input })
          }
          openInApp={openInApp}
          download={downloadUrl ? download : undefined}
          onClose={close}
        />
      </Tabs.Content>
    )
  return (
    <Tabs.Content value={props.tab} class={shell}>
      <DocumentPreviewPanel
        filename={payload.filename}
        kind={payload.kind}
        url={payload.url}
        actions={actions}
        onClose={close}
      />
    </Tabs.Content>
  )
}
