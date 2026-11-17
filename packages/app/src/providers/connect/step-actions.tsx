import { Button } from "@opencode/ui/button"
import { Spinner } from "@opencode/ui/spinner"
import type { JSX } from "solid-js"

// Secondary actions first, the main action furthest right.
export function StepActions(props: { children: JSX.Element }) {
  return <div class="flex flex-wrap items-center justify-end gap-2 self-stretch">{props.children}</div>
}

// The main action while the sign-in finishes elsewhere: the browser, a command, or the Claude Code check.
export function WaitingButton(props: { children: JSX.Element }) {
  return (
    <Button variant="loading" class="!ps-1.5" aria-busy="true" aria-live="polite">
      <Spinner width={16} class="text-v2-icon-icon-muted" />
      {props.children}
    </Button>
  )
}
