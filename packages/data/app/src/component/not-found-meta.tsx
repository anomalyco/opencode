import { Meta } from "@solidjs/meta"
import { HttpStatusCode } from "@solidjs/start"

// Use 503 when upstream data failed to load so crawlers retry instead of dropping the URL.
export function NotFoundMeta(props: { unavailable?: boolean }) {
  return (
    <>
      <HttpStatusCode code={props.unavailable ? 503 : 404} />
      <Meta name="robots" content="noindex,follow" />
    </>
  )
}
