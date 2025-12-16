import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "../ui/toast"
import { createMemo, createSignal, onCleanup, onMount, Show, For } from "solid-js"
import { getAgent, getInstallCommandsForPlatform, type InstallCommand } from "@/acp/agents"
import { runAgentInstall } from "@/acp/install"
import { useLocal } from "@tui/context/local"
import { useKeyboard } from "@opentui/solid"

type Phase = "choose" | "running"

export function DialogAgentInstall(props: { agentName: string }) {
  const dialog = useDialog()
  const toast = useToast()
  const local = useLocal()
  const { theme } = useTheme()

  onMount(() => dialog.setSize("large"))

  const agent = createMemo(() => getAgent(props.agentName))
  const commands = createMemo(() => (agent() ? getInstallCommandsForPlatform(agent()!) : []))
  const hasCommands = createMemo(() => commands().length > 0)

  const [phase, setPhase] = createSignal<Phase>("choose")
  const [output, setOutput] = createSignal("")
  const [selected, setSelected] = createSignal<InstallCommand | null>(null)
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [installing, setInstalling] = createSignal(false)
  const [result, setResult] = createSignal<{ code: number | null; detected: boolean } | null>(null)

  const abortController = new AbortController()
  onCleanup(() => abortController.abort())

  useKeyboard((evt) => {
    if (phase() !== "choose") return
    if (!hasCommands()) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelectedIndex((idx) => {
        const max = commands().length
        return idx <= 0 ? max - 1 : idx - 1
      })
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelectedIndex((idx) => {
        const max = commands().length
        return idx >= max - 1 ? 0 : idx + 1
      })
    }
    if (evt.name === "return") {
      const cmd = commands()[selectedIndex()]
      if (cmd) {
        evt.preventDefault()
        void startInstall(cmd)
      }
    }
  })

  async function startInstall(command: InstallCommand) {
    const agentDef = agent()
    if (!agentDef) return
    if (installing()) return

    setPhase("running")
    setSelected(command)
    setOutput("")
    setResult(null)
    setInstalling(true)

    const installResult = await runAgentInstall({
      agent: agentDef,
      installCommand: command,
      onOutput: (chunk) => setOutput((prev) => prev + chunk),
      signal: abortController.signal,
    })

    setInstalling(false)
    setResult({ code: installResult.code, detected: installResult.detected })

    if (installResult.code === 0 && installResult.detected) {
      toast.show({
        variant: "success",
        message: `${agentDef.name} installed successfully. Selecting agent...`,
        duration: 4000,
      })
      dialog.clear()
      await local.agent.set(agentDef.name, dialog)
      return
    }

    const reason = installResult.error?.message ?? `Exit code ${installResult.code ?? "unknown"}`
    const detectedText = installResult.detected ? "Found on PATH" : "Not detected on PATH"

    toast.show({
      variant: "error",
      message: `Failed to install ${agentDef.name}. ${detectedText}. ${reason}`,
      duration: 8000,
    })
  }

  return (
    <box paddingLeft={3} paddingRight={3} paddingBottom={2} paddingTop={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Install {props.agentName}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={phase() === "choose"}>
        <box gap={1}>
          <text fg={theme.textMuted}>Select an install method</text>
          <Show
            when={hasCommands()}
            fallback={<text fg={theme.textMuted}>No install commands available for this platform.</text>}
          >
            <box gap={0}>
              <For each={commands()}>
                {(cmd, index) => {
                  const active = () => selectedIndex() === index()
                  return (
                    <box
                      paddingLeft={1}
                      paddingRight={1}
                      paddingTop={0}
                      paddingBottom={0}
                      backgroundColor={active() ? theme.primary : undefined}
                      onMouseUp={() => startInstall(cmd)}
                    >
                      <text
                        fg={active() ? theme.background : theme.text}
                        attributes={TextAttributes.BOLD}
                        wrapMode="word"
                      >
                        {cmd.method}
                        {cmd.description ? ` — ${cmd.description}` : ""}
                      </text>
                      <Show when={cmd.command}>
                        <text fg={active() ? theme.background : theme.textMuted} wrapMode="word">
                          {cmd.command}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      <Show when={phase() === "running"}>
        <box gap={1}>
          <text fg={theme.text}>{selected()?.command}</text>
          <text fg={theme.textMuted}>
            {installing() ? "Installing..." : result()?.detected ? "Detected on PATH" : "Not detected yet"}
          </text>
          <scrollbox maxHeight={16} scrollbarOptions={{ visible: false }} paddingRight={1}>
            <text wrapMode="word" fg={theme.text}>
              {output() || "Waiting for output..."}
            </text>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}
