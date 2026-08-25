import { type Plugin, tool } from "@opencode-ai/plugin"
import { access, mkdir } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"

type CrawlResult = {
  success?: boolean
  request?: {
    url?: string
    fetch_mode?: string
  }
  response?: {
    status_code?: number
    final_url?: string
    content_type?: string
    response_time_ms?: number
  }
  page?: {
    title?: string
    language?: string
    canonical_url?: string
  }
  content?: {
    paragraphs?: unknown[]
    text?: string
    headings?: unknown[]
  }
  error?: {
    type?: string
    message?: string
  }
}

type ProfileFields = {
  name?: string
  headline?: string
  pronouns?: string
  current_company?: string
  education?: string
  location?: string
  connections?: string
  open_to_work?: string
  profile_url?: string
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

function extractProfileFields(
  data: CrawlResult,
): ProfileFields {
  const fields: ProfileFields = {}

  const paragraphs = Array.isArray(data.content?.paragraphs)
    ? data.content!.paragraphs
        .map(cleanText)
        .filter(Boolean)
    : []

  const profileUrl =
    data.request?.url ||
    data.response?.final_url ||
    ""

  if (profileUrl) {
    fields.profile_url = profileUrl
  }

  // Find the likely profile name.
  const nameIndex = paragraphs.findIndex(
    (value) =>
      /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}$/.test(
        value,
      ) &&
      value.length <= 80,
  )

  if (nameIndex < 0) {
    return fields
  }

  fields.name = paragraphs[nameIndex]

  const afterName = paragraphs.slice(nameIndex + 1)

  // Headline is normally the first substantial text after the name.
  for (const value of afterName) {
    if (
      value.length >= 20 &&
      !/^(she\/her|he\/him|they\/them|she\/they|he\/they)$/i.test(
        value,
      ) &&
      !/^contact info$/i.test(value) &&
      !/^about$/i.test(value)
    ) {
      fields.headline = value
      break
    }
  }

  // Pronouns.
  const pronouns = afterName.find((value) =>
    /^(she\/her|he\/him|they\/them|she\/they|he\/they)$/i.test(
      value,
    ),
  )

  if (pronouns) {
    fields.pronouns = pronouns
  }

  // Location.
  const location = afterName.find((value) =>
    /^[^,\n]+,\s*[^,\n]+,\s*India$/i.test(value),
  )

  if (location) {
    fields.location = location
  }

  // Company + education.
  const companyEducation = afterName.find((value) =>
    value.includes("·"),
  )

  if (companyEducation) {
    const parts = companyEducation
      .split("·")
      .map((value) => value.trim())
      .filter(Boolean)

    if (parts[0]) {
      fields.current_company = parts[0]
    }

    if (parts[1]) {
      fields.education = parts[1]
    }
  }

  // Connections.
  const connectionIndex = afterName.findIndex((value) =>
    /^\d[\d,]*\+?$/.test(value),
  )

  if (
    connectionIndex >= 0 &&
    afterName[connectionIndex + 1]?.toLowerCase() ===
      "connections"
  ) {
    fields.connections = afterName[connectionIndex]
  }

  // Open to Work.
  const openToWorkIndex = afterName.findIndex((value) =>
    /^open to work$/i.test(value),
  )

  if (openToWorkIndex >= 0) {
    fields.open_to_work = "Yes"
  }

  return fields
}

function safeSlug(
  value: string,
): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "linkedin-profile"
  )
}

async function uniqueMarkdownPath(
  outputDir: string,
  profileName: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true })

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "_")
    .replace(/\..+/, "")

  const base = safeSlug(profileName)

  let counter = 0

  while (true) {
    const suffix =
      counter === 0
        ? ""
        : `_${counter + 1}`

    const candidate = path.join(
      outputDir,
      `${base}_${timestamp}${suffix}.md`,
    )

    try {
      await access(candidate, constants.F_OK)
      counter++
    } catch {
      return candidate
    }
  }
}

function buildMarkdown(
  data: CrawlResult,
  fields: ProfileFields,
): string {
  const lines: string[] = []

  const name =
    fields.name || "LinkedIn Profile"

  lines.push(`# ${name}`)
  lines.push("")
  lines.push("## Profile")
  lines.push("")

  const orderedFields: Array<
    [keyof ProfileFields, string]
  > = [
    ["headline", "Headline"],
    ["pronouns", "Pronouns"],
    ["current_company", "Company"],
    ["education", "Education"],
    ["location", "Location"],
    ["connections", "Connections"],
    ["open_to_work", "Open to Work"],
    ["profile_url", "Profile URL"],
  ]

  for (const [key, label] of orderedFields) {
    const value = fields[key]

    if (value) {
      lines.push(`- **${label}:** ${value}`)
    }
  }

  lines.push("")
  lines.push("## Crawl Information")
  lines.push("")

  lines.push(
    `- **HTTP Status:** ${
      data.response?.status_code ?? "Unknown"
    }`,
  )

  lines.push(
    `- **Fetch Mode:** ${
      data.request?.fetch_mode ?? "Unknown"
    }`,
  )

  lines.push(
    `- **Final URL:** ${
      data.response?.final_url ??
      data.request?.url ??
      "Unknown"
    }`,
  )

  if (data.response?.response_time_ms != null) {
    lines.push(
      `- **Response Time (ms):** ${data.response.response_time_ms}`,
    )
  }

  if (data.page?.title) {
    lines.push(
      `- **Page Title:** ${data.page.title}`,
    )
  }

  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push(
    `*Generated: ${new Date()
      .toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      })}*`,
  )
  lines.push("")

  return lines.join("\n")
}

export const ScraplingPlugin: Plugin =
  async ({ $ }) => {
    const crawlerRoot =
      "D:\\Projects\\opencode\\opencode\\standalone-crawler"

    const python =
      `${crawlerRoot}\\.venv\\Scripts\\python.exe`

    const cli =
      `${crawlerRoot}\\crawler_cli.py`

    const browserProfile =
      `${process.env.LOCALAPPDATA}\\linkedin-crawler-profile`

    const outputDir =
      `${crawlerRoot}\\crawl_output`

    return {
      tool: {
        scrapling_crawl: tool({
          description:
            "Crawl a URL using the standalone Scrapling crawler. For LinkedIn profiles, use the authenticated browser profile and save a unique structured Markdown report.",

          args: {
            url: tool.schema
              .string()
              .describe("URL to crawl"),
          },

          async execute(args) {
            try {
              const raw =
                await $`${python} ${cli} ${args.url} --mode browser --browser-profile ${browserProfile} --json --indent 2`
                  .text()

              const data =
                JSON.parse(raw) as CrawlResult

              if (data.success === false) {
                return JSON.stringify(
                  {
                    integration:
                      "SCRAPLING_PLUGIN_V2",
                    success: false,
                    error: data.error ?? null,
                  },
                  null,
                  2,
                )
              }

              const fields =
                extractProfileFields(data)

              const markdownPath =
                await uniqueMarkdownPath(
                  outputDir,
                  fields.name ||
                    "linkedin-profile",
                )

              const markdown =
                buildMarkdown(data, fields)

              await Bun.write(
                markdownPath,
                markdown,
              )

              return JSON.stringify(
                {
                  integration:
                    "SCRAPLING_PLUGIN_V2",
                  success: true,
                  profile: fields,
                  markdown_file: markdownPath,
                  crawl: {
                    status_code:
                      data.response?.status_code,
                    fetch_mode:
                      data.request?.fetch_mode,
                    final_url:
                      data.response?.final_url,
                    response_time_ms:
                      data.response
                        ?.response_time_ms,
                  },
                },
                null,
                2,
              )
            } catch (error) {
              return JSON.stringify(
                {
                  integration:
                    "SCRAPLING_PLUGIN_V2",
                  success: false,
                  error:
                    error instanceof Error
                      ? error.message
                      : String(error),
                },
                null,
                2,
              )
            }
          },
        }),
      },
    }
  }

export default ScraplingPlugin
