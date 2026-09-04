import { For, Show, createMemo, createUniqueId } from "solid-js"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Select } from "@opencode-ai/ui/select"
import {
  timelineCategories,
  timelinePreset,
  timelinePresets,
  type TimelineDetail,
  type TimelineExpansion,
  type TimelinePlacement,
} from "@opencode-ai/session-ui/timeline/detail"
import { useLanguage } from "@/runtime/i18n/language"
import "./timeline-detail.css"

const placements: TimelinePlacement[] = ["separate", "grouped", "hidden"]
const expansions: TimelineExpansion[] = ["collapsed", "expanded"]

export function TimelineDetailControl(props: { value: TimelineDetail; onChange: (value: TimelineDetail) => void }) {
  const language = useLanguage()
  const id = createUniqueId()
  const preset = createMemo(() => timelinePreset(props.value))
  const position = () => {
    const current = preset()
    return current ? timelinePresets.indexOf(current) : 2
  }
  const label = () => {
    const current = preset()
    return current ? language.t(`settings.timeline.preset.${current.id}`) : language.t("settings.timeline.custom")
  }

  return (
    <div data-component="timeline-detail-control">
      <div data-slot="timeline-detail-heading">
        <label for={`${id}-slider`}>{language.t("settings.timeline.detail")}</label>
        <span data-slot="timeline-detail-current" aria-live="polite">
          {label()}
        </span>
      </div>
      <p id={`${id}-description`} class="sr-only">
        {language.t("settings.timeline.description")}
      </p>
      <div data-slot="timeline-detail-scale">
        <div data-slot="timeline-detail-track" aria-hidden="true">
          <For each={timelinePresets}>{() => <span />}</For>
        </div>
        <input
          id={`${id}-slider`}
          data-action="settings-timeline-detail"
          type="range"
          min="0"
          max={timelinePresets.length - 1}
          step="1"
          value={position()}
          aria-valuetext={label()}
          aria-describedby={`${id}-description ${id}-preset-description`}
          onInput={(event) => props.onChange({ ...timelinePresets[event.currentTarget.valueAsNumber].value })}
        />
      </div>
      <p id={`${id}-preset-description`}>{language.t(`settings.timeline.description.${preset()?.id ?? "custom"}`)}</p>
      <Collapsible variant="ghost" data-slot="timeline-detail-advanced">
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
            <p data-slot="timeline-detail-explainer">{language.t("settings.timeline.advanced.explainer")}</p>
            <div data-slot="timeline-detail-columns">
              <span>{language.t("settings.timeline.activity")}</span>
              <span id={`${id}-placement`}>{language.t("settings.timeline.placement.title")}</span>
              <span id={`${id}-expansion`}>{language.t("settings.timeline.expansion.title")}</span>
            </div>
            <For each={timelineCategories}>
              {(category) => (
                <div data-slot="timeline-detail-category" role="group" aria-labelledby={`${id}-${category}`}>
                  <span id={`${id}-${category}`}>{language.t(`settings.timeline.category.${category}`)}</span>
                  <div data-slot="timeline-detail-placement">
                    <span data-slot="timeline-detail-field-label" aria-hidden="true">
                      {language.t("settings.timeline.placement.title")}
                    </span>
                    <Select
                      data-category={category}
                      data-field="placement"
                      aria-labelledby={`${id}-${category} ${id}-placement`}
                      options={category === "notices" ? placements.filter((value) => value !== "grouped") : placements}
                      current={props.value[category].placement}
                      label={(value) => language.t(`settings.timeline.placement.${value}`)}
                      onSelect={(placement) => {
                        if (!placement) return
                        if (category === "notices") {
                          if (placement === "grouped") return
                          props.onChange({ ...props.value, notices: { placement } })
                          return
                        }
                        props.onChange({ ...props.value, [category]: { ...props.value[category], placement } })
                      }}
                    />
                  </div>
                  <div data-slot="timeline-detail-expansion">
                    {category === "shell" || category === "edit" || category === "thinking" ? (
                      <Show when={props.value[category].placement !== "hidden"}>
                        <span data-slot="timeline-detail-field-label" aria-hidden="true">
                          {language.t("settings.timeline.expansion.title")}
                        </span>
                        <Select
                          data-category={category}
                          data-field="details"
                          aria-labelledby={`${id}-${category} ${id}-expansion`}
                          options={expansions}
                          current={props.value[category].details}
                          label={(value) => language.t(`settings.timeline.expansion.${value}`)}
                          onSelect={(details) =>
                            details &&
                            props.onChange({ ...props.value, [category]: { ...props.value[category], details } })
                          }
                        />
                      </Show>
                    ) : null}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
