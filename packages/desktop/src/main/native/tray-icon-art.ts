import { shellIcons } from "@opencode/ui/icons/shell"
import { traySessionNotification, type TraySession } from "./tray-sessions"

export type TrayActionIcon = "newAgent" | "settings" | "docs" | "quit" | "more"

export function trayMenuIconSvg(artwork: string, twoLines = false) {
  // Native menus measure the image's full width. Leave a trailing gutter
  // without scaling the artwork or changing the menu-bar icon's size.
  // For a title + sublabel, transparent space below the artwork offsets it
  // toward the first line while AppKit centers the complete image canvas.
  const height = twoLines ? 30 : 18
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="${height}" viewBox="0 0 22 ${height}">${artwork}</svg>`
}

export function trayStartupPixels(foreground = 0) {
  // The initial mark needs no SVG renderer, fonts, assets, or server connection.
  const pixels = Buffer.alloc(36 * 36 * 4)
  Array.from({ length: 36 * 36 }, (_, index) => index).forEach((index) => {
    const x = index % 36
    const y = Math.floor(index / 36)
    if (x < 6 || x >= 30 || y < 3 || y >= 32) return
    if (x >= 12 && x < 24 && y >= 9 && y < 26) return
    pixels.fill(foreground, index * 4, index * 4 + 3)
    pixels[index * 4 + 3] = 255
  })
  return pixels
}

// Fallbacks while a desktop window has not published its resolved theme colors.
const avatarColors: Record<string, string> = {
  orange: "#ee7330",
  yellow: "#e7af36",
  cyan: "#0096b8",
  mint: "#0096b8",
  green: "#2eaf5a",
  lime: "#2eaf5a",
  red: "#d92e3c",
  pink: "#e4429e",
  blue: "#3250df",
  purple: "#623be2",
  gray: "#5c5c5c",
}

export function trayActionSvg(action: TrayActionIcon, foreground: string) {
  const name = {
    newAgent: "edit",
    settings: "settings-gear",
    docs: "book-open",
    quit: "log-out",
    more: "grid-plus",
  } as const
  const icon = shellIcons[name[action]]
  return svg(
    `<svg x="1" y="1" width="16" height="16" viewBox="${icon.viewBox}" fill="none" color="${foreground}">${icon.body}</svg>`,
  )
}

export function trayAppSvg(attention: boolean, foreground: string) {
  // Preserve the 18-point tray icon and mark dimensions chosen in the scaffold.
  return svg(badge(`<path d="M3 1.5H15V16H3ZM6 4.5V13H12V4.5Z" fill-rule="evenodd" fill="${foreground}"/>`, attention))
}

export function traySessionSvg(session: TraySession, foreground: string, image?: string) {
  if (session.status === "working") {
    return svg(`<circle cx="9" cy="9" r="3" fill="${foreground}"/>`)
  }
  const name =
    session.avatar?.name ||
    session.project?.name ||
    session.directory.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ||
    ""
  const initial =
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)[Symbol.iterator]().next().value?.segment ??
    ""
  const color = avatarColors[session.project?.icon?.color ?? "gray"] ?? avatarColors.gray
  const background = escapeXml(session.avatar?.background || color)
  const border = escapeXml(session.avatar?.border || color)
  const text = escapeXml(session.avatar?.foreground || "white")
  const highlight = escapeXml(session.avatar?.highlight || "#ffffff29")
  const surface = `<rect x="1" y="1" width="16" height="16" rx="4" fill="${background}"/>`
  const body = image
    ? `${surface}<defs><clipPath id="avatar"><rect x="1" y="1" width="16" height="16" rx="4"/></clipPath></defs><image href="${image}" x="1" y="1" width="16" height="16" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)"/>`
    : `${surface}<defs><linearGradient id="surface" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${highlight}"/><stop offset="1" stop-color="${highlight}" stop-opacity="0"/></linearGradient></defs><rect x="1" y="1" width="16" height="16" rx="4" fill="url(#surface)"/><rect x="1.25" y="1.25" width="15.5" height="15.5" rx="3.75" fill="none" stroke="${border}" stroke-width="0.5"/><text x="9" y="12.5" text-anchor="middle" font-family="Arial" font-size="11" font-weight="530" fill="${text}">${escapeXml(initial.toLocaleUpperCase())}</text>`
  return svg(badge(body, traySessionNotification(session), session.avatar?.accent))
}

function svg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">${body}</svg>`
}

function badge(body: string, attention: boolean, accent = "#3b5cf6") {
  if (!attention) return body
  // A transparent clearance ring keeps the app's accent dot distinct on any menu background.
  return `<defs><mask id="badge"><rect width="18" height="18" fill="white"/><circle cx="15" cy="3" r="4" fill="black"/></mask></defs><g mask="url(#badge)">${body}</g><circle cx="15" cy="3" r="2.75" fill="${escapeXml(accent)}"/>`
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
