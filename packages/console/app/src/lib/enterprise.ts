import { sendEmail } from "~/lib/aws"
import { Resource } from "@opencode/console-resource"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { createLead } from "~/lib/salesforce"
import { inferenceSpendOptions } from "~/lib/inference-spend"
import { ENTERPRISE_SPAM_THRESHOLD, enterpriseSpamProbability } from "~/lib/enterprise-spam"
import { verifyHcaptcha } from "~/lib/hcaptcha"

interface EnterpriseFormData {
  name: string
  role: string
  company?: string
  email: string
  phone?: string
  inferenceSpend?: string
  alias?: string
  message: string
  captcha?: string
}

const EMAIL_OCTOPUS_LIST_ID = "1b381e5e-39bd-11f1-ba4a-cdd4791f0c43"

function splitFullName(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return { firstName: "", lastName: "" }
  if (parts.length === 1) return { firstName: parts[0], lastName: "" }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function enterpriseEmailContent(body: EnterpriseFormData, inferenceSpend?: string) {
  const field = (value?: unknown) => (value ? `${escapeHtml(value)}<br>` : "")
  return {
    html: `
${escapeHtml(body.message)}<br><br>
${inferenceSpend ? `Current monthly inference spend: ${escapeHtml(inferenceSpend)}<br><br>` : ""}
--<br>
${field(body.name)}
${field(body.role)}
${field(body.company)}${field(body.email)}
${field(body.phone)}`.trim(),
    text: [
      body.message,
      "",
      ...(inferenceSpend ? [`Current monthly inference spend: ${inferenceSpend}`, ""] : []),
      "--",
      ...[body.name, body.role, body.company, body.email, body.phone].filter(Boolean),
    ].join("\n"),
  }
}

function subscribe(email: string, fullName: string) {
  const name = splitFullName(fullName)
  const fields: Record<string, string> = {}
  if (name.firstName) fields.FirstName = name.firstName
  if (name.lastName) fields.LastName = name.lastName

  const payload: { email_address: string; fields?: Record<string, string> } = { email_address: email }
  if (Object.keys(fields).length) payload.fields = fields

  return fetch(`https://api.emailoctopus.com/lists/${EMAIL_OCTOPUS_LIST_ID}/contacts`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${Resource.EMAILOCTOPUS_API_KEY.value}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).then(
    async (res) => {
      if (!res.ok) {
        console.error("EmailOctopus subscribe failed:", res.status, res.statusText, await res.text())
        return false
      }
      return true
    },
    (err) => {
      console.error("Failed to subscribe enterprise email:", err)
      return false
    },
  )
}

export async function handleEnterpriseRequest(
  request: Request,
  options: {
    salesforceSubmit?: (payload: Record<string, unknown>) => Promise<boolean>
    notifications?: boolean
    spam?: Parameters<typeof enterpriseSpamProbability>[1]
    captcha?: Parameters<typeof verifyHcaptcha>[1]
  } = {},
) {
  const dict = i18n(localeFromRequest(request))
  try {
    const body = (await request.json()) as EnterpriseFormData
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

    const inferenceSpend = inferenceSpendOptions.find((option) => option.value === body.inferenceSpend)
    if (body.inferenceSpend && !inferenceSpend) {
      return Response.json({ error: dict["enterprise.form.error.invalidInferenceSpend"] }, { status: 400 })
    }

    if (typeof body.captcha !== "string" || !body.captcha) {
      return Response.json({ error: dict["enterprise.form.error.captcha"] }, { status: 400 })
    }
    // Fail open when hCaptcha itself is unavailable; only a rejected token blocks the lead.
    const human = await verifyHcaptcha(body.captcha, {
      remoteip: request.headers.get("cf-connecting-ip") ?? undefined,
      ...options.captcha,
    })
    if (human === false) {
      return Response.json({ error: dict["enterprise.form.error.captcha"] }, { status: 400 })
    }

    // Fail open: a missing score never blocks a lead. Confident spam gets the same
    // response as the honeypot and never reaches Salesforce, email, or EmailOctopus.
    const spam = await enterpriseSpamProbability(body, options.spam)
    if (spam !== undefined) console.info("Enterprise inquiry spam score", { probability: spam })
    if (spam !== undefined && spam >= ENTERPRISE_SPAM_THRESHOLD) {
      console.warn("Enterprise inquiry dropped as spam", { email: body.email, probability: spam })
      return Response.json({ success: true, message: dict["enterprise.form.success.submitted"] }, { status: 200 })
    }

    const emailContent = enterpriseEmailContent(body, inferenceSpend?.salesforceValue)

    const [lead, mail, octopus] = await Promise.all([
      createLead(
        {
          name: body.name,
          role: body.role,
          company: body.company,
          email: body.email,
          phone: body.phone,
          inferenceSpend: inferenceSpend?.salesforceValue,
          message: body.message,
        },
        options.salesforceSubmit,
      ).catch((err) => {
        console.error("Failed to create Salesforce lead:", err)
        return false
      }),
      options.notifications === false
        ? Promise.resolve(false)
        : sendEmail({
            to: Resource.ENTERPRISE_SALES_INBOX_EMAIL.value,
            subject: `Enterprise Inquiry from ${body.name}`,
            body: emailContent.html,
            text: emailContent.text,
            replyTo: body.email,
          }).then(
            () => true,
            (err) => {
              console.error("Failed to send enterprise email:", err)
              return false
            },
          ),
      options.notifications === false ? Promise.resolve(false) : subscribe(body.email, body.name),
    ])

    if (!lead && !mail && !octopus) {
      console.error("Enterprise inquiry delivery failed", { email: body.email })
      return Response.json({ error: dict["enterprise.form.error.internalServer"] }, { status: 500 })
    }

    return Response.json({ success: true, message: dict["enterprise.form.success.submitted"] }, { status: 200 })
  } catch (error) {
    console.error("Error processing enterprise form:", error)
    return Response.json({ error: dict["enterprise.form.error.internalServer"] }, { status: 500 })
  }
}
