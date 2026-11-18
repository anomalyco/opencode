import { For, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"
import {
  DEFAULT_RECENT_VIEW,
  RECENT_DIRECTIONS,
  RECENT_GROUP_BYS,
  RECENT_SORT_BYS,
  type RecentView,
} from "./recent-view"

/** Recent's Group and sort menu, opened from the icon on its headings. */
export function RecentViewMenu(props: {
  view: RecentView
  onChange: (next: Partial<RecentView>) => void
  onViewAll: () => void
}): JSX.Element {
  const language = useLanguage()

  const isDefault = () =>
    props.view.groupBy === DEFAULT_RECENT_VIEW.groupBy &&
    props.view.sortBy === DEFAULT_RECENT_VIEW.sortBy &&
    props.view.direction === DEFAULT_RECENT_VIEW.direction &&
    props.view.metadata === DEFAULT_RECENT_VIEW.metadata &&
    props.view.emptyGroups === DEFAULT_RECENT_VIEW.emptyGroups &&
    props.view.collapsed.length === 0

  return (
    <Menu gutter={4} modal={false} placement="bottom-end">
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size="small"
        data-slot="recent-view-trigger"
        aria-label={language.t("sidebar.recent.view.options")}
        icon={<Icon name="sliders" />}
      />
      <Menu.Portal>
        <Menu.Content class="min-w-[200px]">
          <Menu.Sub gutter={4} overflowPadding={16} overlap>
            <SubTrigger label={language.t("sidebar.recent.view.groupBy")}>
              {language.t(`sidebar.recent.view.groupBy.${props.view.groupBy}`)}
            </SubTrigger>
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[160px]">
                <Menu.RadioGroup
                  value={props.view.groupBy}
                  onChange={(value) => {
                    const next = value === "none" ? value : RECENT_GROUP_BYS.find((item) => item === value)

                    if (next) props.onChange({ groupBy: next })
                  }}
                >
                  <For each={RECENT_GROUP_BYS}>
                    {(value) => (
                      <Menu.RadioItem value={value}>
                        {language.t(`sidebar.recent.view.groupBy.${value}`)}
                      </Menu.RadioItem>
                    )}
                  </For>
                  <Menu.Separator />
                  <Menu.RadioItem value="none">{language.t("sidebar.recent.view.groupBy.none")}</Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub gutter={4} overflowPadding={16} overlap>
            <SubTrigger label={language.t("sidebar.recent.view.sortBy")}>
              {language.t(`sidebar.recent.view.sortBy.${props.view.sortBy}`)}
            </SubTrigger>
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[160px]">
                <Menu.RadioGroup
                  value={props.view.sortBy}
                  onChange={(value) => {
                    const next = RECENT_SORT_BYS.find((item) => item === value)

                    if (next) props.onChange({ sortBy: next })
                  }}
                >
                  <For each={RECENT_SORT_BYS}>
                    {(value) => (
                      <Menu.RadioItem value={value}>{language.t(`sidebar.recent.view.sortBy.${value}`)}</Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
                <Menu.Separator />
                <Menu.RadioGroup
                  value={props.view.direction}
                  onChange={(value) => {
                    const next = RECENT_DIRECTIONS.find((item) => item === value)

                    if (next) props.onChange({ direction: next })
                  }}
                >
                  <For each={RECENT_DIRECTIONS}>
                    {(value) => (
                      <Menu.RadioItem value={value}>
                        {language.t(`sidebar.recent.view.direction.${value}`)}
                      </Menu.RadioItem>
                    )}
                  </For>
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub gutter={4} overflowPadding={16} overlap>
            <SubTrigger label={language.t("sidebar.recent.view.show")} />
            <Menu.Portal>
              <Menu.SubContent class="w-max min-w-[160px]">
                <Menu.CheckboxItem
                  checked={props.view.metadata}
                  onChange={(value) => props.onChange({ metadata: value })}
                >
                  {language.t("sidebar.recent.view.show.metadata")}
                </Menu.CheckboxItem>
                <Menu.CheckboxItem
                  checked={props.view.emptyGroups}
                  onChange={(value) => props.onChange({ emptyGroups: value })}
                >
                  {language.t("sidebar.recent.view.show.emptyGroups")}
                </Menu.CheckboxItem>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator />
          <Menu.Item disabled={isDefault()} onSelect={() => props.onChange(DEFAULT_RECENT_VIEW)}>
            {language.t("sidebar.recent.view.reset")}
          </Menu.Item>
          <Menu.Item onSelect={props.onViewAll}>{language.t("sidebar.recent.view.viewAll")}</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

function SubTrigger(props: { label: string; children?: JSX.Element }) {
  return (
    <Menu.SubTrigger class="[&_[data-slot=menu-v2-item-chevron]]:text-v2-icon-icon-muted">
      <span class="min-w-0 truncate">{props.label}</span>
      <span class="ms-auto shrink-0 ps-4 text-v2-text-text-faint">{props.children}</span>
    </Menu.SubTrigger>
  )
}
