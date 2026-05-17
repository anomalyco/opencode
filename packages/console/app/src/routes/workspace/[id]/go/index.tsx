import { createAsync, useParams } from "@solidjs/router"
import { Show } from "solid-js"
import { IconGo } from "~/component/icon"
import { GoReferralSection, queryGoReferral } from "~/component/go-referral"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LiteSection } from "./lite-section"

export default function () {
  const params = useParams()
  const i18n = useI18n()
  const language = useLanguage()
  const referral = createAsync(() => queryGoReferral(params.id!))

  return (
    <div data-page="workspace-[id]">
      <section data-component="header-section">
        <IconGo />
        <p>
          <span>
            {i18n.t("workspace.lite.banner.beforeLink")}{" "}
            <a target="_blank" href={language.route("/docs/go")}>
              {i18n.t("common.learnMore")}
            </a>
            .
          </span>
        </p>
      </section>

      <div data-slot="sections">
        <LiteSection />
        <Show when={referral()} fallback={<section>{i18n.t("workspace.lite.loading")}</section>}>
          {(summary) => (
            <Show when={summary().hasActiveGo || summary().rewards.length > 0}>
              <GoReferralSection workspaceID={params.id!} summary={summary()} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
