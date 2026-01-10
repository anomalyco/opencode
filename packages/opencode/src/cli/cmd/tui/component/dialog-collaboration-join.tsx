import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useCollaboration } from "../context/collaboration"
import { useToast } from "../ui/toast"
import { onMount, createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

type Step = "code" | "name"

export type DialogCollaborationJoinProps = {
  initialCode?: string
  onJoined?: (sessionID: string) => void
}

export function DialogCollaborationJoin(props: DialogCollaborationJoinProps) {
  const dialog = useDialog()
  const collaboration = useCollaboration()
  const toast = useToast()
  const { theme } = useTheme()

  let textarea: TextareaRenderable

  const [step, setStep] = createSignal<Step>(props.initialCode ? "name" : "code")
  const [code, setCode] = createSignal(props.initialCode ?? "")
  const [sessionID, setSessionID] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  useKeyboard((evt) => {
    if (evt.name === "return" && textarea) {
      handleSubmit()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    // If we have an initial code, validate it first
    if (props.initialCode) {
      validateCode(props.initialCode)
    }
    setTimeout(() => {
      textarea?.focus()
    }, 1)
  })

  async function validateCode(inputCode: string): Promise<boolean> {
    const cleanCode = inputCode.replace(/[-\s]/g, "").toUpperCase()
    if (cleanCode.length !== 6) {
      setError("Code must be 6 characters")
      return false
    }

    setLoading(true)
    setError(null)

    try {
      const result = await collaboration.validateJoinCode(cleanCode)
      if (!result.valid) {
        setError(result.error ?? "Invalid code")
        return false
      }

      setCode(cleanCode)
      setSessionID(result.sessionID!)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to validate code")
      return false
    } finally {
      setLoading(false)
    }
  }

  async function handleCodeSubmit(value: string) {
    const valid = await validateCode(value)
    if (valid) {
      setStep("name")
      setTimeout(() => {
        textarea?.focus()
        textarea?.clear()
      }, 1)
    }
  }

  async function handleNameSubmit(name: string) {
    if (!sessionID()) return

    if (name.length < 1 || name.length > 32) {
      setError("Name must be 1-32 characters")
      return
    }

    setLoading(true)
    setError(null)

    try {
      await collaboration.join(sessionID()!, name)
      toast.show({
        message: `Joined collaboration as ${name}`,
        variant: "success",
      })
      props.onJoined?.(sessionID()!)
      dialog.clear()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join")
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit() {
    if (loading()) return
    const value = textarea?.plainText?.trim() ?? ""

    if (step() === "code") {
      handleCodeSubmit(value)
    } else {
      handleNameSubmit(value)
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Join Collaboration
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={step() === "code"}>
        <box gap={1}>
          <text fg={theme.textMuted}>Enter the 6-character join code:</text>
          <textarea
            onSubmit={handleSubmit}
            height={3}
            keyBindings={[{ name: "return", action: "submit" }]}
            ref={(val: TextareaRenderable) => (textarea = val)}
            placeholder="ABC-123"
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
        </box>
      </Show>

      <Show when={step() === "name"}>
        <box gap={1}>
          <text fg={theme.textMuted}>Code: {code()}</text>
          <text fg={theme.textMuted}>Choose a display name:</text>
          <textarea
            onSubmit={handleSubmit}
            height={3}
            keyBindings={[{ name: "return", action: "submit" }]}
            ref={(val: TextareaRenderable) => (textarea = val)}
            placeholder="Your name"
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
        </box>
      </Show>

      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>

      <Show when={loading()}>
        <text fg={theme.textMuted}>Loading...</text>
      </Show>

      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>{step() === "code" ? "validate" : "join"}</span>
        </text>
      </box>
    </box>
  )
}

// Static helper for showing dialog
DialogCollaborationJoin.show = (
  dialog: DialogContext,
  initialCode?: string,
): Promise<string | null> => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => <DialogCollaborationJoin initialCode={initialCode} onJoined={resolve} />,
      () => resolve(null),
    )
  })
}
