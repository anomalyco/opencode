import "../legal.css"
import { LegalDocument } from "~/component/site/legal"
import { termsOfService } from "~/lib/legal/terms-of-service"

export default function TermsOfService() {
  return <LegalDocument document={termsOfService} />
}
