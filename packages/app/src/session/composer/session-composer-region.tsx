import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

type SessionComposerRegionState = Pick<
  SessionComposerRegionController["state"],
  "questionRequest" | "permissionRequest" | "permissionResponding" | "decide" | "blocked"
>

export type SessionComposerRegionViewController = Pick<
  SessionComposerRegionController,
  | "centered"
  | "onResponseSubmit"
  | "openParent"
  | "setPromptRef"
  | "setDockRef"
  | "parentID"
  | "child"
  | "showComposer"
> & { state: SessionComposerRegionState }

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionViewController
  composer: JSX.Element
}) {
  const language = useLanguage()
  const controller = props.controller
  return (
    <div
      ref={controller.setDockRef}
      data-component="session-composer-dock"
      class="w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none bg-v2-background-bg-base"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": controller.centered(),
        }}
      >
        <Show when={controller.state.questionRequest()} keyed>
          {(request) => (
            <div>
              <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show when={controller.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={controller.state.permissionResponding()}
                onDecide={(response) => {
                  controller.onResponseSubmit()
                  controller.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        <Show when={controller.showComposer()}>
          <div
            classList={{
              "relative z-[70]": true,
            }}
          >
            <Show
              when={controller.child()}
              fallback={<Show when={!controller.state.blocked()}>{props.composer}</Show>}
            >
              <div
                ref={controller.setPromptRef}
                class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak"
              >
                <span>{language.t("session.child.promptDisabled")} </span>
                <Show when={controller.parentID()}>
                  <button
                    type="button"
                    class="text-text-base transition-colors hover:text-text-strong"
                    onClick={controller.openParent}
                  >
                    {language.t("session.child.backToParent")}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
