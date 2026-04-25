/**
 * Status Color Convention
 *
 * Based on ISO 3864 safety colors and WCAG accessibility standards.
 * Each state includes: color + icon + text for accessibility.
 *
 * @see https://www.iso.org/standard/51000.html (ISO 3864)
 * @see https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html (WCAG 1.4.1)
 */

import { RGBA } from "@opentui/core"

export const STATUS_COLORS = {
  running: {
    color: "#3B82F6", // Blue
    bg: "rgba(59, 130, 246, 0.15)",
    icon: "◐",
    text: "Ejecutando...",
    description: "Task is currently executing",
  },
  waiting: {
    color: "#F59E0B", // Yellow
    bg: "rgba(245, 158, 11, 0.15)",
    icon: "⏳",
    text: "Esperando respuesta",
    description: "Waiting for subagent response",
  },
  attention: {
    color: "#D4652F", // Orange
    bg: "rgba(212, 101, 47, 0.15)",
    icon: "⚠",
    text: "Requiere atención",
    description: "Requires user attention",
  },
  error: {
    color: "#EF4444", // Red
    bg: "rgba(239, 68, 68, 0.15)",
    icon: "✗",
    text: "Error",
    description: "An error occurred",
  },
  done: {
    color: "#22C55E", // Green
    bg: "rgba(34, 197, 94, 0.15)",
    icon: "✓",
    text: "Completado",
    description: "Task completed successfully",
  },
  idle: {
    color: "#6B7280", // Gray
    bg: "rgba(107, 114, 128, 0.1)",
    icon: "○",
    text: "Inactivo",
    description: "No activity",
  },
} as const

export type StatusType = keyof typeof STATUS_COLORS

/**
 * Get RGBA from hex color for theme integration
 */
export function statusColorToRgba(hex: string, alpha: number = 1): RGBA {
  return RGBA.fromHex(hex).withAlpha(alpha)
}

/**
 * Get RGBA background color for a status
 */
export function statusBackground(status: StatusType): RGBA {
  const config = STATUS_COLORS[status]
  const rgba = RGBA.fromHex(config.color)
  return rgba.withAlpha(0.15)
}

/**
 * Check if a status is "active" (not idle or done)
 */
export function isActiveStatus(status: StatusType): boolean {
  return status !== "idle" && status !== "done"
}

/**
 * Get toast variant mapping for existing toast system
 */
export function statusToToastVariant(status: StatusType): "error" | "warning" | "info" | "success" {
  switch (status) {
    case "error":
      return "error"
    case "attention":
    case "waiting":
      return "warning"
    case "done":
      return "success"
    case "running":
    case "idle":
    default:
      return "info"
  }
}
