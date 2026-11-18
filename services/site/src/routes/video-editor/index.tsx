import { Meta, Title } from "@solidjs/meta"
import { clientOnly } from "@solidjs/start"

// Development only: the product video editor (see product-videos/EDITOR.md). Production answers this
// address with the not-found page (src/static/routes.ts), and its builds leave the editor out.
const Editor = import.meta.env.DEV ? clientOnly(() => import("~/component/video-editor/editor")) : () => null

export default function VideoEditorPage() {
  return (
    <>
      <Title>Video editor</Title>
      <Meta name="robots" content="noindex" />
      <Editor />
    </>
  )
}
