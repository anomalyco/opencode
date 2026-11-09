import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { Specimen } from "~/component/font/specimen"
import { FilmPlate } from "~/component/font-film/section"
import { Typewriter } from "~/component/font/typewriter"
import { Site } from "~/component/site/site"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { useMarkdown } from "~/component/site/use-markdown"
import { useI18n } from "~/context/i18n"
import { fontContent, fontMarkdown } from "~/lib/font-content"

export default function Font() {
  const i18n = useI18n()
  const markdown = useMarkdown("/font", fontMarkdown)
  return (
    <Site page="font" bare markdown={markdown}>
      <Title>{fontContent.metaTitle}</Title>
      {/* English only: its locale URLs redirect here. */}
      <ShareMeta
        title={fontContent.metaTitle}
        description={fontContent.description}
        image={ogImage("/font")}
        englishOnly
      />
      <LocaleLinks path="/font" englishOnly />
      <Meta name="description" content={fontContent.description} />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: "/" },
          { name: fontContent.title, path: "/font" },
        ])}
      />

      <Typewriter />
      <FilmPlate />
      <Specimen />
    </Site>
  )
}
