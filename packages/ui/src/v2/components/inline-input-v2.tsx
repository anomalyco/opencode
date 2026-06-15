import { type ComponentProps, type JSX, Show, splitProps } from "solid-js"
import { Icon } from "./icon"
import "./inline-input-v2.css"

export interface InlineInputV2Props extends Omit<ComponentProps<"input">, "type" | "prefix"> {
  /** Inline label shown before the field (prefix segment). */
  prefix: JSX.Element
  /** Fixed width for the prefix segment (px number or CSS length). Omit for fit-content. */
  labelWidth?: number | string
  /** Show the trailing copy action. */
  showCopyButton?: boolean
  /** Accessible label for the copy button. */
  copyLabel?: string
  onCopyClick?: (event: MouseEvent) => void
  /** Apply tabular numerals to the prefix and field value. */
  numeric?: boolean
  /** Error styling for the field and value text. */
  invalid?: boolean
  /** `base` is 28px tall; `large` is 32px tall. */
  appearance?: "base" | "large"
  type?: ComponentProps<"input">["type"]
}

export function InlineInputV2(props: InlineInputV2Props) {
  const [local, inputProps] = splitProps(props, [
    "class",
    "classList",
    "prefix",
    "labelWidth",
    "showCopyButton",
    "copyLabel",
    "onCopyClick",
    "numeric",
    "invalid",
    "appearance",
    "disabled",
    "style",
  ])

  return (
    <div
      data-component="inline-input-v2"
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      data-numeric={local.numeric ? "" : undefined}
      data-appearance={local.appearance ?? "base"}
      data-label-width={local.labelWidth != null ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={{
        ...(typeof local.style === "object" && local.style != null ? local.style : {}),
        ...(local.labelWidth != null
          ? {
              "--inline-input-v2-label-width":
                typeof local.labelWidth === "number" ? `${local.labelWidth}px` : local.labelWidth,
            }
          : {}),
      }}
    >
      <div data-slot="inline-input-v2-prefix">
        <span data-slot="inline-input-v2-prefix-text">{local.prefix}</span>
      </div>
      <div data-slot="inline-input-v2-divider" aria-hidden="true" />
      <div data-slot="inline-input-v2-field">
        <div data-slot="inline-input-v2-value">
          <input
            {...inputProps}
            type={inputProps.type ?? "text"}
            disabled={local.disabled}
            aria-invalid={local.invalid ? true : undefined}
            data-slot="inline-input-v2-input"
          />
        </div>
        <Show when={local.showCopyButton}>
          <button
            type="button"
            data-slot="inline-input-v2-icon-button"
            aria-label={local.copyLabel ?? "Copy"}
            disabled={local.disabled}
            onClick={local.onCopyClick}
          >
            <Icon name="copy" />
          </button>
        </Show>
      </div>
    </div>
  )
}
