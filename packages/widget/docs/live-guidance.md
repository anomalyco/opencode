# Live widgets

<!--
  Model guidance for live mode (specs/v2/widgets-live.md), to be folded into the `widgets` skill. The examples are
  run by packages/widget/test/guidance.test.ts; keep them in sync.
-->

A step template reacts to one event at a time and can only animate a canvas from `frame.t`. A **live** template runs
one program for as long as the widget is open: it keeps its state in variables, waits for taps, timers and display
frames, and renders whenever it wants.

## When to use live mode

Use it when something should happen **without the user acting**, or the widget is a loop rather than a form:

- games (reaction tests, tap targets, small puzzles with a clock)
- timers, countdowns, stopwatches, pomodoros
- animations that play out step by step (an algorithm sorting, a simulation running)
- dashboards that poll an HTTPS API and refresh themselves

Stay with step mode (the default) for pickers, forms, confirmations, charts and anything that only changes when the
user clicks. Step widgets are cheaper, work in the terminal, and the server can run them to check them; a live
widget's `main` only runs on the user's device, so the server only checks that it compiles.

## Writing one

Save it with `widget_template` `action: "save"` and `mode: "live"`. Instead of `init`/`view`/`update`/`draw`, define
`async function main(data)`. It runs until it returns, calls `widget.submit(...)` / `widget.dismiss()`, or the
widget closes. Everything goes through the `widget` object:

```
widget.render(node)                      replace the view (any ui.* node, canvas and shader included)
widget.draw(canvasID, g)                 replace a canvas's drawing (g = ui.draw(), same commands as step mode)
await widget.event()                     next user event: { id, type: "press" | "change" | "pointer", value }
await widget.frame()                     next display frame { t, dt, width, height, scale, pointer, dark }
await widget.next({ frame, timeout })    whichever comes first:
                                           { type: "event", event } | { type: "frame", frame }
                                           | { type: "timeout" } | { type: "resumed", pausedMs }
await widget.sleep(ms)                   wait
widget.now()                             ms the program has been running, not counting time paused
await widget.fetch(url, { method, headers, body })
                                         HTTPS request → { ok, status, headers, text(), json() }; needs the https
                                         capability; rejects with { kind, message }
widget.submit(value) / widget.dismiss()  final answer; the program stops
widget.send(value, { wake })             a message to you while the widget stays open (wake: false = next turn)
```

Rules that keep it smooth:

- **Draw only when a frame arrives.** Ask for frames with `widget.next({ frame: true })` (or `widget.frame()`) only
  while something moves; each call requests exactly one, delivered at the next screen refresh. Handle events between
  frames and draw on the frame. Stop asking when nothing moves, and the program costs nothing.
- **Render rarely.** `widget.render` rebuilds the native view; call it when the layout or text changes, not every
  frame. Put anything that changes every frame (positions, timers on the board) in a canvas and `widget.draw` it.
- **Never loop without awaiting.** A stretch of more than 50 ms without an `await` stops the program with an error.
  Keep each `draw` under 2,000 commands (a few dozen is plenty), and don't post more than 240 times a second.
- **Pauses are normal.** When the widget scrolls out of view or the app goes to the background, the program is
  paused: nothing arrives, timers and `widget.now()` stand still. On return, `widget.next` first gives
  `{ type: "resumed", pausedMs }`: refresh data, or show a pause screen in a game. Use `Date.now()` only for
  wall-clock times you display.
- `Math.random()` is fine in live mode. Canvas pointer events carry `{ kind, x, y, width, height }`; give the canvas an
  `id` to get them.
- Always set the canvas `alt`: clients that can't run live widgets (the terminal) show it.

## Example: a small game

```js
// Catch the ball: it bounces around; tap it to score. Submits { score }.
async function main(data) {
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text(data.title, { style: "title" }),
      ui.canvas({ id: "court", height: 240, alt: "Catch the ball game" }),
    ]),
  )
  const ball = { x: 60, y: 60, vx: 180, vy: 140, r: 22 }
  const end = widget.now() + (data.seconds ?? 15) * 1000
  let score = 0
  while (widget.now() < end) {
    const next = await widget.next({ frame: true, timeout: end - widget.now() })
    if (next.type === "event" && next.event.type === "pointer" && next.event.value.kind === "down") {
      if (Math.hypot(next.event.value.x - ball.x, next.event.value.y - ball.y) <= ball.r + 8) {
        score++
        ball.vx *= 1.1
      }
    }
    if (next.type !== "frame") continue
    const f = next.frame
    ball.x += ball.vx * f.dt
    ball.y += ball.vy * f.dt
    if (ball.x < ball.r || ball.x > f.width - ball.r) ball.vx = -ball.vx
    if (ball.y < ball.r || ball.y > f.height - ball.r) ball.vy = -ball.vy
    ball.x = Math.max(ball.r, Math.min(f.width - ball.r, ball.x))
    ball.y = Math.max(ball.r, Math.min(f.height - ball.r, ball.y))
    const g = ui.draw()
    g.text(12, 24, "Score " + score, { size: 16, weight: 600 })
    g.text(f.width - 12, 24, Math.ceil((end - widget.now()) / 1000) + "s", { align: "right", color: "muted" })
    g.circle(ball.x, ball.y, ball.r, "accent")
    widget.draw("court", g)
  }
  widget.render(
    ui.column({ gap: 1 }, [
      ui.text("You caught it " + score + " times", { style: "title" }),
      ui.button("done", "Submit", { variant: "primary" }),
    ]),
  )
  while ((await widget.event()).id !== "done") {}
  widget.submit({ score })
}
```

## Example: a live dashboard

A dashboard polls an HTTPS JSON API. Declare the hosts it may reach in the template's `capabilities`
(`{ "https": { "hosts": ["api.github.com"] } }`; `*.example.com` covers subdomains). Clients show the hosts on the
widget. Requests are HTTPS only, at most 4 in flight and 10 a second, 15 s and 2 MB each; failures reject with
`{ kind: "CapabilityDenied" | "Network" | "Timeout" | "TooLarge" | "RateLimited", message }`.

```js
// GitHub repository stats, refreshed every `seconds` (default 60), on "Refresh", and when the widget comes back.
async function main(data) {
  const every = (data.seconds ?? 60) * 1000
  const stats = { repo: null, error: null, updated: null }
  const show = () =>
    widget.render(
      ui.column({ gap: 1 }, [
        ui.text(data.repo, { style: "title" }),
        stats.repo &&
          ui.row({ gap: 2 }, [
            ui.text("★ " + stats.repo.stargazers_count),
            ui.text("Forks " + stats.repo.forks_count),
            ui.text("Open issues " + stats.repo.open_issues_count),
          ]),
        stats.error && ui.text(stats.error, { tone: "error" }),
        ui.row({ gap: 1, align: "center" }, [
          ui.button("refresh", "Refresh", { variant: "secondary" }),
          stats.updated && ui.text("Updated " + stats.updated, { style: "caption", tone: "muted" }),
        ]),
      ]),
    )
  const refresh = async () => {
    try {
      const response = await widget.fetch("https://api.github.com/repos/" + data.repo, {
        headers: { accept: "application/vnd.github+json" },
      })
      if (!response.ok) throw { message: "GitHub answered " + response.status }
      stats.repo = await response.json()
      stats.error = null
      stats.updated = new Date().toISOString().slice(11, 19) + " UTC"
    } catch (error) {
      stats.error = "Couldn't refresh: " + error.message
    }
    show()
  }
  show()
  await refresh()
  while (true) {
    const next = await widget.next({ timeout: every })
    if (next.type === "event" && next.event.id !== "refresh") continue
    await refresh()
  }
}
```

A `timeout` (the poll interval), a `resumed` (back on screen) and the Refresh button all refresh; other events are
ignored. The program sleeps in `widget.next` between polls, so it costs nothing while it waits.
