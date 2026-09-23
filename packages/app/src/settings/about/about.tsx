import { For, createResource, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
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
  const [otherContributors] = createResource(
    () => props.active || undefined,
    () => loadOtherContributorCount(platform.fetch ?? fetch),
    { initialValue: FALLBACK_OTHER_CONTRIBUTORS },
  )

  return (
    <div class="settings-about-content">
      <div class="settings-about-intro">
        <p>{language.t("settings.about.version", { version: platform.version ?? language.t("settings.about.devVersion") })}</p>
        <p>{language.t("settings.about.license")}</p>
      </div>

      <AnimatedWordmark active={props.active} />

      <div class="settings-about-credits">
        <CreditLine
          label={language.t("settings.about.writtenBy")}
          names={writers}
          and={language.t("settings.about.and")}
          tail={
            <ExternalLink href="https://github.com/anomalyco/opencode/graphs/contributors">
              {language.plural("settings.about.otherContributor", otherContributors.latest, {
                count: otherContributors.latest,
              })}
            </ExternalLink>
          }
        />
        <CreditLine
          label={language.t("settings.about.illustratedBy")}
          names={illustrators}
          and={language.t("settings.about.and")}
        />
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

function CreditLine(props: {
  label: string
  names: readonly string[]
  and: string
  tail?: JSX.Element
}) {
  return (
    <p>
      {props.label}{" "}
      <For each={props.names}>
        {(name, index) => (
          <>
            {index() === 0 ? "" : index() === props.names.length - 1 && !props.tail ? `, ${props.and} ` : ", "}
            <bdi dir="ltr">
              <ExternalLink href={profile(name)}>{name}</ExternalLink>
            </bdi>
          </>
        )}
      </For>
      {props.tail ? <>, {props.and} {props.tail}</> : null}
    </p>
  )
}

function profile(name: string) {
  if (name === "r44vcorp") return "https://github.com/R44VC0RP"
  if (name === "ludvigrask_") return "https://x.com/ludvigrask_"
  return `https://github.com/${name}`
}
