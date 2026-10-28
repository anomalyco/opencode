import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { Dynamic } from "solid-js/web"
import { createMediaQuery } from "@solid-primitives/media"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Slash } from "@opencode/ui/slash"
import { Tooltip } from "@opencode/ui/tooltip"
import { ComposerEditor } from "./editor/editor"
import { DialogSelectModel, ModelSelectorDrawer } from "@/providers/models/select-dialog"
import { DialogSelectModelNext, ModelSelectorDrawerNext } from "@/providers/models/select-dialog-next"
import { useSettings } from "@/settings/model"
import { DialogSelectModelUnpaid } from "@/providers/models/unpaid"
import { formatKeybind, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerModel } from "./model"
import type { ComposerModelLabel } from "./model-label"

export function Composer(props: {
  class?: string
  model: ComposerModel
  borderUnderlay?: boolean
  readOnly?: boolean
  suggestionBoundary?: () => HTMLElement | undefined
}) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()

  const modelName = () => {
    const preview = props.model.model.preview

    if (preview) return preview.model
    const selection = props.model.model.selection
    const model = selection.current()

    if (model) return model.name
    const key = selection.key()

    if (key) return language.t("dialog.model.unavailable", { model: key.modelID })

    return language.t("dialog.model.select.title")
  }

  const modelLabel = () => {
    const preview = props.model.model.preview
    const label = preview ? preview.label : props.model.model.label

    if (label) return label

    return { provider: preview ? preview.provider : props.model.model.providerName, model: modelName() }
  }

  return (
    <div class="flex flex-col gap-3">
      <ComposerEditor
        controller={props.model}
        borderUnderlay={props.borderUnderlay}
        readOnly={props.readOnly}
        class={props.class}
        modelControlsVisible={!props.model.model.loading || !!props.model.model.preview}
        attachKeybind={command.keybindParts("file.attach")}
        attachShortcut={command.keybind("file.attach")}
        alternateKeybind={[formatKeybind("mod", language.t), "↵"]}
        exitShellKeybind={[formatKeybind("esc", language.t)]}
        suggestionBoundary={props.suggestionBoundary}
        modelControl={
          <ComposerModelControl
            loading={props.model.model.loading}
            preview={!!props.model.model.preview}
            paid={props.model.model.paid}
            title={language.t("command.model.choose")}
            keybind={command.keybindParts("model.choose")}
            model={props.model.model.selection}
            label={modelLabel()}
            onClose={props.model.restoreFocus}
            onUnpaidClick={() => dialog.show(() => <DialogSelectModelUnpaid model={props.model.model.selection} />)}
          />
        }
      />
    </div>
  )
}

function ComposerModelControl(props: {
  loading: boolean
  preview: boolean
  paid: boolean
  title: string
  keybind: string[]
  model: ComposerModel["model"]["selection"]
  label: ComposerModelLabel
  onClose: () => void
  onUnpaidClick: () => void
}) {
  // A preview paints the chip in its resting state, and the loaded names replace it in place.
  const shouldAnimate = createMemo<boolean>((previous) => previous ?? (props.loading && !props.preview))
  const mobile = createMediaQuery("(max-width: 767px)")
  const dialog = useDialog()
  const settings = useSettings()

  const open = (detail: number) => {
    if (!props.paid) return props.onUnpaidClick()
    const Picker = settings.general.newModelPicker() ? DialogSelectModelNext : DialogSelectModel
    // A pointer open keeps focus in the composer, so the dialog returns it to the caret. A keyboard open
    // (a click with no pointer presses) returns focus to this trigger instead of moving it to the editor.
    void dialog.show(() => <Picker model={props.model} />, detail === 0 ? undefined : props.onClose)
  }

  // A previewed chip is visible before the catalog loads, so a click on it opens the dialog once loading finishes.
  const [deferred, setDeferred] = createSignal<number>()

  createEffect(() => {
    const detail = deferred()

    if (props.loading || detail === undefined) return
    setDeferred(undefined)
    open(detail)
  })

  const content = () => (
    <>
      <span class="flex min-w-0 whitespace-nowrap leading-4">
        <Show when={props.label.provider}>
          {(name) => (
            <>
              <bdi class="min-w-0 shrink-[2] truncate text-v2-text-text-faint">{name()}</bdi>
              <Slash />
              <span class="sr-only">{" / "}</span>
            </>
          )}
        </Show>
        <bdi class="min-w-0 truncate">{props.label.model}</bdi>
      </span>
      <span class="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )

  return (
    <Show when={!props.loading || props.preview}>
      <Tooltip
        inactive={mobile()}
        placement="top"
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind} variant="neutral" />
          </>
        }
      >
        {/* While loading, the drawer would open on a catalog that isn't there yet, so the inert chip stands in. */}
        <Show
          when={mobile() && !props.loading}
          fallback={
            <Button
              data-action="composer-model"
              data-control-type="dialog"
              variant="ghost-muted"
              size="normal"
              class="min-w-0 max-w-[60cqw] justify-start ![font-weight:440]"
              classList={{ "animate-in fade-in": shouldAnimate() }}
              style={{ height: "28px" }}
              onMouseDown={(event: MouseEvent) => event.preventDefault()}
              onClick={(event: MouseEvent) => {
                if (!props.loading) return open(event.detail)

                // On mobile this inert chip stands in for the drawer trigger, so a click there is dropped.
                if (!mobile()) setDeferred(event.detail)
              }}
            >
              {content()}
            </Button>
          }
        >
          <Dynamic
            component={settings.general.newModelPicker() ? ModelSelectorDrawerNext : ModelSelectorDrawer}
            model={props.model}
            trigger={(triggerProps) => (
              <Button
                {...triggerProps}
                variant="ghost-muted"
                size="normal"
                style={{ height: "28px" }}
                class="min-w-0 max-w-[60cqw] justify-start ![font-weight:440]"
                classList={{ "animate-in fade-in": shouldAnimate() }}
                data-action="composer-model"
                data-control-type="drawer"
              >
                {content()}
              </Button>
            )}
            onClose={props.onClose}
          />
        </Show>
      </Tooltip>
    </Show>
  )
}
