import type { UiDocument, UiSection, UiTheme } from "./model"

export function renderUiDocument(document: UiDocument) {
  return `<!doctype html>
<html lang="en" data-theme="${document.theme.mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}</title>
<style>${styles(document.theme)}</style>
</head>
<body>
${navigation(document)}
<main>
${document.sections.filter((section) => section.kind !== "footer").map((section) => renderSection(section)).join("\n")}
</main>
${footer(document)}
</body>
</html>`
}

function navigation(document: UiDocument) {
  const links = document.sections
    .filter((section) => ["features", "pricing", "testimonial", "table"].includes(section.kind))
    .slice(0, 4)
    .map((section) => `<a href="#${escapeAttribute(section.kind)}">${escapeHtml(navLabel(section.kind))}</a>`)
    .join("")

  return `<header class="nav"><div class="container nav-inner">
<a class="brand" href="#top"><span class="brand-mark"></span>${escapeHtml(document.title)}</a>
<nav class="nav-links">${links}</nav>
<a class="button button-small" href="#contact">Get started</a>
</div></header>`
}

function navLabel(kind: UiSection["kind"]) {
  if (kind === "features") return "Features"

  if (kind === "pricing") return "Pricing"

  if (kind === "testimonial") return "Customers"

  if (kind === "table") return "Activity"

  return "Contact"
}

function renderSection(section: UiSection) {
  switch (section.kind) {
    case "hero":
      return hero(section)
    case "features":
      return features(section)
    case "stats":
      return stats(section)
    case "pricing":
      return pricing(section)
    case "testimonial":
      return testimonial(section)
    case "cta":
      return cta(section)
    case "form":
      return form(section)
    case "table":
      return table(section)
    case "footer":
      return ""
  }
}

function hero(section: UiSection) {
  const actions = section.items
    .slice(0, 2)
    .map((item) => button(item.title, item.body === "secondary" ? "secondary" : "primary"))
    .join("")

  return `<section class="hero" id="top"><div class="container hero-inner">
<div class="eyebrow"><span class="eyebrow-dot"></span>Now in open beta</div>
<h1>${escapeHtml(section.title)}</h1>
${section.body ? `<p class="lede">${escapeHtml(section.body)}</p>` : ""}
${actions ? `<div class="actions">${actions}</div>` : ""}
</div></section>`
}

function features(section: UiSection) {
  const cards = section.items
    .map(
      (item) => `<article class="card feature">
<span class="feature-icon" aria-hidden="true"></span>
<h3>${escapeHtml(item.title)}</h3>
${item.body ? `<p>${escapeHtml(item.body)}</p>` : ""}
</article>`,
    )
    .join("")

  return `<section class="section" id="features"><div class="container">
${sectionHeading(section)}
<div class="grid grid-3">${cards}</div>
</div></section>`
}

function stats(section: UiSection) {
  const cells = section.items
    .map(
      (item) => `<div class="stat">
<strong>${escapeHtml(item.title)}</strong>
${item.body ? `<span>${escapeHtml(item.body)}</span>` : ""}
</div>`,
    )
    .join("")

  return `<section class="section section-tight" id="stats"><div class="container">
<div class="stats">${cells}</div>
</div></section>`
}

function pricing(section: UiSection) {
  const cards = section.items
    .map((item, index) => {
      const [price = "", description = "", ...features] = (item.body ?? "").split("|")
      const highlighted = index === 1 ? " featured" : ""

      return `<article class="card plan${highlighted}">
<div class="plan-head">
<span class="plan-name">${escapeHtml(item.title)}</span>
${index === 1 ? `<span class="badge">Most popular</span>` : ""}
</div>
<div class="price">${escapeHtml(price)}<span>/mo</span></div>
<p>${escapeHtml(description)}</p>
<ul>${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
${button(index === 1 ? "Choose Team" : "Choose plan", index === 1 ? "primary" : "secondary")}
</article>`
    })
    .join("")

  return `<section class="section" id="pricing"><div class="container">
${sectionHeading(section)}
<div class="grid grid-3">${cards}</div>
</div></section>`
}

function testimonial(section: UiSection) {
  const author = section.items[0]

  return `<section class="section" id="testimonial"><div class="container">
<figure class="quote">
<blockquote>${escapeHtml(section.body ?? section.title)}</blockquote>
<figcaption>${author ? `<strong>${escapeHtml(author.title)}</strong><span>${escapeHtml(author.body ?? "")}</span>` : escapeHtml(section.title)}</figcaption>
</figure>
</div></section>`
}

function cta(section: UiSection) {
  const action = section.items[0]

  return `<section class="section" id="contact"><div class="container">
<div class="cta-card">
<h2>${escapeHtml(section.title)}</h2>
${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}
${action ? `<div class="actions">${button(action.title, "primary")}</div>` : ""}
</div>
</div></section>`
}

function form(section: UiSection) {
  const fields = section.items
    .map((item) => {
      const id = `field-${escapeAttribute(item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`

      const control =
        item.body === "textarea"
          ? `<textarea id="${id}" rows="4" placeholder="${escapeAttribute(item.title)}"></textarea>`
          : `<input id="${id}" type="${item.body === "email" ? "email" : "text"}" placeholder="${escapeAttribute(item.title)}">`

      return `<label class="field" for="${id}"><span>${escapeHtml(item.title)}</span>${control}</label>`
    })
    .join("")

  return `<section class="section" id="contact"><div class="container form-layout">
<div>
${sectionHeading({ ...section, body: section.body ?? "Tell us a little about what you need. We reply within two working days." })}
</div>
<form class="card form-card">
${fields}
<button class="button" type="button">Send message</button>
</form>
</div></section>`
}

function table(section: UiSection) {
  const rows = section.items
    .map(
      (item) => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.body ?? "")}</td><td><span class="status">Completed</span></td></tr>`,
    )
    .join("")

  return `<section class="section" id="activity"><div class="container">
${sectionHeading(section)}
<div class="card table-card"><table><thead><tr><th>Activity</th><th>Detail</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
</div></section>`
}

function footer(document: UiDocument) {
  const section = document.sections.find((item) => item.kind === "footer")

  return `<footer class="footer"><div class="container footer-inner">
<span>${escapeHtml(section?.title ?? document.title)}</span>
<span>${escapeHtml(section?.body ?? "Built with care.")}</span>
</div></footer>`
}

function sectionHeading(section: UiSection) {
  return `<div class="section-head">
${section.body ? `<p class="kicker">${escapeHtml(section.kind)}</p>` : ""}
<h2>${escapeHtml(section.title)}</h2>
${section.body ? `<p class="section-copy">${escapeHtml(section.body)}</p>` : ""}
</div>`
}

function button(label: string, variant: "primary" | "secondary") {
  return `<a class="button${variant === "secondary" ? " button-secondary" : ""}" href="#contact">${escapeHtml(label)}</a>`
}

function styles(theme: UiTheme) {
  const dark = theme.mode === "dark"
  const accent = theme.accent
  const accentRgb = hexToRgb(accent)
  const background = dark ? "#111214" : "#f7f7f5"
  const surface = dark ? "#191b1f" : "#ffffff"
  const raised = dark ? "#202228" : "#fbfbfa"
  const text = dark ? "#f1f2f3" : "#18191b"
  const muted = dark ? "#a2a6ad" : "#6b6e73"
  const border = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.09)"
  const shadow = dark ? "0 24px 60px rgba(0,0,0,0.28)" : "0 24px 60px rgba(0,0,0,0.08)"

  const font =
    theme.font === "serif"
      ? 'Georgia, "Times New Roman", serif'
      : theme.font === "mono"
        ? '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
        : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

  return `
:root {
  --accent: ${accent};
  --accent-soft: rgba(${accentRgb}, 0.14);
  --accent-line: rgba(${accentRgb}, 0.4);
  --bg: ${background};
  --surface: ${surface};
  --raised: ${raised};
  --text: ${text};
  --muted: ${muted};
  --border: ${border};
  --shadow: ${shadow};
  --radius: ${theme.radius}px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: ${font}; -webkit-font-smoothing: antialiased; line-height: 1.55; }
a { color: inherit; text-decoration: none; }
.container { width: min(1120px, calc(100% - 48px)); margin: 0 auto; }
.nav { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); }
.nav-inner { display: flex; align-items: center; gap: 28px; height: 68px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 650; letter-spacing: -0.02em; font-size: 16px; }
.brand-mark { width: 22px; height: 22px; border-radius: 7px; background: var(--accent); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); }
.nav-links { display: flex; gap: 22px; margin-inline-start: auto; font-size: 13px; color: var(--muted); }
.nav-links a:hover { color: var(--text); }
.hero { padding: 108px 0 72px; background: radial-gradient(circle at 50% 0%, var(--accent-soft), transparent 58%); }
.hero-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--accent-line); color: var(--accent); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 560; letter-spacing: 0.02em; }
.eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
h1 { max-width: 880px; margin: 24px 0 0; font-size: clamp(42px, 7vw, 76px); line-height: 1.02; letter-spacing: -0.045em; font-weight: 680; }
h2 { margin: 8px 0 0; font-size: clamp(30px, 4vw, 48px); line-height: 1.05; letter-spacing: -0.035em; font-weight: 650; }
h3 { margin: 0 0 8px; font-size: 16px; letter-spacing: -0.015em; }
.lede { max-width: 610px; margin: 22px 0 0; font-size: 17px; line-height: 1.65; color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 30px; }
.button { display: inline-flex; align-items: center; justify-content: center; height: 38px; padding: 0 18px; border-radius: calc(var(--radius) * 0.55); background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 8px 20px var(--accent-soft); }
.button:hover { filter: brightness(1.06); }
.button-small { height: 32px; padding: 0 14px; font-size: 12px; }
.button-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); box-shadow: none; }
.button-secondary:hover { background: var(--surface); }
.section { padding: 82px 0; }
.section-tight { padding-top: 36px; }
.section-head { max-width: 660px; margin-bottom: 34px; }
.kicker { margin: 0; color: var(--accent); font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.section-copy { max-width: 560px; margin: 14px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
.grid { display: grid; gap: 16px; }
.grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; box-shadow: 0 1px 0 rgba(0,0,0,0.02); }
.feature p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
.feature-icon { display: block; width: 30px; height: 30px; margin-bottom: 30px; border-radius: 9px; background: var(--accent-soft); border: 1px solid var(--accent-line); position: relative; }
.feature-icon::after { content: ""; position: absolute; inset: 9px; border-radius: 4px; background: var(--accent); opacity: 0.8; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 28px 0; }
.stat { display: flex; flex-direction: column; gap: 3px; padding-inline: 24px; border-inline-start: 1px solid var(--border); }
.stat:first-child { border-inline-start: 0; padding-inline-start: 0; }
.stat strong { font-size: clamp(30px, 4vw, 44px); line-height: 1; letter-spacing: -0.04em; font-weight: 660; }
.stat span { color: var(--muted); font-size: 13px; }
.plan { display: flex; flex-direction: column; gap: 0; background: var(--surface); }
.plan.featured { border-color: var(--accent-line); box-shadow: var(--shadow); }
.plan-head { display: flex; align-items: center; justify-content: space-between; }
.plan-name { font-weight: 620; }
.badge { background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 600; }
.price { margin: 22px 0 6px; font-size: 42px; line-height: 1; letter-spacing: -0.045em; font-weight: 660; }
.price span { color: var(--muted); font-size: 14px; font-weight: 450; letter-spacing: 0; }
.plan p { margin: 0 0 18px; color: var(--muted); font-size: 13px; }
.plan ul { margin: 0 0 24px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.plan li::before { content: "✓"; color: var(--accent); margin-inline-end: 8px; }
.plan .button { margin-top: auto; width: 100%; }
.quote { margin: 0; padding: 54px; border-radius: calc(var(--radius) * 1.2); background: var(--surface); border: 1px solid var(--border); text-align: center; }
blockquote { margin: 0 auto; max-width: 780px; font-size: clamp(22px, 3vw, 32px); line-height: 1.35; letter-spacing: -0.025em; }
figcaption { display: flex; flex-direction: column; gap: 2px; margin-top: 24px; color: var(--muted); font-size: 13px; }
figcaption strong { color: var(--text); font-size: 13px; }
.cta-card { text-align: center; padding: 68px 32px; border-radius: calc(var(--radius) * 1.35); background: linear-gradient(180deg, var(--surface), var(--raised)); border: 1px solid var(--border); box-shadow: var(--shadow); }
.cta-card p { max-width: 520px; margin: 16px auto 0; color: var(--muted); }
.cta-card .actions { margin-top: 26px; }
.form-layout { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 56px; align-items: start; }
.form-card { display: flex; flex-direction: column; gap: 16px; padding: 28px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
.field input, .field textarea { width: 100%; border: 1px solid var(--border); border-radius: calc(var(--radius) * 0.5); background: var(--bg); color: var(--text); font: inherit; font-size: 13px; padding: 11px 12px; outline: none; resize: vertical; }
.field input:focus, .field textarea:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.form-card .button { align-self: flex-start; border: 0; cursor: pointer; font: inherit; font-size: 13px; }
.table-card { padding: 0; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: start; padding: 13px 20px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 1px solid var(--border); }
td { padding: 15px 20px; border-bottom: 1px solid var(--border); color: var(--muted); }
tr:last-child td { border-bottom: 0; }
td strong { color: var(--text); font-weight: 550; }
.status { display: inline-flex; border-radius: 999px; background: var(--accent-soft); color: var(--accent); padding: 3px 8px; font-size: 11px; font-weight: 560; }
.footer { border-top: 1px solid var(--border); padding: 28px 0; }
.footer-inner { display: flex; justify-content: space-between; gap: 16px; color: var(--muted); font-size: 12px; }
@media (max-width: 820px) {
  .nav-links { display: none; }
  .grid-3, .form-layout { grid-template-columns: 1fr; }
  .hero { padding-top: 78px; }
  .stats { grid-template-columns: 1fr; gap: 0; padding: 0; }
  .stat { border-inline-start: 0; border-top: 1px solid var(--border); padding: 18px 0; }
  .stat:first-child { border-top: 0; }
  .quote { padding: 30px; }
  .section { padding: 56px 0; }
  .footer-inner { flex-direction: column; }
}
`
}

function hexToRgb(value: string) {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)).join(", ")
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;"

    if (character === "<") return "&lt;"

    if (character === ">") return "&gt;"

    if (character === '"') return "&quot;"

    return "&#39;"
  })
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/\n/g, " ")
}
