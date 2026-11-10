import { Meta, Title } from "@solidjs/meta"
import { clientOnly, HttpStatusCode } from "@solidjs/start"

// Development only: the product video editor (see product-videos/EDITOR.md). Production builds drop the editor.
const Editor = import.meta.env.DEV ? clientOnly(() => import("~/component/video-editor/editor")) : undefined

export default function VideoEditorPage() {
  if (!Editor)
    return (
      <>
        <HttpStatusCode code={404} />
        <p>Not found</p>
      </>
    )
  return (
    <>
      <Title>Video editor</Title>
      <Meta name="robots" content="noindex" />
      <Editor />
    </>
  )
}
