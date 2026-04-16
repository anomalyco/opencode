import { Button } from "@opencode-ai/ui/button"
import { createSignal, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"

const EMOJIS = [
  { category: "Smileys", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩"] },
  { category: "Gestures", emojis: ["👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️"] },
  { category: "Food", emojis: ["🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑"] },
  { category: "Activities", emojis: ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏓", "🎱", "🏊", "🚴", "🏃", "🧘", "🎮", "🎯", "🎲", "🎨"] },
  { category: "Objects", emojis: ["💻", "📱", "⌨️", "🖥️", "🖨️", "💾", "💿", "📷", "📹", "🎥", "📞", "📺", "🔋", "🔌", "💡", "🔧"] },
  { category: "Symbols", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💯", "✅", "❌", "⭐", "✨", "💫", "🔥"] },
]

export function EmojiPicker(props: { onSelect: (emoji: string) => void; style?: JSX.CSSProperties }) {
  const [open, setOpen] = createSignal(false)
  const [selectedCategory, setSelectedCategory] = createSignal(0)

  const insertEmoji = (emoji: string) => {
    props.onSelect(emoji)
    setOpen(false)
  }

  return (
    <div class="relative">
      <Button
        variant="ghost"
        size="normal"
        style={props.style}
        class="px-2 min-w-0"
        onClick={() => setOpen(!open())}
        aria-label="Emoji picker"
      >
        Emoji
      </Button>

      <Show when={open()}>
        <Portal>
          <div
            class="fixed inset-0 z-50"
            onClick={() => setOpen(false)}
          />
          <div
            class="absolute bottom-full left-0 mb-2 z-50 bg-surface-raised-base border border-border-base rounded-lg shadow-lg w-72 max-h-80 overflow-hidden flex flex-col"
            data-component="emoji-picker"
          >
            <div class="flex border-b border-border-weak-base overflow-x-auto">
              <For each={EMOJIS}>
                {(category, index) => (
                  <button
                    class={`px-2 py-1.5 text-sm ${selectedCategory() === index() ? "bg-surface-raised-base-active" : "hover:bg-surface-raised-base-hover"} transition-colors`}
                    onClick={() => setSelectedCategory(index())}
                  >
                    {category.emojis[0]}
                  </button>
                )}
              </For>
            </div>

            <div class="p-2 overflow-y-auto max-h-64">
              <div class="grid grid-cols-8 gap-1">
                <For each={EMOJIS[selectedCategory()].emojis}>
                  {(emoji) => (
                    <button
                      class="w-8 h-8 flex items-center justify-center text-xl hover:bg-surface-raised-base-hover rounded transition-colors"
                      onClick={() => insertEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  )
}
