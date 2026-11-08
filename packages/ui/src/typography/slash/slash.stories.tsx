import { Slash } from "./slash"

export default {
  title: "UI/Slash",
  id: "ui-slash",
  component: Slash,
}

export const Paths = {
  render: () => (
    <div class="flex flex-col items-start gap-4 p-6 text-[13px] leading-4 text-v2-text-text-muted">
      <span class="flex items-center">
        <span>home</span>
        <Slash gap={8} />
        <span class="text-v2-text-text-base">HOME</span>
      </span>
      <span class="flex items-center">
        <span class="text-v2-text-text-faint">Anthropic</span>
        <Slash />
        <span>Claude Opus 5.5 Fast</span>
      </span>
    </div>
  ),
}
