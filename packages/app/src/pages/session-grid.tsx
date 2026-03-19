import { For, Show, createSignal, createMemo, Suspense, createEffect, onCleanup } from "solid-js"
import { useSearchParams, useParams, useNavigate } from "@solidjs/router"
import { SessionParamsProvider } from "@/hooks/use-session-params"
import { TerminalProvider } from "@/context/terminal"
import { FileProvider } from "@/context/file"
import { PromptProvider } from "@/context/prompt"
import { CommentsProvider } from "@/context/comments"
import { IconButton } from "@opencode-ai/ui/icon-button"
import Session from "@/pages/session"

const emptyImage = new Image()
emptyImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

export function SessionGrid(props: { ids: string[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const params = useParams()
  const navigate = useNavigate()
  
  let gridRef: HTMLDivElement | undefined

  const [dragId, setDragId] = createSignal<string | null>(null)
  const [localIds, setLocalIds] = createSignal<string[]>([])
  const [isCtrl, setIsCtrl] = createSignal(false)
  
  const [colSizes, setColSizes] = createSignal<number[]>([1, 1, 1, 1, 1])
  const [rowSizes, setRowSizes] = createSignal<number[]>([1, 1, 1, 1, 1])
  const [resizing, setResizing] = createSignal<{ type: "col" | "row", index: number, startFrs: number[], startPos: number } | null>(null)

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

  const gridDims = createMemo(() => {
    const c = count()
    if (c <= 1) return { cols: 1, rows: 1 }
    if (c === 2) return { cols: 2, rows: 1 }
    if (c === 3) return { cols: 3, rows: 1 }
    if (c === 4) return { cols: 2, rows: 2 }
    if (c === 5) return { cols: 3, rows: 2 }
    if (c === 6) return { cols: 3, rows: 2 }
    if (c <= 9) return { cols: 3, rows: 3 }
    return { cols: 4, rows: 3 }
  })

  const gridTemplateColumns = createMemo(() => {
    return colSizes().slice(0, gridDims().cols).map(s => `${s}fr`).join(" ")
  })

  const gridTemplateRows = createMemo(() => {
    return rowSizes().slice(0, gridDims().rows).map(s => `${s}fr`).join(" ")
  })

  const handlePointerMove = (e: PointerEvent) => {
    const res = resizing()
    if (!res || !gridRef) return
    
    const rect = gridRef.getBoundingClientRect()
    
    if (res.type === "col") {
      const deltaX = e.clientX - res.startPos
      const totalFr = res.startFrs.slice(0, gridDims().cols).reduce((a,b)=>a+b, 0)
      const trackWidth = rect.width - ((gridDims().cols - 1) * 8)
      if (trackWidth <= 0) return
      
      const deltaFr = (deltaX / trackWidth) * totalFr
      
      const newSizes = [...colSizes()]
      let newLeft = res.startFrs[res.index] + deltaFr
      let newRight = res.startFrs[res.index + 1] - deltaFr
      
      const minFr = totalFr * 0.1
      if (newLeft < minFr) {
        newRight -= (minFr - newLeft)
        newLeft = minFr
      }
      if (newRight < minFr) {
        newLeft -= (minFr - newRight)
        newRight = minFr
      }
      
      newSizes[res.index] = newLeft
      newSizes[res.index + 1] = newRight
      setColSizes(newSizes)
    } else {
      const deltaY = e.clientY - res.startPos
      const totalFr = res.startFrs.slice(0, gridDims().rows).reduce((a,b)=>a+b, 0)
      const trackHeight = rect.height - ((gridDims().rows - 1) * 8)
      if (trackHeight <= 0) return
      
      const deltaFr = (deltaY / trackHeight) * totalFr
      
      const newSizes = [...rowSizes()]
      let newTop = res.startFrs[res.index] + deltaFr
      let newBottom = res.startFrs[res.index + 1] - deltaFr
      
      const minFr = totalFr * 0.1
      if (newTop < minFr) {
        newBottom -= (minFr - newTop)
        newTop = minFr
      }
      if (newBottom < minFr) {
        newTop -= (minFr - newBottom)
        newBottom = minFr
      }
      
      newSizes[res.index] = newTop
      newSizes[res.index + 1] = newBottom
      setRowSizes(newSizes)
    }
  }

  const handlePointerUp = () => setResizing(null)

  createEffect(() => {
    const res = resizing()
    if (res) {
      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
      document.body.style.cursor = res.type === "col" ? "col-resize" : "row-resize"
      document.body.style.userSelect = "none"
    } else {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    onCleanup(() => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    })
  })

  const startResize = (e: PointerEvent, type: "col" | "row", index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizing({
      type,
      index,
      startFrs: type === "col" ? [...colSizes()] : [...rowSizes()],
      startPos: type === "col" ? e.clientX : e.clientY
    })
  }

  const focusSession = (id: string, replace = false) => {
    const gridParam = searchParams.grid ? `?grid=${searchParams.grid}` : ""
    navigate(`/${params.dir}/session/${id}${gridParam}`, { replace })
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
      
      if (dx > rect.width * 0.4 || dy > rect.height * 0.4) {
        return prev
      }

      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      
      if (!gridRef) return next

      const children = Array.from(gridRef.children) as HTMLElement[]
      const oldPositions = new Map<HTMLElement, DOMRect>()
      
      for (const child of children) {
        if (!child.style) continue
        oldPositions.set(child, child.getBoundingClientRect())
        child.style.transition = 'none'
        child.style.transform = ''
      }

      queueMicrotask(() => {
        for (const child of children) {
          if (!child.style) continue
          const oldRect = oldPositions.get(child)
          if (!oldRect) continue
          
          const newRect = child.getBoundingClientRect()
          const deltaX = oldRect.left - newRect.left
          const deltaY = oldRect.top - newRect.top
          
          if (deltaX === 0 && deltaY === 0) continue
          
          child.style.transition = 'none'
          child.style.transform = `translate(${deltaX}px, ${deltaY}px)`
          
          void child.getBoundingClientRect()
          
          child.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'
          child.style.transform = ''
          
          const timerId = setTimeout(() => {
            if ((child as any).__flipTimer === timerId) {
              child.style.transition = ''
              child.style.transform = ''
            }
          }, 200)
          ;(child as any).__flipTimer = timerId
        }
      })

      return next
    })
  }

  const commitDrag = () => {
    const dragging = dragId()
    if (!dragging) return
    
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
    <div class="relative w-full h-full p-2 bg-background-base">
      <div 
        ref={gridRef}
        class="grid gap-2 w-full h-full" 
        style={{ 
          "grid-template-columns": gridTemplateColumns(), 
          "grid-template-rows": gridTemplateRows() 
        }}
      >
        <For each={stableIds()}>
          {(id) => {
            const visualIndex = () => localIds().indexOf(id)
            const isFocused = () => id === (params.id ?? "")

            return (
              <div
                draggable={isCtrl()}
                style={{ order: visualIndex() }}
                class={`relative flex flex-col min-h-0 min-w-0 border rounded-lg overflow-hidden shadow-sm transition-all duration-200 ease-in-out select-none
                  ${isCtrl() ? "cursor-grab" : ""}
                  ${isFocused() ? "ring-2 ring-blue-500 z-10" : "border-border-base hover:border-border-strong"}
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
                  e.dataTransfer!.setDragImage(emptyImage, 0, 0)
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
                  if (!isFocused()) focusSession(id)
                }}
                onMouseEnter={(e) => {
                  if (!isFocused() && !dragId()) focusSession(id, true)
                }}
              >
                <Show when={dragId() !== null}>
                  <div class="absolute inset-0 z-50 cursor-grabbing" />
                </Show>

                <div class="absolute top-2 right-2 z-50 opacity-0 hover:opacity-100 transition-opacity">
                  <IconButton
                    icon="close"
                    variant="ghost"
                    class="size-6 rounded-md bg-surface-base text-text-weak hover:text-text-strong shadow-sm hover:bg-surface-raised-base border border-border-base"
                    aria-label="Close session"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSessionFromGrid(id)
                    }}
                  />
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

      <div 
        class="absolute inset-2 pointer-events-none grid gap-2" 
        style={{ 
          "grid-template-columns": gridTemplateColumns(), 
          "grid-template-rows": gridTemplateRows() 
        }}
      >
        <For each={Array.from({ length: gridDims().cols - 1 })}>
          {(_, i) => (
            <div
              class="pointer-events-auto cursor-col-resize z-50 flex justify-center group/vsplit"
              style={{
                "grid-column": i() + 1,
                "grid-row": "1 / -1",
                "justify-self": "end",
                "width": "16px",
                "margin-right": "-12px",
              }}
              onPointerDown={(e) => startResize(e, "col", i())}
            >
              <div class="w-1 h-full bg-blue-500/0 group-hover/vsplit:bg-blue-500/50 transition-colors" />
            </div>
          )}
        </For>
        <For each={Array.from({ length: gridDims().rows - 1 })}>
          {(_, i) => (
            <div
              class="pointer-events-auto cursor-row-resize z-50 flex flex-col justify-center items-center group/hsplit"
              style={{
                "grid-row": i() + 1,
                "grid-column": "1 / -1",
                "align-self": "end",
                "height": "16px",
                "margin-bottom": "-12px",
              }}
              onPointerDown={(e) => startResize(e, "row", i())}
            >
              <div class="h-1 w-full bg-blue-500/0 group-hover/hsplit:bg-blue-500/50 transition-colors" />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
