import { createAsync, useParams } from "@solidjs/router"
import { Show } from "solid-js"
import { IconGo } from "~/component/icon"
import { GoReferralSection, queryGoReferral } from "~/component/go-referral"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { LiteSection, queryLiteSubscription } from "./lite-section"

export default function () {
  const params = useParams()
  const i18n = useI18n()
  const language = useLanguage()
  const referral = createAsync(() => queryGoReferral(params.id!))
  const lite = createAsync(() => queryLiteSubscription(params.id!))

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
        <LiteSection lite={lite()} />
        <Show when={referral()} fallback={<section>{i18n.t("workspace.lite.loading")}</section>}>
          {(summary) => <GoReferralSection workspaceID={params.id!} summary={summary()} lite={lite()} />}
        </Show>
      </div>
    </div>
  )
}
