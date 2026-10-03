import { Tooltip } from "@opencode/ui/tooltip"
import { createEffect, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { showToast } from "@/shell/notifications/toast"
import legal from "./legal.svg"
import anomalyBrush from "./anomaly-brush.svg"
import { AnimatedWordmark } from "./animated-wordmark"
import { FALLBACK_OTHER_CONTRIBUTORS, loadOtherContributorCount } from "./contributors"

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
  const [copy, setCopy] = createStore({ pending: false, copied: false, forceCopied: false })
  const version = () => platform.version ?? language.t("settings.about.devVersion")
  const versionLabel = () => language.t("settings.about.version", { version: version() })
  const [otherContributors] = createResource(
    () => props.active || undefined,
    () => loadOtherContributorCount(platform.fetch ?? fetch),
    { initialValue: FALLBACK_OTHER_CONTRIBUTORS },
  )
  createEffect(() => {
    if (!copy.copied) return
    const close = setTimeout(() => setCopy("forceCopied", false), 2000)
    const reset = setTimeout(() => setCopy("copied", false), 2120)
    onCleanup(() => {
      clearTimeout(close)
      clearTimeout(reset)
    })
  })
  const copyVersion = async () => {
    if (copy.pending) return
    setCopy({ pending: true, copied: false, forceCopied: false })
    await (platform.writeClipboardText?.(versionLabel()) ?? navigator.clipboard.writeText(versionLabel()))
      .then(() => setCopy({ copied: true, forceCopied: true }))
      .catch(() =>
        showToast({
          variant: "error",
          title: language.t("settings.about.copyVersionFailed"),
        }),
      )
      .finally(() => setCopy("pending", false))
  }
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

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <div class="settings-about-version-line">
          <Tooltip
            value={language.t(copy.copied ? "common.copied" : "ui.message.copy")}
            placement="top"
            forceOpen={copy.forceCopied ? true : undefined}
          >
            <button
              type="button"
              class="settings-about-version"
              disabled={copy.pending}
              aria-label={language.t(copy.copied ? "common.copied" : "ui.message.copy")}
              onClick={() => void copyVersion()}
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
