import "./open-source-proof.css"
import { createEffect, createSignal, createUniqueId, For, on, onMount, Show } from "solid-js"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { rich } from "~/i18n/rich"
import type { Contributor, RepoStats } from "~/lib/github"
import { ExternalArrow, NewTab } from "./icons"
import { forkUrl } from "./open-source-fork"
import { createWash, revealMotion, washStep } from "./reveal"
import { siteSettings } from "./settings"

const repo = config.github.repoUrl
const links = {
  license: `${repo}/blob/HEAD/LICENSE`,
  contributing: `${repo}/blob/HEAD/CONTRIBUTING.md`,
  contributors: `${repo}/graphs/contributors`,
  anomaly: "https://anoma.ly",
}

/**
 * Open source proof (Settings › Open source proof): a wall of contributor avatars, the licence and
 * the GitHub actions. "stats" sits under the open source stats, which already show the stars and
 * contributors; "section" is the body of a section of its own, led by the licence line and the
 * star count. Numbers GitHub didn't return fall back to the site config.
 */
export function OpenSourceProof(props: {
  stats?: RepoStats
  layout: "stats" | "section"
  pending?: boolean
  // "stats": when the open source numbers start, so the avatars' wash never starts before them.
  start?: number
}) {
  const i18n = useI18n()
  const format = (value: number) => new Intl.NumberFormat("en-US").format(value)
  const stars = () => (props.stats?.stars ? format(props.stats.stars) : config.github.starsFormatted.full)
  const contributors = () => (props.stats?.contributors ? format(props.stats.contributors) : config.stats.contributors)
  const compactStars = () =>
    props.stats?.stars
      ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(props.stats.stars)
      : config.github.starsFormatted.compact

  const licence = (
    <p data-slot={props.layout === "section" ? "lead" : "licence"}>
      <For each={rich(i18n.t("home.openSource.licence", { count: contributors() }), links)}>
        {(part) =>
          typeof part === "string" ? (
            part
          ) : "code" in part ? (
            part.code
          ) : (
            <a href={part.href} target="_blank" rel="noopener">
              {part.text}
              <NewTab />
            </a>
          )
        }
      </For>
    </p>
  )

  return (
    <div data-component="oss-proof" data-layout={props.layout}>
      <Show when={props.layout === "section"}>
        {licence}
        <p data-slot="stars">
          <span data-slot="value">{stars()}</span>
          <span data-slot="label">{i18n.t("home.growth.githubStars")}</span>
        </p>
      </Show>
      {/* While the numbers stream in, an empty wall keeps its place. */}
      <Show when={props.pending || props.stats?.people?.length}>
        <AvatarWall
          people={props.stats?.people ?? []}
          after={props.layout === "stats" ? () => props.start : undefined}
        />
      </Show>
      <Show when={props.layout === "stats"}>{licence}</Show>
      <div data-slot="actions">
        <a href={repo} target="_blank" rel="noopener" data-component="site-button">
          <svg data-slot="star" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 .75l2.2 4.6 5.05.65-3.7 3.5.95 5L8 12.05 3.5 14.5l.95-5-3.7-3.5 5.05-.65z" />
          </svg>
          {i18n.t("home.openSource.star")}
          <span data-slot="count" aria-hidden="true">
            {compactStars()}
          </span>
          <span data-slot="sr-only">{i18n.t("home.openSource.starCount", { count: stars() })}</span>
          <NewTab />
        </a>
        {/* Shown only in Settings › Open source variant "fork" (open-source-fork.css). */}
        <a
          href={forkUrl}
          target="_blank"
          rel="noopener"
          data-component="site-button"
          data-variant="neutral"
          data-slot="fork-button"
        >
          {i18n.t("home.fork.button")}
          <ExternalArrow />
          <NewTab />
        </a>
        <a href={links.contributing} target="_blank" rel="noopener" data-component="site-button" data-variant="neutral">
          {i18n.t("home.openSource.contribute")}
          <ExternalArrow />
          <NewTab />
        </a>
      </div>
    </div>
  )
}

/**
 * Two rows of greyscale avatars that reveal in a diagonal wash from the top left, one at a time,
 * when the wall first scrolls into view, with the logo row's reveal styles (reveal.ts; Settings ›
 * Avatar animation and Avatar stagger). An avatar still loading when its turn comes reveals once it
 * has decoded, so no empty box animates in. Until the page's code runs, and with reduced motion,
 * every avatar simply shows. With Avatar links on, each avatar links to the contributor's commits,
 * pull requests or profile and shows in colour on hover and focus; off, the wall is one decorative
 * image.
 */
function AvatarWall(props: { people: Contributor[]; after?: () => number | undefined }) {
  const i18n = useI18n()
  const id = createUniqueId()
  let wall: HTMLUListElement | undefined
  // The shared entrance wash (reveal.ts); its columns are the wall's auto-fill tracks.
  const wash = createWash(() => wall, undefined, props.after)
  const animation = () =>
    siteSettings.avatarAnimation === "same as logos" ? siteSettings.logoAnimation : siteSettings.avatarAnimation
  const link = () => (siteSettings.avatarLink === "off" ? undefined : siteSettings.avatarLink)
  // Only the two rows on show, so no link hides in the clipped overflow. The server renders every
  // avatar and the wall clips the rest until the columns are measured.
  const people = () => {
    const count = wash.columns()
    return count ? props.people.slice(0, count * 2) : props.people
  }

  // A new style or stagger (Design mode) plays the wash again.
  createEffect(on([animation, () => siteSettings.avatarStagger], wash.replay, { defer: true }))

  return (
    <>
      <Show when={link()}>
        <h3 id={id} data-slot="sr-only">
          {i18n.t("home.openSource.contributors")}
        </h3>
      </Show>
      <ul
        data-slot="people"
        translate="no"
        ref={wall}
        role={link() ? "list" : "img"}
        aria-labelledby={link() ? id : undefined}
        aria-label={link() ? undefined : i18n.t("home.openSource.avatars")}
        data-design="avatarLink avatarAnimation avatarStagger"
        data-links={link() ? "" : undefined}
        data-entrance
        data-mounted={wash.mounted() ? "" : undefined}
        data-reveal={wash.armed() ? "" : undefined}
        data-armed={wash.armed() ? "" : undefined}
        data-animation={wash.armed() ? animation() : undefined}
        style={wash.armed() ? revealMotion(animation(), siteSettings.logoTuning) : undefined}
      >
        <For each={people()}>
          {(person, index) => {
            return (
              <li>
                <Avatar
                  person={person}
                  link={link()}
                  at={
                    wash.start() === undefined
                      ? undefined
                      : wash.start()! +
                        washStep(index(), wash.columns() ?? 1, people().length) * siteSettings.avatarStagger
                  }
                />
              </li>
            )
          }}
        </For>
      </ul>
    </>
  )
}

// Settings › Avatar links: where an avatar goes, and the link's accessible name.
const avatarLinks = {
  commits: (login: string) => ({
    href: `${repo}/commits?author=${encodeURIComponent(login)}`,
    label: "home.openSource.avatarCommits" as const,
  }),
  "pull requests": (login: string) => ({
    href: `${repo}/pulls?q=${encodeURIComponent(`is:pr is:merged author:${login}`)}`,
    label: "home.openSource.avatarPulls" as const,
  }),
  profile: (login: string) => ({
    href: `https://github.com/${encodeURIComponent(login)}`,
    label: "home.openSource.avatarProfile" as const,
  }),
}

// One avatar: revealed at `at` (a performance.now() time), or as soon as it has decoded after that.
function Avatar(props: { person: Contributor; link?: keyof typeof avatarLinks; at?: number }) {
  const i18n = useI18n()
  const [ready, setReady] = createSignal(false)
  const [delay, setDelay] = createSignal<number>()
  let image: HTMLImageElement | undefined

  onMount(() => {
    if (!image) return
    const decoded = () =>
      image?.decode().then(
        () => setReady(true),
        () => {},
      )
    if (image.complete && image.naturalWidth > 0) return void decoded()
    image.addEventListener("load", decoded, { once: true })
  })

  // The delay is fixed when both are true, so a late image starts at once rather than mid-wash.
  createEffect(() => {
    const at = props.at
    if (at === undefined) return setDelay(undefined)
    if (!ready()) return
    setDelay(Math.max(0, at - performance.now()))
  })

  const brand = (
    <span
      data-slot="brand"
      data-state={delay() === undefined ? undefined : "in"}
      style={
        delay() === undefined
          ? undefined
          : { "--logo-delay": `${Math.round(delay()!)}ms`, "--wipe-delay": `${Math.round(delay()!)}ms` }
      }
    >
      <img
        ref={image}
        data-slot="mark"
        src={avatar(props.person.avatar)}
        alt=""
        width="32"
        height="32"
        loading="lazy"
        decoding="async"
      />
    </span>
  )

  return (
    <Show when={props.link && avatarLinks[props.link](props.person.login)} fallback={brand}>
      {(target) => (
        <a
          href={target().href}
          target="_blank"
          rel="noopener"
          title={props.person.login}
          aria-label={i18n.t("site.newTab", { label: i18n.t(target().label, { login: props.person.login }) })}
        >
          {brand}
        </a>
      )}
    </Show>
  )
}

// GitHub's avatar at twice the 32px it shows at. A local photo (contributor-faces.ts) is already that size.
function avatar(src: string) {
  if (src.startsWith("/")) return src
  const url = new URL(src)
  url.searchParams.set("s", "64")
  return url.toString()
}
