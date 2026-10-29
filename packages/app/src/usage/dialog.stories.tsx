import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { UsageDialogContent } from "./dialog"
import type { CurrentModel } from "./limits"

const resetsAt = Date.UTC(2026, 10, 1)
const hour = 3_600_000

const opus = { providerID: "opencode", modelID: "claude-opus-5", name: "Claude Opus 5" }
const sonnet = { providerID: "opencode", modelID: "claude-sonnet-5", name: "Claude Sonnet 5" }

const budget = (input: Partial<UsageLimitsBudget> & Pick<UsageLimitsBudget, "id">): UsageLimitsBudget => ({
  limit: 150,
  spent: 0,
  scope: "each",
  per: "set",
  coverage: "all",
  models: [],
  vendors: [],
  picked: false,
  shared: false,
  resetsAt,
  ...input,
})

const anthropic = (spent: number) =>
  budget({ id: "anthropic", coverage: "models", vendors: ["Anthropic"], models: [opus, sonnet], spent })

const pool = (spent: number) => budget({ id: "pool", scope: "combined", shared: true, limit: 1_000, spent })

const info = (budgets: UsageLimitsBudget[], go = false): UsageLimitsInfo => ({
  workspace: { id: "wrk_1", name: "Acme", usageURL: "https://opencode.ai/wrk_1/activity/overview" },
  ...(go
    ? {
        go: {
          rolling: { percent: 42, limited: false, resetsAt: Date.now() + 3 * hour },
          weekly: { percent: 18, limited: false, resetsAt: Date.now() + 100 * hour },
          monthly: { percent: 7, limited: false, resetsAt: Date.now() + 500 * hour },
        },
      }
    : {}),
  budgets,
})

function UsageStory(props: { info: UsageLimitsInfo; model?: CurrentModel; credits?: boolean }) {
  const dialog = useDialog()
  const open = () => dialog.show(() => <UsageDialogContent {...props} onSwitchModel={() => {}} />)

  onMount(open)

  return (
    <div class="flex min-h-[560px] items-end justify-center">
      <Button variant="ghost-muted" onClick={open}>
        Usage
      </Button>
    </div>
  )
}

export default {
  title: "App/Dialogs/Usage",
  id: "app-dialog-usage",
}

export const Default = { render: () => <UsageStory info={info([anthropic(123.14), pool(394.57)], true)} /> }

export const PerModel = {
  render: () => (
    <UsageStory
      model={opus}
      info={info([
        budget({
          id: "each",
          coverage: "models",
          per: "model",
          limit: 20,
          spent: 20,
          picked: true,
          models: [
            { ...opus, spent: 20 },
            { ...sonnet, spent: 4.5 },
          ],
        }),
      ])}
    />
  ),
}

export const ModelBudgetReached = {
  render: () => <UsageStory model={opus} info={info([anthropic(150.42), pool(394.57)])} />,
}

export const WorkspaceBudgetReached = { render: () => <UsageStory info={info([anthropic(80), pool(1_000.12)])} /> }

export const OutOfCredits = { render: () => <UsageStory credits info={info([anthropic(80), pool(394.57)])} /> }

export const NoBudgets = { render: () => <UsageStory info={info([])} /> }
