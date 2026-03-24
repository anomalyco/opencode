import type { APIEvent } from "@solidjs/start/server"
import { AWS } from "@opencode-ai/console-core/aws.js"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { createLead } from "~/lib/salesforce"

interface EnterpriseFormData {
  name: string
  role: string
  company?: string
  email: string
  phone?: string
  alias?: string
  message: string
}

export async function POST(event: APIEvent) {
  const dict = i18n(localeFromRequest(event.request))
  try {
    const body = (await event.request.json()) as EnterpriseFormData
    const trap = typeof body.alias === "string" ? body.alias.trim() : ""

    if (trap) {
      return Response.json({ success: true, message: dict["enterprise.form.success.submitted"] }, { status: 200 })
    }

    if (!body.name || !body.role || !body.email || !body.message) {
      return Response.json({ error: dict["enterprise.form.error.allFieldsRequired"] }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return Response.json({ error: dict["enterprise.form.error.invalidEmailFormat"] }, { status: 400 })
    }

    const emailContent = `
${body.message}<br><br>
--<br>
${body.name}<br>
${body.role}<br>
${body.company ? `${body.company}<br>` : ""}${body.email}<br>
${body.phone ? `${body.phone}<br>` : ""}`.trim()

    const [lead, mail] = await Promise.all([
      createLead({
        name: body.name,
        role: body.role,
        company: body.company,
        email: body.email,
        phone: body.phone,
        message: body.message,
      }),
      AWS.sendEmail({
        to: "contact@anoma.ly",
        subject: `Enterprise Inquiry from ${body.name}`,
        body: emailContent,
        replyTo: body.email,
      }).then(
        () => true,
        (err) => {
          console.error("Failed to send enterprise email:", err)
          return false
        },
      ),
    ])

    if (!lead && !mail) {
      console.error("Enterprise inquiry delivery failed", { email: body.email })
      return Response.json({ error: dict["enterprise.form.error.internalServer"] }, { status: 500 })
    }

    return Response.json({ success: true, message: dict["enterprise.form.success.submitted"] }, { status: 200 })
  } catch (error) {
    console.error("Error processing enterprise form:", error)
    return Response.json({ error: dict["enterprise.form.error.internalServer"] }, { status: 500 })
  }
}
