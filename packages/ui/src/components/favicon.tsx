import { Link, Meta } from "@solidjs/meta"
import mark from "../assets/brand/v.svg"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/svg+xml" href={mark} />
      <Link rel="shortcut icon" href={mark} />
      <Meta name="apple-mobile-web-app-title" content="Veritly" />
    </>
  )
}
