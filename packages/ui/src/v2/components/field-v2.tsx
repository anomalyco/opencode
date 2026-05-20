import {
  createContext,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  Show,
  type ComponentProps,
  type ParentProps,
} from "solid-js"
import { TooltipV2 } from "./tooltip-v2"
import "./field-v2.css"

type FieldContextValue = {
  controlId: string
  labelId: string
  prefixId: string
  suffixId: string
  invalid: () => boolean
  registerPrefix: () => void
  unregisterPrefix: () => void
  registerSuffix: () => void
  unregisterSuffix: () => void
  getDescribedBy: () => string | undefined
}

const FieldContext = createContext<FieldContextValue>()

function useField() {
  const ctx = useContext(FieldContext)
  if (!ctx) {
    throw new Error("Field subcomponents must be used within <Field>")
  }
  return ctx
}

const CONTROL_SELECTOR = [
  "[data-slot='text-input-v2-input']",
  "[data-slot='textarea-v2-textarea']",
  "[data-slot='inline-input-v2-input']",
].join(", ")

export interface FieldV2Props extends ComponentProps<"div"> {
  invalid?: boolean
}

function FieldV2Root(props: ParentProps<FieldV2Props>) {
  const [local, rest] = splitProps(props, ["invalid", "class", "classList", "children"])

  const controlId = `field-control-${createUniqueId()}`
  const labelId = `field-label-${createUniqueId()}`
  const prefixId = `field-prefix-${createUniqueId()}`
  const suffixId = `field-suffix-${createUniqueId()}`

  const [prefixCount, setPrefixCount] = createSignal(0)
  const [suffixCount, setSuffixCount] = createSignal(0)

  let rootRef: HTMLDivElement | undefined

  const ctx: FieldContextValue = {
    controlId,
    labelId,
    prefixId,
    suffixId,
    invalid: () => !!local.invalid,
    registerPrefix: () => setPrefixCount((n) => n + 1),
    unregisterPrefix: () => setPrefixCount((n) => Math.max(0, n - 1)),
    registerSuffix: () => setSuffixCount((n) => n + 1),
    unregisterSuffix: () => setSuffixCount((n) => Math.max(0, n - 1)),
    getDescribedBy: () => {
      const ids: string[] = []
      if (prefixCount() > 0) ids.push(prefixId)
      if (suffixCount() > 0) ids.push(suffixId)
      return ids.length > 0 ? ids.join(" ") : undefined
    },
  }

  const syncControlA11y = () => {
    const root = rootRef
    if (!root) return

    const control = root.querySelector(CONTROL_SELECTOR) as HTMLInputElement | HTMLTextAreaElement | null
    if (!control) return

    const shell = control.closest(
      "[data-component='text-input-v2'], [data-component='textarea-v2'], [data-component='inline-input-v2']",
    ) as HTMLElement | null

    control.id = controlId
    control.setAttribute("aria-labelledby", labelId)

    const describedBy = ctx.getDescribedBy()
    if (describedBy) {
      control.setAttribute("aria-describedby", describedBy)
    } else {
      control.removeAttribute("aria-describedby")
    }

    if (ctx.invalid()) {
      control.setAttribute("aria-invalid", "true")
      shell?.setAttribute("data-invalid", "")
    } else {
      control.removeAttribute("aria-invalid")
      shell?.removeAttribute("data-invalid")
    }
  }

  onMount(() => {
    syncControlA11y()
  })

  createEffect(() => {
    prefixCount()
    suffixCount()
    local.invalid
    syncControlA11y()
  })

  return (
    <FieldContext.Provider value={ctx}>
      <div
        {...rest}
        ref={rootRef}
        data-component="field-v2"
        data-invalid={local.invalid ? "" : undefined}
        classList={{
          ...local.classList,
          [local.class ?? ""]: !!local.class,
        }}
      >
        {local.children}
      </div>
    </FieldContext.Provider>
  )
}

function FieldLabelInfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M13 13H3V3H13V13ZM6.46777 6.81641V7.81641H7.5791V11.3721H8.5791V6.81641H6.46777ZM7.30078 4.62891V5.62891H8.85645V4.62891H7.30078Z"
        fill="currentColor"
      />
    </svg>
  )
}

export interface FieldLabelProps extends ComponentProps<"label"> {
  /** When set, shows the info icon with a tooltip containing this text. */
  tooltip?: string
}

function FieldLabel(props: ParentProps<FieldLabelProps>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children", "tooltip"])
  const field = useField()

  return (
    <label
      {...rest}
      id={field.labelId}
      for={field.controlId}
      data-slot="field-v2-label"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <span data-slot="field-v2-label-text">{local.children}</span>
      <Show when={local.tooltip}>
        {(tooltip) => (
          <TooltipV2 value={tooltip()}>
            <button
              type="button"
              data-slot="field-v2-label-info"
              aria-label={tooltip()}
              onClick={(e) => e.stopPropagation()}
            >
              <FieldLabelInfoIcon />
            </button>
          </TooltipV2>
        )}
      </Show>
    </label>
  )
}

function FieldPrefix(props: ParentProps<ComponentProps<"div">>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  const field = useField()

  onMount(() => {
    field.registerPrefix()
    onCleanup(() => field.unregisterPrefix())
  })

  return (
    <div
      {...rest}
      id={field.prefixId}
      data-slot="field-v2-prefix"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </div>
  )
}

function FieldSuffix(props: ParentProps<ComponentProps<"div">>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  const field = useField()

  onMount(() => {
    field.registerSuffix()
    onCleanup(() => field.unregisterSuffix())
  })

  return (
    <div
      {...rest}
      id={field.suffixId}
      data-slot="field-v2-suffix"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </div>
  )
}

/** Optional layout wrapper around the control. */
function FieldControl(props: ParentProps<ComponentProps<"div">>) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])

  return (
    <div
      {...rest}
      data-slot="field-v2-control"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </div>
  )
}

export const FieldV2 = Object.assign(FieldV2Root, {
  Label: FieldLabel,
  Prefix: FieldPrefix,
  Suffix: FieldSuffix,
  Control: FieldControl,
})

export const Field = FieldV2
