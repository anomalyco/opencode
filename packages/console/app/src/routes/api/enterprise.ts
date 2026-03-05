import type { APIEvent } from "@solidjs/start/server"
import { AWS } from "@opencode-ai/console-core/aws.js"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"

interface EnterpriseFormData {
  name: string
  role: string
  email: string
  message: string
}

export async function POST(event: APIEvent) {
  const dict = i18n(localeFromRequest(event.request))
  try {
    const body = (await event.request.json()) as EnterpriseFormData

    // Validate required fields
    if (!body.name || !body.role || !body.email || !body.message) {
      return Response.json({ error: dict["enterprise.form.error.allFieldsRequired"] }, { status: 400 })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return Response.json({ error: dict["enterprise.form.error.invalidEmailFormat"] }, { status: 400 })
    }

    // Create email content
    const emailContent = `
${body.message}<br><br>
--<br>
${body.name}<br>
${body.role}<br>
${body.email}`.trim()

    // Send email using AWS SES
    await AWS.sendEmail({
      to: "contact@anoma.ly",
      subject: `Enterprise Inquiry from ${body.name}`,
      body: emailContent,
      replyTo: body.email,
    })

    return Response.json({ success: true, message: dict["enterprise.form.success.submitted"] }, { status: 200 })
  } catch (error) {
    console.error("Error processing enterprise form:", error)
    return Response.json({ error: dict["enterprise.form.error.internalServer"] }, { status: 500 })
  }
}
