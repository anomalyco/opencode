import path from "path"
import fs from "fs/promises"
import { Instance } from "@/project/instance"

const ROOT = ".opencode/.teams"

export function root() {
  return path.join(Instance.worktree, ROOT)
}

export function indexPath() {
  return path.join(root(), "index.json")
}

export function teamDir(id: string) {
  return path.join(root(), id)
}

export function teamFile(id: string) {
  return path.join(teamDir(id), "team.json")
}

export function inboxDir(id: string) {
  return path.join(teamDir(id), "inboxes")
}

export function inboxFile(id: string, name: string) {
  return path.join(inboxDir(id), `${name}.json`)
}

export function taskDir(id: string) {
  return path.join(teamDir(id), "tasks")
}

export function taskFile(id: string, taskID: string) {
  return path.join(taskDir(id), `task-${taskID}.json`)
}

export function counterFile(id: string) {
  return path.join(taskDir(id), ".counter")
}

export async function ensureRoot() {
  await fs.mkdir(root(), { recursive: true })
}

export async function ensureTeam(id: string) {
  await fs.mkdir(teamDir(id), { recursive: true })
  await fs.mkdir(inboxDir(id), { recursive: true })
  await fs.mkdir(taskDir(id), { recursive: true })
}
