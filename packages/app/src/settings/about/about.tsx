import { createResource } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
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
  const dialog = useDialog()

  const [otherContributors] = createResource(
    () => props.active || undefined,
    () => loadOtherContributorCount(platform.fetch ?? fetch),
    { initialValue: FALLBACK_OTHER_CONTRIBUTORS },
  )

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

  let noticesButton: HTMLButtonElement | undefined

  const showNotices = async () => {
    // The license texts load only when someone reads them.
    const loaded = await import("./notices/dialog").catch(() => undefined)

    if (!loaded) {
      showToast({ variant: "error", title: language.t("settings.about.notices.loadFailed") })

      return
    }

    // dialog.show has no trigger for Kobalte to restore, so closing returns focus to the button by hand.
    void dialog.show(() => (
      <loaded.default
        onCloseAutoFocus={(event) => {
          if (!noticesButton?.isConnected) return
          event.preventDefault()
          noticesButton.focus({ preventScroll: true })
        }}
      />
    ))
  }

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <p>
          {language.t("settings.about.version", {
            version: platform.version ?? language.t("settings.about.devVersion"),
          })}
        </p>
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
          <button ref={noticesButton} type="button" class="settings-about-link" onClick={() => void showNotices()}>
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
