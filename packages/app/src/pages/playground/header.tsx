import { Show } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { usePlayground, type DeviceFrame } from "@/context/playground"
import { usePlatform } from "@/context/platform"

export function PlaygroundHeader() {
  const playground = usePlayground()
  const platform = usePlatform()

  function togglePanel(panel: "chat" | "code") {
    playground.setPanel(panel)
  }

  async function exportSelected() {
    const win = playground.selected
    if (!win) return

    let html = win.code
    // Add polyfill stub for window.opencode
    if (html.includes("window.opencode")) {
      const stub = `<script>
window.opencode = {
  complete: function() { return Promise.reject(new Error("Requires OpenPlayground")); },
  chat: function() { return Promise.reject(new Error("Requires OpenPlayground")); },
  stream: function() { return Promise.reject(new Error("Requires OpenPlayground")); },
  skill: function() { return Promise.reject(new Error("Requires OpenPlayground")); },
  skills: function() { return Promise.resolve([]); },
  models: function() { return Promise.resolve([]); }
};
</script>`
      html = html.replace("</head>", `${stub}\n</head>`)
    }

    if (platform.saveFilePickerDialog) {
      const path = await platform.saveFilePickerDialog({
        title: "Export as HTML",
        defaultPath: `${win.title || "app"}.html`,
      })
      if (!path) return
      // On desktop, write via platform — for now use blob download
    }

    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${win.title || "app"}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  function setDeviceFrame(frame: DeviceFrame) {
    const sel = playground.selected
    if (!sel) return
    playground.updateWindow(sel.id, { deviceFrame: frame })
  }

  return (
    <div
      data-component="playground-header"
      class="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-border-base bg-background-base"
    >
      <div class="flex items-center gap-1 flex-1 min-w-0">
        <Show when={playground.selected}>
          <div class="flex items-center gap-0.5 bg-background-stronger rounded-md p-0.5">
            <button
              class="px-2 py-0.5 text-11-medium rounded transition-colors"
              classList={{
                "bg-background-base text-text-base shadow-sm": playground.selected!.deviceFrame === "auto",
                "text-text-dimmed-base hover:text-text-base": playground.selected!.deviceFrame !== "auto",
              }}
              onClick={() => setDeviceFrame("auto")}
            >
              Auto
            </button>
            <button
              class="px-2 py-0.5 text-11-medium rounded transition-colors"
              classList={{
                "bg-background-base text-text-base shadow-sm": playground.selected!.deviceFrame === "mobile",
                "text-text-dimmed-base hover:text-text-base": playground.selected!.deviceFrame !== "mobile",
              }}
              onClick={() => setDeviceFrame("mobile")}
            >
              Mobile
            </button>
            <button
              class="px-2 py-0.5 text-11-medium rounded transition-colors"
              classList={{
                "bg-background-base text-text-base shadow-sm": playground.selected!.deviceFrame === "tablet",
                "text-text-dimmed-base hover:text-text-base": playground.selected!.deviceFrame !== "tablet",
              }}
              onClick={() => setDeviceFrame("tablet")}
            >
              Tablet
            </button>
            <button
              class="px-2 py-0.5 text-11-medium rounded transition-colors"
              classList={{
                "bg-background-base text-text-base shadow-sm": playground.selected!.deviceFrame === "desktop",
                "text-text-dimmed-base hover:text-text-base": playground.selected!.deviceFrame !== "desktop",
              }}
              onClick={() => setDeviceFrame("desktop")}
            >
              Desktop
            </button>
          </div>
        </Show>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <Show when={playground.selected}>
          <Tooltip placement="bottom" value="Export as HTML">
            <IconButton icon="download" variant="ghost" class="w-7 h-7" onClick={exportSelected} />
          </Tooltip>
        </Show>
        <Tooltip placement="bottom" value="Toggle code">
          <IconButton
            icon="code"
            variant="ghost"
            class="w-7 h-7"
            classList={{ "bg-background-stronger": playground.panel === "code" }}
            onClick={() => togglePanel("code")}
          />
        </Tooltip>
        <Tooltip placement="bottom" value="Toggle chat">
          <IconButton
            icon="comment"
            variant="ghost"
            class="w-7 h-7"
            classList={{ "bg-background-stronger": playground.panel === "chat" }}
            onClick={() => togglePanel("chat")}
          />
        </Tooltip>
      </div>
    </div>
  )
}
