import "../legal.css"
import "./index.css"
import { LegalDocument } from "~/component/site/legal"
import { privacyPolicy } from "~/lib/legal/privacy-policy"

export default function PrivacyPolicy() {
  return <LegalDocument document={privacyPolicy} />
}
