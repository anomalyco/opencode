import type { APIEvent } from "@solidjs/start/server"
import { AWS } from "@opencode-ai/console-core/aws.js"

interface EnterpriseFormData {
  name: string
  role: string
  email: string
  message: string
}

export async function POST(event: APIEvent) {
  try {
    const body = (await event.request.json()) as EnterpriseFormData

    // Validate required fields
    if (!body.name || !body.role || !body.email || !body.message) {
      return Response.json({ error: "All fields are required" }, { status: 400 })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return Response.json({ error: "Invalid email format" }, { status: 400 })
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

    return Response.json({ success: true, message: "Form submitted successfully" }, { status: 200 })
  } catch (error) {
    console.error("Error processing enterprise form:", error)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
