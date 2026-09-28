import { Index, createMemo } from "solid-js"
import { useI18n, type UiI18nPluralKey } from "@opencode/ui/context"
import { AnimatedCountLabel } from "./tool-count-label"

export type CountItem = {
  key: UiI18nPluralKey
  count: number
}

export function AnimatedCountList(props: { items: CountItem[]; fallback?: string; class?: string }) {
  const i18n = useI18n()
  const firstPositive = createMemo(() => props.items.findIndex((item) => item.count > 0))
  const active = createMemo(() => props.items.flatMap((item, index) => (item.count > 0 ? [index] : [])))
  const fallback = createMemo(() => props.fallback ?? "")
  const showEmpty = createMemo(() => firstPositive() === -1 && fallback().length > 0)

  return (
    <span data-component="tool-count-summary" class={props.class}>
      <span data-slot="tool-count-summary-empty" data-active={showEmpty() ? "true" : "false"}>
        <span data-slot="tool-count-summary-empty-inner">{fallback()}</span>
      </span>

      <Index each={props.items}>
        {(item, index) => {
          const visible = createMemo(() => item().count > 0)
          const position = createMemo(() => active().indexOf(index))
          return (
            <>
              <span data-slot="tool-count-summary-prefix" data-active={visible() && position() > 0 ? "true" : "false"}>
                {i18n.listSeparator(position(), active().length)}
              </span>
              <span data-slot="tool-count-summary-item" data-active={visible() ? "true" : "false"}>
                <span data-slot="tool-count-summary-item-inner">
                  <AnimatedCountLabel plural={item().key} count={Math.max(0, Math.round(item().count))} />
                </span>
              </span>
            </>
          )
        }}
      </Index>
    </span>
  )
}
