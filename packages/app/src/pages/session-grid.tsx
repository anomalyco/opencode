import { For, Show, createMemo, Suspense } from "solid-js"
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

  // For up to 3x3 grid, we can just use simple CSS grid or Allotment.
  // The user requested: "2 is split horizontally, 3 is also split horizontally, 4 is 2x2, 5 is all split horizontally, 6 is 3x2 grid, etc"
  // Actually CSS Grid is best for this math:

  const count = createMemo(() => props.ids.length)

  const getGridClass = () => {
    const c = count()
    if (c === 1) return "grid-cols-1"
    if (c === 2) return "grid-cols-2"
    if (c === 3) return "grid-cols-3"
    if (c === 4) return "grid-cols-2 grid-rows-2"
    if (c === 5) return "grid-cols-3 grid-rows-2" // 3 top, 2 bottom
    if (c === 6) return "grid-cols-3 grid-rows-2"
    if (c <= 9) return "grid-cols-3 grid-rows-3"
    return "grid-cols-4 grid-rows-3"
  }

  const focusSession = (id: string) => {
    navigate(`/${params.dir}/session/${id}?${searchParams.toString()}`)
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
      // Focus the first remaining session
      navigate(`/${params.dir}/session/${next[0]}?grid=${next.join(",")}`)
    } else {
      setSearchParams({ grid: next.join(",") })
    }
  }

  return (
    <div class={`grid gap-2 w-full h-full p-2 bg-background-base ${getGridClass()}`}>
      <For each={props.ids}>
        {(id) => (
          <div 
            class={`relative flex flex-col min-h-0 min-w-0 border rounded-lg overflow-hidden shadow-sm transition-all
              ${id === params.id ? "ring-2 ring-blue-500 z-10" : "border-border-base hover:border-border-strong"}
            `}
            onClick={(e) => {
              if (id !== params.id) focusSession(id)
            }}
          >
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
        )}
      </For>
    </div>
  )
}
