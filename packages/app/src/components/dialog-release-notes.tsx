import { createSignal, createEffect, onMount, onCleanup } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { markReleaseNotesSeen } from "@/lib/release-notes"

const CHANGELOG_URL = "https://opencode.ai/changelog.json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text.length > 0 ? text : undefined
  }

  if (!Array.isArray(value)) return
  const parts = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)
  if (parts.length === 0) return
  return parts.join(" ")
}

function normalizeRemoteUrl(url: string): string {
  if (url.startsWith("https://") || url.startsWith("http://")) return url
  if (url.startsWith("/")) return `https://opencode.ai${url}`
  return `https://opencode.ai/${url}`
}

function parseMedia(value: unknown): ReleaseFeature["media"] | undefined {
  if (!isRecord(value)) return

  const type = getText(value.type)?.toLowerCase()
  const src = getText(value.src)
  if (!src) return
  if (type !== "image" && type !== "video") return

  return {
    type,
    src: normalizeRemoteUrl(src),
    alt: getText(value.alt),
  }
}

function parseFeature(value: unknown): ReleaseFeature | undefined {
  if (!isRecord(value)) return

  const title = getText(value.title) ?? getText(value.name) ?? getText(value.heading)
  const description = getText(value.description) ?? getText(value.body) ?? getText(value.text)

  if (!title) return
  if (!description) return

  const tag = getText(value.tag) ?? getText(value.label) ?? "New"

  const media = (() => {
    const parsed = parseMedia(value.media)
    if (parsed) return parsed

    const alt = getText(value.alt)
    const image = getText(value.image)
    if (image) return { type: "image" as const, src: normalizeRemoteUrl(image), alt }

    const video = getText(value.video)
    if (video) return { type: "video" as const, src: normalizeRemoteUrl(video), alt }
  })()

  return { title, description, tag, media }
}

function parseChangelog(value: unknown): ReleaseNote | undefined {
  const releases = (() => {
    if (Array.isArray(value)) return value
    if (!isRecord(value)) return
    if (Array.isArray(value.releases)) return value.releases
    if (Array.isArray(value.versions)) return value.versions
    if (Array.isArray(value.changelog)) return value.changelog
  })()

  if (!releases) {
    if (!isRecord(value)) return
    if (!Array.isArray(value.highlights)) return
    const features = value.highlights.map(parseFeature).filter((item): item is ReleaseFeature => item !== undefined)
    if (features.length === 0) return
    return { version: CURRENT_RELEASE.version, features: features.slice(0, 3) }
  }

  const version = (() => {
    const head = releases[0]
    if (!isRecord(head)) return
    return getText(head.version) ?? getText(head.tag_name) ?? getText(head.tag) ?? getText(head.name)
  })()

  const features = releases
    .flatMap((item) => {
      if (!isRecord(item)) return []
      const highlights = item.highlights
      if (!Array.isArray(highlights)) return []
      return highlights.map(parseFeature).filter((feature): feature is ReleaseFeature => feature !== undefined)
    })
    .slice(0, 3)

  if (features.length === 0) return
  return { version: version ?? CURRENT_RELEASE.version, features }
}

export interface ReleaseFeature {
  title: string
  description: string
  tag?: string
  media?: {
    type: "image" | "video"
    src: string
    alt?: string
  }
}

export interface ReleaseNote {
  version: string
  features: ReleaseFeature[]
}

// Current release notes - update this with each release
export const CURRENT_RELEASE: ReleaseNote = {
  version: "1.0.0",
  features: [
    {
      title: "Cleaner tab experience",
      description: "Chat is now fixed to the side of your tabs, and review is now available as a dedicated tab. ",
      tag: "New",
      media: {
        type: "video",
        src: "/release/release-example.mp4",
        alt: "Cleaner tab experience",
      },
    },
    {
      title: "Share with control",
      description: "Keep your sessions private by default, or publish them to the web with a shareable URL.",
      tag: "New",
      media: {
        type: "image",
        src: "/release/release-share.png",
        alt: "Share with control",
      },
    },
    {
      title: "Improved attachment management",
      description: "Upload and manage attachments more easily, to help build and maintain context.",
      tag: "New",
      media: {
        type: "video",
        src: "/release/release-example.mp4",
        alt: "Improved attachment management",
      },
    },
  ],
}

export function DialogReleaseNotes(props: { release?: ReleaseNote }) {
  const dialog = useDialog()
  const [note, setNote] = createSignal(props.release ?? CURRENT_RELEASE)
  const [index, setIndex] = createSignal(0)

  const feature = () => note().features[index()] ?? note().features[0] ?? CURRENT_RELEASE.features[0]!
  const total = () => note().features.length
  const isFirst = () => index() === 0
  const isLast = () => index() === total() - 1

  function handleNext() {
    if (!isLast()) setIndex(index() + 1)
  }

  function handleBack() {
    if (!isFirst()) setIndex(index() - 1)
  }

  function handleClose() {
    markReleaseNotesSeen()
    dialog.close()
  }

  let focusTrap: HTMLDivElement | undefined

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowLeft" && !isFirst()) {
      e.preventDefault()
      setIndex(index() - 1)
    }
    if (e.key === "ArrowRight" && !isLast()) {
      e.preventDefault()
      setIndex(index() + 1)
    }
  }

  onMount(() => {
    focusTrap?.focus()
    document.addEventListener("keydown", handleKeyDown)
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown))

    const controller = new AbortController()
    fetch(CHANGELOG_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : undefined))
      .then((json) => {
        if (!json) return
        const parsed = parseChangelog(json)
        if (!parsed) return
        setNote({
          version: parsed.version,
          features: parsed.features,
        })
        setIndex(0)
      })
      .catch(() => undefined)

    onCleanup(() => controller.abort())
  })

  // Refocus the trap when index changes to ensure escape always works
  createEffect(() => {
    index() // track index
    focusTrap?.focus()
  })

  return (
    <Dialog class="dialog-release-notes">
      {/* Hidden element to capture initial focus and handle escape */}
      <div ref={focusTrap} tabindex="0" class="absolute opacity-0 pointer-events-none" />
      {/* Left side - Text content */}
      <div class="flex flex-col flex-1 min-w-0 p-8">
        {/* Top section - feature content (fixed position from top) */}
        <div class="flex flex-col gap-2 pt-22">
          <div class="flex items-center gap-2">
            <h1 class="text-16-medium text-text-strong">{feature().title}</h1>
            {feature().tag && (
              <span
                class="text-12-medium text-text-weak px-1.5 py-0.5 bg-surface-base rounded-sm border border-border-weak-base"
                style={{ "border-width": "0.5px" }}
              >
                {feature().tag}
              </span>
            )}
          </div>
          <p class="text-14-regular text-text-base">{feature().description}</p>
        </div>

        {/* Spacer to push buttons to bottom */}
        <div class="flex-1" />

        {/* Bottom section - buttons and indicators (fixed position) */}
        <div class="flex flex-col gap-12">
          <div class="flex items-center gap-3">
            {isLast() ? (
              <Button variant="primary" size="large" onClick={handleClose}>
                Get started
              </Button>
            ) : (
              <Button variant="secondary" size="large" onClick={handleNext}>
                Next
              </Button>
            )}
          </div>

          {total() > 1 && (
            <div class="flex items-center gap-1.5 -my-2.5">
              {note().features.map((_, i) => (
                <button
                  type="button"
                  class="h-6 flex items-center cursor-pointer bg-transparent border-none p-0 transition-all duration-200"
                  classList={{
                    "w-8": i === index(),
                    "w-3": i !== index(),
                  }}
                  onClick={() => setIndex(i)}
                >
                  <div
                    class="w-full h-0.5 rounded-[1px] transition-colors duration-200"
                    classList={{
                      "bg-icon-strong-base": i === index(),
                      "bg-icon-weak-base": i !== index(),
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right side - Media content (edge to edge) */}
      {feature().media && (
        <div class="flex-1 min-w-0 bg-surface-base overflow-hidden rounded-r-xl">
          {feature().media!.type === "image" ? (
            <img
              src={feature().media!.src}
              alt={feature().media!.alt ?? "Release preview"}
              class="w-full h-full object-cover"
            />
          ) : (
            <video src={feature().media!.src} autoplay loop muted playsinline class="w-full h-full object-cover" />
          )}
        </div>
      )}
    </Dialog>
  )
}
