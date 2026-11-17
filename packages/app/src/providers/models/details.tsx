import { For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { useLanguage } from "@/runtime/i18n/language"
import type { ModelUsageLabel } from "@/usage/model"
import type { ModelSelection } from "./selection"
import { ProviderModelIcon } from "./provider-group"

type ModelInfo = NonNullable<ReturnType<ModelSelection["current"]>>

type Input = keyof ModelInfo["capabilities"]["input"]

const inputs: Input[] = ["text", "image", "pdf", "audio", "video"]

const inputIcons: Record<Input, IconName> = {
  text: "outline-text",
  image: "outline-photo",
  pdf: "file-document",
  audio: "outline-audio",
  video: "outline-video",
}

export function ModelDetails(props: {
  model: ModelInfo
  provider: string
  compact?: boolean
  standalone?: boolean
  /** What the member's Console budgets leave for the model. */
  usage?: ModelUsageLabel
}) {
  const language = useLanguage()
  const input = () => inputs.filter((type) => props.model.capabilities.input[type])

  const modalities = () =>
    inputs.filter((type) => props.model.capabilities.input[type] || props.model.capabilities.output[type])

  const label = (type: Input) => language.t(`model.details.input.${type}`)

  const summary = () =>
    new Intl.ListFormat(language.intl(), { style: "short", type: "unit" }).format([
      ...input().map(label),
      ...(props.model.capabilities.toolcall ? [language.t("model.details.tools")] : []),
    ])

  return (
    <Show
      when={props.compact}
      fallback={
        <div class="w-[188px] max-w-[calc(100vw-24px)] font-[440] text-v2-text-text-muted">
          <div class="border-b-[0.5px] border-v2-border-border-base py-0.5">
            <div class="flex h-6 min-w-0 items-center gap-1.5 px-2">
              <ProviderModelIcon provider={props.model.provider} class="!size-3.5 shrink-0" />
              <bdi class="min-w-0 truncate font-[530]">{props.model.name}</bdi>
            </div>
          </div>
          <div class="flex flex-col gap-1.5 py-1">
            <dl>
              <div class="flex h-6 min-w-0 items-center gap-2 px-2">
                <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                  {language.t("model.tooltip.provider")}
                </dt>
                <dd class="min-w-0 truncate text-end">
                  <bdi>{props.provider}</bdi>
                </dd>
              </div>
              <div class="flex h-6 min-w-0 items-center gap-2 px-2">
                <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                  {language.t("model.tooltip.context.label")}
                </dt>
                <dd class="shrink-0">{props.model.limit.context.toLocaleString(language.intl())}</dd>
              </div>
            </dl>
            <Show when={props.usage}>
              {(usage) => (
                <>
                  <div class="mx-2 border-t-[0.5px] border-v2-border-border-base" />
                  <dl>
                    <div class="flex h-6 min-w-0 items-center gap-2 px-2">
                      <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                        {language.t("model.details.left")}
                      </dt>
                      <dd class="shrink-0 tabular-nums" classList={{ "text-v2-state-fg-danger": usage().reached }}>
                        {usage().reached ? usage().label : usage().left}
                      </dd>
                    </div>
                    <div class="flex h-6 min-w-0 items-center gap-2 px-2">
                      <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                        {language.t("model.details.resets")}
                      </dt>
                      <dd class="min-w-0 truncate text-end">{usage().resets}</dd>
                    </div>
                  </dl>
                </>
              )}
            </Show>
            <div class="mx-2 border-t-[0.5px] border-v2-border-border-base" />
            <dl>
              <For each={modalities()}>
                {(type) => (
                  <div class="flex h-6 min-w-0 items-center gap-1.5 px-2">
                    <Icon name={inputIcons[type]} size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">{label(type)}</dt>
                    <dd class="shrink-0">
                      {props.model.capabilities.input[type] && props.model.capabilities.output[type]
                        ? language.t("model.details.inputOutput")
                        : props.model.capabilities.input[type]
                          ? language.t("model.details.input")
                          : language.t("model.details.output")}
                    </dd>
                  </div>
                )}
              </For>
              <Show when={props.model.capabilities.reasoning}>
                <div class="flex h-6 min-w-0 items-center gap-1.5 px-2">
                  <Icon name="outline-brain" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                    {language.t("model.tooltip.reasoning")}
                  </dt>
                  <dd class="flex shrink-0">
                    <Icon
                      name="check"
                      class="text-v2-icon-icon-muted"
                      aria-label={language.t("model.details.supported")}
                      aria-hidden={false}
                    />
                  </dd>
                </div>
              </Show>
              <Show when={props.model.capabilities.toolcall}>
                <div class="flex h-6 min-w-0 items-center gap-1.5 px-2">
                  <Icon name="outline-console" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <dt class="min-w-0 flex-1 truncate font-[530] text-v2-text-text-faint">
                    {language.t("model.details.tools")}
                  </dt>
                  <dd class="flex shrink-0">
                    <Icon
                      name="check"
                      class="text-v2-icon-icon-muted"
                      aria-label={language.t("model.details.supported")}
                      aria-hidden={false}
                    />
                  </dd>
                </div>
              </Show>
            </dl>
          </div>
        </div>
      }
    >
      <div
        class="px-3 py-2 text-[12px] font-[440] leading-5 text-v2-text-text-muted"
        classList={{ "border-t border-v2-border-border-muted": !props.standalone }}
      >
        <bdi class="block">
          {language.t("model.details.summary", {
            provider: props.provider,
            context: new Intl.NumberFormat(language.intl(), {
              notation: "compact",
              maximumFractionDigits: 0,
              roundingMode: "trunc",
            }).format(props.model.limit.context),
          })}
        </bdi>
        <Show when={summary()}>{(value) => <div>{value()}</div>}</Show>
        <Show when={props.usage}>
          {(usage) => (
            <div classList={{ "text-v2-state-fg-danger": usage().reached }}>
              {language.t("model.details.usage", { label: usage().label, time: usage().resets })}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
