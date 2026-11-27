# Live widgets

<!--
  Model guidance for live mode (specs/v2/widgets-live.md). The examples are run by
  packages/widget/test/guidance.test.ts; keep them in sync.
-->

A step widget template computes its view from state and reacts to one event at a time. A **live** widget template runs one program
for as long as the widget is open: it keeps its state in variables, waits for timers and display frames, and renders
whenever it wants.

## When to use live mode

Use it when something should happen **without the user acting**: games, timers and countdowns, animations that play
out step by step, dashboards that poll an HTTPS API. Stay with step mode (the default) for pickers, forms,
confirmations and charts: step widgets are cheaper and work in the terminal.

## Writing one

Save it with `widget_template` `action: "save"` and `mode: "live"`, and define `async function main(data)`. Input
arrives through **handlers on nodes**, the same props as in step mode, but a live handler gets only the value and its
return value is ignored: it changes your variables or calls `widget.*`.

```
widget.render(node)                      replace the view; handlers on its nodes run between your awaits
widget.draw(key, g)                      replace the drawing of the canvas with that `key` (g = ui.draw())
await widget.frame()                     next display frame { t, dt, width, height, scale, pointer, dark }
await widget.sleep(ms)                   wait
widget.now()                             ms the program has been running, not counting time paused
widget.on(kind, fn)                      "key" | "focus" | "fullscreen" | "capture" | "resumed"; returns an unsubscribe
widget.keys / widget.pointer             held key codes (a Set) and the last pointer, read them each frame
await widget.fetch(url, { method, headers, body })
                                         HTTPS request → { ok, status, headers, text(), json() }; needs the https
                                         capability; rejects with { kind, message }
widget.submit(value) / widget.dismiss()  final answer; the program stops
widget.send(value, { wake })             a message to you while the widget stays open (wake: false = next turn)
```

- **Draw on frames.** Ask for a frame (`await widget.frame()`) only while something moves; each call requests one,
  delivered at the next screen refresh. Stop asking when nothing moves, and the program costs nothing.
- **Render rarely.** Re-render when the layout or text changes; put what moves every frame in a canvas.
- **Never loop without awaiting.** More than 50 ms without an `await` stops the program. Keep each draw under 2,000
  commands and post at most 240 times a second.
- **Returning keeps the view.** When `main` returns, the widget stays open and its handlers keep running until one of
  them submits or dismisses.
- **Pauses are normal.** Out of view or in the background, the program is paused: nothing arrives and timers and
  `widget.now()` stand still. `widget.on("resumed", (pausedMs) => ...)` tells you when it's back.
- `Math.random()` is fine. Always set the canvas `alt`: the terminal shows it.

## Example: a small game

```js
// Catch the ball: it bounces around; tap it to score. Submits { score }.
async function main(data) {
  const ball = { x: 60, y: 60, vx: 180, vy: 140, r: 22 }
  let score = 0
  const catchAt = (p) => {
    if (p.kind === "down" && Math.hypot(p.x - ball.x, p.y - ball.y) <= ball.r + 8) {
      score++
      ball.vx *= 1.1
    }
  }
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({ key: "court", height: 240, alt: "Catch the ball game", onPointer: catchAt }),
    ]),
  )
  const end = widget.now() + (data.seconds ?? 15) * 1000
  while (widget.now() < end) {
    const f = await widget.frame()
    ball.x = Math.max(ball.r, Math.min(f.width - ball.r, ball.x + ball.vx * f.dt))
    ball.y = Math.max(ball.r, Math.min(f.height - ball.r, ball.y + ball.vy * f.dt))
    if (ball.x <= ball.r || ball.x >= f.width - ball.r) ball.vx = -ball.vx
    if (ball.y <= ball.r || ball.y >= f.height - ball.r) ball.vy = -ball.vy
    const g = ui.draw()
    g.text(12, 24, "Score " + score, { size: 16, weight: 600 })
    g.text(f.width - 12, 24, Math.ceil((end - widget.now()) / 1000) + "s", { align: "right", color: "muted" })
    g.circle(ball.x, ball.y, ball.r, "accent")
    widget.draw("court", g)
  }
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text("You caught it " + score + " times", { style: "title" }),
      ui.button("Submit", { variant: "primary", onPress: () => widget.submit({ score }) }),
    ]),
  )
}
```

## Example: a live dashboard

Declare the hosts it may reach in the widget template's `capabilities` (`{ "https": { "hosts": ["api.github.com"] } }`).
Requests are HTTPS only, at most 4 in flight and 10 a second, 15 s and 2 MB each.

```js
// GitHub repository stats, refreshed every `seconds` (default 60), on "Refresh", and when the widget comes back.
async function main(data) {
  const stats = { repo: null, error: null }
  const show = () =>
    widget.render(
      ui.column({ gap: 1 }, [
        ui.text(data.repo, { style: "title" }),
        stats.repo &&
          ui.row({ gap: 2 }, [
            ui.text("★ " + stats.repo.stargazers_count),
            ui.text("Open issues " + stats.repo.open_issues_count),
          ]),
        stats.error && ui.text(stats.error, { tone: "error" }),
        ui.button("Refresh", { variant: "secondary", onPress: refresh }),
      ]),
    )
  async function refresh() {
    try {
      const response = await widget.fetch("https://api.github.com/repos/" + data.repo, {
        headers: { accept: "application/vnd.github+json" },
      })
      if (!response.ok) throw { message: "GitHub answered " + response.status }
      stats.repo = await response.json()
      stats.error = null
    } catch (error) {
      stats.error = "Couldn't refresh: " + error.message
    }
    show()
  }
  widget.on("resumed", refresh)
  show()
  while (true) {
    await refresh()
    await widget.sleep((data.seconds ?? 60) * 1000)
  }
}
```
