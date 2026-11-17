import { useI18n } from "@opencode/ui/context/i18n"
import { BasicTool } from "../components/basic-tool"
import { Show, type JSX } from "solid-js"

/** Outer whole-turn disclosure around one or more response phases. */
export function WorkStepsDisclosure(props: {
  first: boolean
  live: boolean
  open: boolean
  phaseOpen: boolean
  onOpenChange: (open: boolean) => void
  children: JSX.Element
}) {
  const i18n = useI18n()

  return (
    <Show
      when={props.first}
      fallback={
        <Show when={props.open}>
          <div data-component="work-steps-phase" data-work-phase-open={props.phaseOpen ? "" : undefined}>
            {props.children}
          </div>
        </Show>
      }
    >
      <div data-component="work-steps-disclosure" data-work-turn-open={props.open ? "" : undefined}>
        <BasicTool
          icon="glasses"
          status={props.live ? "running" : "completed"}
          compact
          hasContent
          allowOpenWhilePending
          open={props.open}
          onOpenChange={props.onOpenChange}
          trigger={{
            title: i18n.t(props.live ? "ui.sessionTurn.status.working" : "ui.timeline.activity.workedUnknown"),
          }}
        >
          <div data-component="work-steps-phases" data-work-phase-open={props.phaseOpen ? "" : undefined}>
            {props.children}
          </div>
        </BasicTool>
      </div>
    </Show>
  )
}
