import { createEffect, on, onCleanup, onMount } from "solid-js"
import { fontContent, glyphs, type Letter } from "~/lib/font-content"
import { downloadFile, downloadFont, fontAsset } from "./download"
import { glyphMarkup } from "./glyph"
import { mapCharacter, mapVersion } from "./mapping"

const MAX_TYPE_SIZE = 161
const MIN_TYPE_SIZE = 49
const GIF_REVEAL_DELAY = 700

const initialLetters = [..."opencode"]
  .map(
    (letter, index) =>
      `<span class="glyph" data-index="${index}" data-letter="${letter}">${glyphMarkup(letter as Letter)}</span>`,
  )
  .join("")

type Motion = { rotation: number; lift: number; scale: number }
/** public/font/confetti.mjs, shared with the GIF worker. */
type Confetti = {
  CONFETTI_DURATION: number
  LETTER_PERSPECTIVE: number
  letterCelebrationAt: (index: number, elapsed: number) => Motion
  createConfetti: (seed: number) => unknown[]
  drawConfetti: (
    context: CanvasRenderingContext2D,
    particles: unknown[],
    elapsed: number,
    width: number,
    height: number,
  ) => void
}

/**
 * The font page's hero: type anything and it is set in the six letters. The text is a real
 * (hidden) textarea; the letters are drawn beside it. Exports the typing as a GIF or the current
 * map as an installable font. A perfect anagram of "opencode" sets off confetti.
 */
export function Typewriter() {
  let canvas!: HTMLDivElement
  let input!: HTMLTextAreaElement
  let output!: HTMLDivElement
  let overlay!: HTMLCanvasElement
  let gifControl!: HTMLDivElement
  let gifButton!: HTMLButtonElement
  let gifTooltip!: HTMLSpanElement
  let downloadButton!: HTMLButtonElement
  let exportStatus!: HTMLSpanElement
  let fontStatus!: HTMLSpanElement
  let anagramStatus!: HTMLSpanElement

  onMount(() => {
    let renderFrame = 0
    let composing = false
    let replaceDefaultOnType = true
    let hasEdited = false
    let gifRevealTimer: ReturnType<typeof setTimeout> | undefined
    let lastAnagram = ""
    let confettiSeed: number | undefined
    let confettiFrame = 0
    let celebration: { started: number } | undefined
    let inView = true
    let confetti: Confetti | undefined
    const loadConfetti = () => import(/* @vite-ignore */ fontAsset("confetti.mjs")) as Promise<Confetti>

    const isPerfectAnagram = (text: string) => {
      const letters = text.toLowerCase().replace(/\s/gu, "")
      return letters !== "opencode" && letters.length === 8 && [...letters].sort().join("") === "cdeenoop"
    }

    const keepCaretVisible = () => {
      if (document.activeElement !== input) return
      const caret = output.querySelector(".before-caret, .end-caret")
      if (!caret) return
      const rect = caret.getBoundingClientRect()
      const bounds = canvas.getBoundingClientRect()
      if (rect.bottom > bounds.bottom - 24 || rect.top < bounds.top + 24) caret.scrollIntoView({ block: "nearest" })
    }

    const clearCelebration = () => {
      celebration = undefined
      for (const svg of output.querySelectorAll<SVGElement>(".glyph svg")) svg.style.removeProperty("transform")
    }

    const animateLetters = (now: number) => {
      if (!celebration || !confetti) return
      const elapsed = now - celebration.started
      for (const [index, svg] of [...output.querySelectorAll<SVGElement>(".glyph[data-letter] svg")].entries()) {
        const motion = confetti.letterCelebrationAt(index, elapsed)
        const height = svg.parentElement!.getBoundingClientRect().height
        svg.style.transform = `translateY(${motion.lift * height}px) perspective(${height * confetti.LETTER_PERSPECTIVE}px) rotateX(${motion.rotation}rad) scale(${motion.scale})`
      }
    }

    const updateCelebration = async () => {
      const text = input.value.toLowerCase().replace(/\s/gu, "")
      if (!isPerfectAnagram(input.value)) {
        lastAnagram = ""
        clearCelebration()
        if (text === "opencode") {
          cancelAnimationFrame(confettiFrame)
          overlay.hidden = true
          anagramStatus.hidden = true
        }
        return
      }
      if (text === lastAnagram) return
      lastAnagram = text
      confetti ??= await loadConfetti()
      const module = confetti
      confettiSeed = crypto.getRandomValues(new Uint32Array(1))[0]
      const particles = module.createConfetti(confettiSeed)
      const context = overlay.getContext("2d")!
      const started = performance.now()
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches
      clearCelebration()
      if (!reducedMotion) celebration = { started }
      cancelAnimationFrame(confettiFrame)
      overlay.hidden = false
      anagramStatus.textContent = "ANAGRAM FOUND"
      anagramStatus.hidden = false

      const animate = (now: number) => {
        const elapsed = now - started
        if (elapsed >= (reducedMotion ? 1600 : module.CONFETTI_DURATION)) {
          overlay.hidden = true
          anagramStatus.hidden = true
          clearCelebration()
          return
        }
        const width = window.innerWidth
        const height = window.innerHeight
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
          overlay.width = Math.round(width * ratio)
          overlay.height = Math.round(height * ratio)
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, width, height)
        module.drawConfetti(context, particles, reducedMotion ? 900 : elapsed, width, height)
        animateLetters(now)
        confettiFrame = requestAnimationFrame(animate)
      }
      confettiFrame = requestAnimationFrame(animate)
    }

    const renderLetters = (
      target: HTMLElement,
      text: string,
      start = text.length,
      end = start,
      availableWidth = target.clientWidth,
    ) => {
      // Start with a viewport-sized wordmark, then shrink gradually to a readable minimum. Sizes
      // snap to multiples of seven pixels, so every module of the 4 × 7 grid is whole pixels.
      const startingSize = Math.min(MAX_TYPE_SIZE, ((availableWidth - 8) * 42) / 234)
      const characterCount = Math.max(8, [...text].length)
      const size = Math.max(MIN_TYPE_SIZE, Math.floor((startingSize * Math.sqrt(8 / characterCount)) / 7) * 7)
      target.style.setProperty("--glyph-size", `${size}px`)
      const fragment = document.createDocumentFragment()
      let offset = 0
      for (const character of text) {
        const glyph = document.createElement("span")
        glyph.className = "glyph"
        glyph.dataset.index = String(offset)
        if (offset >= start && offset < end) glyph.classList.add("selected")
        if (offset === start && start === end) glyph.classList.add("before-caret")
        if (character === "\n") {
          glyph.classList.add("break")
          fragment.append(glyph, document.createElement("br"))
        } else if (/\s/u.test(character)) {
          glyph.classList.add("space")
          fragment.append(glyph)
        } else {
          const letter = mapCharacter(character)
          glyph.dataset.letter = letter
          glyph.innerHTML = glyphMarkup(letter)
          fragment.append(glyph)
        }
        offset += character.length
      }
      if (start === text.length && start === end) {
        const caret = document.createElement("span")
        caret.className = "end-caret"
        fragment.append(caret)
      }
      target.replaceChildren(fragment)
    }

    const render = () => {
      renderLetters(output, input.value, input.selectionStart, input.selectionEnd)
      animateLetters(performance.now())
      output.classList.toggle("focused", document.activeElement === input)
    }

    const scheduleRender = () => {
      cancelAnimationFrame(renderFrame)
      renderFrame = requestAnimationFrame(render)
    }

    const focusEditor = (position = input.value.length) => {
      input.focus({ preventScroll: true })
      input.setSelectionRange(position, position)
      render()
    }

    const prepareDefaultEdit = (inputType: string) => {
      // The starting wordmark is real editable text. Starting a fresh message still replaces it,
      // while deletion and explicit cursor placement edit it normally.
      if (
        replaceDefaultOnType &&
        inputType.startsWith("insert") &&
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length
      ) {
        input.setSelectionRange(0, input.value.length)
      }
      replaceDefaultOnType = false
    }

    const scheduleGifReveal = () => {
      clearTimeout(gifRevealTimer)
      gifControl.inert = true
      gifControl.setAttribute("aria-hidden", "true")
      gifControl.classList.remove("is-visible")
      if (!hasEdited || composing || !input.value.trim()) return
      gifRevealTimer = setTimeout(() => {
        gifControl.inert = false
        gifControl.removeAttribute("aria-hidden")
        gifControl.classList.add("is-visible")
      }, GIF_REVEAL_DELAY)
    }

    const insertText = (text: string) => {
      prepareDefaultEdit("insertText")
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }

    canvas.addEventListener("click", (event) => {
      if ((event.target as Element).closest("button, a")) return
      replaceDefaultOnType = false
      const glyph = (event.target as Element).closest<HTMLElement>(".glyph")
      if (glyph && input.value) {
        const rect = glyph.getBoundingClientRect()
        const position = Number(glyph.dataset.index)
        const next = event.clientX > rect.left + rect.width / 2 ? [...input.value.slice(position)][0]?.length || 0 : 0
        focusEditor(position + next)
        return
      }
      focusEditor()
    })

    input.addEventListener("beforeinput", (event) => prepareDefaultEdit(event.inputType))
    input.addEventListener("input", () => {
      replaceDefaultOnType = false
      hasEdited = true
      scheduleGifReveal()
      if (!composing) void updateCelebration()
      scheduleRender()
      requestAnimationFrame(keepCaretVisible)
    })
    input.addEventListener("focus", scheduleRender)
    input.addEventListener("blur", scheduleRender)
    input.addEventListener("compositionstart", () => {
      composing = true
      scheduleGifReveal()
    })
    input.addEventListener("compositionend", () => {
      composing = false
      scheduleGifReveal()
      void updateCelebration()
      scheduleRender()
    })
    input.addEventListener("select", scheduleRender)
    const selectionChange = () => {
      if (document.activeElement === input) scheduleRender()
    }
    document.addEventListener("selectionchange", selectionChange)

    // Typing from the neutral page starts the editor without stealing focus from controls. Only
    // while the hero is on screen, and ahead of the site's number-key shortcuts.
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target === input && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        replaceDefaultOnType = false
      }
      if (event.metaKey || event.ctrlKey || event.altKey || composing || !inView) return
      const neutral = target === document.body || target === canvas || target.id === "content"
      if (!neutral || (event.key.length !== 1 && event.key !== "Enter")) return
      // Shift+S and Shift+D open Settings and Design mode (design-mode.tsx), which have no buttons.
      if (event.key === "S" || event.key === "D") return
      event.preventDefault()
      event.stopImmediatePropagation()
      focusEditor()
      // Insert explicitly: the key's original target was not the textarea.
      insertText(event.key === "Enter" ? "\n" : event.key)
    }
    window.addEventListener("keydown", keydown, true)

    const visibility = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting), { threshold: 0.4 })
    visibility.observe(canvas)

    let previousWidth = output.clientWidth
    const resize = new ResizeObserver(() => {
      if (Math.abs(output.clientWidth - previousWidth) <= 0.5) return
      previousWidth = output.clientWidth
      scheduleRender()
    })
    resize.observe(output)

    gifButton.addEventListener("click", async () => {
      gifButton.disabled = true
      gifButton.setAttribute("aria-busy", "true")
      gifTooltip.textContent = "creating GIF…"
      exportStatus.textContent = "Creating your typing animation."
      let worker: Worker | undefined
      const finish = (error: boolean) => {
        worker?.terminate()
        gifButton.disabled = false
        gifButton.removeAttribute("aria-busy")
        gifTooltip.textContent = error ? "export failed — try again" : "download gif"
        exportStatus.textContent = error ? "Could not create the GIF. Please try again." : "Your GIF has downloaded."
      }
      try {
        // Capture a snapshot; users can keep typing while the worker encodes it.
        const composition = await captureExportComposition()
        worker = new Worker(fontAsset("gif-worker.mjs"), { type: "module" })
        worker.onmessage = ({ data }) => {
          if (data.type === "progress") gifTooltip.textContent = `creating GIF… ${data.percent}%`
          if (data.type === "done") {
            downloadFile(new Blob([data.buffer], { type: "image/gif" }), "opentype.gif")
            finish(false)
          }
          if (data.type === "error") finish(true)
        }
        worker.onerror = () => finish(true)
        worker.postMessage(composition)
      } catch {
        finish(true)
      }
    })

    downloadButton.addEventListener("click", async () => {
      downloadButton.disabled = true
      downloadButton.setAttribute("aria-busy", "true")
      fontStatus.textContent = "Creating your installable font."
      try {
        fontStatus.textContent = await downloadFont()
      } finally {
        downloadButton.disabled = false
        downloadButton.removeAttribute("aria-busy")
      }
    })

    // The export reads real colours: the site's are light-dark() pairs, so read the computed ones.
    const colors = () => {
      const probe = output.querySelector<SVGPathElement>(".glyph svg path")
      const styles = getComputedStyle(canvas)
      const background = rgba(styles.backgroundColor)
      // The shade is translucent ink: flatten it onto the background, since a GIF has no alpha.
      const shade = rgba(probe ? getComputedStyle(probe).fill : styles.color)
      const flat = shade
        .slice(0, 3)
        .map((channel, index) => Math.round(channel * shade[3] + background[index] * (1 - shade[3])))
      return {
        background: `rgb(${background.slice(0, 3).join(", ")})`,
        ink: styles.color,
        shadow: `rgb(${flat.join(", ")})`,
      }
    }

    const captureExportComposition = async () => {
      // Flush pending input so the download always includes the latest text.
      render()
      const width = 1600
      const height = 900
      const theme = colors()
      const composition = {
        width,
        height,
        padding: 112,
        background: theme.background,
        ink: theme.ink,
        shadow: theme.shadow,
        caret: theme.ink,
        paths: glyphs,
        dark: false,
        confettiEnabled: hasEdited,
        confettiSeed: confettiSeed ?? crypto.getRandomValues(new Uint32Array(1))[0],
        frames: [] as { layout: Layout; delay: number; caret: boolean; anagram?: boolean }[],
        scale: 1,
      }
      const characters = [...input.value]
      const availableWidth = output.clientWidth
      const measurement = document.createElement("div")
      measurement.className = "letter-output export-measurement"
      measurement.style.width = `${availableWidth}px`
      measurement.setAttribute("aria-hidden", "true")
      canvas.append(measurement)

      type Layout = ReturnType<typeof measure>
      function measure(text: string) {
        // Use the editor's actual DOM renderer and CSS for every typing step. This keeps
        // centering, auto-sizing, spaces, and browser line wrapping identical.
        renderLetters(measurement, text, text.length, text.length, availableWidth)
        const bounds = measurement.getBoundingClientRect()
        const centerX = bounds.left + bounds.width / 2
        const centerY = bounds.top + bounds.height / 2
        let halfWidth = 0
        const items = [...measurement.querySelectorAll<HTMLElement>(".glyph")].map((element) => {
          const rect = element.getBoundingClientRect()
          halfWidth = Math.max(halfWidth, Math.abs(rect.left - centerX), Math.abs(rect.right - centerX))
          return {
            letter: element.dataset.letter || null,
            x: rect.left - centerX,
            y: rect.top - centerY,
            width: rect.width,
            height: rect.height,
          }
        })
        const caretRect = measurement.querySelector(".end-caret")!.getBoundingClientRect()
        const caret = {
          x: caretRect.left - centerX + 2,
          y: caretRect.top - centerY - caretRect.height * 0.05,
          height: caretRect.height * 1.1,
        }
        halfWidth = Math.max(halfWidth, Math.abs(caret.x), Math.abs(caret.x + 2))
        return {
          glyphs: items,
          caret,
          width: halfWidth * 2,
          height: Math.max(bounds.height, Math.abs(caret.y) * 2, Math.abs(caret.y + caret.height) * 2),
        }
      }

      try {
        composition.frames.push({ layout: measure("opencode"), delay: 900, caret: true })
        const typingFrames = Math.min(characters.length, 120)
        const counts = new Set(
          Array.from({ length: typingFrames }, (_, index) =>
            Math.ceil((characters.length * (index + 1)) / typingFrames),
          ),
        )
        // Don't skip the winning keystroke when a long composition batches letters.
        let letterCount = 0
        for (let index = 0; index < characters.length; index++) {
          if (!/\s/u.test(characters[index])) letterCount++
          if (letterCount === 8) {
            if (isPerfectAnagram(characters.slice(0, index + 1).join(""))) counts.add(index + 1)
            break
          }
        }
        let finalLayout: Layout | undefined
        let frame = 0
        for (const count of [...counts].sort((a, b) => a - b)) {
          const text = characters.slice(0, count).join("")
          finalLayout = measure(text)
          composition.frames.push({ layout: finalLayout, delay: 90, caret: true, anagram: isPerfectAnagram(text) })
          if (++frame % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
        }
        finalLayout ??= measure("")
        composition.frames.push(
          { layout: finalLayout, delay: 300, caret: false },
          { layout: finalLayout, delay: 300, caret: true },
          { layout: finalLayout, delay: 1500, caret: false },
        )
        // One horizontal zoom preserves the natural growth between keystrokes and enlarges short
        // compositions without resizing each prefix to fill the GIF.
        const widest = Math.max(...composition.frames.map((item) => item.layout.width))
        composition.scale = (width - composition.padding * 2) / widest
        return composition
      } finally {
        measurement.remove()
      }
    }

    // No focus on load: the hidden textarea would capture dictation and other system input. A
    // click or tap on the hero, or typing while it is in view, starts the editor.
    render()

    // A shuffled map redraws the letters typed so far.
    createEffect(on(mapVersion, scheduleRender, { defer: true }))

    onCleanup(() => {
      cancelAnimationFrame(renderFrame)
      cancelAnimationFrame(confettiFrame)
      clearTimeout(gifRevealTimer)
      document.removeEventListener("selectionchange", selectionChange)
      window.removeEventListener("keydown", keydown, true)
      visibility.disconnect()
      resize.disconnect()
    })
  })

  return (
    <section data-component="font-hero" aria-label="Logo typewriter">
      <h1 data-slot="sr-only">{fontContent.title}</h1>
      {/* The live page's layout: a canvas that fills the screen and scrolls on its own, with the
          claim centred in the top bar and the downloads on its right. */}
      <div ref={canvas} data-slot="canvas" tabIndex={-1}>
        <label data-slot="sr-only" for="font-typing-input">
          Type anything to create OpenCode logo letters
        </label>
        <textarea
          ref={input}
          id="font-typing-input"
          data-slot="typing-input"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
        >
          opencode
        </textarea>
        {/* The server renders the starting wordmark, so the hero is never empty before hydration. */}
        <div ref={output} class="letter-output" aria-hidden="true" innerHTML={initialLetters} />
      </div>
      <div data-slot="top-bar">
        <p data-slot="top-copy">
          A TYPEFACE WITH{" "}
          <span data-slot="count">
            {fontContent.combinations.base}
            <sup>{fontContent.combinations.exponent}</sup>
          </span>{" "}
          POSSIBLE COMBINATIONS
        </p>
        <div data-slot="tools" role="group" aria-label="Canvas controls">
          <div ref={gifControl} class="gif-control" aria-hidden="true" inert>
            <button
              ref={gifButton}
              type="button"
              data-component="site-button"
              data-variant="neutral"
              aria-label="Download GIF"
              aria-describedby="font-export-tooltip"
            >
              <span>GIF</span>
              <span ref={gifTooltip} id="font-export-tooltip" data-slot="tooltip" role="tooltip">
                download gif
              </span>
            </button>
          </div>
          <button ref={downloadButton} type="button" data-component="site-button" aria-label="Download font">
            {fontContent.download}
            <DownloadIcon />
          </button>
        </div>
      </div>
      <canvas ref={overlay} data-slot="confetti" aria-hidden="true" hidden />
      <span ref={exportStatus} data-slot="sr-only" role="status" />
      <span ref={fontStatus} data-slot="sr-only" role="status" />
      <span ref={anagramStatus} data-slot="anagram-status" role="status" hidden />
    </section>
  )
}

/** A computed colour as [r, g, b, a] with channels 0–255: rgb(), rgba() and color(srgb …) forms. */
function rgba(color: string) {
  const numbers = (color.match(/[\d.]+/g) ?? []).map(Number)
  if (color.startsWith("color(")) {
    const [r = 0, g = 0, b = 0, a = 1] = numbers
    return [r * 255, g * 255, b * 255, a]
  }
  const [r = 0, g = 0, b = 0, a = 1] = numbers
  return [r, g, b, a]
}

/** The site's download arrow, as on the brand page's download buttons. */
function DownloadIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
      />
    </svg>
  )
}
