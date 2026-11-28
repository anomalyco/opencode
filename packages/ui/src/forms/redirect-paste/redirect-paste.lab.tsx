import { createEffect, createSignal, on, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { RedirectPasteForm, type RedirectPasteError } from "./redirect-paste"

type Phase = "editing" | "required" | "rejected" | "submitting" | "accepted"

type Args = { value: string; phase: Phase; rejection: string }

const callback = "http://localhost/callback?code=story-example"

function Preview(props: Args) {
  const [phase, setPhase] = createSignal(props.phase)

  const [value, setValue] = createSignal(props.value)

  createEffect(
    on([() => props.phase, () => props.value], () => {
      setPhase(props.phase)
      setValue(props.value)
    }),
  )

  const locked = () => phase() === "submitting" || phase() === "accepted"

  const error = (): RedirectPasteError | undefined => {
    if (phase() === "required") return { type: "required" }

    if (phase() === "rejected") return { type: "rejected", message: props.rejection }
  }

  return (
    <div class="grid w-96 max-w-full gap-4 text-sm">
      <RedirectPasteForm
        value={value()}
        locked={locked()}
        submitting={phase() === "submitting"}
        error={error()}
        onInput={(next) => {
          setValue(next)
          setPhase("editing")
        }}
        onSubmit={() => {
          if (!locked()) setPhase(value().trim() ? "submitting" : "required")
        }}
      />
      <Show when={phase() === "submitting"}>
        <div class="grid gap-2 border-t border-v2-border-border-base pt-3">
          <p role="status" class="text-xs text-v2-text-text-muted">
            Choose the local callback response.
          </p>
          <div class="flex gap-2">
            <Button size="small" onClick={() => setPhase("accepted")}>
              Accept callback
            </Button>
            <Button size="small" onClick={() => setPhase("rejected")}>
              Reject callback
            </Button>
          </div>
        </div>
      </Show>
      <Show when={phase() === "accepted"}>
        <div class="flex items-center gap-3">
          <p role="status">Callback accepted.</p>
          <Button
            size="small"
            onClick={() => {
              setValue("")
              setPhase("editing")
            }}
          >
            Start again
          </Button>
        </div>
      </Show>
    </div>
  )
}

export default {
  title: "UI/RedirectPasteForm",
  id: "ui-redirect-paste-form",
  component: Preview,
  args: {
    value: "",
    phase: "editing",
    rejection: "This callback has expired. Paste the new redirect URL.",
  } satisfies Args,
  argTypes: { phase: { control: "select", options: ["editing", "required", "rejected", "submitting", "accepted"] } },
}

export const Empty = {}

export const ReadyToSubmit = { args: { value: callback } }

export const Required = { args: { phase: "required" } }

export const Rejected = { args: { value: callback, phase: "rejected" } }

export const Submitting = { args: { value: callback, phase: "submitting" } }

export const Locked = { args: { value: callback, phase: "accepted" } }
