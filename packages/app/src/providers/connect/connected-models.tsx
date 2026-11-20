import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Loader } from "@opencode/ui/loader"
import { createMemo, createSignal, Match, onCleanup, Switch, untrack } from "solid-js"
import { DialogSelectModel } from "@/providers/models/select-dialog"
import type { ModelSelection } from "@/providers/models/selection"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import type { DraftTab, useTabs } from "@/shell/tabs/tabs"
import { useChatgptPlanWelcome } from "./chatgpt-welcome"
import { useConnectionRefresh } from "./connection-refresh"
import {
  selectConnectedModelsEmpty,
  startConnectedModels,
  transitionConnectedModels,
  type ConnectedModelsEffect,
  type ConnectedModelsEvent,
} from "./connected-models-machine"
import { CONSOLE_INTEGRATION } from "./dialog-machine"

/** What a first connection hands to the model picker it opens. */
export type ConnectedModelsPick = {
  readonly integration: string
  /** The Location the sign-in belongs to; undefined is the server's default. */
  readonly directory: string | undefined
  readonly settle: boolean
  readonly welcome: boolean
}

type Tabs = ReturnType<typeof useTabs>

/**
 * A connection made outside a composer opens a new session, whose composer opens the picker once it is ready. The
 * request is left before the draft opens, so its screen finds it however soon it mounts.
 */
export function requestDraftModels(tabs: Tabs, draft: DraftTab, pick: ConnectedModelsPick) {
  draftPick(tabs, draft).pick = pick
}

export function takeDraftModels(tabs: Tabs, draft: DraftTab) {
  const slot = draftPick(tabs, draft)
  const pick = slot.pick
  slot.pick = undefined

  return pick
}

function draftPick(tabs: Tabs, draft: DraftTab) {
  return tabs.state<{ pick?: ConnectedModelsPick }>(draft, "connected-models", () => ({}))
}

export function showConnectedModels(
  dialog: ReturnType<typeof useDialog>,
  pick: ConnectedModelsPick,
  model?: ModelSelection,
  onClose?: () => void,
) {
  return dialog.show(() => <DialogConnectedModels {...pick} model={model} />, onClose)
}

/**
 * The model picker, filtered to the integration that just connected. It opens at once and loads the catalogs the
 * sign-in changed while it is open, so the models appear as they arrive.
 */
export function DialogConnectedModels(props: ConnectedModelsPick & { model?: ModelSelection }) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const refresh = useConnectionRefresh(props.directory)
  const showWelcome = useChatgptPlanWelcome()
  const start = startConnectedModels()
  const [state, setState] = createSignal(start.state)

  const dispatch = (event: ConnectedModelsEvent) => {
    const next = transitionConnectedModels(untrack(state), event)
    setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: ConnectedModelsEffect) =>
    void refresh({ integrationID: props.integration, settle: props.settle }).then((outcome) =>
      dispatch({ type: "refresh.settled", attempt: effect.attempt, outcome }),
    )

  start.effects.forEach(run)
  onCleanup(() => dispatch({ type: "disposed" }))

  const empty = createMemo(() => selectConnectedModelsEmpty(state(), props.integration === CONSOLE_INTEGRATION))

  const choose = () => {
    if (!props.welcome) return dialog.close()
    void showWelcome().then((shown) => {
      if (!shown) dialog.close()
    })
  }

  const refreshButton = () => (
    <Button variant="submit" onClick={() => dispatch({ type: "refresh.requested" })}>
      {language.t("provider.connect.console.refresh")}
    </Button>
  )

  return (
    <DialogSelectModel
      integration={props.integration}
      model={props.model}
      onChoose={choose}
      empty={
        <div
          role="status"
          data-component="connected-models-empty"
          class="flex max-w-96 flex-col items-center gap-4 px-4 text-center"
        >
          <Switch>
            <Match when={empty().kind === "loading"}>
              <span class="flex items-center gap-2">
                <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
                {language.t("provider.connect.models.loading")}
              </span>
            </Match>
            <Match when={empty().kind === "failed"}>
              <p>
                {language.t(
                  props.integration === CONSOLE_INTEGRATION
                    ? "provider.connect.console.refreshFailed"
                    : "provider.connect.models.refreshFailed",
                )}
              </p>
              {refreshButton()}
            </Match>
            <Match when={empty().kind === "pending"}>
              <p>{language.t("provider.connect.console.modelsLoading")}</p>
              {refreshButton()}
            </Match>
            <Match when={empty().kind === "console"}>
              <p>{language.t("provider.connect.console.noModels")}</p>
              <div class="flex items-center gap-2">
                <Button variant="ghost" onClick={() => platform.openExternal("https://opencode.ai/console")}>
                  {language.t("provider.connect.console.openAgain")}
                </Button>
                {refreshButton()}
              </div>
            </Match>
            <Match when={empty().kind === "none"}>
              <p>{language.t("provider.connect.models.empty")}</p>
              {refreshButton()}
            </Match>
          </Switch>
        </div>
      }
    />
  )
}
