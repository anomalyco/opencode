import { NotFoundPage } from "~/component/site/arcade3d/not-found-page"
import { useI18n } from "~/context/i18n"

export default function NotFound() {
  const i18n = useI18n()
  return <NotFoundPage title={i18n.t("notFound.title")} status={404} />
}
