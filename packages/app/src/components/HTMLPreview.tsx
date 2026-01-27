import { Component, createSignal, onMount, onCleanup, Show, For, createEffect } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"

type DevicePreset = {
  name: string
  width: string
  height: string
}

const DEVICE_PRESETS: DevicePreset[] = [
  { name: "Desktop", width: "100%", height: "100%" },
  { name: "Laptop (1024x768)", width: "1024px", height: "768px" },
  { name: "Tablet (768x1024)", width: "768px", height: "1024px" },
  { name: "Mobile (375x667)", width: "375px", height: "667px" },
]

interface HTMLPreviewProps {
  content: string
  filePath?: string
}

export const HTMLPreview: Component<HTMLPreviewProps> = (props) => {
  const language = useLanguage()
  const [iframeRef, setIframeRef] = createSignal<HTMLIFrameElement | null>(null)
  const [selectedDevice, setSelectedDevice] = createSignal<DevicePreset>(DEVICE_PRESETS[0])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [showControls, setShowControls] = createSignal(true)
  const [viewMode, setViewMode] = createSignal<"preview" | "code">("preview")

  // Update iframe content when props change
  const updateContent = () => {
    const iframe = iframeRef()
    if (!iframe || !props.content) return

    try {
      setIsLoading(true)
      setError(null)

      const doc = iframe.contentDocument
      if (!doc) return

      // Inject base URL for relative resources
      const basePath = props.filePath ? new URL(props.filePath, "file:///").pathname : "/"
      const baseTag = `<base href="${basePath}">`

      const contentWithBase = props.content.replace(/<head>/i, `<head>${baseTag}`)

      doc.open()
      doc.write(contentWithBase)
      doc.close()

      // Handle iframe load
      iframe.onload = () => {
        setIsLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsLoading(false)
    }
  }

  // Refresh preview
  const refresh = () => {
    updateContent()
  }

  // Open in new window
  const openInNewWindow = () => {
    const newWindow = window.open("", "_blank")
    if (newWindow) {
      newWindow.document.write(props.content)
      newWindow.document.close()
    }
  }

  // Initial load and update on changes
  createEffect(() => {
    updateContent()
  })

  // Apply device preset styles
  const deviceStyles = () => {
    const device = selectedDevice()
    return {
      width: device.width,
      height: device.height,
      "max-width": "100%",
      "max-height": "100%",
    }
  }

  return (
    <div class="flex flex-col h-full bg-background-base">
      {/* Control Bar */}
      <Show when={showControls()}>
        <div class="flex items-center justify-between px-3 py-2 border-b border-border-weak-base bg-surface-raised-base">
          <div class="flex items-center gap-2">
            {/* View Mode Toggle */}
            <Tabs value={viewMode()} onChange={(value) => setViewMode(value as "preview" | "code")}>
              <Tabs.List>
                <Tabs.Trigger value="preview" size="small">
                  <div class="flex items-center gap-1.5">
                    <Icon name="eye" size="small" />
                    <span>Preview</span>
                  </div>
                </Tabs.Trigger>
                <Tabs.Trigger value="code" size="small">
                  <div class="flex items-center gap-1.5">
                    <Icon name="code" size="small" />
                    <span>Code</span>
                  </div>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>

            <Show when={viewMode() === "preview"}>
              <div class="w-px h-4 bg-border-weak-base mx-2" />

              {/* Device Preset Selector */}
              <For each={DEVICE_PRESETS}>
                {(preset) => (
                  <Button
                    size="small"
                    variant={selectedDevice().name === preset.name ? "secondary" : "ghost"}
                    onClick={() => setSelectedDevice(preset)}
                  >
                    {preset.name}
                  </Button>
                )}
              </For>
            </Show>
          </div>

          {/* Actions */}
          <div class="flex items-center gap-1">
            <Button
              size="small"
              variant="ghost"
              onClick={refresh}
              disabled={isLoading()}
            >
              <div class="flex items-center gap-1.5">
                <Icon name="arrows-clockwise" size="small" />
                <span>Refresh</span>
              </div>
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={openInNewWindow}
            >
              <div class="flex items-center gap-1.5">
                <Icon name="square-arrow-top-right" size="small" />
                <span>Open</span>
              </div>
            </Button>
            <IconButton
              icon="eye"
              variant="ghost"
              size="small"
              onClick={() => setShowControls(false)}
              title="Hide controls"
            />
          </div>
        </div>
      </Show>

      {/* Error State */}
      <Show when={error()}>
        {(errorMsg) => (
          <div class="flex items-center gap-2 px-4 py-2 bg-background-warning-subtle text-text-warning text-13-regular">
            <Icon name="warning-circle" class="w-4 h-4 shrink-0" />
            <span class="flex-1">{errorMsg()}</span>
            <Button size="small" variant="ghost" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
      </Show>

      {/* Preview Container */}
      <div class="flex-1 overflow-auto bg-surface-base">
        <Show when={viewMode() === "preview"}>
          <Show when={selectedDevice().name === "Desktop"}>
            {/* Desktop mode - full width */}
            <div class="h-full relative">
              <Show when={isLoading()}>
                <div class="absolute inset-0 flex items-center justify-center bg-background-base/50">
                  <div class="inline-block w-6 h-6 border-2 border-border-strong-subtle border-t-transparent rounded-full animate-spin" />
                </div>
              </Show>

              <Show when={!showControls()}>
                <div class="absolute top-2 right-2 z-10">
                  <IconButton
                    icon="eye"
                    variant="secondary"
                    size="small"
                    onClick={() => setShowControls(true)}
                    title="Show controls"
                  />
                </div>
              </Show>

              <iframe
                ref={setIframeRef}
                class="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                title="HTML Preview"
              />
            </div>
          </Show>

          <Show when={selectedDevice().name !== "Desktop"}>
            {/* Other devices - centered with fixed size */}
            <div class="flex items-center justify-center min-h-full p-4">
              <div
                class="bg-white shadow-lg border border-border-weak-base transition-all duration-200 relative"
                style={deviceStyles()}
              >
                <Show when={isLoading()}>
                  <div class="absolute inset-0 flex items-center justify-center bg-background-base/50">
                    <div class="inline-block w-6 h-6 border-2 border-border-strong-subtle border-t-transparent rounded-full animate-spin" />
                  </div>
                </Show>

                <Show when={!showControls()}>
                  <div class="absolute top-2 right-2 z-10">
                    <IconButton
                      icon="eye"
                      variant="secondary"
                      size="small"
                      onClick={() => setShowControls(true)}
                      title="Show controls"
                    />
                  </div>
                </Show>

                <iframe
                  ref={setIframeRef}
                  class="w-full h-full border-0"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                  title="HTML Preview"
                />
              </div>
            </div>
          </Show>
        </Show>

        <Show when={viewMode() === "code"}>
          <div class="px-4 py-4 h-full">
            <pre class="text-13-regular text-text-strong overflow-auto h-full"><code>{props.content}</code></pre>
          </div>
        </Show>
      </div>
    </div>
  )
}
