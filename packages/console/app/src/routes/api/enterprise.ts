import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode/console-resource"
import { i18n } from "~/i18n"
import { handleEnterpriseRequest } from "~/lib/enterprise"
import { localeFromRequest } from "~/lib/language"

// SolidStart keeps only the method export from API routes, so the handler lives in lib.
export async function POST(event: APIEvent) {
  // Outside production, accept submissions without reaching hCaptcha, spam scoring, Salesforce, email, or EmailOctopus.
  if (import.meta.env.DEV || Resource.App.stage !== "production")
    return Response.json({
      success: true,
      message: i18n(localeFromRequest(event.request))["enterprise.form.success.submitted"],
    })
  return handleEnterpriseRequest(event.request)
}
