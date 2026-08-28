import { onMount } from "solid-js"
import { DocumentPreview } from "./document-preview"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import PDF_URL from "./fixtures/report.pdf?url"
import DOCX_URL from "./fixtures/notes.docx?url"
import MARKDOWN_URL from "./fixtures/draft.md?url"
import XLSX_URL from "./fixtures/cashflow.xlsx?url"

function Open(props: {
  kind: "pdf" | "docx" | "xlsx" | "pptx" | "markdown" | "fallback"
  filename: string
  url: string
  sourceLabel?: string
}) {
  const dialog = useDialog()
  const open = () =>
    dialog.show(() => (
      <DocumentPreview
        filename={props.filename}
        kind={props.kind}
        url={props.url}
        sourceLabel={props.sourceLabel}
        actions={<Button variant="ghost">Download</Button>}
      />
    ))
  onMount(open)
  return (
    <Button variant="secondary" onClick={open}>
      Open {props.kind} preview
    </Button>
  )
}

export default {
  title: "UI/DocumentPreview",
  id: "components-document-preview",
  component: DocumentPreview,
  tags: ["autodocs"],
}

export const Pdf = () => <Open kind="pdf" filename="report.pdf" url={PDF_URL} sourceLabel="file" />
export const Docx = () => <Open kind="docx" filename="notes.docx" url={DOCX_URL} sourceLabel="file" />
export const Xlsx = () => <Open kind="xlsx" filename="cashflow.xlsx" url={XLSX_URL} sourceLabel="file" />
export const Markdown = () => <Open kind="markdown" filename="draft.md" url={MARKDOWN_URL} sourceLabel="draft" />
export const Fallback = () => <Open kind="fallback" filename="data.xyz" url="" />
