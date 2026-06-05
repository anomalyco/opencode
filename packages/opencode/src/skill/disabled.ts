import path from "path"
import { Global } from "@opencode-ai/core/global"
import fs from "fs"

const STATE_FILE = path.join(Global.Path.config, "skills", "skills.json")

function load(): Set<string> {
  try {
    if (!fs.existsSync(STATE_FILE)) return new Set()
    const raw = fs.readFileSync(STATE_FILE, "utf-8")
    const data = JSON.parse(raw)
    return new Set(Array.isArray(data?.disabled) ? data.disabled : [])
  } catch {
    return new Set()
  }
}

const disabled = load()

function save() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify({ disabled: [...disabled] }, null, 2))
}

export function isDisabled(name: string) {
  return disabled.has(name.trim())
}

export function toggle(name: string) {
  const key = name.trim()
  if (disabled.has(key)) disabled.delete(key)
  else disabled.add(key)
  save()
}
