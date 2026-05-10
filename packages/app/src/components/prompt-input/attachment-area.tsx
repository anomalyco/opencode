import type { ImageAttachmentPart } from "@/context/prompt"
import { AnnotationCapsule } from "@/components/annotation-capsule"
import { PromptImageAttachments } from "./image-attachments"

type PromptAttachmentAreaProps = {
  imageAttachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

export function PromptAttachmentArea(props: PromptAttachmentAreaProps) {
  return (
    <div data-component="prompt-attachment-area" class="contents">
      <AnnotationCapsule />
      <PromptImageAttachments
        attachments={props.imageAttachments}
        onOpen={props.onOpen}
        onRemove={props.onRemove}
        removeLabel={props.removeLabel}
      />
    </div>
  )
}
