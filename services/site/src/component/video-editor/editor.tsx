import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import "./editor.css"
import { cropRect, crops, type Crop } from "./crops"
import {
  camOf,
  driftWidth,
  durationOf,
  moveShot,
  setSpeed,
  speedOf,
  split,
  trim,
  uniqueId,
  type Box,
  type Cam,
  type Edit,
  type Engine,
  type Shot,
  type Transition,
} from "./edit"

const API = "/video-editor/api"

type Video = {
  id: string
  pipeline: string
  name: string
  title: string
  product: string
  aspect: string
  feature: boolean
  styles: { style: string; set: string; video: string; poster: string; updated: number; size: number }[]
}

type RenderJob = {
  id: string
  status: "running" | "done" | "error" | "stopped"
  style: string
  progress?: { style: string; frame: number; count: number }
  log: string[]
}

async function loadEngine() {
  const text = await fetch(`${API}/engine.mjs`).then((response) => response.text())
  const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }))
  return (await import(/* @vite-ignore */ url)) as Engine
}

const json = <T,>(url: string, init?: RequestInit) =>
  fetch(url, init).then((response) =>
    response.ok ? (response.json() as Promise<T>) : Promise.reject(new Error(`${response.status}`)),
  )
const post = <T,>(url: string, body: unknown) =>
  json<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const fixed = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "–")

export default function VideoEditor() {
  const params = new URLSearchParams(location.search)
  const [engine] = createResource(loadEngine)
  const [videos, { refetch: refetchVideos }] = createResource(() => json<Video[]>(`${API}/videos`))
  const [videoId, setVideoId] = createSignal(params.get("v") ?? "real-ui/desktop-landscape")
  const [style, setStyle] = createSignal(params.get("style") ?? "cinematic")
  const [edit, setEdit] = createSignal<Edit>()
  const [past, setPast] = createSignal<string[]>([])
  const [future, setFuture] = createSignal<string[]>([])
  const [saveState, setSaveState] = createSignal<"saved" | "saving" | "unsaved" | "error">("saved")
  const [selected, setSelected] = createSignal(0)
  const [selectedKey, setSelectedKey] = createSignal(0)
  const [time, setTime] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [looping, setLooping] = createSignal(true)
  const [message, setMessage] = createSignal("")
  const [renderedEdit, setRenderedEdit] = createSignal<Edit>()
  const [viewCrop, setViewCrop] = createSignal("full")
  const [guides, setGuides] = createSignal(true)
  const [panes, setPanes] = createSignal(true)

  const video = createMemo(() => videos()?.find((item) => item.id === videoId()))
  const styles = createMemo(() => Object.keys(edit()?.styles ?? {}))
  const pipeline = () => videoId().split("/")[0]
  const name = () => videoId().split("/")[1]

  const proxy = (key: string, index: number, width?: number) => {
    const current = edit()
    if (!current) return ""
    const source = current.sources[key]
    const file = `${String(index).padStart(source.pad ?? 4, "0")}.jpg`
    return `${API}/proxy/${pipeline()}/${source.dir}/${file}${width ? `?w=${width}` : ""}`
  }

  const plan = createMemo(() => {
    const current = edit()
    const e = engine()
    if (!current || !e) return
    return e.plan(current, style(), { url: (key, index) => proxy(key, index), blur: false })
  })
  // Camera values for editing come from the cinematic plan: the straight style flattens the tilt.
  const camPlan = createMemo(() => {
    const current = edit()
    const e = engine()
    if (!current || !e) return
    return e.plan(current, current.styles.cinematic ? "cinematic" : style(), { url: () => "", blur: false })
  })
  const checks = createMemo(() => {
    const current = edit()
    const e = engine()
    if (!current || !e) return []
    return e.checks(current, style())
  })
  const total = () => plan()?.total ?? 0
  const fps = () => engine()?.FPS ?? 30
  const frameNumber = () => Math.min(Math.max(0, (plan()?.count ?? 1) - 1), Math.floor(time() * fps() + 1e-6))
  const shotAtPlayhead = () => plan()?.indexAt(time()) ?? 0
  const shot = () => edit()?.shots[selected()]
  // Setting an iframe's src, even to the same value, reloads it: only change it when the page really changes.
  const composeUrl = createMemo(() => `${API}/file/${pipeline()}/${edit()?.render.compose}`)
  const cropList = (): Crop[] => (video()?.feature ? crops.feature : crops[edit()?.aspect ?? "landscape"])
  const aspects = createMemo(() => {
    const current = video()
    if (!current) return []
    return (videos() ?? []).filter(
      (item) =>
        item.pipeline === current.pipeline &&
        item.product === current.product &&
        item.feature === current.feature &&
        (!item.feature || item.name === current.name),
    )
  })

  // Load the chosen video's edit, warm its proxy frames and remember the choice in the address.
  createEffect(
    on(videoId, async (id) => {
      setPlaying(false)
      const [pipe, file] = id.split("/")
      const loaded = await json<Edit>(`${API}/edit/${pipe}/${file}`).catch(() => undefined)
      if (!loaded) return setMessage(`Can't load ${id}`)
      setEdit(loaded)
      setPast([])
      setFuture([])
      setSaveState("saved")
      setSelected((i) => Math.min(i, loaded.shots.length - 1))
      setSelectedKey(0)
      setRenderedEdit(await json<Edit>(`${API}/rendered/${pipe}/${file}`).catch(() => undefined))
      if (!loaded.styles[style()]) setStyle(Object.keys(loaded.styles)[0])
      fetch(`${API}/warm/${pipe}/${file}`, { method: "POST" })
      history.replaceState(null, "", `?v=${id}&style=${style()}`)
    }),
  )
  createEffect(() => history.replaceState(null, "", `?v=${videoId()}&style=${style()}`))

  // Edits: every change goes through update(), which records undo history and autosaves.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(saveTimer)
    setSaveState("unsaved")
    saveTimer = setTimeout(async () => {
      const current = edit()
      if (!current) return
      setSaveState("saving")
      const response = await fetch(`${API}/edit/${pipeline()}/${name()}`, {
        method: "PUT",
        body: JSON.stringify(current),
      }).catch(() => undefined)
      setSaveState(response?.ok ? "saved" : "error")
    }, 500)
  }
  const checkpoint = () => {
    const current = edit()
    if (!current) return
    setPast((list) => [...list.slice(-199), JSON.stringify(current)])
    setFuture([])
  }
  const update = (fn: (current: Edit) => Edit, record = true) => {
    const current = edit()
    if (!current) return
    if (record) checkpoint()
    setEdit(fn(current))
    save()
  }
  const updateShot = (index: number, fn: (shot: Shot) => Shot, record = true) =>
    update(
      (current) => ({ ...current, shots: current.shots.map((item, i) => (i === index ? fn(item) : item)) }),
      record,
    )
  const undo = () => {
    const last = past().at(-1)
    const current = edit()
    if (!last || !current) return
    setFuture((list) => [...list, JSON.stringify(current)])
    setPast((list) => list.slice(0, -1))
    setEdit(JSON.parse(last) as Edit)
    save()
  }
  const redo = () => {
    const next = future().at(-1)
    const current = edit()
    if (!next || !current) return
    setPast((list) => [...list, JSON.stringify(current)])
    setFuture((list) => list.slice(0, -1))
    setEdit(JSON.parse(next) as Edit)
    save()
  }
  const revertToRender = async () => {
    const rendered = await json<Edit>(`${API}/rendered/${pipeline()}/${name()}`).catch(() => undefined)
    if (!rendered) return setMessage("No render of this video from the editor yet")
    update(() => rendered)
    setSelected((i) => Math.min(i, rendered.shots.length - 1))
    setMessage("Shot list reverted to the last render")
  }

  // Shot operations.
  const select = (index: number, seek = true) => {
    setSelected(index)
    setSelectedKey(0)
    const item = plan()?.list[index]
    if (seek && item) setTime(item.start)
  }
  const duplicate = (index: number) =>
    update((current) => {
      const copy = { ...structuredClone(current.shots[index]), id: uniqueId(current.shots, current.shots[index].id) }
      return { ...current, shots: [...current.shots.slice(0, index + 1), copy, ...current.shots.slice(index + 1)] }
    })
  const remove = (index: number) => {
    if ((edit()?.shots.length ?? 0) < 2) return
    update((current) => ({ ...current, shots: current.shots.filter((_, i) => i !== index) }))
    setSelected((i) => Math.max(0, Math.min(i, (edit()?.shots.length ?? 1) - 1)))
  }
  const move = (from: number, to: number) => {
    if (from === to || from + 1 === to) return
    update((current) => ({ ...current, shots: moveShot(current.shots, from, to) }))
    setSelected(to > from ? to - 1 : to)
  }
  const splitAtPlayhead = () => {
    const p = camPlan()
    const current = edit()
    if (!p || !current) return
    const index = p.indexAt(time())
    const local = time() - p.list[index].start
    update((e) => ({
      ...e,
      shots: split(
        e,
        e.shots,
        index,
        local,
        (t) => p.cam(index, t),
        (t) => p.srcTime(index, t),
      ),
    }))
    setSelected(index + 1)
  }
  const copyEndToNext = (index: number) => {
    const p = camPlan()
    const current = edit()
    if (!p || !current || index + 1 >= current.shots.length) return
    const end = p.cam(index, p.list[index].duration)
    updateShot(index + 1, (next) => {
      if (next.keys) return { ...next, keys: [[next.keys[0][0], camOf(end)], ...next.keys.slice(1)] }
      if (next.a)
        return {
          ...next,
          a: {
            ...next.a,
            cx: round(end.cx),
            cy: round(end.cy),
            w: round(driftWidth(current, end.s)),
            rx: round(end.rx),
            ry: round(end.ry),
            rz: round(end.rz),
          },
        }
      return next
    })
    setMessage(`Copied the end camera of ${current.shots[index].id} to the start of ${current.shots[index + 1].id}`)
  }

  // Playback: every preview (the main stage and the crop panes) is the pipeline's own compositor page
  // (compose.html) in an iframe at the output size; each frame is drawn into all of them. The crop panes skip
  // the depth-of-field layers (a blurred full-size copy per layer), which cost the most to draw.
  const targets = new Map<Window, { lite: boolean }>()
  const [targetsVersion, setTargetsVersion] = createSignal(0)
  let drawing = false
  let pending: number | undefined
  const draw = async (n: number) => {
    const p = plan()
    if (!p || targets.size === 0) return
    if (drawing) {
      pending = n
      return
    }
    drawing = true
    const f = p.frame(Math.max(0, Math.min(p.count - 1, n)))
    // A compositor page that navigates away mid-draw never resolves; don't let it stall the others.
    const timeout = () => new Promise((resolve) => setTimeout(resolve, 3000))
    const lite = (layer: Record<string, unknown>) => ({ ...layer, dof: undefined })
    const liteArg =
      f.method === "renderMulti"
        ? (f.arg as Record<string, unknown>[][]).map((layers) => layers.map(lite))
        : (f.arg as Record<string, unknown>[]).map(lite)
    await Promise.all(
      [...targets].map(([win, options]) =>
        Promise.race([
          (win as unknown as Record<string, ((arg: unknown) => Promise<void>) | undefined>)[f.method]?.(
            options.lite ? liteArg : f.arg,
          ),
          timeout(),
        ]),
      ),
    )
    drawing = false
    if (pending !== undefined) {
      const next = pending
      pending = undefined
      await draw(next)
    }
  }
  createEffect(() => {
    plan()
    targetsVersion()
    const n = frameNumber()
    if (!playing()) draw(n)
  })
  const prefetch = (n: number) => {
    const p = plan()
    if (!p) return
    for (let k = 1; k <= 12; k++) {
      const f = p.frame((n + k) % p.count)
      const layers = (
        f.method === "renderMulti" ? (f.arg as { src: string }[][]).flat() : (f.arg as { src: string }[])
      ).map((layer) => layer.src)
      for (const src of new Set(layers)) new Image().src = src
    }
  }
  const play = () => {
    if (playing()) return setPlaying(false)
    if (time() >= total() - 1 / fps()) setTime(0)
    setPlaying(true)
    const startWall = performance.now()
    const startTime = time()
    const tick = async () => {
      if (!playing()) return
      const elapsed = startTime + (performance.now() - startWall) / 1000
      const length = total()
      if (elapsed >= length && !looping()) {
        setTime(length - 1 / fps())
        setPlaying(false)
        return
      }
      const t = elapsed % length
      setTime(t)
      const n = Math.floor(t * fps())
      prefetch(n)
      await draw(n)
      requestAnimationFrame(tick)
    }
    tick()
  }
  const step = (frames: number) => {
    setPlaying(false)
    setTime((t) => Math.max(0, Math.min(total() - 1 / fps(), (Math.round(t * fps()) + frames) / fps())))
  }

  let stageRef: HTMLDivElement | undefined
  const [stageSize, setStageSize] = createSignal<[number, number]>([800, 450])
  const measure = () => stageRef && setStageSize([stageRef.clientWidth, stageRef.clientHeight])
  onMount(() => {
    const observer = new ResizeObserver(measure)
    createEffect(() => {
      if (!edit()) return
      requestAnimationFrame(() => {
        if (!stageRef) return
        observer.observe(stageRef)
        measure()
      })
    })
    onCleanup(() => observer.disconnect())
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, select")) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        return event.shiftKey ? redo() : undo()
      }
      if (event.key === " ") {
        event.preventDefault()
        return play()
      }
      if (event.key === "ArrowLeft") return step(event.shiftKey ? -fps() : -1)
      if (event.key === "ArrowRight") return step(event.shiftKey ? fps() : 1)
      if (event.key === "s") return splitAtPlayhead()
    }
    window.addEventListener("keydown", keydown)
    onCleanup(() => window.removeEventListener("keydown", keydown))
  })

  // Direct framing: the camera at the playhead. Keys shots: the key at the playhead (created when there is none).
  // Drift shots (Mobile): pan and zoom move the shot's pin to the playhead's source time; tilt changes the start
  // camera (a), whose tilt the drift carries through the shot.
  const playheadCam = () => {
    const p = camPlan()
    if (!p) return
    const i = p.indexAt(time())
    return p.cam(i, time() - p.list[i].start)
  }
  const keyAtPlayhead = () => {
    const p = camPlan()
    const current = edit()
    if (!p || !current) return -1
    const i = p.indexAt(time())
    const local = time() - p.list[i].start
    return current.shots[i].keys?.findIndex(([t]) => Math.abs(t - local) < 0.5 / fps()) ?? -1
  }
  const setPlayheadCam = (changes: Partial<Cam>, record = false) => {
    const p = camPlan()
    const current = edit()
    if (!p || !current) return
    const i = p.indexAt(time())
    const local = round(time() - p.list[i].start, 3)
    const now = p.cam(i, local)
    if (selected() !== i) setSelected(i)
    updateShot(
      i,
      (item) => {
        if (item.keys) {
          const k = item.keys.findIndex(([t]) => Math.abs(t - local) < 0.5 / fps())
          if (k >= 0)
            return {
              ...item,
              keys: item.keys.map(([t, c], j): [number, Cam] =>
                j === k ? [t, roundCam({ ...c, ...changes })] : [t, c],
              ),
            }
          const keys: [number, Cam][] = [...item.keys, [local, roundCam({ ...camOf(now), ...changes })]]
          return { ...item, keys: keys.toSorted((a, b) => a[0] - b[0]) }
        }
        const a = item.a
        if (!a) return item
        const tilt = {
          rx: round((a.rx ?? 0) + (changes.rx ?? now.rx) - now.rx),
          ry: round((a.ry ?? 0) + (changes.ry ?? now.ry) - now.ry),
          rz: round((a.rz ?? 0) + (changes.rz ?? now.rz) - now.rz),
        }
        const moved = changes.cx !== undefined || changes.cy !== undefined || changes.s !== undefined
        const pin = moved
          ? {
              t: round(p.srcTime(i, local) / (current.unit === "frames" ? 30 : 1), 3),
              cx: round(changes.cx ?? now.cx, 1),
              cy: round(changes.cy ?? now.cy, 1),
              w: round(driftWidth(current, changes.s ?? now.s), 1),
            }
          : item.pin
        return { ...item, a: { ...a, ...tilt }, ...(pin ? { pin } : {}) }
      },
      record,
    )
  }
  const resetKey = () => {
    const p = camPlan()
    const current = edit()
    if (!p || !current) return
    const i = p.indexAt(time())
    const item = current.shots[i]
    const saved = renderedEdit()?.shots.find((other) => other.id === item.id)
    const k = keyAtPlayhead()
    if (item.keys) {
      if (k < 0) return setMessage("No camera key at the playhead")
      const at = item.keys[k][0]
      const savedKey = saved?.keys?.find(([t]) => Math.abs(t - at) < 0.5 / fps())
      if (savedKey)
        return updateShot(i, (shot) => ({
          ...shot,
          keys: (shot.keys ?? []).map(([t, c], j): [number, Cam] => (j === k ? [t, savedKey[1]] : [t, c])),
        }))
      if (item.keys.length < 2) return setMessage("This is the shot's only key")
      return updateShot(i, (shot) => ({ ...shot, keys: (shot.keys ?? []).filter((_, j) => j !== k) }))
    }
    updateShot(i, (shot) => {
      const next = { ...shot, a: saved?.a ?? shot.a }
      if (saved?.pin) next.pin = saved.pin
      else delete next.pin
      return next
    })
  }

  // Rendering through the pipeline (editor/render.mjs), polled once a second.
  const [renderStyle, setRenderStyle] = createSignal("both")
  const [hdr, setHdr] = createSignal(false)
  const [draft, setDraft] = createSignal(false)
  const [job, setJob] = createSignal<RenderJob>()
  let poll: ReturnType<typeof setInterval> | undefined
  const watch = (id: string) => {
    clearInterval(poll)
    const tick = async () => {
      const status = await json<RenderJob>(`${API}/render/${id}`).catch(() => undefined)
      if (!status) return
      setJob(status)
      if (status.status !== "running") {
        clearInterval(poll)
        refetchVideos()
        if (status.status === "done")
          setRenderedEdit(await json<Edit>(`${API}/rendered/${pipeline()}/${name()}`).catch(() => undefined))
      }
    }
    tick()
    poll = setInterval(tick, 1000)
  }
  onCleanup(() => clearInterval(poll))
  createEffect(
    on(videoId, async (id) => {
      setJob(undefined)
      const list = await json<RenderJob[]>(`${API}/renders?video=${encodeURIComponent(id)}`).catch(() => [])
      if (list[0]) watch(list[0].id)
    }),
  )
  const render = async () => {
    clearTimeout(saveTimer)
    const current = edit()
    if (current) await fetch(`${API}/edit/${pipeline()}/${name()}`, { method: "PUT", body: JSON.stringify(current) })
    setSaveState("saved")
    const started = await post<RenderJob>(`${API}/render`, {
      pipeline: pipeline(),
      name: name(),
      style: renderStyle(),
      hdr: hdr(),
      draft: draft(),
      publish: true,
    })
    setJob({ ...started, status: "running", log: [] })
    watch(started.id)
  }
  const cancel = () => {
    const current = job()
    if (current) post(`${API}/render/${current.id}/cancel`, {})
  }
  const restore = async () => {
    const result = await post<{ restored: { set: string; restored: boolean; from?: string }[] }>(`${API}/restore`, {
      pipeline: pipeline(),
      name: name(),
      style: renderStyle(),
    })
    setMessage(
      result.restored
        .map((item) => (item.restored ? `${item.set}: restored ${item.from}` : `${item.set}: no editor backup`))
        .join(" · ") + " · Revert to last render loads the matching shot list",
    )
    setRenderedEdit(await json<Edit>(`${API}/rendered/${pipeline()}/${name()}`).catch(() => undefined))
    refetchVideos()
  }

  return (
    <div data-page="video-editor">
      <header data-slot="bar">
        <strong>Video editor</strong>
        <label>
          Video
          <select value={videoId()} onChange={(event) => setVideoId(event.currentTarget.value)}>
            <optgroup label="Product videos">
              <For each={videos()?.filter((item) => !item.feature)}>
                {(item) => (
                  <option value={item.id} selected={item.id === videoId()}>
                    {item.title}
                  </option>
                )}
              </For>
            </optgroup>
            <optgroup label="Feature clips">
              <For each={videos()?.filter((item) => item.feature)}>
                {(item) => (
                  <option value={item.id} selected={item.id === videoId()}>
                    {item.title}
                  </option>
                )}
              </For>
            </optgroup>
          </select>
        </label>
        <Show when={aspects().length > 1}>
          <div data-slot="segmented">
            <For each={aspects()}>
              {(item) => (
                <button data-selected={item.id === videoId() ? "" : undefined} onClick={() => setVideoId(item.id)}>
                  {item.aspect}
                </button>
              )}
            </For>
          </div>
        </Show>
        <label>
          Style
          <select value={style()} onChange={(event) => setStyle(event.currentTarget.value)}>
            <For each={styles()}>
              {(item) => (
                <option value={item} selected={item === style()}>
                  {item}
                </option>
              )}
            </For>
          </select>
        </label>
        <span data-slot="spacer" />
        <button onClick={undo} disabled={past().length === 0} title="Undo (⌘Z)">
          Undo
        </button>
        <button onClick={redo} disabled={future().length === 0} title="Redo (⇧⌘Z)">
          Redo
        </button>
        <button onClick={revertToRender} title="Load the shot list of the last render">
          Revert to last render
        </button>
        <span data-slot="save" data-state={saveState()}>
          {saveState() === "saved"
            ? "Saved"
            : saveState() === "saving"
              ? "Saving…"
              : saveState() === "error"
                ? "Save failed"
                : "Unsaved"}
        </span>
      </header>

      <Show when={message()}>
        <div data-slot="message" onClick={() => setMessage("")}>
          {message()}
        </div>
      </Show>

      <Show when={edit() && engine()} fallback={<p data-slot="loading">Loading…</p>}>
        <main data-slot="workspace">
          <section data-slot="preview">
            <div data-slot="view-bar">
              <label>
                View
                <select value={viewCrop()} onChange={(event) => setViewCrop(event.currentTarget.value)}>
                  <option value="full">Full frame</option>
                  <For each={cropList()}>{(crop) => <option value={crop.id}>{crop.label}</option>}</For>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={guides()}
                  onChange={(event) => setGuides(event.currentTarget.checked)}
                />{" "}
                Crop guides
              </label>
              <label>
                <input type="checkbox" checked={panes()} onChange={(event) => setPanes(event.currentTarget.checked)} />{" "}
                All crops
              </label>
              <span data-slot="hint">Drag: pan · scroll / pinch: zoom · ⌥-drag: tilt · ⇧-drag: roll</span>
            </div>
            <div data-slot="stage" ref={stageRef}>
              <Compositor
                ratio={cropList().find((crop) => crop.id === viewCrop())?.ratio}
                width={stageSize()[0]}
                height={stageSize()[1]}
                guides={viewCrop() === "full" && guides() ? cropList() : []}
                interactive
              />
            </div>
            <Show when={panes()}>
              <div data-slot="panes">
                <For each={cropList()}>
                  {(crop) => (
                    <figure>
                      <Compositor ratio={crop.ratio} width={edit()?.aspect === "portrait" ? 150 : 260} height={150} />
                      <figcaption title={crop.css}>{crop.label}</figcaption>
                    </figure>
                  )}
                </For>
              </div>
            </Show>
            <FramingPanel />
            <div data-slot="transport">
              <button onClick={() => step(-1)} title="Previous frame (←)">
                ◀︎
              </button>
              <button onClick={play} data-slot="play" title="Play / pause (space)">
                {playing() ? "Pause" : "Play"}
              </button>
              <button onClick={() => step(1)} title="Next frame (→)">
                ▶︎
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={looping()}
                  onChange={(event) => setLooping(event.currentTarget.checked)}
                />{" "}
                Loop
              </label>
              <span data-slot="time">
                {fixed(time())} / {fixed(total())} s · frame {frameNumber()} · shot{" "}
                {edit()?.shots[shotAtPlayhead()]?.id}
              </span>
              <span data-slot="hint">Preview: proxy frames, no motion blur</span>
            </div>
          </section>

          <aside data-slot="inspector">
            <Show when={shot()}>{(current) => <Inspector />}</Show>
          </aside>

          <section data-slot="timeline">
            <div data-slot="tools">
              <button onClick={splitAtPlayhead} title="Split the shot under the playhead (S)">
                Split at playhead
              </button>
              <button onClick={() => duplicate(selected())}>Duplicate</button>
              <button onClick={() => remove(selected())} disabled={(edit()?.shots.length ?? 0) < 2}>
                Delete
              </button>
              <button onClick={() => move(selected(), selected() - 1)} disabled={selected() === 0}>
                Move left
              </button>
              <button
                onClick={() => move(selected(), selected() + 2)}
                disabled={selected() >= (edit()?.shots.length ?? 0) - 1}
              >
                Move right
              </button>
              <span data-slot="spacer" />
              <span>
                {edit()?.shots.length} shots · {fixed(total())} s ·{" "}
                {checks().filter((item) => item.level === "warn").length} warnings
              </span>
            </div>
            <Timeline />
          </section>

          <section data-slot="side">
            <Warnings />
            <RenderPanel />
          </section>
        </main>
      </Show>
    </div>
  )

  function Compositor(props: {
    ratio?: number
    width: number
    height: number
    guides?: Crop[]
    interactive?: boolean
  }) {
    let frame: HTMLIFrameElement | undefined
    const size = () => edit()?.size ?? [1920, 1080]
    const rect = () => (props.ratio ? cropRect(size(), props.ratio) : { x: 0, y: 0, w: size()[0], h: size()[1] })
    const k = () => Math.max(0.01, Math.min(props.width / rect().w, props.height / rect().h))
    onCleanup(() => frame?.contentWindow && targets.delete(frame.contentWindow))
    let lastWheel = 0
    const down = (event: PointerEvent) => {
      const start = playheadCam()
      if (!start || event.button !== 0) return
      event.preventDefault()
      setPlaying(false)
      checkpoint()
      const target = event.currentTarget as HTMLElement
      target.setPointerCapture(event.pointerId)
      const mode = event.altKey ? "tilt" : event.shiftKey ? "roll" : "pan"
      target.dataset.mode = mode
      const x0 = event.clientX
      const y0 = event.clientY
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0
        const dy = ev.clientY - y0
        if (mode === "tilt") return setPlayheadCam({ ry: start.ry + dx * 0.08, rx: start.rx - dy * 0.08 })
        if (mode === "roll") return setPlayheadCam({ rz: start.rz + dx * 0.05 })
        setPlayheadCam({ cx: start.cx - dx / k() / start.s, cy: start.cy - dy / k() / start.s })
      }
      const up = () => {
        delete target.dataset.mode
        target.removeEventListener("pointermove", move)
        target.removeEventListener("pointerup", up)
      }
      target.addEventListener("pointermove", move)
      target.addEventListener("pointerup", up)
    }
    const wheel = (event: WheelEvent) => {
      const cam = playheadCam()
      if (!cam) return
      event.preventDefault()
      setPlaying(false)
      if (Date.now() - lastWheel > 500) checkpoint()
      lastWheel = Date.now()
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
      // Zoom around the pointer: the source point under it stays put.
      const px = (event.clientX - box.left - box.width / 2) / k()
      const py = (event.clientY - box.top - box.height / 2) / k()
      const s = cam.s * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))
      setPlayheadCam({ s, cx: cam.cx + px / cam.s - px / s, cy: cam.cy + py / cam.s - py / s })
    }
    return (
      <div data-slot="compositor" style={{ width: `${rect().w * k()}px`, height: `${rect().h * k()}px` }}>
        <iframe
          ref={frame}
          title="Preview"
          src={composeUrl()}
          width={size()[0]}
          height={size()[1]}
          style={{ transform: `translate(${-rect().x * k()}px, ${-rect().y * k()}px) scale(${k()})` }}
          onLoad={() => {
            if (frame?.contentWindow) targets.set(frame.contentWindow, { lite: !props.interactive })
            setTargetsVersion((n) => n + 1)
          }}
        />
        <For each={props.guides ?? []}>
          {(crop, j) => {
            const r = () => cropRect(size(), crop.ratio)
            return (
              <div
                data-slot="guide"
                style={{
                  left: `${r().x * k()}px`,
                  top: `${r().y * k()}px`,
                  width: `${r().w * k()}px`,
                  height: `${r().h * k()}px`,
                }}
              >
                <span style={{ bottom: `${2 + j() * 15}px` }}>{crop.label}</span>
              </div>
            )
          }}
        </For>
        <Show when={props.interactive}>
          <div data-slot="grab" onPointerDown={down} onWheel={wheel} />
        </Show>
      </div>
    )
  }

  function FramingPanel() {
    const fields = [
      ["cx", "Centre x", 5],
      ["cy", "Centre y", 5],
      ["s", "Scale", 0.02],
      ["rx", "Tilt rx°", 0.5],
      ["ry", "Tilt ry°", 0.5],
      ["rz", "Roll rz°", 0.1],
    ] as const
    const drift = () => edit()?.engine === "drift"
    return (
      <div data-slot="framing">
        <span data-slot="muted">
          Camera at the playhead ({edit()?.aspect}) ·{" "}
          {drift()
            ? "Mobile: pan and zoom set the shot's pin, tilt the start camera"
            : keyAtPlayhead() >= 0
              ? "on a key"
              : "between keys: an edit adds a key here"}
          {style() === "straight" ? " · straight style shows no tilt" : ""}
        </span>
        <div data-slot="row">
          <For each={fields}>
            {([prop, label, stepValue]) => (
              <label>
                {label}
                <NumberInput
                  value={round(playheadCam()?.[prop] ?? 0, prop === "s" ? 3 : 1)}
                  step={stepValue}
                  onCommit={(value) => {
                    setPlaying(false)
                    setPlayheadCam({ [prop]: value }, true)
                  }}
                />
              </label>
            )}
          </For>
          <button
            onClick={resetKey}
            title="Back to this key's values in the last render (a key added since then is removed)"
          >
            Reset camera
          </button>
        </div>
      </div>
    )
  }

  function Timeline() {
    const PX = 46
    const [dragging, setDragging] = createSignal<number>()
    const [drop, setDrop] = createSignal<number>()
    let rulerRef: HTMLDivElement | undefined
    const seek = (event: PointerEvent) => {
      if (!rulerRef) return
      const rect = rulerRef.getBoundingClientRect()
      setPlaying(false)
      setTime(Math.max(0, Math.min(total() - 1 / fps(), (event.clientX - rect.left) / PX)))
    }
    return (
      <div data-slot="track" style={{ width: `${total() * PX + 40}px` }}>
        <div
          data-slot="ruler"
          ref={rulerRef}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            seek(event)
          }}
          onPointerMove={(event) => event.buttons && seek(event)}
        >
          <For each={Array.from({ length: Math.ceil(total()) + 1 }, (_, i) => i)}>
            {(second) => (
              <span data-slot="tick" style={{ left: `${second * PX}px` }}>
                {second % 2 === 0 ? `${second}s` : ""}
              </span>
            )}
          </For>
        </div>
        <div data-slot="cards">
          <Index each={plan()?.list ?? []}>
            {(item, index) => {
              const current = () => item().shot
              const key = () => current().source ?? edit()?.source ?? ""
              const thumb = (srcT: number) => proxy(key(), engine()?.frameIndex(edit() as Edit, key(), srcT) ?? 0, 200)
              const transition = () => engine()?.transitionOf(edit() as Edit, style(), current())
              const warnings = () => checks().filter((check) => check.shot === index && check.level === "warn").length
              return (
                <div
                  data-slot="card"
                  data-selected={selected() === index ? "" : undefined}
                  data-drop={
                    drop() === index
                      ? "before"
                      : drop() === index + 1 && index === (plan()?.list.length ?? 0) - 1
                        ? "after"
                        : undefined
                  }
                  style={{ width: `${item().duration * PX - 4}px` }}
                  draggable={true}
                  onDragStart={(event) => {
                    setDragging(index)
                    event.dataTransfer?.setData("text/plain", String(index))
                  }}
                  onDragEnd={() => {
                    setDragging(undefined)
                    setDrop(undefined)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    setDrop(event.clientX < rect.left + rect.width / 2 ? index : index + 1)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const from = dragging()
                    const to = drop()
                    setDragging(undefined)
                    setDrop(undefined)
                    if (from !== undefined && to !== undefined) move(from, to)
                  }}
                  onClick={() => select(index)}
                >
                  <div data-slot="thumbs">
                    <img src={thumb(current().time[0][1])} alt="" draggable={false} />
                    <img src={thumb(current().time.at(-1)?.[1] ?? 0)} alt="" draggable={false} />
                  </div>
                  <div data-slot="label">
                    <b>{current().id}</b> {fixed(item().duration)} s · {fixed(speedOf(edit() as Edit, current()))}×
                    <Show when={warnings()}>
                      <span data-slot="warn-count">⚠ {warnings()}</span>
                    </Show>
                  </div>
                  <div data-slot="note">{current().note}</div>
                  <Show when={index < (plan()?.list.length ?? 0) - 1}>
                    <span data-slot="join" data-type={transition()?.type}>
                      {transition()?.type === "dissolve"
                        ? `dissolve ${(transition() as { frames: number }).frames}f`
                        : transition()?.type}
                    </span>
                  </Show>
                </div>
              )
            }}
          </Index>
        </div>
        <div data-slot="playhead" style={{ left: `${time() * PX}px` }} />
      </div>
    )
  }

  function Inspector() {
    const index = selected
    const current = () => shot() as Shot
    const e = () => edit() as Edit
    const key = () => current().source ?? e().source
    const source = () => e().sources[key()]
    const unitStep = () => (e().unit === "frames" ? 1 : 1 / (source().fps ?? 30))
    const sourceEnd = () => (e().unit === "frames" ? source().frames - 1 : (source().frames - 1) / (source().fps ?? 30))
    const [scrub, setScrub] = createSignal(0)
    createEffect(on([index, videoId], () => setScrub(current().time[0][1])))
    const inPoint = () => current().time[0][1]
    const outPoint = () => current().time.at(-1)?.[1] ?? 0
    const camAt = (local: number) => (camPlan() as NonNullable<ReturnType<typeof camPlan>>).cam(index(), local)
    const doTrim = (side: "in" | "out", value: number) => {
      if (!Number.isFinite(value)) return
      updateShot(index(), (item) => trim(item, side, value, camAt))
    }
    const strip = () => Array.from({ length: 10 }, (_, k) => inPoint() + ((outPoint() - inPoint()) * k) / 9)
    const transition = () => current().transition
    const setTransition = (value: Transition | undefined) =>
      updateShot(index(), (item) => {
        const next = { ...item }
        if (value) next.transition = value
        else delete next.transition
        return next
      })
    const shotChecks = () => checks().filter((item) => item.shot === index())
    return (
      <div data-slot="shot">
        <h3>
          Shot
          <input
            value={current().id}
            onChange={(event) => updateShot(index(), (item) => ({ ...item, id: event.currentTarget.value }))}
          />
          <span data-slot="muted">
            {fixed(durationOf(current()))} s at {fixed(speedOf(e(), current()))}×
          </span>
        </h3>
        <textarea
          rows={2}
          value={current().note ?? ""}
          onChange={(event) => updateShot(index(), (item) => ({ ...item, note: event.currentTarget.value }))}
        />

        <h4>Source and trim</h4>
        <div data-slot="scrub-view">
          <img src={proxy(key(), engine()?.frameIndex(e(), key(), scrub()) ?? 0, 640)} alt="" />
        </div>
        <div data-slot="scrubber">
          <div
            data-slot="range"
            style={{
              left: `${(Math.min(inPoint(), outPoint()) / sourceEnd()) * 100}%`,
              width: `${(Math.abs(outPoint() - inPoint()) / sourceEnd()) * 100}%`,
            }}
          />
          <input
            type="range"
            min={0}
            max={sourceEnd()}
            step={unitStep()}
            value={scrub()}
            onInput={(event) => setScrub(Number(event.currentTarget.value))}
          />
        </div>
        <div data-slot="row">
          <span>
            {e().unit === "frames" ? "frame" : "s"} {fixed(scrub(), e().unit === "frames" ? 0 : 2)}
          </span>
          <button onClick={() => doTrim("in", scrub())}>Set in here</button>
          <button onClick={() => doTrim("out", scrub())}>Set out here</button>
        </div>
        <div data-slot="filmstrip">
          <For each={strip()}>
            {(srcT) => (
              <img
                src={proxy(key(), engine()?.frameIndex(e(), key(), srcT) ?? 0, 120)}
                alt=""
                onClick={() => setScrub(srcT)}
                title={fixed(srcT)}
              />
            )}
          </For>
        </div>
        <div data-slot="grid">
          <label>
            In <NumberInput value={inPoint()} step={unitStep()} onCommit={(value) => doTrim("in", value)} />
          </label>
          <label>
            Out <NumberInput value={outPoint()} step={unitStep()} onCommit={(value) => doTrim("out", value)} />
          </label>
          <label>
            Speed ×{" "}
            <NumberInput
              value={Number(fixed(speedOf(e(), current())))}
              step={0.05}
              onCommit={(value) => value > 0 && updateShot(index(), (item) => setSpeed(e(), item, value))}
            />
          </label>
        </div>
        <details>
          <summary>Time map (output s → source {e().unit === "frames" ? "frame" : "s"})</summary>
          <Index each={current().time}>
            {(point, k) => (
              <div data-slot="row">
                <NumberInput
                  value={point()[0]}
                  step={0.05}
                  disabled={k === 0}
                  onCommit={(value) =>
                    updateShot(index(), (item) => ({
                      ...item,
                      time: item.time.map((p, j): [number, number] => (j === k ? [value, p[1]] : p)),
                    }))
                  }
                />
                →
                <NumberInput
                  value={point()[1]}
                  step={unitStep()}
                  onCommit={(value) =>
                    updateShot(index(), (item) => ({
                      ...item,
                      time: item.time.map((p, j): [number, number] => (j === k ? [p[0], value] : p)),
                    }))
                  }
                />
                <button
                  disabled={current().time.length <= 2}
                  onClick={() =>
                    updateShot(index(), (item) => ({ ...item, time: item.time.filter((_, j) => j !== k) }))
                  }
                >
                  −
                </button>
                <Show when={k < current().time.length - 1}>
                  <button
                    title="Add a point halfway to the next one"
                    onClick={() =>
                      updateShot(index(), (item) => {
                        const [a, b] = [item.time[k], item.time[k + 1]]
                        const mid: [number, number] = [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)]
                        return { ...item, time: [...item.time.slice(0, k + 1), mid, ...item.time.slice(k + 1)] }
                      })
                    }
                  >
                    +
                  </button>
                </Show>
              </div>
            )}
          </Index>
        </details>

        <h4>Join to the next shot</h4>
        <div data-slot="row">
          <select
            value={transition()?.type ?? "default"}
            onChange={(event) => {
              const value = event.currentTarget.value
              if (value === "default") return setTransition(undefined)
              if (value === "dissolve") return setTransition({ type: "dissolve", frames: 6 })
              setTransition({ type: value as "cut" | "glide" })
            }}
          >
            <option value="default">
              Style default (
              {engine()?.transitionOf({ ...e(), shots: [] }, style(), { ...current(), transition: undefined }).type})
            </option>
            <option value="cut">Cut</option>
            <option value="dissolve">Dissolve</option>
            <Show when={e().engine === "keys"}>
              <option value="glide">Glide (next shot starts on this camera)</option>
            </Show>
          </select>
          <Show when={transition()?.type === "dissolve"}>
            <NumberInput
              value={(transition() as { frames: number }).frames}
              step={1}
              onCommit={(value) => setTransition({ type: "dissolve", frames: Math.max(2, Math.round(value)) })}
            />{" "}
            frames
          </Show>
        </div>
        <div data-slot="row">
          <label>
            <input
              type="checkbox"
              checked={current().blur !== false}
              onChange={(event) =>
                updateShot(index(), (item) => ({ ...item, blur: event.currentTarget.checked ? undefined : false }))
              }
            />{" "}
            Motion blur
          </label>
        </div>

        <h4>Look (cinematic)</h4>
        <div data-slot="grid">
          <label>
            Lens px
            <NumberInput
              value={
                (e().engine === "drift" ? current().a?.persp : current().persp) ??
                (e().engine === "drift" ? 1500 : 2000)
              }
              step={50}
              onCommit={(value) =>
                updateShot(index(), (item) =>
                  item.a ? { ...item, a: { ...item.a, persp: value } } : { ...item, persp: value },
                )
              }
            />
          </label>
          <label>
            Focus from
            <NumberInput
              value={current().dof?.a ?? 0}
              step={0.02}
              onCommit={(value) =>
                updateShot(index(), (item) => ({
                  ...item,
                  dof: { a: value, b: item.dof?.b ?? 1, blur: item.dof?.blur ?? 4 },
                }))
              }
            />
          </label>
          <label>
            Focus to
            <NumberInput
              value={current().dof?.b ?? 1}
              step={0.02}
              onCommit={(value) =>
                updateShot(index(), (item) => ({
                  ...item,
                  dof: { a: item.dof?.a ?? 0, b: value, blur: item.dof?.blur ?? 4 },
                }))
              }
            />
          </label>
          <label>
            Blur px
            <NumberInput
              value={current().dof?.blur ?? 0}
              step={0.5}
              onCommit={(value) =>
                updateShot(index(), (item) => ({
                  ...item,
                  dof: { a: item.dof?.a ?? 0, b: item.dof?.b ?? 1, blur: value },
                }))
              }
            />
          </label>
        </div>

        <Camera />

        <Show when={shotChecks().length}>
          <h4>Checks</h4>
          <ul data-slot="checks">
            <For each={shotChecks()}>{(item) => <li data-level={item.level}>{item.text}</li>}</For>
          </ul>
        </Show>
      </div>
    )

    function Camera() {
      // Keys engine: one box per camera keyframe. Drift engine: the start framing (a) and the pin.
      const keys = () => current().keys ?? []
      const drift = () => e().engine === "drift"
      const slots = () =>
        drift() ? ["Start", ...(current().pin ? ["Pin"] : [])] : keys().map(([t]) => `${fixed(t)} s`)
      const slot = () => Math.min(selectedKey(), slots().length - 1)
      const srcTimeOf = (k: number) => {
        const p = camPlan()
        if (!p) return 0
        if (drift())
          return k === 1 && current().pin
            ? (current().pin?.t ?? 0) * (e().unit === "frames" ? (source().fps ?? 30) : 1)
            : p.srcTime(index(), 0)
        return p.srcTime(index(), keys()[k]?.[0] ?? 0)
      }
      const boxOf = (k: number): Box | undefined => {
        const en = engine()
        if (!en) return
        if (!drift()) {
          const cam = keys()[k]?.[1]
          return cam && en.camBox(e(), cam)
        }
        const a = current().a
        if (!a) return
        if (k === 0) return en.camBox(e(), a)
        const pin = current().pin
        return pin && en.camBox(e(), { cx: pin.cx, cy: pin.cy, w: pin.w ?? a.w })
      }
      const live = () => {
        const p = camPlan()
        const en = engine()
        if (!p || !en || shotAtPlayhead() !== index()) return
        const cam = p.cam(index(), time() - p.list[index()].start)
        return en.camBox(e(), { cx: cam.cx, cy: cam.cy, s: cam.s })
      }
      let viewRef: HTMLDivElement | undefined
      const k = () => (viewRef?.clientWidth ?? 400) / source().w
      const [, setTick] = createSignal(0)
      const setBox = (box: Box) => {
        const en = engine()
        if (!en) return
        updateShot(
          index(),
          (item) => {
            if (!drift())
              return {
                ...item,
                keys: (item.keys ?? []).map(([t, cam], j): [number, Cam] =>
                  j === slot() ? [t, roundCam(en.boxCam(e(), cam, box))] : [t, cam],
                ),
              }
            if (slot() === 0 && item.a) {
              const a = en.boxCam(e(), item.a, box)
              return { ...item, a: { ...a, cx: round(a.cx), cy: round(a.cy), w: round(a.w) } }
            }
            const pin = item.pin
            if (!pin || !item.a) return item
            const moved = en.boxCam(e(), { cx: pin.cx, cy: pin.cy, w: pin.w ?? item.a.w }, box)
            return { ...item, pin: { ...pin, cx: round(moved.cx), cy: round(moved.cy), w: round(moved.w) } }
          },
          false,
        )
      }
      const drag = (mode: "move" | "resize") => (event: PointerEvent) => {
        event.preventDefault()
        event.stopPropagation()
        const start = boxOf(slot())
        if (!start) return
        checkpoint()
        const x0 = event.clientX
        const y0 = event.clientY
        const target = event.currentTarget as HTMLElement
        target.setPointerCapture(event.pointerId)
        const moveHandler = (ev: PointerEvent) => {
          const dx = (ev.clientX - x0) / k()
          const dy = (ev.clientY - y0) / k()
          if (mode === "move") return setBox({ ...start, x: start.x + dx, y: start.y + dy })
          const w = Math.max(40, start.w + dx)
          const h = (w * start.h) / start.w
          setBox({ x: start.x + start.w / 2 - w / 2, y: start.y + start.h / 2 - h / 2, w, h })
        }
        const up = () => {
          target.removeEventListener("pointermove", moveHandler)
          target.removeEventListener("pointerup", up)
        }
        target.addEventListener("pointermove", moveHandler)
        target.addEventListener("pointerup", up)
      }
      const style = (box: Box | undefined) =>
        box
          ? { left: `${box.x * k()}px`, top: `${box.y * k()}px`, width: `${box.w * k()}px`, height: `${box.h * k()}px` }
          : { display: "none" }
      onMount(() => {
        const observer = new ResizeObserver(() => setTick((n) => n + 1))
        if (viewRef) observer.observe(viewRef)
        onCleanup(() => observer.disconnect())
      })
      const field = (label: string, prop: string, stepValue: number) => {
        const value = () => {
          if (!drift()) return (keys()[slot()]?.[1] as Record<string, number> | undefined)?.[prop] ?? 0
          if (slot() === 0) return (current().a as Record<string, number> | undefined)?.[prop] ?? 0
          return (current().pin as Record<string, number> | undefined)?.[prop] ?? current().a?.w ?? 0
        }
        return (
          <label>
            {label}
            <NumberInput
              value={value()}
              step={stepValue}
              onCommit={(next) =>
                updateShot(index(), (item) => {
                  if (!drift())
                    return {
                      ...item,
                      keys: (item.keys ?? []).map(([t, cam], j): [number, Cam] =>
                        j !== slot() ? [t, cam] : prop === "t" ? [next, cam] : [t, { ...cam, [prop]: next }],
                      ),
                    }
                  if (slot() === 0 && item.a) return { ...item, a: { ...item.a, [prop]: next } }
                  if (item.pin) return { ...item, pin: { ...item.pin, [prop]: next } }
                  return item
                })
              }
            />
          </label>
        )
      }
      const addKey = () => {
        const p = camPlan()
        if (!p || drift()) return
        const local = shotAtPlayhead() === index() ? time() - p.list[index()].start : durationOf(current()) / 2
        const at = round(local)
        updateShot(index(), (item) => ({
          ...item,
          keys: [...(item.keys ?? []), [at, camOf(p.cam(index(), local))] as [number, Cam]].toSorted(
            (a, b) => a[0] - b[0],
          ),
        }))
        setSelectedKey((current().keys ?? []).findIndex(([t]) => t === at))
      }
      const removeKey = () => {
        if (drift()) return updateShot(index(), (item) => ({ ...item, pin: undefined }))
        if (keys().length < 2) return
        updateShot(index(), (item) => ({ ...item, keys: (item.keys ?? []).filter((_, j) => j !== slot()) }))
        setSelectedKey(0)
      }
      const addPin = () => {
        const p = camPlan()
        const a = current().a
        if (!p || !a) return
        const local = shotAtPlayhead() === index() ? time() - p.list[index()].start : durationOf(current()) / 2
        const cam = p.cam(index(), local)
        const t = p.srcTime(index(), local) / (e().unit === "frames" ? (source().fps ?? 30) : 1)
        updateShot(index(), (item) => ({
          ...item,
          pin: { t: round(t), cx: round(cam.cx), cy: round(cam.cy), w: round(driftWidth(e(), cam.s)) },
        }))
        setSelectedKey(1)
      }
      return (
        <>
          <h4>Camera</h4>
          <div data-slot="chips">
            <For each={slots()}>
              {(label, j) => (
                <button data-selected={slot() === j() ? "" : undefined} onClick={() => setSelectedKey(j())}>
                  {label}
                </button>
              )}
            </For>
            <Show
              when={!drift()}
              fallback={
                <Show when={!current().pin}>
                  <button onClick={addPin}>+ Pin at playhead</button>
                </Show>
              }
            >
              <button onClick={addKey} title="Add a camera key at the playhead">
                + Key at playhead
              </button>
            </Show>
            <button onClick={removeKey} disabled={!drift() && keys().length < 2}>
              {drift() ? "Remove pin" : "Delete key"}
            </button>
          </div>
          <div data-slot="cam-view" ref={viewRef} style={{ "aspect-ratio": `${source().w} / ${source().h}` }}>
            <img
              src={proxy(key(), engine()?.frameIndex(e(), key(), srcTimeOf(slot())) ?? 0, 640)}
              alt=""
              draggable={false}
            />
            <For each={slots()}>
              {(_, j) => (
                <Show when={j() !== slot()}>
                  <div data-slot="box" data-kind="other" style={style(boxOf(j()))} />
                </Show>
              )}
            </For>
            <div data-slot="box" data-kind="live" style={style(live())} />
            <div data-slot="box" data-kind="selected" style={style(boxOf(slot()))} onPointerDown={drag("move")}>
              <span data-slot="handle" onPointerDown={drag("resize")} />
            </div>
          </div>
          <p data-slot="muted">
            Drag the box to move the framing, drag its corner to zoom. Dashed: the camera at the playhead.
          </p>
          <div data-slot="grid">
            <Show when={!drift()}>{field("Key t (s)", "t", 0.05)}</Show>
            <Show when={drift() && slot() === 1}>{field("Pin source s", "t", 0.05)}</Show>
            {field("Centre x", "cx", 5)}
            {field("Centre y", "cy", 5)}
            {drift() ? field("Width px", "w", 5) : field("Scale", "s", 0.02)}
            <Show when={!drift() || slot() === 0}>
              {field("Tilt rx°", "rx", 0.5)}
              {field("Tilt ry°", "ry", 0.5)}
              {field("Roll rz°", "rz", 0.1)}
            </Show>
          </div>
          <Show when={drift() && current().glides?.length}>
            <details>
              <summary>Glides (spring moves at a source time)</summary>
              <Index each={current().glides ?? []}>
                {(glide, j) => (
                  <div data-slot="row">
                    <For each={["t", "dx", "dy", "zoom", "w"] as const}>
                      {(prop) => (
                        <label>
                          {prop}
                          <NumberInput
                            value={glide()[prop] ?? (prop === "zoom" ? 1 : prop === "w" ? 3 : 0)}
                            step={prop === "zoom" ? 0.02 : prop === "t" ? 0.05 : 5}
                            onCommit={(next) =>
                              updateShot(index(), (item) => ({
                                ...item,
                                glides: (item.glides ?? []).map((g, n) => (n === j ? { ...g, [prop]: next } : g)),
                              }))
                            }
                          />
                        </label>
                      )}
                    </For>
                  </div>
                )}
              </Index>
            </details>
          </Show>
          <div data-slot="row">
            <button onClick={() => copyEndToNext(index())} disabled={index() >= e().shots.length - 1}>
              Copy end camera to next shot's start
            </button>
            <button onClick={() => index() > 0 && copyEndToNext(index() - 1)} disabled={index() === 0}>
              Start on previous shot's end
            </button>
          </div>
        </>
      )
    }
  }

  function Warnings() {
    const [showInfo, setShowInfo] = createSignal(false)
    const list = () => checks().filter((item) => showInfo() || item.level === "warn")
    return (
      <div data-slot="warnings">
        <h4>
          EDITING.md checks ({style()})
          <label>
            <input
              type="checkbox"
              checked={showInfo()}
              onChange={(event) => setShowInfo(event.currentTarget.checked)}
            />{" "}
            camera at every cut
          </label>
        </h4>
        <Show when={list().length} fallback={<p data-slot="muted">No warnings.</p>}>
          <ul data-slot="checks">
            <For each={list()}>
              {(item) => (
                <li data-level={item.level} onClick={() => item.shot >= 0 && select(item.shot)}>
                  {item.text}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    )
  }

  function RenderPanel() {
    const running = () => job()?.status === "running"
    const percent = () => {
      const progress = job()?.progress
      return progress ? Math.round((progress.frame / progress.count) * 100) : 0
    }
    return (
      <div data-slot="render">
        <h4>Render</h4>
        <div data-slot="row">
          <select value={renderStyle()} onChange={(event) => setRenderStyle(event.currentTarget.value)}>
            <Show when={styles().length > 1}>
              <option value="both">Both styles</option>
            </Show>
            <For each={styles()}>{(item) => <option value={item}>{item} only</option>}</For>
          </select>
          <label>
            <input type="checkbox" checked={hdr()} onChange={(event) => setHdr(event.currentTarget.checked)} /> HDR copy
          </label>
          <label title="Up to 4 motion-blur samples instead of 16: faster, slightly rougher fast moves">
            <input type="checkbox" checked={draft()} onChange={(event) => setDraft(event.currentTarget.checked)} />{" "}
            Draft
          </label>
        </div>
        <div data-slot="row">
          <button data-slot="primary" onClick={render} disabled={running()}>
            {running() ? "Rendering…" : "Render and publish"}
          </button>
          <Show when={running()}>
            <button onClick={cancel}>Cancel</button>
          </Show>
          <button onClick={restore} disabled={running()} title="Put back the files the last render replaced">
            Restore previous video
          </button>
        </div>
        <Show when={job()}>
          {(current) => (
            <>
              <div data-slot="progress">
                <div style={{ width: `${current().status === "done" ? 100 : percent()}%` }} />
              </div>
              <p data-slot="muted">
                {current().status}
                {current().progress
                  ? ` · ${current().progress?.style} frame ${current().progress?.frame}/${current().progress?.count}`
                  : ""}
              </p>
              <pre data-slot="log">{current().log.join("\n")}</pre>
            </>
          )}
        </Show>
        <h4>On the site now</h4>
        <For each={video()?.styles.filter((item) => renderStyle() === "both" || item.style === renderStyle())}>
          {(item) => (
            <figure data-slot="output">
              <figcaption>
                {item.set} · {(item.size / 1e6).toFixed(2)} MB ·{" "}
                {item.updated ? new Date(item.updated).toLocaleTimeString() : "missing"}
              </figcaption>
              <video src={item.video} poster={item.poster} controls loop muted playsinline preload="metadata" />
              <a href={item.poster} target="_blank">
                Poster
              </a>
            </figure>
          )}
        </For>
      </div>
    )
  }
}

function NumberInput(props: { value: number; step?: number; disabled?: boolean; onCommit: (value: number) => void }) {
  return (
    <input
      type="number"
      value={Number.isFinite(props.value) ? round(props.value, 4) : ""}
      step={props.step ?? 1}
      disabled={props.disabled}
      onChange={(event) => {
        const value = Number(event.currentTarget.value)
        if (Number.isFinite(value)) props.onCommit(value)
      }}
    />
  )
}

function round(value: number, digits = 2) {
  return Math.round(value * 10 ** digits) / 10 ** digits
}

function roundCam<T extends { cx: number; cy: number }>(cam: T): T {
  return Object.fromEntries(
    Object.entries(cam).map(([prop, value]) => [
      prop,
      typeof value === "number" ? round(value, prop === "s" ? 4 : 1) : value,
    ]),
  ) as T
}
