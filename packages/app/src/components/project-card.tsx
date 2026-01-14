import { createMemo, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useGlobalSync } from "@/context/global-sync"
import { DateTime } from "luxon"
import { LocalProject } from "@/context/layout"
import { A, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Button } from "@opencode-ai/ui/button"

export function ProjectCard(props: { project: LocalProject, homeDir: string }) {
    const navigate = useNavigate()
    const sync = useGlobalSync()

    // Connect to project store to monitor agent activity
    const [store] = sync.child(props.project.worktree)

    // Find any active session
    const activeSession = createMemo(() => {
        if (!store?.session) return null
        return store.session.find(s => {
            const status = store.session_status?.[s.id]
            return status?.type === 'busy' || status?.type === 'retry'
        })
    })

    const statusDetail = createMemo(() => {
        if (!activeSession()) return null
        const status = store.session_status?.[activeSession()!.id]
        // This is a rough mapping, in a real detailed implementation we'd parse the 'progress' object
        return "Processing task..."
    })

    return (
        <div
            class="group relative flex flex-col justify-between p-6 rounded-2xl bg-[#FDFCF8] border border-border-weak-base shadow-sm hover:shadow-md transition-all duration-300 h-64 cursor-pointer overflow-hidden"
            onClick={() => {
                navigate(`/${base64Encode(props.project.worktree)}`)
            }}
        >
            {/* Header */}
            <div class="flex justify-between items-start">
                <div class="flex flex-col gap-1">
                    <h3 class="text-lg font-semibold text-text-strong tracking-tight">
                        {props.project.worktree.split('/').pop()}
                    </h3>
                    <span class="text-xs text-text-weak font-mono truncate max-w-[200px] opacity-70">
                        {props.project.worktree.replace(props.homeDir, "~")}
                    </span>
                </div>
                <div class="size-8 rounded-full bg-surface-base border border-border-base flex items-center justify-center text-text-secondary">
                    <Icon name="folder" size="small" />
                </div>
            </div>

            {/* Content / Stats (Mocked or Real) */}
            <div class="grid grid-cols-2 gap-4 my-4">
                <div class="p-3 bg-surface-base rounded-xl border border-border-weak-base/50">
                    <p class="text-[10px] uppercase tracking-wider text-text-weaker font-medium mb-1">Last Updated</p>
                    <p class="text-xs font-medium text-text-secondary">
                        {DateTime.fromMillis(props.project.time.updated ?? props.project.time.created).toRelative()}
                    </p>
                </div>
                <div class="p-3 bg-surface-base rounded-xl border border-border-weak-base/50">
                    <p class="text-[10px] uppercase tracking-wider text-text-weaker font-medium mb-1">Sessions</p>
                    <p class="text-xs font-medium text-text-secondary">
                        {store?.session?.length || 0}
                    </p>
                </div>
            </div>

            {/* Footer / Quick Actions */}
            <div class="flex items-center gap-2 mt-auto pt-4 border-t border-border-weak-base/50 z-10 relative">
                <Button
                    size="small"
                    variant="ghost"
                    class="text-xs h-7 px-3 bg-white border border-border-base shadow-sm hover:bg-surface-raised-base text-text-secondary"
                    onClick={(e) => { e.stopPropagation(); navigate(`/${base64Encode(props.project.worktree)}/brand`) }}
                >
                    <Icon name="check-small" size="small" class="mr-1.5 opacity-70" /> Brand
                </Button>
                <Button
                    size="small"
                    variant="ghost"
                    class="text-xs h-7 px-3 bg-white border border-border-base shadow-sm hover:bg-surface-raised-base text-text-secondary"
                    onClick={(e) => { e.stopPropagation(); navigate(`/${base64Encode(props.project.worktree)}/commerce`) }}
                >
                    <Icon name="server" size="small" class="mr-1.5 opacity-70" /> Commerce
                </Button>
            </div>

            {/* Dynamic Agent Overlay (The "Island" Effect) */}
            <Show when={activeSession()}>
                <div class="absolute inset-0 bg-background-base/20 backdrop-blur-[1px] z-20 flex items-start justify-center pt-8 animate-in fade-in duration-300">
                    <div class="flex items-center gap-3 bg-[#0F0F0F] text-white px-4 py-2.5 rounded-xl shadow-2xl border border-white/10 max-w-[90%] transform transition-all hover:scale-105">
                        <div class="relative size-2 shrink-0">
                            <div class="absolute inset-0 bg-green-400 rounded-full animate-ping opacity-75"></div>
                            <div class="relative size-2 bg-green-500 rounded-full"></div>
                        </div>
                        <div class="flex flex-col min-w-0">
                            <span class="text-xs font-semibold tracking-wide">Agent Active</span>
                            <span class="text-[10px] text-white/60 font-mono truncate max-w-[140px] animate-pulse">
                                {statusDetail()}
                            </span>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    )
}
