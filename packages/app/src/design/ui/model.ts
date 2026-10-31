import { uuid } from "@opencode/util/uuid"

export type UiTemplate = "landing" | "pricing" | "dashboard" | "portfolio" | "contact"

export type UiSectionKind = "hero" | "features" | "stats" | "pricing" | "testimonial" | "cta" | "form" | "table" | "footer"

export type UiSectionItem = {
  id: string
  title: string
  body?: string
}

export type UiSection = {
  id: string
  kind: UiSectionKind
  title: string
  body?: string
  items: UiSectionItem[]
}

export type UiTheme = {
  mode: "light" | "dark"
  accent: string
  font: "sans" | "serif" | "mono"
  radius: number
}

export type UiDocument = {
  version: 1
  template: UiTemplate
  title: string
  theme: UiTheme
  sections: UiSection[]
}

export type UiNoticeKey =
  | "design.ui.notice.created"
  | "design.ui.notice.updated"
  | "design.ui.notice.added"
  | "design.ui.notice.removed"
  | "design.ui.notice.reset"
  | "design.ui.notice.unknown"
  | "design.ui.notice.empty"
  | "design.ui.notice.renamed"

export type UiPromptOutcome = {
  document: UiDocument
  ok: boolean
  notice: { key: UiNoticeKey; params?: Record<string, string | number> }
}

export const UI_TEMPLATES: UiTemplate[] = ["landing", "pricing", "dashboard", "portfolio", "contact"]

export const UI_ACCENTS = ["#4f6bed", "#2f9e76", "#d78b2a", "#d05270", "#9a6be8", "#2a9db0", "#6a7482"]

const templateWords: Record<string, UiTemplate> = {
  landing: "landing",
  homepage: "landing",
  home: "landing",
  startseite: "landing",
  "landing page": "landing",
  pricing: "pricing",
  preise: "pricing",
  "pricing page": "pricing",
  dashboard: "dashboard",
  admin: "dashboard",
  portal: "dashboard",
  portfolio: "portfolio",
  showcase: "portfolio",
  contact: "contact",
  kontakt: "contact",
  "contact page": "contact",
  form: "contact",
  formular: "contact",
}

const sectionWords: Record<string, UiSectionKind> = {
  hero: "hero",
  header: "hero",
  features: "features",
  feature: "features",
  funktionen: "features",
  stats: "stats",
  statistics: "stats",
  metrics: "stats",
  zahlen: "stats",
  pricing: "pricing",
  prices: "pricing",
  preise: "pricing",
  testimonial: "testimonial",
  testimonials: "testimonial",
  quote: "testimonial",
  kundenstimmen: "testimonial",
  cta: "cta",
  "call to action": "cta",
  form: "form",
  contact: "form",
  formular: "form",
  kontact: "form",
  table: "table",
  activity: "table",
  tabelle: "table",
  footer: "footer",
}

const createVerbs = /\b(create|build|design|generate|start|erstelle|erstellen|baue|bauen|entwirf|entwerfen|generiere)\b/i

const addVerbs = /\b(add|insert|include|append|füge|fuege|hinzufügen|hinzufuegen|ergänze|ergaenze)\b/i

const removeVerbs = /\b(remove|delete|drop|lösche|loesche|entferne|entfernen)\b/i

const resetVerbs = /\b(reset|start over|clear|leeren|zurücksetzen|zuruecksetzen)\b/i

const renameVerbs = /\b(rename|call it|name it|benenne|umbenennen|nenne)\b/i

const accentWords: Record<string, string> = {
  blue: "#4f6bed",
  blau: "#4f6bed",
  green: "#2f9e76",
  grün: "#2f9e76",
  gruen: "#2f9e76",
  orange: "#d78b2a",
  red: "#d05270",
  rot: "#d05270",
  pink: "#d05270",
  purple: "#9a6be8",
  lila: "#9a6be8",
  violet: "#9a6be8",
  teal: "#2a9db0",
  türkis: "#2a9db0",
  tuerkis: "#2a9db0",
  gray: "#6a7482",
  grey: "#6a7482",
  grau: "#6a7482",
}

export function createUiDocument(template: UiTemplate = "landing", title?: string): UiDocument {
  const content = templateContent(template)

  return {
    version: 1,
    template,
    title: title?.trim() || content.title,
    theme: defaultTheme(template === "dashboard" ? "dark" : "light"),
    sections: content.sections.map(createSection),
  }
}

export function defaultTheme(mode: UiTheme["mode"] = "light"): UiTheme {
  return { mode, accent: UI_ACCENTS[0]!, font: "sans", radius: 14 }
}

export function parseUiDocument(input: unknown): UiDocument | undefined {
  if (!isRecord(input) || (input.version !== undefined && input.version !== 1) || !Array.isArray(input.sections))
    return
  const rawTemplate = typeof input.template === "string" ? input.template.toLowerCase().trim() : undefined
  const template = UI_TEMPLATES.find((value) => value === rawTemplate) ?? "landing"
  const title = typeof input.title === "string" && input.title.trim() ? input.title : "Untitled page"
  const theme = isRecord(input.theme) ? input.theme : {}
  const mode = theme.mode === "dark" ? "dark" : "light"
  const font = theme.font === "serif" || theme.font === "mono" ? theme.font : "sans"
  const accent = typeof theme.accent === "string" && /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : UI_ACCENTS[0]!
  const radius = typeof theme.radius === "number" && Number.isFinite(theme.radius) ? theme.radius : 14
  const seen = new Set<string>()

  const sections = input.sections.flatMap((item) => {
    if (!isRecord(item) || typeof item.title !== "string") return []
    const rawKind = typeof item.kind === "string" ? item.kind.toLowerCase().trim() : undefined
    const kind = Object.values(sectionWords).find((value) => value === rawKind)

    if (!kind) return []

    const items = Array.isArray(item.items)
      ? item.items.flatMap((entry) => {
          if (!isRecord(entry) || typeof entry.title !== "string") return []

          return [
            {
              id: uniqueID(seen, typeof entry.id === "string" ? entry.id : undefined),
              title: entry.title,
              body: typeof entry.body === "string" ? entry.body : undefined,
            },
          ]
        })
      : []

    return [
      {
        id: uniqueID(seen, typeof item.id === "string" ? item.id : undefined),
        kind,
        title: item.title,
        body: typeof item.body === "string" ? item.body : undefined,
        items,
      },
    ]
  })

  return {
    version: 1,
    template,
    title,
    theme: { mode, accent, font, radius },
    sections,
  }
}

function uniqueID(seen: Set<string>, value: string | undefined) {
  const candidate = value && !seen.has(value) ? value : uuid()

  seen.add(candidate)

  return candidate
}

export function interpretUiPrompt(document: UiDocument, prompt: string): UiPromptOutcome {
  const text = prompt.trim()
  const lower = text.toLowerCase()

  if (!text) return fail(document, "design.ui.notice.empty")

  if (resetVerbs.test(lower))
    return {
      document: createUiDocument("landing", document.title),
      ok: true,
      notice: { key: "design.ui.notice.reset" },
    }

  const template = findTemplate(lower)

  const styleIntent =
    /\b(dark|dunkel|light|hell|serif|serifen|mono|monospace|sans|rounded|round|soft|sharp|square|kantig|eckig)\b/i.test(
      lower,
    ) || !!parseAccent(lower)

  if (template && (createVerbs.test(lower) || (!addVerbs.test(lower) && !styleIntent))) {
    const title = parseQuotedTitle(text)
    const document = applyStyle(createUiDocument(template, title), lower)

    return {
      document,
      ok: true,
      notice: { key: "design.ui.notice.created", params: { template } },
    }
  }

  if (addVerbs.test(lower)) {
    const kind = findSection(lower)

    if (kind) {
      const section = createSection(defaultSection(kind))
      const title = parseNamed(text)

      if (title) section.title = title

      return {
        document: { ...document, sections: [...document.sections.filter((item) => item.kind !== "footer"), section, footerSection(document)] },
        ok: true,
        notice: { key: "design.ui.notice.added", params: { section: kind } },
      }
    }
  }

  if (removeVerbs.test(lower)) {
    const kind = findSection(lower)

    if (!kind) return fail(document, "design.ui.notice.unknown")
    const sections = document.sections.filter((item) => item.kind !== kind)

    return {
      document: { ...document, sections },
      ok: true,
      notice: { key: "design.ui.notice.removed", params: { section: kind } },
    }
  }

  if (/\b(dark|dunkel|dark mode|nacht)\b/i.test(lower))
    return themed(document, { mode: "dark" }, "design.ui.notice.updated")

  if (/\b(light|hell|light mode|tag)\b/i.test(lower))
    return themed(document, { mode: "light" }, "design.ui.notice.updated")

  if (/\b(serif|serifen)\b/i.test(lower)) return themed(document, { font: "serif" }, "design.ui.notice.updated")

  if (/\b(mono|monospace|code font)\b/i.test(lower)) return themed(document, { font: "mono" }, "design.ui.notice.updated")

  if (/\b(sans|sans-serif|clean font)\b/i.test(lower)) return themed(document, { font: "sans" }, "design.ui.notice.updated")

  if (/\b(rounded|round|soft|weich|abgerundet)\b/i.test(lower))
    return themed(document, { radius: 22 }, "design.ui.notice.updated")

  if (/\b(sharp|square|kantig|eckig)\b/i.test(lower))
    return themed(document, { radius: 2 }, "design.ui.notice.updated")

  const accent = parseAccent(lower)

  if (accent) return themed(document, { accent }, "design.ui.notice.updated")

  if (renameVerbs.test(lower) || /\b(title|headline|titel|überschrift|ueberschrift)\b/i.test(lower)) {
    const title = parseTitle(text)

    if (!title) return fail(document, "design.ui.notice.unknown")

    const sections = document.sections.map((section) =>
      section.kind === "hero" ? { ...section, title } : section,
    )

    return {
      document: { ...document, title, sections },
      ok: true,
      notice: { key: "design.ui.notice.renamed", params: { title } },
    }
  }

  if (template) {
    return {
      document: applyStyle(createUiDocument(template, document.title), lower),
      ok: true,
      notice: { key: "design.ui.notice.created", params: { template } },
    }
  }

  return fail(document, "design.ui.notice.unknown")
}

function applyStyle(document: UiDocument, text: string): UiDocument {
  const theme = { ...document.theme }
  const accent = parseAccent(text)

  if (/\b(dark|dunkel|dark mode|nacht)\b/i.test(text)) theme.mode = "dark"

  if (/\b(light|hell|light mode|tag)\b/i.test(text)) theme.mode = "light"

  if (accent) theme.accent = accent

  if (/\b(serif|serifen)\b/i.test(text)) theme.font = "serif"

  if (/\b(mono|monospace|code font)\b/i.test(text)) theme.font = "mono"

  if (/\b(sans|sans-serif|clean font)\b/i.test(text)) theme.font = "sans"

  if (/\b(rounded|round|soft|weich|abgerundet)\b/i.test(text)) theme.radius = 22

  if (/\b(sharp|square|kantig|eckig)\b/i.test(text)) theme.radius = 2

  return { ...document, theme }
}

function themed(document: UiDocument, patch: Partial<UiTheme>, key: UiNoticeKey): UiPromptOutcome {
  return {
    document: { ...document, theme: { ...document.theme, ...patch } },
    ok: true,
    notice: { key },
  }
}

function fail(document: UiDocument, key: UiNoticeKey): UiPromptOutcome {
  return { document, ok: false, notice: { key } }
}

function findTemplate(text: string) {
  return Object.entries(templateWords)
    .toSorted((a, b) => b[0].length - a[0].length)
    .find(([word]) => containsWord(text, word))?.[1]
}

function findSection(text: string): UiSectionKind | undefined {
  return Object.entries(sectionWords)
    .toSorted((a, b) => b[0].length - a[0].length)
    .find(([word]) => containsWord(text, word))?.[1]
}

function containsWord(text: string, word: string) {
  if (word.includes(" ")) return text.includes(word)

  return new RegExp(`(^|[^a-zäöüß])${word}([^a-zäöüß]|$)`, "i").test(text)
}

function parseAccent(text: string) {
  const hex = text.match(/#([0-9a-f]{6})\b/i)?.[1]

  if (hex) return `#${hex}`.toLowerCase()

  return Object.entries(accentWords)
    .filter(([word]) => containsWord(text, word))
    .toSorted((a, b) => b[0].length - a[0].length)[0]?.[1]
}

function parseQuotedTitle(text: string) {
  const quoted = text.match(/["']([^"']{2,80})["']/)?.[1]
  const named = text.match(/\b(?:called|named|for|heißt|heisst|namens|für|fuer)\s+([a-z0-9äöüß &'.-]{2,80})/i)?.[1]

  return quoted?.trim() || named?.replace(/[.,;!?]+$/, "").trim()
}

function parseTitle(text: string) {
  const explicit = parseQuotedTitle(text)

  if (explicit) return explicit

  const match = text.match(
    /\b(?:to|as|zu|als|in)\s+([a-z0-9äöüß &'.,:!?-]{2,80})$/i,
  )?.[1]

  return match?.replace(/[.,;!?]+$/, "").trim()
}

function parseNamed(text: string) {
  const quoted = text.match(/["']([^"']{2,80})["']/)?.[1]

  if (quoted) return quoted.trim()

  return text.match(/\b(?:called|named|heißt|heisst|namens)\s+([a-z0-9äöüß &'.-]{2,80})/i)?.[1]?.trim()
}

function createSection(section: SectionContent): UiSection {
  return { ...section, id: uuid(), items: section.items.map((item) => ({ ...item, id: uuid() })) }
}

function footerSection(document: UiDocument): UiSection {
  const existing = document.sections.find((section) => section.kind === "footer")

  if (existing) return existing

  return createSection(defaultSection("footer"))
}

type SectionContent = Omit<UiSection, "id" | "items"> & { items: Array<Omit<UiSectionItem, "id">> }

function templateContent(template: UiTemplate): { title: string; sections: SectionContent[] } {
  switch (template) {
    case "landing":
      return {
        title: "Northstar",
        sections: [
          {
            kind: "hero",
            title: "Design once. Ship everywhere.",
            body: "A clear, fast interface for teams that care about the details. Build your next product with a foundation that already feels finished.",
            items: [
              { title: "Get started", body: "primary" },
              { title: "See how it works", body: "secondary" },
            ],
          },
          {
            kind: "features",
            title: "Everything you need",
            body: "A small set of sharp tools instead of a drawer full of loose parts.",
            items: [
              { title: "Fast by default", body: "Every interaction responds immediately, from the first paint to the last keystroke." },
              { title: "Built to scale", body: "Start with a single idea and grow into a product your whole team can rely on." },
              { title: "Made for teams", body: "Shared patterns keep design and engineering moving in the same direction." },
            ],
          },
          {
            kind: "stats",
            title: "Trusted in production",
            items: [
              { title: "12k+", body: "Teams building with us" },
              { title: "99.99%", body: "Uptime across regions" },
              { title: "4.9/5", body: "Average customer rating" },
            ],
          },
          {
            kind: "testimonial",
            title: "A calmer way to build",
            body: "It feels like the product reads our minds. The small details add up to something that finally feels considered.",
            items: [{ title: "Mara Jensen", body: "Head of Product, Fieldnote" }],
          },
          {
            kind: "cta",
            title: "Ready to build something clear?",
            body: "Start free. Invite your team when you are ready.",
            items: [{ title: "Create an account", body: "primary" }],
          },
          { kind: "footer", title: "Northstar", body: "A quiet foundation for loud ideas.", items: [] },
        ],
      }
    case "pricing":
      return {
        title: "Northstar Pricing",
        sections: [
          {
            kind: "hero",
            title: "Simple pricing that scales with you",
            body: "Start free, then pick a plan when your team is ready. No setup fees and no surprises.",
            items: [],
          },
          {
            kind: "pricing",
            title: "Plans for every stage",
            items: [
              { title: "Starter", body: "$0|For side projects and early experiments.|1 project|Community support|1 seat" },
              { title: "Team", body: "$19|For teams shipping every week.|Unlimited projects|Priority support|10 seats" },
              { title: "Scale", body: "$49|For products with real traffic.|SSO and audit logs|Dedicated support|Unlimited seats" },
            ],
          },
          {
            kind: "cta",
            title: "Not sure which plan fits?",
            body: "Talk to us and we will help you choose.",
            items: [{ title: "Contact sales", body: "primary" }],
          },
          { kind: "footer", title: "Northstar", body: "Pricing that stays out of your way.", items: [] },
        ],
      }
    case "dashboard":
      return {
        title: "Northstar Dashboard",
        sections: [
          {
            kind: "hero",
            title: "Overview",
            body: "Here is what is happening across your workspace today.",
            items: [],
          },
          {
            kind: "stats",
            title: "At a glance",
            items: [
              { title: "2,481", body: "Active users +12.4%" },
              { title: "$48.2k", body: "Revenue this month +8.1%" },
              { title: "3.8%", body: "Conversion rate +0.6%" },
            ],
          },
          {
            kind: "table",
            title: "Recent activity",
            items: [
              { title: "New workspace created", body: "Vela Studio · 2 minutes ago" },
              { title: "Plan upgraded", body: "Fieldnote · 18 minutes ago" },
              { title: "Member invited", body: "Northstar Labs · 43 minutes ago" },
              { title: "Invoice paid", body: "Harbor and Co. · 1 hour ago" },
            ],
          },
          { kind: "footer", title: "Northstar", body: "Workspace analytics.", items: [] },
        ],
      }
    case "portfolio":
      return {
        title: "Mira Vale",
        sections: [
          {
            kind: "hero",
            title: "Selected work, made with care.",
            body: "Independent product designer working across brand, interface and motion.",
            items: [{ title: "View projects", body: "primary" }],
          },
          {
            kind: "features",
            title: "Recent projects",
            items: [
              { title: "Fieldnote", body: "A calmer workspace for research teams." },
              { title: "Harbor", body: "Brand and product for a logistics platform." },
              { title: "Vela", body: "An editorial portfolio for a small studio." },
            ],
          },
          {
            kind: "testimonial",
            title: "Working together",
            body: "Mira turns fuzzy ideas into interfaces that feel obvious. The process is calm and the work is precise.",
            items: [{ title: "Jonas Lind", body: "Founder, Fieldnote" }],
          },
          {
            kind: "cta",
            title: "Have a project in mind?",
            body: "I take on a small number of collaborations each season.",
            items: [{ title: "Get in touch", body: "primary" }],
          },
          { kind: "footer", title: "Mira Vale", body: "Product design studio.", items: [] },
        ],
      }
    case "contact":
      return {
        title: "Contact Northstar",
        sections: [
          {
            kind: "hero",
            title: "Let's talk about your next product.",
            body: "Tell us what you are building and we will get back to you within two working days.",
            items: [],
          },
          {
            kind: "form",
            title: "Send a message",
            items: [
              { title: "Name", body: "text" },
              { title: "Email", body: "email" },
              { title: "Company", body: "text" },
              { title: "How can we help?", body: "textarea" },
            ],
          },
          { kind: "footer", title: "Northstar", body: "Clear products, built together.", items: [] },
        ],
      }
  }
}

function defaultSection(kind: UiSectionKind): SectionContent {
  if (kind === "footer") return { kind, title: "Northstar", body: "Built with care.", items: [] }

  if (kind === "features")
    return {
      kind,
      title: "Built for the work",
      body: "A few sharp tools, arranged with intent.",
      items: [
        { title: "Simple", body: "Fewer moving parts and a clearer path." },
        { title: "Fast", body: "Responsive from the first click." },
        { title: "Considered", body: "Details that hold up under use." },
      ],
    }

  if (kind === "stats")
    return {
      kind,
      title: "By the numbers",
      items: [
        { title: "10k+", body: "Monthly users" },
        { title: "99.9%", body: "Uptime" },
        { title: "4.9/5", body: "Satisfaction" },
      ],
    }

  if (kind === "pricing")
    return {
      kind,
      title: "Simple pricing",
      items: [
        { title: "Starter", body: "$0|For trying things out.|1 project|Community support" },
        { title: "Team", body: "$19|For growing teams.|Unlimited projects|Priority support" },
        { title: "Scale", body: "$49|For serious products.|SSO|Dedicated support" },
      ],
    }

  if (kind === "testimonial")
    return {
      kind,
      title: "Loved by teams",
      body: "A calmer, clearer way to build. The details make the difference.",
      items: [{ title: "Alex Rivera", body: "Design lead" }],
    }

  if (kind === "form")
    return {
      kind,
      title: "Get in touch",
      items: [
        { title: "Name", body: "text" },
        { title: "Email", body: "email" },
        { title: "Message", body: "textarea" },
      ],
    }

  if (kind === "table")
    return {
      kind,
      title: "Recent activity",
      items: [
        { title: "New workspace created", body: "2 minutes ago" },
        { title: "Plan upgraded", body: "18 minutes ago" },
        { title: "Invoice paid", body: "1 hour ago" },
      ],
    }

  if (kind === "cta")
    return {
      kind,
      title: "Ready to get started?",
      body: "Start free and invite your team when you are ready.",
      items: [{ title: "Get started", body: "primary" }],
    }

  return {
    kind,
    title: "A clear place to start",
    body: "Build something that feels considered from the first screen.",
    items: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
