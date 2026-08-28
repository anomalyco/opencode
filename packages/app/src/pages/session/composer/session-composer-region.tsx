import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionController
  promptInput: JSX.Element
}) {
  const language = useLanguage()
  const controller = props.controller
  const settings = useSettings()
  const rolled = () => {
    const revert = controller.revert()
    return revert?.items.length ? revert : undefined
  }

  return (
    <div
      ref={controller.setDockRef}
      data-component="session-prompt-dock"
      classList={{
        "w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none": true,
        "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
        "bg-background-stronger": !settings.general.newLayoutDesigns(),
      }}
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
          <Show when={controller.dock()}>
            <div
              classList={{
                "overflow-hidden": true,
                "pointer-events-none": controller.dockProgress() < 0.98,
              }}
              style={{
                "max-height": `${controller.dockHeight() * controller.dockProgress()}px`,
              }}
            >
              <div ref={controller.setDockBodyRef}>
                <SessionTodoDock
                  todos={controller.state.todos()}
                  collapsed={controller.todo.collapsed()}
                  onToggle={controller.todo.onToggle}
                  collapseLabel={language.t("session.todo.collapse")}
                  expandLabel={language.t("session.todo.expand")}
                  dockProgress={controller.dockProgress()}
                />
              </div>
            </div>
          </Show>
          <Show
            when={controller.promptReady()}
            fallback={
              <>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div class="pb-2">
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div
                  class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none"
                  style={{ "margin-top": `${-36 * controller.dockProgress()}px` }}
                >
                  {controller.handoffPrompt() || language.t("prompt.loading")}
                </div>
              </>
            }
          >
            <Show when={rolled()} keyed>
              {(revert) => (
                <div
                  style={{
                    "margin-top": `${-36 * controller.dockProgress()}px`,
                  }}
                >
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-[70]": true,
              }}
              style={{
                "margin-top": `${-controller.lift()}px`,
              }}
            >
              <Show when={controller.followup()?.items.length}>
                <SessionFollowupDock
                  items={controller.followup()!.items}
                  sending={controller.followup()!.sending}
                  onSend={controller.followup()!.onSend}
                  onEdit={controller.followup()!.onEdit}
                />
              </Show>
              <Show
                when={controller.child()}
                fallback={<Show when={!controller.state.blocked()}>{props.promptInput}</Show>}
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
        </Show>
      </div>
    </div>
  )
}
