import { For, Show, createSignal, createMemo, Suspense, createEffect, onCleanup } from "solid-js"
import { useSearchParams, useParams, useNavigate } from "@solidjs/router"
import { SessionParamsProvider } from "@/hooks/use-session-params"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import Session from "@/pages/session"

export function SessionGrid(props: { ids: string[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useParams()
  const navigate = useNavigate()
  
  const [dragId, setDragId] = createSignal<string | null>(null)
  const [localIds, setLocalIds] = createSignal<string[]>([])
  const [isCtrl, setIsCtrl] = createSignal(false)

  // Use a stable sorted array for the DOM to prevent Solid's <For> loop from 
  // physically detaching and reattaching DOM nodes when the array order changes.
  // This prevents scroll positions from being lost and iframes from reloading.
  const stableIds = createMemo(() => {
    return [...props.ids].sort()
  })

  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setIsCtrl(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setIsCtrl(false)
    }
    const handleBlur = () => setIsCtrl(false)
    
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    })
  })

  createEffect(() => {
    if (!dragId()) {
      setLocalIds(props.ids)
    }
  })

  const count = createMemo(() => localIds().length)

  const getGridClass = () => {
    const c = count()
    if (c === 1) return "grid-cols-1"
    if (c === 2) return "grid-cols-2"
    if (c === 3) return "grid-cols-3"
    if (c === 4) return "grid-cols-2 grid-rows-2"
    if (c === 5) return "grid-cols-3 grid-rows-2"
    if (c === 6) return "grid-cols-3 grid-rows-2"
    if (c <= 9) return "grid-cols-3 grid-rows-3"
    return "grid-cols-4 grid-rows-3"
  }

  const focusSession = (id: string) => {
    const gridParam = searchParams.grid ? `?grid=${searchParams.grid}` : ""
    navigate(`/${params.dir}/session/${id}${gridParam}`)
  }

  const removeSessionFromGrid = (id: string) => {
    const next = props.ids.filter(x => x !== id)
    if (next.length <= 1) {
      setSearchParams({ grid: undefined })
      if (next.length === 1) {
        navigate(`/${params.dir}/session/${next[0]}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    } else if (id === params.id) {
      navigate(`/${params.dir}/session/${next[0]}?grid=${next.join(",")}`)
    } else {
      setSearchParams({ grid: next.join(",") })
    }
  }

  const moveTile = (hoverId: string, e: DragEvent) => {
    const dragging = dragId()
    if (!dragging || dragging === hoverId) return

    setLocalIds((prev) => {
      const from = prev.indexOf(dragging)
      const to = prev.indexOf(hoverId)
      if (from === -1 || to === -1 || from === to) return prev

      const targetEl = e.currentTarget as HTMLElement
      const rect = targetEl.getBoundingClientRect()
      
      const targetCenterX = rect.left + rect.width / 2
      const targetCenterY = rect.top + rect.height / 2
      
      const dx = Math.abs(e.clientX - targetCenterX)
      const dy = Math.abs(e.clientY - targetCenterY)
      
      // Require the mouse to be within the central 60% of the target tile before swapping
      // to prevent flicker and allow dragging across items
      if (dx > rect.width * 0.3 || dy > rect.height * 0.3) {
        return prev
      }

      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const commitDrag = () => {
    const dragging = dragId()
    if (!dragging) return
    
    // Capture state before resetting dragId to prevent the createEffect from wiping it
    const currentLocal = [...localIds()]
    setDragId(null)
    
    if (currentLocal.join(",") !== props.ids.join(",")) {
      const newFocusedId = params.id ? currentLocal.find((id) => id === params.id) ?? currentLocal[0] : undefined
      const navUrl = newFocusedId
        ? `/${params.dir}/session/${newFocusedId}?grid=${currentLocal.join(",")}`
        : `/${params.dir}/session?grid=${currentLocal.join(",")}`
      navigate(navUrl, { replace: true })
    }
  }

  return (
    <div class={`grid gap-2 w-full h-full p-2 bg-background-base ${getGridClass()}`}>
      <For each={stableIds()}>
        {(id) => {
          const visualIndex = () => localIds().indexOf(id)

          return (
            <div
              draggable={isCtrl()}
              style={{ order: visualIndex() }}
              class={`relative flex flex-col min-h-0 min-w-0 border rounded-lg overflow-hidden shadow-sm transition-all duration-200 ease-in-out select-none
                ${isCtrl() ? "cursor-grab" : ""}
                ${id === params.id ? "ring-2 ring-blue-500 z-10" : "border-border-base hover:border-border-strong"}
                ${dragId() === id ? "opacity-50 scale-[0.98] z-50 shadow-xl" : ""}
                ${count() === 5 && visualIndex() === 4 ? "col-start-3 row-start-1 row-span-2" : ""}
              `}
              onDragStart={(e) => {
                if (!isCtrl()) {
                  e.preventDefault()
                  return
                }
                setDragId(id)
                e.dataTransfer!.effectAllowed = "move"
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer!.dropEffect = "move"
                moveTile(id, e)
              }}
              onDrop={(e) => {
                e.preventDefault()
                commitDrag()
              }}
              onDragEnd={() => {
                commitDrag()
              }}
              onClick={(e) => {
                if (id !== params.id) focusSession(id)
              }}
            >
              <Show when={dragId() !== null}>
                <div class="absolute inset-0 z-50 cursor-grabbing" />
              </Show>

              <div class="absolute top-2 right-2 z-50 opacity-0 hover:opacity-100 transition-opacity">
                <button
                  class="bg-surface-base text-text-strong rounded px-2 py-1 text-xs border border-border-base shadow-sm hover:bg-surface-raised-base"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSessionFromGrid(id)
                  }}
                >
                  Close
                </button>
              </div>

              <SessionParamsProvider dir={params.dir} id={id}>
                <TerminalProvider>
                  <FileProvider>
                    <PromptProvider>
                      <CommentsProvider>
                        <Suspense fallback={<div class="size-full" />}>
                          <Session />
                        </Suspense>
                      </CommentsProvider>
                    </PromptProvider>
                  </FileProvider>
                </TerminalProvider>
              </SessionParamsProvider>
            </div>
          )
        }}
      </For>
    </div>
  )
}
