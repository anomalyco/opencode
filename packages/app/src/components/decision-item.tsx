import { Icon } from "@opencode-ai/ui/icon"

interface DecisionProps {
    question: string
    impact?: string
}

export function DecisionItem(props: DecisionProps) {
    return (
        <button class="w-full group text-left flex items-center justify-between gap-4 p-5 -mx-4 rounded-xl hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 transition-all duration-200 relative border-l-4 border-transparent hover:border-l-blue-500 hover:shadow-md">
            {/* Strategic decision icon */}
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shrink-0 text-white group-hover:scale-110 transition-transform shadow-md">
                <Icon name="brain" size="small" />
            </div>

            <div class="flex flex-col gap-1.5 flex-1">
                <span class="text-base font-bold leading-snug group-hover:text-blue-700 transition-colors" style={{ color: "#000000" }}>
                    {props.question}
                </span>
                {props.impact && (
                    <span class="text-sm font-medium leading-relaxed" style={{ color: "#52525b" }}>
                        {props.impact}
                    </span>
                )}
            </div>

            <div class="flex items-center gap-2 shrink-0">
                <Icon
                    name="chevron-right"
                    class="text-zinc-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-200"
                    size="small"
                />
            </div>
        </button>
    )
}
