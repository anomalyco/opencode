// The product switcher: the pill at the titlebar's start that swaps the whole shell between
// OpenCode (the session surface) and Trading (the desk), the way Claude and Claude Code read
// as one active product. It only marks the active product and asks to move; navigation stays
// in the tabs store (toggleHome / toggleTrading), called from the titlebar.
import { Show, createSignal } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"

export function ProductSwitcher(props: { trading: boolean; aOpenCode: () => void; aTrading: () => void }) {
  const language = useLanguage()

  // Kobalte keeps a radio menu open after selecting, so the switcher owns the open state and folds
  // itself as soon as a product is picked: one click swaps, one click closes.
  const [abierto, setAbierto] = createSignal(false)

  return (
    <Menu placement="bottom-start" gutter={4} open={abierto()} onOpenChange={setAbierto}>
      <Menu.Trigger
        data-action="product-switcher"
        aria-label={language.t("product.switch")}
        class="flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-hover data-[expanded]:text-v2-text-text-base [app-region:no-drag]"
      >
        <Show when={props.trading} fallback={<Icon name="grid-plus" class="shrink-0 text-v2-icon-icon-muted" />}>
          <Icon name="trading-chart" class="shrink-0 text-v2-icon-icon-muted" />
        </Show>
        <span class="min-w-0 max-w-24 truncate">{props.trading ? language.t("trading.title") : language.t("product.openCode")}</span>
        <Icon name="chevron-down" class="shrink-0 text-v2-icon-icon-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content class="min-w-44" aria-label={language.t("product.switch")}>
          <Menu.RadioGroup
            value={props.trading ? "trading" : "opencode"}
            onChange={(value) => {
              value === "trading" ? props.aTrading() : props.aOpenCode()
              setAbierto(false)
            }}
          >
            <Menu.RadioItem value="opencode">
              <Icon name="grid-plus" class="shrink-0 text-v2-icon-icon-muted" />
              {language.t("product.openCode")}
            </Menu.RadioItem>
            <Menu.RadioItem value="trading">
              <Icon name="trading-chart" class="shrink-0 text-v2-icon-icon-muted" />
              {language.t("trading.title")}
            </Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
