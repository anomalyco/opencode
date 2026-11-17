import { Meta } from "@solidjs/meta"
import { config } from "~/config"
import { useLanguage } from "~/context/language"

export function SocialMeta(props: { title: string; description: string; path: string; image?: string }) {
  const language = useLanguage()
  const image = () => `${config.baseUrl}${props.image ?? "/social-share.png"}`
  return (
    <>
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:url" content={`${config.baseUrl}${language.route(props.path)}`} />
      <Meta property="og:title" content={props.title} />
      <Meta property="og:description" content={props.description} />
      <Meta property="og:image" content={image()} />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:site" content="@opencode" />
      <Meta name="twitter:title" content={props.title} />
      <Meta name="twitter:description" content={props.description} />
      <Meta name="twitter:image" content={image()} />
    </>
  )
}
