import { VisualizationProvider } from "../context/visualization"
import { VisualizationFrame } from "./visualization-frame"
import { VisualizationTool } from "./visualization-tool"

const controls = {
  version: 1 as const,
  title: "Motion controls",
  html: `<main style="font: 14px system-ui; color: var(--v2-text-text-base); padding: 20px; display: grid; gap: 16px">
  <svg viewBox="0 0 240 80" role="img" aria-label="Wave"><path d="M0 40 Q30 5 60 40 T120 40 T180 40 T240 40" fill="none" stroke="var(--v2-text-text-accent)" stroke-width="4"/></svg>
  <label>Speed <input id="speed" type="range" min="0" max="100" value="50"></label>
  <button id="send">Use this motion</button>
  <script>document.querySelector('#send').onclick = () => window.opencode.visualization.sendFollowUp({ prompt: 'Use this motion' })</script>
</main>`,
}

const long = {
  version: 1 as const,
  title: "Long visualization",
  html: `<div style="height: 1100px; padding: 20px">Long content that can be expanded</div>`,
}

function FrameStory(props: { value: typeof controls | typeof long; dark?: boolean }) {
  return (
    <div
      style={{
        padding: "20px",
        background: props.dark ? "#111" : "#fff",
        "--v2-background-bg-base": props.dark ? "#111" : "#fff",
        "--v2-background-bg-layer-01": props.dark ? "#1a1a1a" : "#f5f5f5",
        "--v2-text-text-base": props.dark ? "#f5f5f5" : "#111",
        "--v2-text-text-muted": props.dark ? "#b5b5b5" : "#666",
        "--v2-border-border-base": props.dark ? "#444" : "#ddd",
        "--v2-text-text-accent": "#5b7cfa",
        "--font-family-sans": "system-ui, sans-serif",
        "--font-family-mono": "ui-monospace, monospace",
      }}
    >
      <VisualizationProvider enabled followUp={async () => "cancelled"}>
        <VisualizationFrame value={props.value} sessionID="story-session" />
      </VisualizationProvider>
    </div>
  )
}

export default {
  title: "UI/Visualization Frame",
  id: "components-visualization-frame",
  component: VisualizationFrame,
  tags: ["autodocs"],
}

export const Controls = {
  render: () => <FrameStory value={controls} />,
}

export const LongCollapsed = {
  render: () => <FrameStory value={long} />,
}

export const InvalidStructured = {
  render: () => <VisualizationTool status="completed" structured={{ version: 1, title: "Invalid", html: "" }} />,
}

export const Dark = {
  render: () => <FrameStory value={controls} dark />,
}
