import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface TypeOptions {
  /** Text to type */
  text: string
  /** Whether to press Return/Enter after typing */
  pressEnter?: boolean
}

export interface KeyPressOptions {
  /** Key to press (e.g., "Return", "Tab", "Escape", "a", "1") */
  key: string
  /** Modifier keys to hold while pressing */
  modifiers?: ("command" | "shift" | "option" | "control")[]
}

/**
 * Type text at the current cursor position
 */
export async function typeText(options: TypeOptions): Promise<void> {
  const { text, pressEnter = false } = options

  if (process.platform === "darwin") {
    const script = `
      tell application "System Events"
        keystroke "${text.replace(/"/g, '\\"')}"
        ${pressEnter ? 'keystroke return' : ''}
      end tell
    `
    await execFileAsync("osascript", ["-e", script])
    return
  }

  throw new Error("typeText not implemented for platform: " + process.platform)
}

/**
 * Press a specific key
 */
export async function pressKey(options: KeyPressOptions): Promise<void> {
  const { key, modifiers = [] } = options

  if (process.platform === "darwin") {
    const modifierFlags: Record<string, string> = {
      command: "command down",
      shift: "shift down",
      option: "option down",
      control: "control down",
    }

    const modifierString = modifiers.map((m) => modifierFlags[m]).filter(Boolean).join(", ")

    const script = `
      tell application "System Events"
        key code ${keyCodeForKey(key)}${modifierString ? " using {" + modifierString + "}" : ""}
      end tell
    `
    await execFileAsync("osascript", ["-e", script])
    return
  }

  throw new Error("pressKey not implemented for platform: " + process.platform)
}

/**
 * Map common key names to AppleScript key codes
 */
function keyCodeForKey(key: string): string {
  const keyCodes: Record<string, string> = {
    return: "36",
    enter: "36",
    tab: "48",
    escape: "53",
    space: "49",
    delete: "51",
    forwarddelete: "117",
    home: "115",
    end: "119",
    pageup: "116",
    pagedown: "121",
    left: "123",
    right: "124",
    down: "125",
    up: "126",
    "0": "29",
    "1": "18",
    "2": "19",
    "3": "20",
    "4": "21",
    "5": "23",
    "6": "22",
    "7": "26",
    "8": "28",
    "9": "25",
    a: "0",
    b: "11",
    c: "8",
    d: "2",
    e: "14",
    f: "3",
    g: "5",
    h: "4",
    i: "34",
    j: "38",
    k: "40",
    l: "37",
    m: "46",
    n: "45",
    o: "31",
    p: "35",
    q: "12",
    r: "15",
    s: "1",
    t: "17",
    u: "32",
    v: "9",
    w: "13",
    x: "7",
    y: "16",
    z: "6",
  }

  return keyCodes[key.toLowerCase()] || key
}
