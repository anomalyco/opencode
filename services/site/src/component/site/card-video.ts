/**
 * What a card video does (CardVideo in products.tsx draws it, in the app and on the static pages):
 * it rests on its first frame and plays on hover or focus, so the still turns into motion without a
 * jump. On leave it either plays back to the start quickly ("hover · reverse") or the still fades
 * back over it ("hover · fade"). "autoplay" plays all the time. Reduced motion keeps the still.
 *
 * With a resting loop, the card shows the loop's first frame until the page has loaded, then plays
 * the loop while the card is on screen, crossfades to the video on hover and back on leave. Touch
 * screens have no hover: once most of the card is on screen it rests for 2s, then plays the video
 * (the sizzle reel) by itself. Reduced motion and Save-Data keep the first frame.
 *
 * No framework code: `view` shows the state, as signals in the app and attributes on the static
 * pages. `media` is the card's media box, holding the video, and the loop or the still. Returns its stop.
 */
export function cardVideo(
  media: HTMLElement,
  options: {
    /** Settings › Card video and Card hover, and the resting loop's speed (Card loop speed). */
    mode: string
    hover: string
    loopSpeed: number
    /** The video is the product demo: hovering stops the loop and cuts or crossfades to it. */
    demo?: boolean
    /** The video starts on the loop's framing, so the swap is a short crossfade. */
    matchesLoop?: boolean
    /** A still of its own, not the video's first frame, so it always fades back over the video. */
    still?: boolean
    /** A phone or tablet platform (no hover), as well as touch screens. */
    mobile: boolean
  },
  view: {
    /** Shows or hides the still (or the resting loop) over the video. */
    still: (shown: boolean) => void
    /** Starts buffering the video: its metadata ahead of a touch card's sizzle, or all of it. */
    preload: (level: "metadata" | "auto") => void
    /** On touch screens: the video plays by itself as the sizzle reel. */
    sizzle: () => void
    /** The resting loop, or the still, has its first frame. */
    loaded: () => void
  },
) {
  const video = media.querySelector<HTMLVideoElement>("video:not([data-slot])")
  const idle = media.querySelector<HTMLVideoElement>('video[data-slot="still"]')
  const image = media.querySelector<HTMLImageElement>('img[data-slot="still"]:not([data-poster])')
  const card = media.closest<HTMLElement>('[data-component="product-card"]')
  const loop = !!idle
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches
  // Reduced motion and Save-Data keep a card on its still: no resting loop and no sizzle.
  const cover = () =>
    reduced() || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
  // Settings › Card hover: "match" keeps the short swap for hover videos that start on the loop's
  // framing; "fade" (default) crossfades from the loop to the video's start over 150ms; "cut" swaps instantly.
  const matching = !!options.matchesLoop && options.hover === "match"
  // Phones and tablets play the sizzle by visibility instead of hover.
  const sizzle = matchMedia("(hover: none), (pointer: coarse)").matches || options.mobile
  const fade = () => {
    if (sizzle) return 400
    if (options.demo) return options.hover === "cut" ? 0 : 320
    if (matching) return 120
    if (loop && options.hover === "cut") return 0
    if (loop && options.hover === "fade") return 150
    return 300
  }
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let visible = false
  // The loop plays only once the page has loaded, so it never competes with the stills: it starts
  // from the frame the still shows.
  let ready = false

  // The resting loop's speed. A new source resets playbackRate to defaultPlaybackRate, so both are
  // set, again on load. The hover videos are cut to hold each shot for its length, so they play at 1×.
  const speed = () => {
    if (!loop) return
    for (const [element, rate] of [
      [video, 1],
      [idle, options.loopSpeed],
    ] as const) {
      if (!element) continue
      element.defaultPlaybackRate = rate
      element.playbackRate = rate
    }
  }
  const rest = () => {
    if (!idle) return
    if (ready && visible && !active && options.mode !== "autoplay" && !cover()) return void idle.play().catch(() => {})
    idle.pause()
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
  }
  // Marks the card as active (hovered, focused or in view on touch) so CSS can bring back colour.
  const mark = (on: boolean) => media.toggleAttribute("data-active", on)

  const enter = () => {
    mark(true)
    if (!video || options.mode === "autoplay" || reduced()) return
    active = true
    stop()
    // Hide the still once the video is actually playing, so a slow load never flashes black.
    void video
      .play()
      .then(() => {
        if (!active) return
        const show = () => {
          if (!active) return
          // The demo is a different animation: the loop stops on the frame it was showing.
          if (options.demo) idle?.pause()
          view.still(false)
          // Pause the idle loop once the video has faded in over it.
          setTimeout(rest, fade())
        }
        // Fade only once the first frame is on screen, so the crossfade never shows black.
        if (matching || !("requestVideoFrameCallback" in video)) return show()
        video.requestVideoFrameCallback(show)
      })
      .catch(() => {})
  }

  const leave = () => {
    mark(false)
    if (!video || options.mode === "autoplay" || !active) return
    active = false
    stop()
    video.pause()
    // A separate still is not the first frame, so it always fades back over the video. With "cut" or
    // "fade" the resting loop comes straight back instead of the video rewinding into it.
    if (options.mode === "hover · fade" || options.still || (loop && options.hover !== "match")) {
      view.still(true)
      rest()
      timer = setTimeout(() => (video.currentTime = 0), fade())
      return
    }
    // Seek backwards to the first frame with an ease-out, faster than it played: at most 0.8s.
    const from = video.currentTime
    const duration = Math.min(800, Math.max(250, from * 250))
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      if (!video.seeking) video.currentTime = from * (1 - (1 - (1 - progress) ** 3))
      if (progress < 1) {
        frame = requestAnimationFrame(step)
        return
      }
      video.currentTime = 0
      view.still(true)
    }
    frame = requestAnimationFrame(step)
  }

  if (options.mode === "autoplay" && !reduced()) {
    view.still(false)
    void video?.play().catch(() => {})
  }
  // The loop's or the still's first frame, also when it loaded before this ran.
  const first = idle ?? image
  if (idle && idle.readyState >= 2) view.loaded()
  if (image?.complete && image.naturalWidth > 0) view.loaded()
  first?.addEventListener(idle ? "loadeddata" : "load", view.loaded)
  speed()
  video?.addEventListener("loadedmetadata", speed)
  idle?.addEventListener("loadedmetadata", speed)

  // A hover video downloads only once the card itself is pointed at or focused (preload="none" until
  // then; the still shows meanwhile and the video fades in once a frame of it is decoded). Not on
  // phones, where the sizzle loads by itself when its card is in view, nor with reduced motion.
  const want = () => !sizzle && !reduced() && view.preload("auto")
  // A tap also fires pointerenter and pointerleave; touch plays by visibility instead (below).
  const pointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    want()
    enter()
  }
  const focus = () => {
    want()
    enter()
  }
  // While the card's menu is open (data-menu-open, ProductAction) the card stays as hovered: the
  // pointer moving from the media into the menu doesn't end it; closing the menu does, unless the
  // pointer is back on the media.
  const pointerLeave = (event: PointerEvent) =>
    event.pointerType !== "touch" && !card?.hasAttribute("data-menu-open") && leave()
  const menuClose = () => {
    if (!media.matches(":hover") && document.activeElement !== media) leave()
  }
  card?.addEventListener("menuclose", menuClose)
  media.addEventListener("pointerenter", pointerEnter)
  media.addEventListener("pointerleave", pointerLeave)
  media.addEventListener("focus", focus)
  media.addEventListener("blur", leave)

  // On touch, once most of the card is on screen (scrolling the page or swiping the carousel), it
  // rests on its cover for 2s, then crossfades into the sizzle reel once a frame of it is decoded.
  // Leaving pauses the sizzle where it is and coming back resumes it, unless the card was away for
  // over 30s: then it starts again from the cover.
  if (sizzle) view.sizzle()
  let wait: ReturnType<typeof setTimeout> | undefined
  let away = 0
  // Back to the cover with the sizzle rewound, without a fade (the card is off screen).
  const reset = () => {
    active = false
    view.still(true)
    if (video) video.currentTime = 0
    rest()
  }
  const inView = () => {
    mark(true)
    if (!video || options.mode === "autoplay" || cover()) return
    // The sizzle (megabytes) buffers once the page has loaded, so on a slow phone it doesn't share
    // the connection with the card stills and scripts; the 2s wait below hides the difference.
    afterLoad(() => view.preload("auto"))
    if (active && performance.now() - away < 30_000) return void video.play().catch(() => {})
    if (active) reset()
    clearTimeout(wait)
    wait = setTimeout(enter, 2000)
  }
  const outOfView = () => {
    mark(false)
    clearTimeout(wait)
    away = performance.now()
    video?.pause()
  }
  const watch = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      rest()
      if (!sizzle) return
      if (entry.intersectionRatio >= 0.6) inView()
      if (entry.intersectionRatio < 0.6) outOfView()
    },
    { threshold: [0, 0.6, 1] },
  )
  watch.observe(media)
  // On phones the sizzle's metadata loads a screen ahead of the card scrolling into view.
  const ahead = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && sizzle && !cover()) view.preload("metadata")
    },
    { rootMargin: "100% 50%" },
  )
  ahead.observe(media)
  const start = () => {
    ready = true
    rest()
  }
  afterLoad(start)

  return () => {
    window.removeEventListener("load", start)
    watch.disconnect()
    ahead.disconnect()
    clearTimeout(wait)
    stop()
    first?.removeEventListener(idle ? "loadeddata" : "load", view.loaded)
    video?.removeEventListener("loadedmetadata", speed)
    idle?.removeEventListener("loadedmetadata", speed)
    media.removeEventListener("pointerenter", pointerEnter)
    media.removeEventListener("pointerleave", pointerLeave)
    card?.removeEventListener("menuclose", menuClose)
    media.removeEventListener("focus", focus)
    media.removeEventListener("blur", leave)
  }
}

/** Runs `run` once the page's load event has fired (now, if it already has). */
export function afterLoad(run: () => void) {
  if (document.readyState === "complete") return run()
  window.addEventListener("load", run, { once: true })
}
