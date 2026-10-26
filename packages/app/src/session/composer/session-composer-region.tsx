import { createMemo, Show, type JSX } from "solid-js"
import { SessionElicitationDock } from "@/session/requests/session-elicitation-dock"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import { SessionWebSearchDock } from "@/session/requests/session-websearch-dock"
import type { SessionComposerRegionController } from "./session-composer-region-controller"
import { ComposerMorph, Grow } from "./spring-height"

type SessionComposerRegionState = Pick<
  SessionComposerRegionController["state"],
  | "questionRequest"
  | "elicitationRequest"
  | "websearch"
  | "permissionRequest"
  | "permissionResponding"
  | "decide"
  | "blocked"
>

export type SessionComposerRegionViewController = Pick<
  SessionComposerRegionController,
  "centered" | "onResponseSubmit" | "setDockRef" | "child" | "showComposer"
> & { state: SessionComposerRegionState }

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionViewController
  above?: JSX.Element
  composer: JSX.Element
  subagent: JSX.Element
}) {
  const controller = props.controller
  const face = createMemo(() => {
    const websearch = controller.state.websearch.request()
    const question = controller.state.questionRequest()
    const elicitation = controller.state.elicitationRequest()
    const permission = controller.state.permissionRequest()
    const composer = controller.showComposer() && !controller.child() && !controller.state.blocked()
    return { key: composer ? "composer" : "docks", websearch, question, elicitation, permission, composer }
  })

  return (
    <div
      ref={controller.setDockRef}
      data-component="session-composer-dock"
      class="w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none"
    >
      {/* Only the docks and composer take the pointer; the gaps beside them belong to the timeline underneath. */}
      <div
        classList={{
          "w-full px-3 *:pointer-events-auto": true,
          "md:max-w-session md:mx-auto": controller.centered(),
        }}
      >
        <div class="relative z-[70] flex flex-col">
          {props.above}
          <ComposerMorph face={face()}>
            {(current) => (
              <div class="flex flex-col">
                <Grow when={current().websearch} fade card class={controller.child() ? "mb-2" : undefined}>
                  <SessionWebSearchDock model={controller.state.websearch} onSubmit={controller.onResponseSubmit} />
                </Grow>
                <Grow when={current().question} fade card class={controller.child() ? "mb-2" : undefined}>
                  {(request) => <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />}
                </Grow>

                <Grow when={current().elicitation} fade card class={controller.child() ? "mb-2" : undefined}>
                  {(request) => <SessionElicitationDock request={request} onSubmit={controller.onResponseSubmit} />}
                </Grow>

                <Grow when={current().permission} fade card class={controller.child() ? "mb-2" : undefined}>
                  {(request) => (
                    <SessionPermissionDock
                      request={request}
                      responding={controller.state.permissionResponding()}
                      onDecide={(response) => {
                        controller.onResponseSubmit()
                        controller.state.decide(response)
                      }}
                    />
                  )}
                </Grow>

                <Show when={current().composer}>
                  <div
                    classList={{
                      "relative z-[70]": true,
                    }}
                  >
                    {props.composer}
                  </div>
                </Show>
              </div>
            )}
          </ComposerMorph>
          <Show when={controller.showComposer() && controller.child()}>{props.subagent}</Show>
        </div>
      </div>
    </div>
  )
}
