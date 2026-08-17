import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For } from "solid-js"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { describeOS, describeTerminal } from "../util/system"

export function DialogDebug() {
  const { themeV2 } = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()
  const [copied, setCopied] = createSignal(false)

  dialog.setSize("large")

  const entries = createMemo(() => {
    const model = local.model.current()
    return [
      { label: "Version", value: `${InstallationVersion} (${InstallationChannel})` },
      { label: "Date", value: new Date().toISOString() },
      { label: "OS", value: describeOS() },
      { label: "Terminal", value: describeTerminal() },
      { label: "Session ID", value: route.data.type === "session" ? route.data.sessionID : "n/a" },
      { label: "Model", value: model ? `${model.providerID}/${model.modelID}` : "n/a" },
    ]
  })

  const copy = () => {
    const text = entries()
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join("\n")
    void clipboard
      .write?.(text)
      .then(() => {
        setCopied(true)
        toast.show({ message: "Debug info copied to clipboard", variant: "info" })
      })
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "return", title: "Copy debug info", group: "Dialog", run: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={themeV2.text()} attributes={TextAttributes.BOLD}>
          Debug
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      {/* No click-to-copy here: releasing a mouse selection must trigger the
          global copy-on-select so users can copy a single value, e.g. the session id. */}
      <box>
        <For each={entries()}>
          {(entry) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={themeV2.text.subdued()}>
                {entry.label.padEnd(10)}
              </text>
              <text fg={themeV2.text()} wrapMode="word">
                {entry.value}
              </text>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={themeV2.text.subdued()}>Share this when reporting an issue.</text>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? themeV2.text.feedback.success() : themeV2.text() }}>
            <b>{copied() ? "✓ copied" : "copy"}</b>{" "}
          </span>
          <span style={{ fg: themeV2.text.subdued() }}>enter</span>
        </text>
      </box>
    </box>
  )
}
