import { createMemo, onMount } from "solid-js"
import { Button } from "@athena/ui/button"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@athena/util/encode"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

/**
 * Home page for Athena Browser Agent.
 *
 * Unlike OpenCode which asks you to open a project directory,
 * the browser agent auto-opens a data directory and goes straight
 * to a new session. No project picker needed.
 */
export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()

  // Auto-open the athena data directory as the "project"
  // This is ~/.local/share/athena/ — where the agent stores files
  const dataDir = createMemo(() => {
    const home = sync.data.path.home
    if (!home) return undefined
    return `${home}/.local/share/athena`
  })

  // Auto-navigate to session on mount
  onMount(() => {
    const dir = dataDir()
    if (!dir) return

    // Open data dir as project and navigate
    layout.projects.open(dir)
    server.projects.touch(dir)
    navigate(`/${base64Encode(dir)}`)
  })

  // If auto-navigate hasn't fired yet, show a simple landing
  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function startSession() {
    const dir = dataDir()
    if (!dir) return
    layout.projects.open(dir)
    server.projects.touch(dir)
    navigate(`/${base64Encode(dir)}`)
  }

  return (
    <div class="mx-auto mt-40 w-full md:w-auto px-4 flex flex-col items-center gap-8">
      <div class="flex flex-col items-center gap-3">
        <div class="text-48-medium opacity-20" style={{ color: "var(--color-accent-base, #b48efa)" }}>
          ◆
        </div>
        <div class="text-20-medium text-text-strong">athena browser</div>
        <div class="text-14-regular text-text-weak">automate anything in the browser</div>
      </div>

      <div class="flex gap-3 items-center">
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        <span class="text-12-regular text-text-weak">{server.name}</span>
      </div>

      <Button size="large" onClick={startSession}>
        Start Session
      </Button>
    </div>
  )
}
