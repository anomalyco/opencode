import { createEffect, createMemo, createResource, createSignal, onCleanup, untrack } from "solid-js"
import { writeClipboard } from "@opencode/session-ui/copy"
import { useDialog } from "@opencode/ui/context/dialog"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { showToast } from "@/shell/notifications/toast"
import legal from "./legal.svg"
import anomalyBrush from "./anomaly-brush.svg"
import { AnimatedWordmark } from "./animated-wordmark"
import { FALLBACK_OTHER_CONTRIBUTORS, loadOtherContributorCount } from "./contributors"
import {
  INITIAL_ABOUT_COPY_STATE,
  selectAboutCopyView,
  transitionAboutCopy,
  type AboutCopyEffect,
  type AboutCopyEvent,
} from "./machine"

const writers = [
  "thdxr",
  "adamdotdev",
  "rekram1-node",
  "kitlangton",
  "iamdavidhill",
  "jayair",
  "fwang",
  "brendonovich",
  "nexxeln",
  "hona",
  "kommander",
  "jlongster",
  "vimtor",
  "r44vcorp",
  "simonklee",
  "arvsrn",
] as const

const illustrators = ["usrnk1", "ludvigrask_", "arvsrn", "iamdavidhill"] as const

export function SettingsAbout(props: { active: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [copyState, setCopyState] = createSignal(INITIAL_ABOUT_COPY_STATE)
  const copy = createMemo(() => selectAboutCopyView(copyState()))
  const version = () => platform.version ?? language.t("settings.about.devVersion")
  const versionLabel = () => language.t("settings.about.version", { version: version() })
  let copyTimer: ReturnType<typeof setTimeout> | undefined

  const [otherContributors] = createResource(
    () => props.active || undefined,
    () => loadOtherContributorCount(platform.fetch ?? fetch),
    { initialValue: FALLBACK_OTHER_CONTRIBUTORS },
  )

  const dispatchCopy = (event: AboutCopyEvent) =>
    untrack(() => {
      const previous = copyState()
      const next = transitionAboutCopy(previous, event)

      if (next.state !== previous) setCopyState(next.state)
      next.effects.forEach(runCopyEffect)
    })

  function runCopyEffect(effect: AboutCopyEffect) {
    if (effect.type === "timer.clear") return clearTimeout(copyTimer)

    if (effect.type === "timer.schedule") {
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => dispatchCopy({ type: effect.event, attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "toast.failed")
      return showToast({ variant: "error", title: language.t("settings.about.copyVersionFailed") })

    const attempt = effect.attempt
    // Plain-HTTP LAN origins have no `navigator.clipboard`; `writeClipboard` falls back to a selected textarea there.
    void Promise.try(() =>
      platform.writeClipboardText ? platform.writeClipboardText(effect.text).then(() => true) : writeClipboard(effect.text),
    ).then(
      (written) => dispatchCopy({ type: written ? "copy.succeeded" : "copy.failed", attempt }),
      () => dispatchCopy({ type: "copy.failed", attempt }),
    )
  }

  createEffect(() => {
    if (!props.active) dispatchCopy({ type: "hidden" })
  })
  onCleanup(() => dispatchCopy({ type: "disposed" }))

  const credit = (name: string) => (
    <bdi dir="ltr">
      <ExternalLink href={profile(name)}>{name}</ExternalLink>
    </bdi>
  )

  const writerCredits = () => [
    ...writers.map(credit),
    <ExternalLink href="https://github.com/anomalyco/opencode/graphs/contributors">
      {language.plural("settings.about.otherContributor", otherContributors.latest, {
        count: otherContributors.latest,
      })}
    </ExternalLink>,
  ]

  const showNotices = async () => {
    // The license texts load only when someone reads them.
    const loaded = await import("./notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    void dialog.show(() => <loaded.default />)
  }

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <div class="settings-about-version-line">
          <Tooltip
            value={language.t(copy().copied ? "common.copied" : "ui.message.copy")}
            placement="top"
            forceOpen={copy().forceOpen}
          >
            <button
              type="button"
              class="settings-about-version"
              disabled={copy().disabled}
              aria-label={language.t(copy().copied ? "common.copied" : "ui.message.copy")}
              onClick={() => dispatchCopy({ type: "copy.requested", text: versionLabel() })}
            >
              <span>
                {language.rich("settings.about.version", {
                  version: <bdi dir="ltr">{version()}</bdi>,
                })}
              </span>
            </button>
          </Tooltip>
        </div>
        <p>{language.t("settings.about.license")}</p>
      </div>

      <AnimatedWordmark active={props.active} />

      <div class="settings-about-credits">
        <p>{language.rich("settings.about.writtenByNames", { names: language.list(writerCredits()) })}</p>
        <p>
          {language.rich("settings.about.illustratedByNames", {
            names: language.list(illustrators.map(credit)),
          })}
        </p>
      </div>

      <div class="settings-about-publication">
        <p>{language.t("settings.about.firstPublished")}</p>
        <p>{language.t("settings.about.firstIllustrated")}</p>
      </div>

      <p class="settings-about-faint">
        <ExternalLink href="https://opencode.ai">
          <bdi dir="ltr">{language.t("settings.about.website")}</bdi>
        </ExternalLink>
      </p>

      <div class="settings-about-details">
        <p>{language.t("settings.about.description")}</p>
        <p>{language.t("settings.about.trademark")}</p>
        <p>{language.t("settings.about.typeset")}</p>
        <p>
          <button type="button" class="settings-about-link" onClick={() => void showNotices()}>
            {language.t("settings.about.notices.title")}
          </button>
        </p>
      </div>

      <p>{language.t("settings.about.tagline")}</p>
      <img class="settings-about-legal" src={legal} alt="" />
      <div class="settings-about-copyright">
        <p>{language.t("settings.about.copyright")}</p>
        <img class="settings-about-anomaly-brush" src={anomalyBrush} alt="" />
      </div>
    </div>
  )
}

function profile(name: string) {
  if (name === "r44vcorp") return "https://github.com/R44VC0RP"

  if (name === "ludvigrask_") return "https://x.com/ludvigrask_"

  return `https://github.com/${name}`
}
