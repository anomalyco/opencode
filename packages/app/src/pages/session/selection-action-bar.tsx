import type { JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

export type SelectionActionBarProps = {
  top?: number
  onAddToChat: () => void
  onQuickEdit: () => void
}

export function SelectionActionBar(props: SelectionActionBarProps): JSX.Element {
  const language = useLanguage()
  const hidden = () => props.top === undefined

  return (
    <div
      data-component="selection-action-bar"
      style={{
        position: "absolute",
        right: "12px",
        top: `${props.top ?? 0}px`,
        opacity: hidden() ? 0 : 1,
        "pointer-events": hidden() ? "none" : "auto",
        "z-index": 10,
      }}
    >
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0",
          "border-radius": "6px",
          border: "1px solid var(--color-border-weak-base)",
          background: "var(--color-background-base)",
          "box-shadow": "0 2px 8px rgba(0,0,0,0.12)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={props.onAddToChat}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            padding: "4px 8px",
            border: "none",
            background: "transparent",
            color: "var(--color-text-base)",
            cursor: "pointer",
            "font-size": "12px",
            "white-space": "nowrap",
          }}
          title={language.t("selection.action.addToChat") + " ⌘L"}
        >
          <Icon name="plus-small" size="small" />
          {language.t("selection.action.addToChat")}
          <kbd
            style={{
              "font-size": "10px",
              opacity: 0.5,
              "margin-left": "2px",
            }}
          >
            ⌘L
          </kbd>
        </button>
        <div
          style={{
            width: "1px",
            height: "16px",
            background: "var(--color-border-weak-base)",
          }}
        />
        <button
          type="button"
          onClick={props.onQuickEdit}
          style={{
            display: "flex",
            "align-items": "center",
            gap: "4px",
            padding: "4px 8px",
            border: "none",
            background: "transparent",
            color: "var(--color-text-base)",
            cursor: "pointer",
            "font-size": "12px",
            "white-space": "nowrap",
          }}
          title={language.t("selection.action.quickEdit") + " ⌘K"}
        >
          <Icon name="pencil-line" size="small" />
          {language.t("selection.action.quickEdit")}
          <kbd
            style={{
              "font-size": "10px",
              opacity: 0.5,
              "margin-left": "2px",
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>
    </div>
  )
}
