import { Show, For, createMemo } from "solid-js"
import { useTTS } from "@/context/tts"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"

export function TTSControlBar() {
  const tts = useTTS()

  // Filter to show only English voices for simplicity
  const englishVoices = createMemo(() =>
    tts
      .voices()
      .filter((v) => v.lang.startsWith("en"))
      .sort((a, b) => {
        // Prioritize Neural/Natural voices
        const aNeural = a.name.includes("Neural") || a.name.includes("Natural") ? -1 : 0
        const bNeural = b.name.includes("Neural") || b.name.includes("Natural") ? -1 : 0
        if (aNeural !== bNeural) return aNeural - bNeural
        return a.name.localeCompare(b.name)
      }),
  )

  const rateOptions = [
    { value: 0.5, label: "0.5x" },
    { value: 0.75, label: "0.75x" },
    { value: 1, label: "1x" },
    { value: 1.25, label: "1.25x" },
    { value: 1.5, label: "1.5x" },
    { value: 2, label: "2x" },
  ]

  return (
    <Show when={tts.isSupported() && tts.isEnabled()}>
      <div class="flex items-center gap-3 px-4 py-2 bg-surface-base border-t border-border-weak-base">
        {/* Speaking indicator */}
        <div class="flex items-center gap-2 min-w-28">
          <Show
            when={tts.isSpeaking()}
            fallback={
              <div class="flex items-center gap-1.5 text-text-weak">
                <div class="w-2 h-2 rounded-full bg-text-weaker" />
                <span class="text-12-regular">Ready</span>
              </div>
            }
          >
            <div class="flex items-center gap-1.5">
              <Show
                when={!tts.isPaused()}
                fallback={
                  <div class="flex items-center gap-1.5 text-warning">
                    <div class="w-2 h-2 rounded-full bg-warning" />
                    <span class="text-12-regular">Paused</span>
                  </div>
                }
              >
                <div class="flex items-center gap-1.5 text-primary">
                  <div class="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span class="text-12-regular">Speaking...</span>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {/* Playback controls */}
        <div class="flex items-center gap-1 border-l border-border-weak-base pl-3">
          {/* Replay button */}
          <Tooltip value="Replay last message">
            <button
              onClick={() => tts.replay()}
              disabled={!tts.canReplay() || tts.isSpeaking()}
              classList={{
                "w-8 h-8 rounded flex items-center justify-center transition-colors": true,
                "hover:bg-surface-stronger text-text-strong": tts.canReplay() && !tts.isSpeaking(),
                "text-text-weaker cursor-not-allowed": !tts.canReplay() || tts.isSpeaking(),
              }}
            >
              ↻
            </button>
          </Tooltip>

          {/* Pause/Resume button */}
          <Tooltip value={tts.isPaused() ? "Resume" : "Pause"}>
            <button
              onClick={() => tts.togglePause()}
              disabled={!tts.isSpeaking()}
              classList={{
                "w-8 h-8 rounded flex items-center justify-center text-16-medium transition-colors": true,
                "hover:bg-surface-stronger text-text-strong": tts.isSpeaking(),
                "text-text-weaker cursor-not-allowed": !tts.isSpeaking(),
              }}
            >
              <Show when={tts.isPaused()} fallback="⏸">
                ▶
              </Show>
            </button>
          </Tooltip>

          {/* Stop button */}
          <Tooltip value="Stop">
            <button
              onClick={() => tts.stop()}
              disabled={!tts.isSpeaking()}
              classList={{
                "w-8 h-8 rounded flex items-center justify-center transition-colors": true,
                "hover:bg-surface-stronger text-text-strong": tts.isSpeaking(),
                "text-text-weaker cursor-not-allowed": !tts.isSpeaking(),
              }}
            >
              <Icon name="stop" size="small" />
            </button>
          </Tooltip>
        </div>

        {/* Voice selector */}
        <div class="flex items-center gap-2 border-l border-border-weak-base pl-3">
          <label class="text-12-regular text-text-weak">Voice:</label>
          <select
            value={tts.selectedVoice()}
            onChange={(e) => tts.setVoice(e.currentTarget.value)}
            class="text-12-regular border border-border-weak-base rounded px-2 py-1 max-w-48 truncate focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}
          >
            <For each={englishVoices()}>
              {(voice) => (
                <option value={voice.name} style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}>
                  {voice.name.replace("Microsoft ", "").replace(" Online (Natural)", "")}
                </option>
              )}
            </For>
          </select>
        </div>

        {/* Speed control */}
        <div class="flex items-center gap-2 border-l border-border-weak-base pl-3">
          <label class="text-12-regular text-text-weak">Speed:</label>
          <select
            value={tts.rate()}
            onChange={(e) => tts.setRate(parseFloat(e.currentTarget.value))}
            class="text-12-regular border border-border-weak-base rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}
          >
            <For each={rateOptions}>
              {(opt) => (
                <option value={opt.value} style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}>
                  {opt.label}
                </option>
              )}
            </For>
          </select>
        </div>

        {/* Disable TTS button */}
        <div class="flex items-center border-l border-border-weak-base pl-3 ml-auto">
          <Tooltip value="Disable text-to-speech">
            <button
              onClick={() => tts.disable()}
              class="flex items-center gap-1.5 px-2 py-1 rounded text-12-regular text-text-weak hover:text-text-strong hover:bg-surface-stronger transition-colors"
            >
              <Icon name="close" size="small" />
              <span>Disable TTS</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </Show>
  )
}
