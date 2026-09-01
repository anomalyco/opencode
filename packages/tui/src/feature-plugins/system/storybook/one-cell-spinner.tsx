import type { Plugin } from "@opencode-ai/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { OneCellSpinner } from "../../../component/one-cell-spinner"
import { useConfig } from "../../../config"
import { entrySplashLayout } from "../../../mini/splash"
import { stringWidth } from "../../../util/string-width"
import { StoryFooter } from "./footer"
import type { Story } from "./index"
import { ONE_CELL_SPINNERS } from "./one-cell-spinner.fixtures"

function OneCellSpinnerStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const config = useConfig()
  const [selected, setSelected] = createSignal(39)
  const [speed, setSpeed] = createSignal(1)
  const [animations, setAnimations] = createSignal(config.data.animations ?? true)
  const [paused, setPaused] = createSignal(false)
  const [glow, setGlow] = createSignal(true)
  const [solo, setSolo] = createSignal(false)
  const [epoch, setEpoch] = createSignal(0)
  const [age, setAge] = createSignal(0)
  const animation = () => ONE_CELL_SPINNERS[selected()]!
  const timing = createMemo(() => {
    const item = animation()
    const cycle = (item.frames.length * item.interval) / speed()
    if (!item.pace) return `${Math.round((item.interval / speed()) * 10) / 10}ms tick / ${cycle}ms cycle`
    return `${(cycle / item.pace.initial / 1000).toFixed(2)}s to ${(cycle / item.pace.final / 1000).toFixed(2)}s cycle`
  })
  const previewWidth = () => (solo() ? Math.min(dimensions().width, 64) : dimensions().width)
  const speeds = createMemo(() => (dimensions().width >= 60 ? [0.5, 1, 2] : [speed()]))
  const splash = createMemo(() =>
    entrySplashLayout({ width: Math.max(1, previewWidth() - 8), version: "1.18.4", detail: "~/src/opencode" }),
  )
  let scroll: ScrollBoxRenderable | undefined
  const revealSelected = () => {
    if (!scroll || scroll.isDestroyed) return
    const rows = scroll.viewport.height
    scroll.scrollTo(Math.max(0, Math.min(selected() - Math.floor(rows / 2), ONE_CELL_SPINNERS.length - rows)))
  }
  createEffect(revealSelected)

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: solo() ? "Leave focus" : "Back to storybook",
        group: "Storybook",
        run: () => {
          if (solo()) return setSolo(false)
          props.context.ui.router.navigate({ type: "plugin", name: "storybook" })
        },
      },
      {
        bind: "up,k",
        title: "Previous animation",
        group: "Storybook",
        run: () => setSelected((value) => (value + ONE_CELL_SPINNERS.length - 1) % ONE_CELL_SPINNERS.length),
      },
      {
        bind: "down,j",
        title: "Next animation",
        group: "Storybook",
        run: () => setSelected((value) => (value + 1) % ONE_CELL_SPINNERS.length),
      },
      {
        bind: "s",
        title: "Cycle preview speed",
        group: "Storybook",
        run: () => setSpeed((value) => (value === 0.5 ? 1 : value === 1 ? 2 : 0.5)),
      },
      { bind: "space", title: "Pause / resume", group: "Storybook", run: () => setPaused((value) => !value) },
      { bind: "a", title: "Toggle animations", group: "Storybook", run: () => setAnimations((value) => !value) },
      { bind: "g", title: "Toggle intensity pulse", group: "Storybook", run: () => setGlow((value) => !value) },
      {
        bind: "f",
        title: "Focus selected animation",
        group: "Storybook",
        run: () =>
          batch(() => {
            setSolo((value) => !value)
            if (solo()) setEpoch((value) => value + 1)
          }),
      },
      {
        bind: "p",
        title: "Replay animation",
        group: "Storybook",
        run: () =>
          batch(() => {
            setAge(0)
            setEpoch((value) => value + 1)
          }),
      },
      ...(animation().pace
        ? [
            {
              bind: "t",
              title: "Cycle work age",
              group: "Storybook",
              run: () => setAge((value) => (value === 0 ? 30_000 : value === 30_000 ? 60_000 : 0)),
            },
          ]
        : []),
      {
        bind: "r",
        title: "Reset comparison",
        group: "Storybook",
        run: () =>
          batch(() => {
            setSelected(39)
            setSpeed(1)
            setAnimations(config.data.animations ?? true)
            setPaused(false)
            setGlow(true)
            setSolo(false)
            setAge(0)
            setEpoch((value) => value + 1)
          }),
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background.default}
      justifyContent={solo() ? "center" : undefined}
      alignItems={solo() ? "center" : undefined}
    >
      <Show when={!solo()}>
        <text fg={theme.text.default} flexShrink={0}>
          one-cell motion lab.
        </text>
      </Show>
      <For each={[epoch()]}>
        {() => (
          <>
            <Show when={!solo()}>
              <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1}>
                <text width={22} fg={theme.text.subdued}>
                  pattern
                </text>
                <For each={speeds()}>
                  {(value) => (
                    <text width={7} fg={theme.text.subdued}>
                      {value}x
                    </text>
                  )}
                </For>
                <text fg={theme.text.subdued}>cycle @1x</text>
              </box>
              <scrollbox
                ref={scroll}
                flexGrow={1}
                minHeight={1}
                viewportOptions={{ paddingLeft: 1 }}
                onSizeChange={() => queueMicrotask(revealSelected)}
              >
                <For each={ONE_CELL_SPINNERS}>
                  {(item, index) => (
                    <box height={1} flexShrink={0} flexDirection="row">
                      <text
                        width={22}
                        wrapMode="none"
                        fg={index() === selected() ? theme.text.formfield.selected : theme.text.formfield.default}
                      >
                        {index() === selected() ? ">" : " "}
                        {String(index() + 1).padStart(2)} {item.name.toLowerCase()}.
                      </text>
                      <For each={speeds()}>
                        {(value) => (
                          <box width={7} flexShrink={0}>
                            <OneCellSpinner
                              animation={item}
                              age={age()}
                              speed={value}
                              animations={animations()}
                              paused={paused()}
                              glow={glow()}
                              color={theme.text.status.running}
                            />
                          </box>
                        )}
                      </For>
                      <text width={10} fg={theme.text.subdued}>
                        {item.pace ? "adaptive" : `${item.frames.length * item.interval}ms`}
                      </text>
                      <Show when={dimensions().width >= 80}>
                        <text fg={theme.text.subdued}>
                          {[...new Set(item.frames)].join(" ")}
                          {item.levels ? "  + intensity" : ""}
                        </text>
                      </Show>
                    </box>
                  )}
                </For>
              </scrollbox>
            </Show>
            <box
              width={previewWidth()}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              alignItems={solo() ? "center" : undefined}
            >
              <text fg={theme.text.default} maxWidth="100%" attributes={solo() ? TextAttributes.BOLD : 0}>
                <Show when={!solo()}>{String(selected() + 1).padStart(2, "0")} / </Show>
                {animation().name.toLowerCase()}.
              </text>
              <Show when={!solo()}>
                <text fg={theme.text.subdued} maxWidth="100%">
                  {animation().description}
                </text>
                <text fg={theme.text.subdued}>
                  {speed()}x: {timing()}
                </text>
              </Show>
              <box
                width={
                  solo() ? Math.min(previewWidth() - 2, stringWidth(splash().label + splash().metadata) + 7) : "100%"
                }
                marginTop={solo() ? 1 : 0}
              >
                <box height={1} flexDirection="row">
                  <text width={7} fg={theme.text.subdued}>
                    work
                  </text>
                  <OneCellSpinner
                    animation={animation()}
                    age={age()}
                    speed={speed()}
                    animations={animations()}
                    paused={paused()}
                    glow={glow()}
                    color={theme.text.status.running}
                  />
                  <text fg={theme.text.default}> esc stop</text>
                </box>
                <box height={1} flexDirection="row">
                  <text width={7} fg={theme.text.subdued}>
                    launch
                  </text>
                  <OneCellSpinner
                    animation={animation().launch ?? animation()}
                    speed={speed()}
                    animations={animations()}
                    paused={paused()}
                    glow={glow()}
                    color={theme.text.default}
                  />
                  <text fg={theme.text.default} wrapMode="none">
                    {splash().label.slice(1)}
                    <span style={{ fg: theme.text.subdued }}>{splash().metadata}</span>
                  </text>
                </box>
              </box>
            </box>
          </>
        )}
      </For>
      <Show when={!solo()}>
        <StoryFooter
          context={props.context}
          title="motion lab."
          details={[animations() ? (paused() ? "paused" : "playing") : "motion off", glow() ? "glow on" : "shape only"]}
          status={animation().pace ? `start at ${age() / 1000}s | slows after 30s` : undefined}
          controls={[
            { shortcut: "j/k", label: "select" },
            { shortcut: "s", label: "speed" },
            { shortcut: "space", label: "pause" },
            { shortcut: "a", label: "motion" },
            { shortcut: "g", label: "glow" },
            { shortcut: "f", label: "focus" },
            { shortcut: "p", label: "replay" },
            ...(animation().pace ? [{ shortcut: "t", label: "age 0/30/60s" }] : []),
            { shortcut: "r", label: "reset" },
            { shortcut: "esc", label: "back" },
          ]}
        />
      </Show>
    </box>
  )
}

export const oneCellSpinnerStory: Story = {
  id: "one-cell-spinners",
  title: "one-cell spinners.",
  render: (context) => <OneCellSpinnerStory context={context} />,
}
