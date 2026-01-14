import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"

interface PulseProps {
    summary: string
    detail: string
    trend?: "up" | "down" | "neutral"
}

export function BusinessPulse(props: PulseProps) {
    return (
        <div class="flex flex-col gap-4 py-8 relative group">
            {/* Vibrant left accent */}
            <div class="absolute left-0 top-8 bottom-8 w-1.5 bg-gradient-to-b from-emerald-400 to-blue-400 rounded-full shadow-sm" />

            <div class="pl-6 flex flex-col gap-3">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-md">
                        <Icon name="arrow-up" size="small" />
                    </div>
                    <h2 class="text-xs font-bold tracking-widest uppercase" style={{ color: "#18181b" }}>Daily Brief</h2>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="text-3xl md:text-4xl font-serif font-bold tracking-tight leading-tight" style={{ color: "#000000" }}>
                        {props.summary}
                    </div>

                    <div class="flex items-center gap-2 text-base md:text-lg mt-1">
                        <span class="font-bold" style={{ color: "#000000" }}>{props.detail}</span>
                        <Show when={props.trend === 'down'}>
                            <span class="inline-flex items-center gap-1 text-white bg-gradient-to-r from-red-500 to-red-600 px-3 py-1 rounded-full text-xs font-bold shadow-md">
                                <Icon name="arrow-up" size="small" style={{ transform: "rotate(180deg)" }} /> 3%
                            </span>
                        </Show>
                        <Show when={props.trend === 'up'}>
                            <span class="inline-flex items-center gap-1 text-white bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-1 rounded-full text-xs font-bold shadow-md">
                                <Icon name="arrow-up" size="small" /> 12%
                            </span>
                        </Show>
                    </div>
                </div>
            </div>
        </div>
    )
}
