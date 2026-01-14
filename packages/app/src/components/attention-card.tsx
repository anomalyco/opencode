import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

interface AttentionItemProps {
    title: string
    impact: string
    action: string
    urgency: "high" | "medium"
}

// Helper function to highlight numbers and currency in text
function highlightNumbers(text: string) {
    const parts: Array<{ text: string; isNumber: boolean; isNegative?: boolean }> = []

    // Regex to match numbers, percentages, and currency
    const regex = /(\+?\-?\₹?\d+(?:,\d+)*(?:\.\d+)?%?|\d+\s+days?)/g
    let lastIndex = 0
    let match

    while ((match = regex.exec(text)) !== null) {
        // Add text before the number
        if (match.index > lastIndex) {
            parts.push({ text: text.slice(lastIndex, match.index), isNumber: false })
        }

        // Determine if negative indicator
        const numText = match[0]
        const isNegative = numText.includes('-') ||
            (text.toLowerCase().includes('drop') ||
                text.toLowerCase().includes('decreased') ||
                text.toLowerCase().includes('undercutting'))

        parts.push({ text: numText, isNumber: true, isNegative })
        lastIndex = regex.lastIndex
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push({ text: text.slice(lastIndex), isNumber: false })
    }

    return parts.length > 0 ? parts : [{ text, isNumber: false }]
}

export function AttentionCard(props: AttentionItemProps) {
    const iconName = props.urgency === 'high' ? 'alert-triangle' : 'bubble-5'
    const impactParts = highlightNumbers(props.impact)

    return (
        <div class={`group relative flex flex-col md:flex-row md:items-center justify-between p-5 bg-white rounded-xl shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden animate-in slide-in-from-left-4 fade-in ${props.urgency === 'high'
                ? 'border-2 border-orange-400 bg-gradient-to-r from-orange-50 to-red-50 hover:scale-[1.02]'
                : 'border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 hover:scale-[1.02]'
            }`}>

            {/* Animated pulse ring for high urgency */}
            {props.urgency === 'high' && (
                <div class="absolute inset-0 rounded-xl border-2 border-red-500 animate-ping opacity-20" />
            )}

            <div class="flex items-start gap-4 flex-1">
                {/* Vibrant icon container with animation */}
                <div class={`mt-0.5 w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg animate-bounce ${props.urgency === 'high'
                        ? 'bg-gradient-to-br from-red-500 to-orange-600 text-white shadow-red-500/40'
                        : 'bg-gradient-to-br from-amber-500 to-yellow-600 text-white shadow-amber-500/40'
                    }`}>
                    <Icon name={iconName as any} size="small" />
                </div>

                <div class="flex flex-col gap-2 flex-1">
                    <h3 class="text-lg font-bold leading-snug" style={{ color: "#000000" }}>
                        {props.title}
                    </h3>
                    <p class="text-sm font-medium leading-relaxed flex flex-wrap gap-1 items-center">
                        {impactParts.map((part, i) =>
                            part.isNumber ? (
                                <span
                                    key={i}
                                    class={`inline-flex items-center px-2.5 py-1 rounded-lg font-bold text-sm shadow-md animate-pulse ${part.isNegative
                                            ? 'bg-gradient-to-r from-red-500 to-red-600 text-white'
                                            : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white'
                                        }`}
                                >
                                    {part.text}
                                </span>
                            ) : (
                                <span key={i} style={{ color: "#3f3f46" }}>{part.text}</span>
                            )
                        )}
                    </p>
                </div>
            </div>

            <div class="mt-4 md:mt-0 flex items-center pl-16 md:pl-4">
                <Button
                    variant="secondary"
                    class="font-bold text-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 border-0 transition-all shadow-lg hover:shadow-xl hover:scale-110 px-5 py-2.5 rounded-xl"
                >
                    {props.action}
                </Button>
            </div>
        </div>
    )
}
