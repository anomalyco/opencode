import type { UsageLimitsGo } from "@opencode/client/promise"
import { Menu } from "@opencode/ui/menu"
import { For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { Track } from "./dialog"
import { useUsageFormat } from "./format"
import { goMeter, goRows, type GoRow } from "./limits"
import "./go-meter.css"

// The 5-hour window: 2px dashes 2px apart that divide the meter's 26px evenly.
const DASHES = 7

const WIDTH = DASHES * 4 - 2

// The dashes stand taller than the 2px weekly line beneath them, 2px apart. An even total keeps the meter on whole
// pixels when the row centres it.
const DASH_HEIGHT = 4

const HEIGHT = DASH_HEIGHT + 4

/**
 * The OpenCode Go allowance on the model picker's OpenCode row: the 5-hour and weekly windows and the highest one in
 * words, opening every window and the way to the Usage dialog. Go usage shows only here, not in the composer.
 */
export function GoMeter(props: { go: UsageLimitsGo; onViewAll: () => void }) {
  const language = useLanguage()
  const format = useUsageFormat()
  const meter = () => goMeter(props.go)
  const rows = () => goRows(props.go)

  const status = () => {
    const value = meter()

    if (value.kind === "limited") return language.t("usage.go.meter.resets", { time: format.clock(value.resetsAt) })

    return language.t("usage.go.used", { percent: Math.round(value.percent) })
  }

  return (
    <Menu gutter={6} modal={false} placement="bottom-end">
      <Menu.Trigger
        as="button"
        type="button"
        data-slot="go-meter-trigger"
        data-state={meter().kind}
        aria-label={language.t("usage.go.meter.label", { status: status() })}
      >
        <GoMeterBars rolling={rows()[0]} weekly={rows()[1]} />
        <span class="truncate tabular-nums">{status()}</span>
      </Menu.Trigger>
      <Menu.Portal>
        {/* A menu like any other: the windows are rows that only report, then the way to the Usage dialog. Escape
            closes the menu, not the picker under it. */}
        <Menu.Content data-slot="go-meter-popover" data-owns-escape="">
          <Menu.Group>
            <Menu.GroupLabel>{language.t("usage.section.go")}</Menu.GroupLabel>
            <For each={rows()}>
              {(row) => (
                <div role="presentation">
                  <div data-component="menu-v2-item" data-appearance="compact">
                    <span data-slot="menu-v2-item-content" class="normal-nums">
                      {language.t(`usage.go.window.${row.window}`)}
                    </span>
                    <span data-slot="menu-v2-item-shortcut" classList={{ "text-[var(--usage-reached)]!": row.limited }}>
                      {language.t("usage.go.used", { percent: Math.round(row.percent) })}
                    </span>
                  </div>
                  {/* The item's own insets, so the bar and reset time line up with its text. */}
                  <div class="flex flex-col gap-1.5 ps-3 pe-1.5 pb-2">
                    <Track fill={row.percent / 100} reached={row.limited} />
                    <span class="text-[11px] leading-4 font-[530] tracking-[0.05px] text-v2-text-text-faint">
                      {language.t("usage.go.resetsIn", { duration: format.duration(row.resetsAt) })}
                    </span>
                  </div>
                </div>
              )}
            </For>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Item onSelect={props.onViewAll}>{language.t("usage.go.viewAll")}</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

/**
 * The 5-hour window as a dashed line over the weekly window as a solid one, so the two read apart without labels and
 * the shorter window, which moves in larger steps, gets the coarser mark. Both snap to whole pixels: the dashes fill to
 * the nearest dash, at least one while anything is used, and the solid fill rounds to a pixel.
 */
function GoMeterBars(props: { rolling: GoRow; weekly: GoRow }) {
  const filled = () =>
    props.rolling.percent > 0 ? Math.max(1, Math.round((Math.min(100, props.rolling.percent) / 100) * DASHES)) : 0

  const weekly = () => Math.round((Math.min(100, props.weekly.percent) / 100) * WIDTH)

  // An SVG with crisp edges: the label beside it has a fractional width, so boxes would land between pixels and blur.
  return (
    <svg data-slot="go-meter-bars" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <g data-limited={props.rolling.limited ? "" : undefined}>
        <For each={Array.from({ length: DASHES }, (_, index) => index)}>
          {(index) => (
            <rect
              data-slot="go-meter-dash"
              data-filled={index < filled() ? "" : undefined}
              x={index * 4}
              y="0"
              width="2"
              height={DASH_HEIGHT}
            />
          )}
        </For>
      </g>
      <g data-limited={props.weekly.limited ? "" : undefined}>
        <rect data-slot="go-meter-dash" x="0" y={HEIGHT - 2} width={WIDTH} height="2" />
        <rect data-slot="go-meter-dash" data-filled="" x="0" y={HEIGHT - 2} width={weekly()} height="2" />
      </g>
    </svg>
  )
}
