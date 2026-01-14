import { Show, createSignal, createEffect } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

export interface AgentActivityProps {
    active: boolean
    title?: string
    detail?: string
    type?: "thinking" | "writing" | "reading" | "success"
}

export function AgentActivity(props: AgentActivityProps) {

    return (
        <Show when={props.active}>
            <div class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
                <div class="flex flex-col items-center gap-1 animate-in slide-in-from-bottom-4 fade-in duration-300">

                    {/* The "Island" */}
                    <div class="flex items-center gap-4 bg-[#1a1a1a] text-white px-5 py-3.5 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/10 backdrop-blur-xl min-w-[300px] max-w-[400px]">

                        {/* Status Icon / Spinner */}
                        <div class="shrink-0 flex items-center justify-center size-5">
                            <Show when={props.type === 'success'}>
                                <Icon name="check-small" class="text-green-400" />
                            </Show>
                            <Show when={props.type !== 'success'}>
                                <div class="relative size-2.5">
                                    <div class="absolute inset-0 bg-white rounded-full animate-ping opacity-75"></div>
                                    <div class="relative size-2.5 bg-white rounded-full"></div>
                                </div>
                            </Show>
                        </div>

                        {/* Content */}
                        <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-4">
                                <span class="text-sm font-medium tracking-wide text-white/95 truncate">
                                    {props.title || "Thinking"}
                                </span>
                                <span class="text-[10px] font-mono text-white/50 bg-white/10 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">
                                    AGENT
                                </span>
                            </div>
                            <Show when={props.detail}>
                                <span class="text-xs text-white/60 font-mono truncate animate-pulse">
                                    {props.detail}
                                </span>
                            </Show>
                        </div>
                    </div>

                    {/* Reflection/Glow below */}
                    <div class="w-[80%] h-4 bg-black/20 blur-lg rounded-full -mt-2 opacity-50"></div>
                </div>
            </div>
        </Show>
    )
}
