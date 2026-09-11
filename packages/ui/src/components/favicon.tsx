import { Link, Meta } from "@solidjs/meta"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/png" href="/logowithbg.png" />
      <Link rel="shortcut icon" href="/logowithbg.png" />
      <Link rel="apple-touch-icon" href="/logowithbg.png" />
      <Link rel="manifest" href="/site.webmanifest" />
      <Meta name="apple-mobile-web-app-title" content="Argus" />
    </>
  )
}
