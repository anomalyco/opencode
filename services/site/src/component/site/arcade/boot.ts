/**
 * The cabinet's boot log, shared by the DOM screen (screen.tsx) and the canvas renderer
 * (screen-canvas.ts): a straight BIOS-style boot with OpenCode references. It always plays through.
 */

/** How long the boot runs before the start screen, in ms. */
export const bootDuration = 4600

// [time in ms, text, status shown when the next line starts]. No line has a status now: the "OK"
// markers read as noise on the small screen.
const lines: [number, string, string?][] = [
  [0, "OPENCODE BIOS v2.0.26"],
  [120, "(C) ANOMALY INNOVATIONS INC."],
  [380, ""],
  [420, "CPU .............. TERMINAL AGENT CORE"],
  [640, "MEMORY TEST ......"],
  [1500, "INPUT ............ KEYBOARD  MOUSE  COIN MECH"],
  [1760, "CREDITS .......... 1"],
  [2000, ""],
  [2040, "LOADING MODELS ... CLAUDE OPUS 5.5"],
  [2500, "STARTING SESSION . SES_ARCADE"],
  [2900, "MOUNTING /ARCADE . BLACKOUT GETAWAY CARRIER"],
  [3300, ""],
]
const memory = { start: 640, end: 1400, size: 65536 }
const progress = { start: 3300, end: 4300 }

export type BootLine = { text: string; status?: string; caret: boolean }

/**
 * The boot screen `time` ms in: the visible lines (with their statuses), the progress (0–1, or
 * undefined before the bar appears) and whether it reads READY. Reduced motion passes
 * `bootDuration` to show it complete. A different `duration` stretches the same log to fit.
 */
export function bootFrame(elapsed: number, duration = bootDuration) {
  const time = (elapsed * bootDuration) / duration
  const shown = lines.filter(([at]) => time >= at)
  const last = shown.length - 1
  const out: BootLine[] = shown.map(([at, text, status], index) => {
    const next = lines[index + 1]?.[0] ?? at
    const counted = text.startsWith("MEMORY") ? `${text} ${memoryText(time)}` : text
    return { text: counted, status: status && time >= next - 80 ? status : undefined, caret: index === last && !!text }
  })
  const bar =
    time >= progress.start ? Math.min(1, (time - progress.start) / (progress.end - progress.start)) : undefined
  return { lines: out, progress: bar, ready: time >= progress.end + 100 }
}

function memoryText(time: number) {
  const t = Math.min(1, Math.max(0, (time - memory.start) / (memory.end - memory.start)))
  return `${Math.round(t * memory.size)}K`
}
