import { Show, type JSXElement } from "solid-js"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { useI18n } from "../../context/i18n"
import { Button } from "../button"
import { Icon } from "../icon"
import { RadioGroup } from "../radio-group"
import { Select } from "../select"
import { Tooltip, TooltipKeybind } from "../tooltip"
import { ModelPicker } from "./model-picker"

const IS_MAC = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const pretty = (config: string | undefined) => {
  if (!config) return ""
  const parts = config.split(",")[0]?.trim().toLowerCase().split("+")
  if (!parts) return ""

  const kb = {
    key: "",
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
  }

  for (const part of parts) {
    if (part === "ctrl" || part === "control") {
      kb.ctrl = true
      continue
    }
    if (part === "meta" || part === "cmd" || part === "command") {
      kb.meta = true
      continue
    }
    if (part === "mod") {
      if (IS_MAC) kb.meta = true
      else kb.ctrl = true
      continue
    }
    if (part === "alt" || part === "option") {
      kb.alt = true
      continue
    }
    if (part === "shift") {
      kb.shift = true
      continue
    }
    kb.key = part
  }

  const out: string[] = []
  if (kb.ctrl) out.push(IS_MAC ? "⌃" : "Ctrl")
  if (kb.alt) out.push(IS_MAC ? "⌥" : "Alt")
  if (kb.shift) out.push(IS_MAC ? "⇧" : "Shift")
  if (kb.meta) out.push(IS_MAC ? "⌘" : "Meta")

  const map: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    comma: ",",
    plus: "+",
    space: "Space",
  }

  if (kb.key) {
    const hit = map[kb.key]
    if (hit) out.push(hit)
    else if (kb.key.length === 1) out.push(kb.key.toUpperCase())
    else out.push(kb.key.charAt(0).toUpperCase() + kb.key.slice(1))
  }

  if (IS_MAC) return out.join("")
  return out.join("+")
}

interface Props {
  inputOpacity: number
  inputBlur: number
  questionOpacity: number
  questionBlur: number
  morph: number
  isQuestion: boolean
  isPermission: boolean
  showQuestion: boolean
  showPermission: boolean
  agentName?: string
  modelName?: string
  variant?: string
  agentOptions?: string[]
  modelOptions?: string[]
  variantOptions?: string[]
  agentCurrent?: string
  modelCurrent?: string
  variantCurrent?: string
  onAgentSelect?: (value: string) => void
  onModelSelect?: (value: string) => void
  onVariantSelect?: (value: string) => void
  agentKeybind?: string
  modelKeybind?: string
  variantKeybind?: string
  modelOpenTick?: number
  agentControl?: JSXElement
  modelControl?: JSXElement
  variantControl?: JSXElement
  shell: "shell" | "normal"
  onShell: (mode: "shell" | "normal") => void
  questionIndex?: number
  questionTotal?: number
  onQuestionDismiss?: () => void
  onQuestionBack?: () => void
  onQuestionNext?: () => void
  questionBusy?: boolean
  onPermissionDecide?: (response: "once" | "always" | "reject") => void | Promise<void>
  permissionBusy?: boolean
  onRef: (el: HTMLDivElement) => void
}

export function ComposerTray(props: Props) {
  const i18n = useI18n()
  const isShell = () => props.shell === "shell"
  const shell = useSpring(() => (isShell() ? 1 : 0), { visualDuration: 0.1, bounce: 0 })
  const buttonsOpacity = () => 1 - shell()
  const buttonsBlur = () => shell()
  const labelOpacity = () => shell()
  const labelBlur = () => 1 - shell()

  const hint = (title: string, keybind: string | undefined, node: JSXElement) => {
    const kb = pretty(keybind)
    if (kb) {
      return (
        <TooltipKeybind placement="top" gutter={4} title={title} keybind={kb}>
          {node}
        </TooltipKeybind>
      )
    }

    return (
      <Tooltip placement="top" value={<span>{title}</span>}>
        {node}
      </Tooltip>
    )
  }

  return (
    <div
      ref={props.onRef}
      data-dock-surface="tray"
      data-dock-attach="top"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        "z-index": 0,
        height: "58px",
        "border-color": "light-dark(#dcd9d9, #3e3a3a)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "22px 7px 8px",
          gap: "8px",
          opacity: props.inputOpacity,
          filter: `blur(${props.inputBlur}px)`,
          "pointer-events": props.morph > 0.5 ? "none" : "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "min-width": 0,
            flex: 1,
            position: "relative",
          }}
        >
          {/* Shell label — fades in when shell mode active */}
          <div
            class="absolute inset-y-0 left-0 flex items-center px-1"
            style={{
              opacity: `${labelOpacity()}`,
              filter: labelBlur() > 0.01 ? `blur(${labelBlur()}px)` : "none",
              "pointer-events": shell() > 0.5 ? "auto" : "none",
            }}
          >
            <span class="truncate text-13-medium text-text-strong">{i18n.t("ui.prompt.control.shell")}</span>
          </div>
          {/* Agent / model / variant buttons — fade out in shell mode */}
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              opacity: `${buttonsOpacity()}`,
              filter: buttonsBlur() > 0.01 ? `blur(${buttonsBlur()}px)` : "none",
              "pointer-events": shell() < 0.5 ? "auto" : "none",
            }}
          >
            <Show
              when={props.agentControl}
              fallback={
                <Show
                  when={(props.agentOptions?.length ?? 0) > 0}
                  fallback={hint(
                    i18n.t("ui.prompt.control.agent"),
                    props.agentKeybind,
                    <Button variant="ghost" size="normal">
                      {props.agentName ?? "Ask"}
                      <Icon name="chevron-down" size="small" />
                    </Button>,
                  )}
                >
                  {hint(
                    i18n.t("ui.prompt.control.agent"),
                    props.agentKeybind,
                    <Select
                      size="normal"
                      variant="ghost"
                      options={props.agentOptions ?? []}
                      current={props.agentCurrent}
                      onSelect={(value) => {
                        if (!value) return
                        props.onAgentSelect?.(value)
                      }}
                      class="capitalize max-w-[160px]"
                      valueClass="truncate text-13-regular"
                      triggerStyle={{ height: "28px" }}
                    />,
                  )}
                </Show>
              }
            >
              {props.agentControl}
            </Show>
            <Show
              when={props.modelControl}
              fallback={
                <Show
                  when={(props.modelOptions?.length ?? 0) > 0}
                  fallback={hint(
                    i18n.t("ui.prompt.control.model"),
                    props.modelKeybind,
                    <Button variant="ghost" size="normal">
                      <Icon name="brain" size="small" />
                      {props.modelName ?? "GPT-4"}
                      <Icon name="chevron-down" size="small" />
                    </Button>,
                  )}
                >
                  {hint(
                    i18n.t("ui.prompt.control.model"),
                    props.modelKeybind,
                    <ModelPicker
                      options={props.modelOptions ?? []}
                      current={props.modelCurrent ?? props.modelName}
                      onSelect={props.onModelSelect}
                      openTick={props.modelOpenTick}
                    />,
                  )}
                </Show>
              }
            >
              {props.modelControl}
            </Show>
            <Show
              when={props.variantControl}
              fallback={
                <Show
                  when={(props.variantOptions?.length ?? 0) > 0}
                  fallback={hint(
                    i18n.t("ui.prompt.control.variant"),
                    props.variantKeybind,
                    <Button variant="ghost" size="normal">
                      {props.variant ?? "Default"}
                      <Icon name="chevron-down" size="small" />
                    </Button>,
                  )}
                >
                  {hint(
                    i18n.t("ui.prompt.control.variant"),
                    props.variantKeybind,
                    <Select
                      size="normal"
                      variant="ghost"
                      options={props.variantOptions ?? []}
                      current={props.variantCurrent}
                      onSelect={(value) => {
                        if (!value) return
                        props.onVariantSelect?.(value)
                      }}
                      class="capitalize max-w-[160px]"
                      valueClass="truncate text-13-regular"
                      triggerStyle={{ height: "28px" }}
                    />,
                  )}
                </Show>
              }
            >
              {props.variantControl}
            </Show>
          </div>
        </div>
        <RadioGroup
          options={["shell", "normal"] as const}
          current={props.shell}
          onSelect={(mode) => props.onShell(mode ?? "normal")}
          value={(mode) => mode}
          label={(mode) => <Icon name={mode === "shell" ? "console" : "prompt"} class="size-[18px]" />}
          fill
          pad="none"
          class="w-[68px] shrink-0"
        />
      </div>

      <Show when={props.showQuestion}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 8px 8px",
            opacity: props.questionOpacity,
            filter: `blur(${props.questionBlur}px)`,
            "pointer-events": props.morph < 0.5 ? "none" : "auto",
          }}
        >
          <Button variant="ghost" size="normal" onClick={() => props.onQuestionDismiss?.()}>
            {i18n.t("ui.common.dismiss")}
          </Button>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Show when={(props.questionIndex ?? 0) > 0}>
              <Button
                variant="secondary"
                size="normal"
                onClick={() => props.onQuestionBack?.()}
                disabled={props.questionBusy}
              >
                {i18n.t("ui.common.back")}
              </Button>
            </Show>
            <Button
              variant={(props.questionIndex ?? 0) >= (props.questionTotal ?? 1) - 1 ? "primary" : "secondary"}
              size="normal"
              onClick={() => props.onQuestionNext?.()}
              disabled={props.questionBusy}
            >
              {(props.questionIndex ?? 0) >= (props.questionTotal ?? 1) - 1
                ? i18n.t("ui.common.submit")
                : i18n.t("ui.common.next")}
            </Button>
          </div>
        </div>
      </Show>

      <Show when={props.showPermission}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "22px 8px 8px",
            opacity: props.questionOpacity,
            filter: `blur(${props.questionBlur}px)`,
            "pointer-events": props.morph < 0.5 ? "none" : "auto",
          }}
        >
          <div />
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button
              variant="ghost"
              size="normal"
              onClick={() => props.onPermissionDecide?.("reject")}
              disabled={props.permissionBusy}
            >
              {i18n.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onPermissionDecide?.("always")}
              disabled={props.permissionBusy}
            >
              {i18n.t("ui.permission.allowAlways")}
            </Button>
            <Button
              variant="primary"
              size="normal"
              onClick={() => props.onPermissionDecide?.("once")}
              disabled={props.permissionBusy}
            >
              {i18n.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}
