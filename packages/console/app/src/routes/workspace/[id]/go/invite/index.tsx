import { createAsync, useParams } from "@solidjs/router"
import { Show } from "solid-js"
import { IconGo } from "~/component/icon"
import { GoReferralOverview, GoReferralRewards, queryGoReferral } from "~/component/go-referral"
import { useI18n } from "~/context/i18n"

export default function () {
  const params = useParams()
  const i18n = useI18n()
  const referral = createAsync(() => queryGoReferral(params.id!))

  return (
    <div data-page="workspace-[id]">
      <section data-component="header-section">
        <IconGo />
        <p>{i18n.t("workspace.referral.page.subtitle")}</p>
      </section>

      <div data-slot="sections">
        <Show when={referral()} fallback={<section>{i18n.t("workspace.lite.loading")}</section>}>
          {(summary) => (
            <>
              <GoReferralOverview summary={summary()} />
              <GoReferralRewards workspaceID={params.id!} summary={summary()} />
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
