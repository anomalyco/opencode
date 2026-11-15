import "./section.css"
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"
import { designCopy } from "~/component/site/design-copy"
import { siteSettings } from "~/component/site/settings"
import { videoSources } from "~/component/site/media"
import { mediaUrl } from "~/lib/media"

// The published cut. Files are versioned so a new cut never plays from a cached old one.
const FILM = {
  wide: "/font/film/opencode-font-film-v3-1080p.mp4",
  tall: "/font/film/opencode-font-film-v3-4x5.mp4",
  captions: "/font/film/opencode-font-film-v3.en.vtt",
}

/**
 * Plate 00 of the specimen: the film. Nothing loads until the reader presses play, it
 * never plays by itself, and the narration has captions.
 */
export function FilmPlate() {
  const [started, setStarted] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)
  const [inView, setInView] = createSignal(true)
  let video!: HTMLVideoElement

  // While the film plays and is on screen, the page's floating theme picker steps aside (see
  // section.css); it comes back on pause, at the end, or once the film scrolls away.
  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(video)
    onCleanup(() => observer.disconnect())
  })
  createEffect(() => {
    const site = video.closest<HTMLElement>("[data-site]")
    if (!site) return
    if (playing() && inView()) site.dataset.filmPlaying = ""
    else delete site.dataset.filmPlaying
    onCleanup(() => delete site.dataset.filmPlaying)
  })

  return (
    <section id="film" data-plate="film" data-tone="ink" aria-labelledby="film-title">
      <header data-slot="plate-head">
        <span data-anno>Pl. 00</span>
        <h2 id="film-title" data-anno>
          The film
        </h2>
        <span data-anno data-slot="plate-aside">
          Narrated · Captions
        </span>
      </header>
      <p data-slot="plate-lead" data-design-copy="font.film.lead">
        {designCopy("font.film.lead", "A short film on the greatest six letters ever drawn.")}
      </p>
      <figure
        data-slot="film-screen"
        data-poster={siteSettings.filmPoster}
        data-design="filmPoster"
        data-started={started() ? "" : undefined}
      >
        <video
          ref={video}
          poster={siteSettings.filmPoster === "light" ? "/font/film/poster.jpg" : "/font/film/poster-inverted.jpg"}
          preload="none"
          controls={started()}
          playsinline
          width="1920"
          height="1080"
          aria-label="A film about the OpenCode font."
          onPlay={() => {
            setStarted(true)
            setPlaying(true)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        >
          {/* AV1, then HEVC (media.tsx), then the original H.264 file. */}
          <For each={videoSources(FILM.wide)}>{(source) => <source src={source.src} type={source.type} />}</For>
          <track kind="captions" src={FILM.captions} srclang="en" label="English" />
        </video>
        <button type="button" data-slot="film-play" onClick={() => video.play()} aria-label="Play the film">
          <span data-slot="film-play-square">
            {/* A triangle 0.8 as wide as it is tall; its centroid sits right of centre so it looks centred. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.8 5v14l11.2-7z" />
            </svg>
          </span>
        </button>
        <figcaption data-anno>
          <a href={mediaUrl(FILM.tall)} download="opencode-font-film-4x5.mp4">
            4:5 cut
          </a>
        </figcaption>
      </figure>
    </section>
  )
}
