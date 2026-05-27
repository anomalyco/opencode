import { For, Show, createMemo } from "solid-js"

export type WorkflowStep = {
  name: string
  action: string
  description: string
  status: "pending" | "active" | "completed" | "error"
}

type WorkflowStepperProps = {
  steps: WorkflowStep[]
  workflowName?: string
}

export function WorkflowStepper(props: WorkflowStepperProps) {
  const currentStepIndex = createMemo(() =>
    props.steps.findIndex((s) => s.status === "active"),
  )

  const completedCount = createMemo(() =>
    props.steps.filter((s) => s.status === "completed").length,
  )

  const progress = createMemo(() =>
    props.steps.length > 0
      ? Math.round(((completedCount() + (currentStepIndex() >= 0 ? 0.5 : 0)) / props.steps.length) * 100)
      : 0,
  )

  return (
    <div class="flex flex-col gap-3 p-4">
      {/* Header */}
      <Show when={props.workflowName}>
        <div class="flex items-center justify-between">
          <div class="text-14-medium text-text-strong">{props.workflowName}</div>
          <div class="text-12-regular text-text-weak">
            {completedCount()}/{props.steps.length}
          </div>
        </div>
      </Show>

      {/* Progress bar */}
      <div class="h-1.5 bg-background-stronger rounded-full overflow-hidden">
        <div
          class="h-full bg-accent-base rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress()}%` }}
        />
      </div>

      {/* Steps */}
      <div class="flex flex-col gap-1">
        <For each={props.steps}>
          {(step, index) => (
            <div
              class="flex items-start gap-3 px-3 py-2 rounded-lg transition-colors"
              classList={{
                "bg-background-stronger": step.status === "active",
                "opacity-50": step.status === "pending",
              }}
            >
              {/* Step indicator */}
              <div
                class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-12-medium mt-0.5"
                classList={{
                  "bg-accent-base text-text-inverted": step.status === "active",
                  "bg-accent-base/20 text-accent-base": step.status === "completed",
                  "bg-background-stronger text-text-weak border border-border-weaker-base": step.status === "pending",
                  "bg-error-base/20 text-error-base": step.status === "error",
                }}
              >
                <Show
                  when={step.status === "completed"}
                  fallback={
                    <Show when={step.status !== "error"} fallback={"!"}>
                      {index() + 1}
                    </Show>
                  }
                >
                  ✓
                </Show>
              </div>

              {/* Step info */}
              <div class="flex-1 min-w-0">
                <div
                  class="text-13-medium truncate"
                  classList={{
                    "text-text-strong": step.status === "active" || step.status === "completed",
                    "text-text-weak": step.status === "pending",
                  }}
                >
                  {step.name}
                </div>
                <Show when={step.status === "active"}>
                  <div class="text-12-regular text-text-weak mt-0.5">
                    {step.description}
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
