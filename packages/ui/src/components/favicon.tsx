import { Link, Meta } from "@solidjs/meta"
import favicon96 from "../assets/favicon/favicon-96x96.png"
import faviconSvg from "../assets/favicon/favicon.svg"
import faviconIco from "../assets/favicon/favicon.ico"
import appleTouchIcon from "../assets/favicon/apple-touch-icon.png"
import siteWebmanifest from "../assets/favicon/site.webmanifest"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/svg+xml" href={faviconSvg} />
      <Link rel="icon" type="image/png" href={favicon96} sizes="96x96" />
      <Link rel="shortcut icon" href={faviconIco} />
      <Link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon} />
      <Meta name="apple-mobile-web-app-title" content="OpenCode" />
      <Link rel="manifest" href={siteWebmanifest} />
    </>
  )
}
