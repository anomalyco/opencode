import type { APIEvent } from "@solidjs/start/server"
import { AWS } from "@opencode-ai/console-core/aws.js"

interface EnterpriseFormData {
  name: string
  role: string
  email: string
  message: string
}

// Rate limiting store: tracks requests per IP address
// Format: { "ip_address": { count: number, resetTime: number } }
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 5 // Max 5 requests per window

function getRateLimitKey(event: APIEvent): string {
  // Get the client IP address from headers or socket
  const forwardedFor = event.request.headers.get("x-forwarded-for")
  const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown"
  return clientIp
}

function checkRateLimit(key: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const rateLimitEntry = rateLimitStore.get(key)

  if (!rateLimitEntry) {
    // First request from this IP
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true }
  }

  // Check if the rate limit window has expired
  if (now > rateLimitEntry.resetTime) {
    // Reset the counter for a new window
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true }
  }

  // Check if we've exceeded the limit
  if (rateLimitEntry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((rateLimitEntry.resetTime - now) / 1000)
    return { allowed: false, retryAfter }
  }

  // Increment the counter
  rateLimitEntry.count += 1
  return { allowed: true }
}

export async function POST(event: APIEvent) {
  try {
    // Apply rate limiting before processing the request
    const rateLimitKey = getRateLimitKey(event)
    const rateLimitCheck = checkRateLimit(rateLimitKey)

    if (!rateLimitCheck.allowed) {
      return Response.json(
        { error: "Too many requests. Please try again later." },
        { 
          status: 429,
          headers: {
            "Retry-After": rateLimitCheck.retryAfter?.toString() || "60",
          },
        }
      )
    }

    // Enforce JSON body size limit (1 MB)
    const contentLength = event.request.headers.get("content-length")
    const MAX_BODY_SIZE = 1024 * 1024 // 1 MB
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return Response.json(
        { error: "Request body too large" },
        { status: 413 }
      )
    }

    let body: EnterpriseFormData
    try {
      body = (await event.request.json()) as EnterpriseFormData
    } catch (parseError) {
      console.error("Error parsing JSON body:", parseError)
      return Response.json(
        { error: "Invalid JSON format" },
        { status: 400 }
      )
    }

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
