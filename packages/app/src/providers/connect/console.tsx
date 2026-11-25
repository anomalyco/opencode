import { For, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useLanguage } from "@/runtime/i18n/language"
import { StepActions, WaitingButton } from "./step-actions"

export function ConsoleAuthorization(props: {
  /** Undefined until the server returns the sign-in attempt. */
  code: string | undefined
  browserFailed: boolean
  copied: boolean
  copyFailed: boolean
  onCopy: () => void
}) {
  const language = useLanguage()

  return (
    <div
      data-component="console-authorization"
      class="flex flex-col items-start gap-5 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
    >
      <p>
        {language.t(
          props.browserFailed ? "provider.connect.console.browserFailed" : "provider.connect.console.instructions",
        )}
      </p>
      <Show when={props.code}>
        {(code) => (
          <div class="flex w-full flex-col gap-2">
            <div class="font-[530] text-v2-text-text-base">{language.t("provider.connect.console.deviceCode")}</div>
            <div
              dir="ltr"
              role="group"
              aria-label={language.t("provider.connect.console.deviceCode.label", { code: code() })}
              class="flex w-full select-none gap-1.5 font-mono text-[28px] font-[530] text-v2-text-text-base tabular-nums"
            >
              <For each={code().split("")}>
                {(character) => (
                  <span
                    aria-hidden="true"
                    class={
                      character === "-"
                        ? "mx-1 flex h-16 items-center text-v2-text-text-muted"
                        : "flex h-16 min-w-0 flex-1 items-center justify-center rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02"
                    }
                  >
                    {character}
                  </span>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
      <Show when={props.copyFailed}>
        <p role="alert">{language.t("provider.connect.console.copyFailed")}</p>
      </Show>
      <StepActions>
        <Button variant="ghost" disabled={!props.code} onClick={props.onCopy}>
          {language.t(props.copied ? "provider.connect.console.linkCopied" : "provider.connect.console.copyLink")}
        </Button>
        <WaitingButton>
          {language.t(props.code ? "provider.connect.console.waiting" : "provider.connect.console.openingBrowser")}
        </WaitingButton>
      </StepActions>
    </div>
  )
}
