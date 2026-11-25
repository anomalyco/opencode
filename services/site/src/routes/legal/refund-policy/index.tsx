import "../legal.css"
import { LegalDocument } from "~/component/site/legal"
import { refundPolicy } from "~/lib/legal/refund-policy"

export default function RefundPolicy() {
  return <LegalDocument document={refundPolicy} />
}
