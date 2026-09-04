import { For, Show, createMemo, createUniqueId } from "solid-js"
import { createStore } from "solid-js/store"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import {
  timelineCategories,
  timelinePreset,
  timelinePresets,
  type TimelineCategory,
  type TimelineDetail,
  type TimelinePlacement,
} from "@opencode-ai/session-ui/timeline/detail"
import { useLanguage } from "@/runtime/i18n/language"
import "./timeline-detail.css"

const presets = timelinePresets.toReversed()

export function TimelineDetailControl(props: { value: TimelineDetail; onChange: (value: TimelineDetail) => void }) {
  const language = useLanguage()
  const id = createUniqueId()
  const [visiblePlacements, setVisiblePlacements] = createStore<
    Partial<Record<TimelineCategory, Exclude<TimelinePlacement, "hidden">>>
  >({})
  const preset = createMemo(() => timelinePreset(props.value))
  const position = () => {
    const current = preset()
    return current ? presets.indexOf(current) : 2
  }
  const label = () => {
    const current = preset()
    return current ? language.t(`settings.timeline.preset.${current.id}`) : language.t("settings.timeline.custom")
  }

  return (
    <div data-component="timeline-detail-control">
      <div data-slot="settings-row-copy">
        <label data-slot="settings-row-title" for={`${id}-slider`}>
          {language.t("settings.timeline.detail")}
        </label>
        <div id={`${id}-description`} data-slot="settings-row-description">
          {language.t("settings.timeline.description")}
        </div>
      </div>
      <div data-slot="timeline-detail-scale">
        <div
          data-slot="timeline-detail-track"
          aria-hidden="true"
          style={{ "--timeline-detail-progress": `${(position() / (presets.length - 1)) * 100}%` }}
        >
          <For each={presets}>
            {(_, index) => <span style={{ "inset-inline-start": `${(index() / (presets.length - 1)) * 100}%` }} />}
          </For>
        </div>
        <input
          id={`${id}-slider`}
          data-action="settings-timeline-detail"
          type="range"
          min="0"
          max={presets.length - 1}
          step="1"
          value={position()}
          aria-valuetext={label()}
          aria-describedby={`${id}-description ${id}-preset-description`}
          onInput={(event) => props.onChange({ ...presets[event.currentTarget.valueAsNumber].value })}
        />
      </div>
      <p id={`${id}-preset-description`} aria-live="polite">
        <span data-slot="timeline-detail-summary">{language.t("settings.timeline.summary", { preset: label() })}</span>{" "}
        {language.t(`settings.timeline.description.${preset()?.id ?? "custom"}`)}
      </p>
      <Collapsible variant="ghost" data-slot="timeline-detail-advanced" defaultOpen={!preset()}>
        <Collapsible.Trigger>
          <span>{language.t("settings.timeline.advanced")}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div
            data-slot="timeline-detail-categories"
            role="group"
            aria-label={language.t("settings.timeline.advanced.description")}
          >
            <div data-slot="timeline-detail-columns">
              <span aria-hidden="true" />
              <span>{language.t("settings.timeline.group")}</span>
              <span>{language.t("settings.timeline.collapse")}</span>
            </div>
            <div data-slot="timeline-detail-list">
              <For each={timelineCategories}>
                {(category) => (
                  <div
                    data-slot="timeline-detail-category"
                    data-hidden={props.value[category].placement === "hidden" ? "" : undefined}
                    role="group"
                    aria-labelledby={`${id}-${category}`}
                  >
                    <div data-slot="timeline-detail-activity">
                      <Tooltip
                        placement="top"
                        value={language.t(
                          props.value[category].placement === "hidden"
                            ? "settings.timeline.visibility.show"
                            : "settings.timeline.visibility.hide",
                        )}
                      >
                        <IconButton
                          id={`${id}-${category}-visibility`}
                          type="button"
                          variant="ghost-muted"
                          size="small"
                          data-action="timeline-detail-visibility"
                          aria-label={language.t("settings.timeline.visibility.label", {
                            activity: language.t(`settings.timeline.category.${category}`),
                          })}
                          aria-pressed={props.value[category].placement !== "hidden"}
                          onClick={() => {
                            const placement = props.value[category].placement
                            if (placement !== "hidden") setVisiblePlacements(category, placement)
                            props.onChange({
                              ...props.value,
                              [category]: {
                                ...props.value[category],
                                placement:
                                  placement === "hidden" ? (visiblePlacements[category] ?? "grouped") : "hidden",
                              },
                            })
                          }}
                          icon={
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M2.5 10s3.33-5.42 7.5-5.42S17.5 10 17.5 10s-3.33 5.42-7.5 5.42S2.5 10 2.5 10Z" />
                              <circle cx="10" cy="10" r="2.5" />
                              <Show when={props.value[category].placement === "hidden"}>
                                <path data-slot="timeline-detail-eye-slash" d="M3 3 17 17" />
                              </Show>
                            </svg>
                          }
                        />
                      </Tooltip>
                      <label id={`${id}-${category}`} for={`${id}-${category}-visibility`}>
                        {language.t(`settings.timeline.category.${category}`)}
                      </label>
                    </div>
                    <div data-slot="timeline-detail-placement">
                      <span data-slot="timeline-detail-field-label" aria-hidden="true">
                        {language.t("settings.timeline.group")}
                      </span>
                      <Show
                        when={props.value[category].placement !== "hidden"}
                        fallback={<span data-slot="timeline-detail-unavailable" aria-hidden="true" />}
                      >
                        <Switch
                          data-category={category}
                          data-field="placement"
                          hideLabel
                          checked={props.value[category].placement === "grouped"}
                          onChange={(checked) =>
                            props.onChange({
                              ...props.value,
                              [category]: { ...props.value[category], placement: checked ? "grouped" : "separate" },
                            })
                          }
                        >
                          {language.t("settings.timeline.grouped.label", {
                            activity: language.t(`settings.timeline.category.${category}`),
                          })}
                        </Switch>
                      </Show>
                    </div>
                    <div data-slot="timeline-detail-expansion">
                      {category === "shell" || category === "edit" || category === "thinking" ? (
                        <>
                          <span data-slot="timeline-detail-field-label" aria-hidden="true">
                            {language.t("settings.timeline.collapse")}
                          </span>
                          <Show
                            when={props.value[category].placement !== "hidden"}
                            fallback={<span data-slot="timeline-detail-unavailable" aria-hidden="true" />}
                          >
                            <Switch
                              data-category={category}
                              data-field="details"
                              hideLabel
                              checked={props.value[category].details === "collapsed"}
                              onChange={(checked) =>
                                props.onChange({
                                  ...props.value,
                                  [category]: { ...props.value[category], details: checked ? "collapsed" : "expanded" },
                                })
                              }
                            >
                              {language.t("settings.timeline.collapsed.label", {
                                activity: language.t(`settings.timeline.category.${category}`),
                              })}
                            </Switch>
                          </Show>
                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
