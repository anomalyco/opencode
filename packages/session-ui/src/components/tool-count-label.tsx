import { createMemo } from "solid-js"
import { AnimatedNumber } from "@opencode-ai/ui/animated-number"
import { useI18n, type UiI18nPluralKey } from "@opencode-ai/ui/context/i18n"

export function AnimatedCountLabel(props: { count: number; plural: UiI18nPluralKey; class?: string }) {
  const i18n = useI18n()
  const parts = createMemo(() =>
    i18n.pluralParts(props.plural, Math.round(props.count), {
      count: <AnimatedNumber value={props.count} />,
    }),
  )

  return (
    <span data-component="tool-count-label" class={props.class}>
      {parts()}
    </span>
  )
}
