import { Show, createMemo, createSignal } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { showToast } from "@/utils/toast"

export function SessionBudget() {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const { params } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))
  const budget = createMemo(() => info()?.budget)
  const cost = createMemo(() => info()?.cost ?? 0)
  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  let inputRef!: HTMLInputElement

  const usage = createMemo(() => {
    const limit = budget()
    if (!limit) return 0
    return Math.max(0, Math.min(1, cost() / limit))
  })

  const startEdit = () => {
    setDraft(budget() !== undefined ? String(budget()) : "")
    setEditing(true)
    requestAnimationFrame(() => {
      inputRef?.focus()
      inputRef?.select()
    })
  }

  const cancelEdit = () => {
    setEditing(false)
  }

  const apply = async (next: number | undefined) => {
    const sessionID = params.id
    const current = info()
    if (!sessionID || !current) return
    const previous = current.budget
    sync().session.remember({ ...current, budget: next })
    try {
      await sdk().client.session.update({ sessionID, budget: next ?? null })
    } catch (err) {
      sync().session.remember({ ...current, budget: previous })
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  const save = () => {
    const raw = draft().trim()
    if (!raw) {
      void apply(undefined)
      setEditing(false)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) return
    void apply(parsed)
    setEditing(false)
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <div class="text-12-regular text-text-weak">{language.t("context.budget.title")}</div>
        <div class="flex items-center gap-1">
          <Show when={budget() !== undefined && !editing()}>
            <Button
              size="small"
              variant="ghost"
              class="gap-1 px-1.5 text-text-weak hover:text-text-base"
              onClick={() => void apply(undefined)}
            >
              {language.t("context.budget.clear")}
            </Button>
          </Show>
          <Button
            size="small"
            variant="ghost"
            class="gap-1 px-1.5 text-text-weak hover:text-text-base"
            onClick={startEdit}
          >
            <Icon name="edit" size="small" />
          </Button>
        </div>
      </div>

      <Show
        when={editing()}
        fallback={
          <div class="text-12-medium text-text-strong">
            {budget() !== undefined
              ? `${usd().format(cost())} / ${usd().format(budget()!)}`
              : language.t("context.budget.unset")}
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1 rounded-md border border-border-base bg-surface-base px-2 py-1">
            <span class="text-12-regular text-text-weak">$</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  save()
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  cancelEdit()
                }
              }}
              onBlur={save}
              class="w-20 bg-transparent text-12-medium text-text-strong focus:outline-none"
              aria-label={language.t("context.budget.edit")}
            />
          </div>
        </div>
      </Show>

      <Show when={budget() !== undefined}>
        <div class="h-1.5 w-full rounded-full bg-surface-base overflow-hidden">
          <div
            class="h-full rounded-full"
            classList={{
              "bg-syntax-warning": usage() >= 1,
              "bg-text-text-base": usage() < 1,
            }}
            style={{ width: `${usage() * 100}%` }}
          />
        </div>
      </Show>
    </div>
  )
}
