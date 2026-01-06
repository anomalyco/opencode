import type { TextareaRenderable } from "@opentui/core"
import type { PromptExtension, PromptKeyEvent } from "./prompt-extension"
import { useViBasic } from "./vi-basic-core"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"

export interface ViBasicExtensionOptions {
  textarea: () => TextareaRenderable | undefined
  onContentChange: () => void
}

/**
 * Create a vi basic extension for the prompt
 */
export function createViBasicExtension(options: ViBasicExtensionOptions): PromptExtension {
  const kv = useKV()
  const { theme } = useTheme()

  const enabled = () => kv.get("prompt_vi_basic", false) as boolean
  const setEnabled = (value: boolean) => kv.set("prompt_vi_basic", value)
  const clipX = () => kv.get("vi_basic_clip_x", false) as boolean

  const viBasic = useViBasic({
    textarea: options.textarea,
    onContentChange: options.onContentChange,
    mode: "prompt",
    clipX: clipX(),
  })

  return {
    id: "vi-basic",

    enabled,

    handleKey: (event: PromptKeyEvent) => {
      if (!enabled()) return false

      return viBasic.handleKey(event)
    },

    keyPhase: "pre",

    handleEscape: () => {
      if (!enabled()) return false

      // In vi insert mode, escape exits insert mode
      if (viBasic.state() === "insert") {
        viBasic.handleKey({ name: "escape", preventDefault: () => {} })
        return true
      }

      // In vi command mode with pending command, escape aborts the command
      if (viBasic.command()) {
        viBasic.handleKey({ name: "escape", preventDefault: () => {} })
        return true
      }

      return false
    },

    blockInterrupt: () => {
      if (!enabled()) return false
      // Block interrupt when in insert mode or with pending command
      return viBasic.state() === "insert" || !!viBasic.command()
    },

    StatusIndicator: () => {
      if (!enabled()) return <></>

      const isInsert = viBasic.state() === "insert"

      return (
        <text>
          <span
            style={{
              fg: isInsert ? theme.background : theme.textMuted,
              bg: isInsert ? theme.success : theme.backgroundElement,
            }}
          >
            {isInsert ? "  INSERT  " : viBasic.command() ? ` ${viBasic.command().padEnd(8, " ")} ` : " vi basic "}
          </span>
        </text>
      )
    },

    commands: () => [
      {
        title: enabled() ? "Use standard prompt editor" : "Use vi basic prompt editor",
        value: "prompt.toggle.vi",
        category: "Prompt",
        onSelect: () => {
          const newValue = !enabled()
          setEnabled(newValue)
          viBasic.reset()
        },
      },
    ],

    reset: () => {
      viBasic.reset()
    },

    onToggle: (value: boolean) => {
      setEnabled(value)
      if (!value) viBasic.reset()
    },

    getState: () => viBasic.state(),
  }
}
