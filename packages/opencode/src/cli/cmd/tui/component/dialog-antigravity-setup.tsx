import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { createSignal, onCleanup, Show } from "solid-js"
import { Antigravity } from "@/antigravity"
import { useDialog } from "../ui/dialog"
import { useKeyboard } from "@opentui/solid"
import { DialogModel } from "./dialog-model"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"

type SetupStep = "intro" | "launching" | "waiting" | "success" | "error"

export function DialogAntigravitySetup() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const [step, setStep] = createSignal<SetupStep>("intro")
  const [error, setError] = createSignal<string | null>(null)

  let pollInterval: ReturnType<typeof setInterval> | null = null

  onCleanup(() => {
    if (pollInterval) clearInterval(pollInterval)
  })

  const startSetup = async () => {
    setStep("launching")
    
    // Open terminal for user to login
    const opened = await Antigravity.openSetupTerminal()
    
    if (!opened) {
      setError("Could not open terminal. Please run manually:\nnpx antigravity-claude-proxy start")
      setStep("error")
      return
    }

    setStep("waiting")

    // Poll for proxy to be ready with accounts
    let attempts = 0
    const maxAttempts = 120 // 2 minutes

    pollInterval = setInterval(async () => {
      attempts++
      
      const running = await Antigravity.isRunning()
      if (running) {
        const status = await Antigravity.getStatus()
        if (status && status.accounts.length > 0) {
          // Success! User has logged in
          if (pollInterval) clearInterval(pollInterval)
          
          // Mark setup as complete
          Antigravity.completeSetup()
          
          setStep("success")
          
          // After a brief delay, show model selection
          setTimeout(async () => {
            // Refresh provider data
            await sdk.client.instance.dispose()
            await sync.bootstrap()
            dialog.replace(() => <DialogModel providerID="antigravity" />)
          }, 1500)
          return
        }
      }

      if (attempts >= maxAttempts) {
        if (pollInterval) clearInterval(pollInterval)
        setError("Timed out waiting for login. Please try again.")
        setStep("error")
      }
    }, 1000)
  }

  useKeyboard((evt) => {
    if (step() === "intro" && (evt.name === "return" || evt.name === "enter")) {
      startSetup()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Antigravity Setup
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={step() === "intro"}>
        <box gap={1}>
          <text fg={theme.text} wrapMode="word">
            Antigravity provides <b>free</b> access to Claude and Gemini models via Google Cloud Code.
          </text>
          
          <text fg={theme.textMuted} wrapMode="word">
            A terminal will open where you'll need to:
          </text>
          
          <box marginLeft={2}>
            <text fg={theme.text}>1. Wait for the proxy to start</text>
            <text fg={theme.text}>2. Open http://localhost:8080 in your browser</text>
            <text fg={theme.text}>3. Click "Add Account" and sign in with Google</text>
          </box>

          <text fg={theme.textMuted} wrapMode="word">
            After logging in, CloseCode will automatically detect your account and configure the provider.
          </text>

          <box marginTop={1} flexDirection="row" gap={2}>
            <text fg={theme.success}>Enter</text>
            <text fg={theme.textMuted}>Start setup</text>
          </box>
        </box>
      </Show>

      <Show when={step() === "launching"}>
        <text fg={theme.warning}>Opening terminal...</text>
      </Show>

      <Show when={step() === "waiting"}>
        <box gap={1}>
          <text fg={theme.success}>Terminal opened!</text>
          <text fg={theme.text} wrapMode="word">
            Please complete the setup in the terminal window:
          </text>
          <box marginLeft={2}>
            <text fg={theme.textMuted}>1. Open http://localhost:8080</text>
            <text fg={theme.textMuted}>2. Click "Add Account"</text>
            <text fg={theme.textMuted}>3. Sign in with Google</text>
          </box>
          <text fg={theme.warning}>Waiting for you to log in...</text>
        </box>
      </Show>

      <Show when={step() === "success"}>
        <box gap={1}>
          <text fg={theme.success}>Setup complete!</text>
          <text fg={theme.textMuted}>
            Antigravity will now auto-start when you open CloseCode.
          </text>
        </box>
      </Show>

      <Show when={step() === "error"}>
        <box gap={1}>
          <text fg={theme.error}>Setup failed</text>
          <text fg={theme.textMuted} wrapMode="word">{error()}</text>
          <box marginTop={1} flexDirection="row" gap={2}>
            <text fg={theme.text}>Enter</text>
            <text fg={theme.textMuted}>Try again</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
