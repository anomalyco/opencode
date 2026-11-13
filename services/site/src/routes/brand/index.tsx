import { Marked } from "~/component/site/marked"
import { onCloseMenus } from "~/component/site/menu-open"
import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { useLanguage } from "~/context/language"
import { englishText, localize } from "~/i18n/content"
import { brandSource } from "~/i18n/content/areas/brand"
import { Site } from "~/component/site/site"
import { useI18n } from "~/context/i18n"
import {
  badgeFile,
  badgeHtml,
  badgeMarkdown,
  badgeZip,
  brandContent,
  brandMarkdown,
  colorFormats,
  type BadgeFont,
} from "~/lib/brand-content"
import { useMarkdown, useMarkdownSource } from "~/component/site/use-markdown"
import { siteSettings } from "~/component/site/settings"
import { ContentsMenu, OnThisPage, SectionHeading, slug } from "~/component/site/on-this-page"
import { PageTitle } from "~/component/site/sticky-title"
import { AgentRulesButton } from "~/component/site/agent-rules-button"
import { inlineKey } from "~/lib/direction"
import { placeMenu } from "~/component/site/place-menu"
import { fitDrawings, snapLogos, startDrawings } from "~/component/site/brand-drawings"
import { checkPath, copyPath } from "~/component/site/icon-paths"

export default function Brand() {
  const i18n = useI18n()
  const language = useLanguage()
  const [copied, setCopied] = createSignal<string>()
  const content = createMemo(() => localize(language.locale(), "brand", brandContent(i18n.t)))
  // Heading ids stay English in every locale, so links to /brand#naming keep working.
  const english = createMemo(() => englishText(content(), brandSource))
  const anchor = (text: string) => slug(english().get(text) ?? text)
  const lower = (text: string) => (language.locale() === "en" ? text.toLowerCase() : text)
  // A tone ("light", "dark") in the page's language, lower case in English as in a sentence.
  const tone = (value: string) => lower(themeName(value))
  const themeName = (value: string) => i18n.t(value === "dark" ? "site.theme.dark" : "site.theme.light")
  const markdown = useMarkdown("/brand", brandMarkdown)
  const rules = useMarkdownSource("/brand", brandMarkdown)

  // The sections in page order, for the "Contents" list.
  const sections = createMemo(() =>
    [
      content().naming.title,
      ...content().families.map((family) => family.title),
      content().variants.title,
      content().colors.title,
      content().usage.title,
      content().donts.title,
      content().integrations.title,
      content().trademarks.title,
    ].map((title) => ({ id: anchor(title), title })),
  )

  // Translated labels change length: refit the drawings around them once the new text has rendered.
  createEffect(on(language.locale, () => requestAnimationFrame(() => (fitDrawings(), snapLogos())), { defer: true }))

  onMount(() => {
    onCleanup(startDrawings())
    // The animated stroke diagram plays once, when it first comes into view.
    const play = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry) => {
            ;(entry.target as HTMLElement).dataset.play = ""
            play.unobserve(entry.target)
          })
      },
      { threshold: 0.6 },
    )
    document.querySelectorAll('[data-component="stroke-diagram"]').forEach((element) => play.observe(element))
    onCleanup(() => play.disconnect())
  })

  /** Copies text, or the text a URL serves, and marks `key` as copied for a moment. */
  const copy = (key: string, value: string | { url: string }) => {
    // A promised ClipboardItem keeps the click's user activation while the file loads (Safari needs it).
    void (typeof value === "string"
      ? navigator.clipboard.writeText(value)
      : navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": fetch(value.url)
              .then((response) => response.text())
              .then((text) => new Blob([text], { type: "text/plain" })),
          }),
        ]))
    setCopied(key)
    setTimeout(() => setCopied((current) => (current === key ? undefined : current)), 1500)
  }

  /** A section or sub-section heading: a plain title that copies its section's address when clicked. */
  const Heading = (props: { level: 2 | 3; id: string; children: string; label?: boolean }) => (
    <SectionHeading level={props.level} id={props.id} title={props.children} label={props.label} />
  )

  /** A square icon button next to Download: the copy icon turns into a check. */
  // `detail` names the asset ("the logo (light)"); `of` reads "Copy SVG of the logo", else "… for the logo".
  // `url`, the file it copies, is for the static page's script (src/client/islands/brand.ts).
  const CopyButton = (props: {
    label: string
    detail: string
    of?: boolean
    url?: string
    done: boolean
    onClick: () => void
  }) => (
    <button
      type="button"
      data-component="site-button"
      data-variant="neutral"
      data-slot="copy-square"
      data-url={props.url}
      data-tip={props.label}
      data-tip-align="center"
      aria-label={i18n.t(props.of ? "brand.ui.actionOf" : "brand.ui.actionFor", {
        label: props.label,
        detail: props.detail,
      })}
      onClick={() => props.onClick()}
    >
      {props.done ? <CheckIcon /> : <CopyIcon />}
    </button>
  )

  /**
   * An asset's downloads and Copy SVG, in the style from Settings › Brand asset actions. Every asset
   * (logos, wordmarks, avatars, the badge) gets the same treatment; avatars have two PNG sizes and no
   * SVG. Copying shows a check and is announced.
   */
  const Actions = (props: { actions: AssetAction[]; detail: string }) => {
    const copyKey = (action: AssetAction) => `copy:${action.href}`
    const run = (action: AssetAction) => copy(copyKey(action), { url: action.href })
    const done = (action: AssetAction) => action.copy && copied() === copyKey(action)
    const live = () => (props.actions.some(done) ? i18n.t("site.action.copied") : "")
    const style = () => siteSettings.brandAssetActions
    // Plain strings for the label and tooltip: reading a JSX prop twice would build it twice and break
    // hydration.
    const Item = (item: { action: AssetAction; class?: string; icon?: JSX.Element; label?: string; tip?: string }) =>
      item.action.copy ? (
        <button
          type="button"
          data-component={item.class}
          data-variant={item.class ? "neutral" : undefined}
          data-tip={item.tip}
          data-tip-align={item.tip ? "center" : undefined}
          aria-label={i18n.t("brand.ui.actionFor", { label: item.action.label, detail: props.detail })}
          onClick={() => run(item.action)}
        >
          {item.label}
          {done(item.action) ? <CheckIcon /> : item.icon}
        </button>
      ) : (
        <a
          href={item.action.href}
          download={item.action.download}
          data-component={item.class}
          data-variant={item.class ? "neutral" : undefined}
          data-tip={item.tip}
          data-tip-align={item.tip ? "center" : undefined}
          aria-label={i18n.t("brand.ui.downloadItem", { label: item.action.label, detail: props.detail })}
        >
          {item.label}
          {item.icon}
        </a>
      )
    // In development every style is in the markup and CSS shows the chosen one (data-style), so the
    // server's default and the saved setting hydrate the same nodes; production has only the default.
    const copyAction = props.actions.find((action) => action.copy)
    return (
      <div data-slot="actions" data-style={style()} data-design="brandAssetActions">
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "menu copy"}>
          <div data-variant="menu copy">
            <AssetMenu
              actions={props.actions.filter((action) => !action.copy)}
              detail={props.detail}
              done={done}
              run={run}
            />
            {copyAction ? (
              <CopyButton
                label={copyAction.label}
                detail={props.detail}
                of
                url={copyAction.href}
                done={done(copyAction) ?? false}
                onClick={() => run(copyAction)}
              />
            ) : null}
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "menu"}>
          <div data-variant="menu">
            <AssetMenu actions={props.actions} detail={props.detail} done={done} run={run} />
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "split"}>
          <div data-variant="split">
            <Item
              action={props.actions[0]}
              class="site-button"
              label={i18n.t("download.action.download")}
              tip={i18n.t("brand.ui.downloadLabel", { label: props.actions[0].label })}
            />
            <AssetMenu actions={props.actions.slice(1)} detail={props.detail} done={done} run={run} chevronOnly />
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "icons"}>
          <div data-variant="icons">
            <For each={props.actions}>
              {(action) => (
                <Item
                  action={action}
                  class="site-button"
                  icon={action.copy ? <CopyIcon /> : action.label.includes("SVG") ? <VectorIcon /> : <ImageIcon />}
                  tip={action.copy ? action.label : i18n.t("brand.ui.downloadLabel", { label: action.label })}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "text links"}>
          <div data-variant="text links">
            <span data-slot="links">
              <For each={props.actions}>
                {(action, index) => (
                  <>
                    {index() > 0 ? <span aria-hidden="true"> · </span> : null}
                    <Item action={action} label={done(action) ? i18n.t("site.action.copied") : action.label} />
                  </>
                )}
              </For>
            </span>
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "svg copy"}>
          <div data-variant="svg copy">
            <For each={props.actions.filter((action) => !action.copy)}>
              {(action) => (
                <Item
                  action={action}
                  class="site-button"
                  label={action.label}
                  icon={<DownloadIcon />}
                  tip={i18n.t("brand.ui.downloadLabel", { label: action.label })}
                />
              )}
            </For>
            {copyAction ? (
              <CopyButton
                label={copyAction.label}
                detail={props.detail}
                url={copyAction.href}
                done={done(copyAction) ?? false}
                onClick={() => run(copyAction)}
              />
            ) : null}
          </div>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.brandAssetActions === "hover reveal"}>
          <div data-variant="hover reveal">
            <For each={props.actions}>
              {(action) => (
                <Item
                  action={action}
                  class="site-button"
                  label={action.label}
                  icon={action.copy ? <CopyIcon /> : <DownloadIcon />}
                />
              )}
            </For>
          </div>
        </Show>
        <span data-slot="sr-only" aria-live="polite">
          {live()}
        </span>
      </div>
    )
  }

  /** "Download" (or a chevron next to the split button's main part) opening a grey menu of the actions. */
  const AssetMenu = (props: {
    actions: AssetAction[]
    detail: string
    done: (action: AssetAction) => boolean | undefined
    run: (action: AssetAction) => void
    chevronOnly?: boolean
  }) => {
    const [open, setOpen] = createSignal(false)
    onCloseMenus(() => setOpen(false))
    const state: { root?: HTMLDivElement } = {}
    const items = () => [...(state.root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const close = (focus?: boolean) => {
      setOpen(false)
      if (focus) state.root?.querySelector<HTMLElement>("[aria-haspopup]")?.focus()
    }
    createEffect(() => {
      if (!open()) return
      requestAnimationFrame(() => items()[0]?.focus())
      const outside = (event: MouseEvent) => {
        if (!state.root?.contains(event.target as Node)) close()
      }
      const keys = (event: KeyboardEvent) => {
        if (event.key === "Escape") return close(true)
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        const list = items()
        const index = list.indexOf(document.activeElement as HTMLElement)
        list[(index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus()
      }
      document.addEventListener("click", outside)
      document.addEventListener("keydown", keys)
      onCleanup(() => {
        document.removeEventListener("click", outside)
        document.removeEventListener("keydown", keys)
      })
    })
    return (
      <div data-slot="asset-menu" ref={(element) => (state.root = element)}>
        <button
          type="button"
          data-component="site-button"
          data-variant="neutral"
          data-slot={props.chevronOnly ? "chevron-button" : undefined}
          aria-haspopup="menu"
          aria-expanded={open() ? "true" : "false"}
          aria-label={
            props.chevronOnly
              ? i18n.t("brand.ui.moreFormats", { detail: props.detail })
              : i18n.t("brand.ui.downloadAsset", { detail: props.detail })
          }
          onClick={() => {
            setOpen(!open())
            const menu = state.root?.querySelector<HTMLElement>('[data-slot="menu"]')
            if (menu) placeMenu(menu)
          }}
        >
          <Show when={!props.chevronOnly}>{i18n.t("download.action.download")}</Show>
          <ChevronIcon />
        </button>
        <Show when={open()}>
          <div data-slot="menu" role="menu">
            <For each={props.actions}>
              {(action, index) => (
                <>
                  <Show when={action.group !== undefined && action.group !== props.actions[index() - 1]?.group}>
                    <span data-slot="menu-group" role="presentation">
                      {action.group}
                    </span>
                  </Show>
                  {action.copy ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        props.run(action)
                        setTimeout(() => close(true), 700)
                      }}
                    >
                      <span data-slot="item-label">
                        {props.done(action) ? i18n.t("site.action.copied") : action.label}
                      </span>
                      {props.done(action) ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  ) : (
                    <a role="menuitem" href={action.href} download={action.download} onClick={() => close(true)}>
                      <span data-slot="item-label">{action.label}</span>
                      <DownloadIcon />
                    </a>
                  )}
                </>
              )}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  type BadgeGroup = { label: string; title: string; alt: string; body: string }
  const badgeFonts: BadgeFont[] = import.meta.env.DEV ? ["sans", "mono", "mono caps"] : [siteSettings.badgeFont]

  // The badge size shown in every preview and used by every Markdown copy; Shields stays at 20px.
  const [badgeSize, setBadgeSize] = createSignal(20)
  const badgeSizes = [20, 32, 44]
  // The style the "tabs" layout shows, shared by Works with and Built with like the size.
  const [badgeStyle, setBadgeStyle] = createSignal("a")
  // Loads every badge file a change will show before making it, so the crossfade never shows a blank
  // tile while a file downloads.
  const preloadBadges = (size: number, styleIds: string[]) => {
    const badges = content().integrations.badges
    return Promise.all(
      badges.groups.flatMap((group) =>
        badges.styles
          .filter((style) => styleIds.includes(style.id))
          .flatMap((style) =>
            (["light", "dark"] as const).map((theme) => {
              const image = new Image()
              image.src = badgeFile(
                group.label,
                style.id,
                theme,
                style.sizes.includes(size) ? size : style.sizes[0],
                "svg",
                siteSettings.badgeFont,
              )
              return image.decode().catch(() => undefined)
            }),
          ),
      ),
    )
  }
  const chooseBadgeSize = async (size: number) => {
    await preloadBadges(
      size,
      content().integrations.badges.styles.map((style) => style.id),
    )
    setBadgeSize(size)
  }
  const chooseBadgeStyle = async (id: string) => {
    await preloadBadges(badgeSize(), [id])
    setBadgeStyle(id)
  }
  /**
   * A badge preview that eases between sizes and styles: the new file starts at the old size (transform only)
   * and fading in, then settles at full size, where it is the crisp file on whole pixels. Reduced
   * motion swaps instantly.
   */
  const BadgePreview = (props: { src: string; size: number; alt: string }) => {
    const state: { image?: HTMLImageElement } = {}
    createEffect(
      on(
        () => [props.src, props.size] as const,
        (next, previous) => {
          if (!state.image || previous === undefined || previous[0] === next[0]) return
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
          state.image.animate(
            [
              { transform: `scale(${previous[1] / next[1]})`, opacity: 0.4 },
              { transform: "scale(1)", opacity: 1 },
            ],
            { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
          )
        },
      ),
    )
    // Lazy, so the hidden fonts and layouts never download.
    return (
      <img
        ref={(element) => (state.image = element)}
        src={props.src}
        height={props.size}
        alt={props.alt}
        loading="lazy"
      />
    )
  }

  /**
   * The sizes in a preview's top-left corner: plain text buttons, the chosen one in the strong colour.
   * One tab stop per group (the chosen size); the arrow keys move between sizes and choose them.
   */
  const SizeSwitcher = () => (
    <div data-slot="sizes" role="group" aria-label={i18n.t("brand.ui.badgeSize")}>
      <For each={badgeSizes}>
        {(size) => (
          <button
            type="button"
            aria-pressed={badgeSize() === size ? "true" : "false"}
            tabIndex={badgeSize() === size ? 0 : -1}
            onClick={() => void chooseBadgeSize(size)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              event.preventDefault()
              const next =
                badgeSizes[
                  (badgeSizes.indexOf(size) + (inlineKey(event) === "ArrowRight" ? 1 : -1) + badgeSizes.length) %
                    badgeSizes.length
                ]
              void chooseBadgeSize(next)
              const buttons = event.currentTarget.parentElement?.querySelectorAll("button")
              buttons?.[badgeSizes.indexOf(next)]?.focus()
            }}
          >
            {size}px
          </button>
        )}
      </For>
    </div>
  )

  type BadgeStyle = { id: string; name: string; sizes: number[] }

  /** One badge card: the preview with its size switcher, then the caption, Download (ZIP) and copy. */
  const BadgeCard = (props: { group: BadgeGroup; style: BadgeStyle; theme: "light" | "dark"; font: BadgeFont }) => {
    const size = () => (props.style.sizes.includes(badgeSize()) ? badgeSize() : props.style.sizes[0])
    const theme = () => lower(i18n.t(props.theme === "light" ? "site.theme.light" : "site.theme.dark"))
    // The card's files and labels with {{id}}, {{style}} (its name) and {{size}} left in: filled in here,
    // and in the markup for the static page's script to fill in as they change (src/client/islands/brand.ts).
    const templates = () => {
      const detail = i18n.t("brand.ui.badgeName", {
        style: "{{style}}",
        group: lower(props.group.title),
        theme: theme(),
      })
      const asset = i18n.t("brand.ui.badgeAsset", { name: detail, size: "{{size}}" })
      return {
        src: badgeFile(props.group.label, "{{id}}", props.theme, "{{size}}", "svg", props.font),
        zip: badgeZip(props.group.label, "{{id}}", props.font, props.theme),
        markdown: badgeMarkdown(props.group.label, props.group.alt, "{{id}}", "{{size}}", props.font, props.theme),
        alt: `${props.group.alt}, {{style}}, ${theme()}, {{size}}px`,
        zipLabel: i18n.t("brand.ui.downloadSizes", { detail }),
        asset,
        copyLabel: i18n.t("brand.ui.actionFor", { label: i18n.t("brand.ui.copyMarkdown"), detail: asset }),
      }
    }
    const fill = (template: string) =>
      template
        .replaceAll("{{id}}", props.style.id)
        .replaceAll("{{style}}", props.style.name.toLowerCase())
        .replaceAll("{{size}}", String(size()))
    const zip = () => fill(templates().zip)
    const markdown = () => `markdown:${props.group.label}-${props.style.id}-${props.theme}-${props.font}`
    return (
      <li
        data-src={templates().src}
        data-zip={templates().zip}
        data-copy-text={templates().markdown}
        data-alt={templates().alt}
        data-zip-label={templates().zipLabel}
        data-copy-label={templates().copyLabel}
      >
        <div data-slot="preview" data-tone={props.theme} data-badge={props.style.id}>
          <Show when={props.style.sizes.length > 1}>
            <SizeSwitcher />
          </Show>
          <BadgePreview src={fill(templates().src)} size={size()} alt={fill(templates().alt)} />
        </div>
        <div data-slot="meta">
          <span data-slot="name">
            {props.theme === "light" ? i18n.t("site.theme.light") : i18n.t("site.theme.dark")}
          </span>
          <div data-slot="badge-actions">
            <a
              href={zip()}
              download={zip().split("/").pop()}
              data-component="site-button"
              data-variant="neutral"
              aria-label={fill(templates().zipLabel)}
            >
              {i18n.t("download.action.download")}
              <DownloadIcon />
            </a>
            <CopyButton
              label={i18n.t("brand.ui.copyMarkdown")}
              detail={fill(templates().asset)}
              done={copied() === markdown()}
              onClick={() => copy(markdown(), fill(templates().markdown))}
            />
            <span data-slot="sr-only" aria-live="polite">
              {copied() === markdown() ? i18n.t("site.action.copied") : ""}
            </span>
          </div>
        </div>
      </li>
    )
  }

  /**
   * The style tabs: quiet text like the size switcher, a tablist with one tab stop (the chosen style)
   * and the arrow keys to move and choose.
   */
  const StyleTabs = (props: { panel: string }) => {
    const styles = () => content().integrations.badges.styles
    const state: { list?: HTMLDivElement; indicator?: HTMLSpanElement } = {}
    // The "underline" style's line: under the chosen tab's text, moved there on every change, and when
    // the tabs first show or resize (a hidden layout or font measures nothing).
    const place = () => {
      const tab = state.list?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!tab || !state.indicator) return
      state.indicator.style.width = `${tab.offsetWidth}px`
      state.indicator.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop + tab.offsetHeight - 2}px)`
    }
    createEffect(on(badgeStyle, () => requestAnimationFrame(place)))
    onMount(() => {
      const observer = new ResizeObserver(place)
      if (state.list) observer.observe(state.list)
      onCleanup(() => observer.disconnect())
    })
    return (
      <div
        data-slot="style-tabs"
        role="tablist"
        aria-label={i18n.t("brand.ui.badgeStyle")}
        ref={(element) => (state.list = element)}
      >
        <For each={styles()}>
          {(style, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={badgeStyle() === style.id ? "true" : "false"}
              aria-controls={props.panel}
              tabIndex={badgeStyle() === style.id ? 0 : -1}
              data-id={style.id}
              data-sizes={style.sizes.join(" ")}
              onClick={() => void chooseBadgeStyle(style.id)}
              onKeyDown={(event) => {
                const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
                const key = inlineKey(event)
                if (!(key in keys)) return
                event.preventDefault()
                const next = (index() + keys[key] + styles().length) % styles().length
                void chooseBadgeStyle(styles()[next].id)
                event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus()
              }}
            >
              {style.name}
            </button>
          )}
        </For>
        <span data-slot="tab-indicator" aria-hidden="true" ref={(element) => (state.indicator = element)} />
      </div>
    )
  }

  /**
   * The badges in the layout from Settings › Badge layout: "tabs" (default), quiet style tabs over one
   * Light and Dark pair; or "rows", a row per style with its pair, as the logo and wordmark sections.
   * In development every font and both layouts are in the markup and CSS shows the chosen ones, so the
   * server and the saved settings hydrate the same nodes; production has only the defaults.
   */
  const Badges = (props: { group: BadgeGroup }) => (
    <div
      data-component="badges"
      data-style={siteSettings.badgeFont}
      data-layout={siteSettings.badgeLayout}
      data-tab-style={siteSettings.badgeTabStyle}
    >
      <For each={badgeFonts}>
        {(font) => (
          <div data-variant={font}>
            <Show when={import.meta.env.DEV || siteSettings.badgeLayout === "tabs"}>
              <div data-slot="tabs-layout">
                <StyleTabs panel={`badges-${props.group.label}-${font.replace(" ", "-")}`} />
                <div
                  role="tabpanel"
                  id={`badges-${props.group.label}-${font.replace(" ", "-")}`}
                  aria-label={i18n.t("brand.ui.badge", { title: props.group.title })}
                >
                  <ul data-slot="badge-grid">
                    <For each={["light", "dark"] as const}>
                      {(theme) => {
                        const style = () =>
                          content().integrations.badges.styles.find((item) => item.id === badgeStyle()) ??
                          content().integrations.badges.styles[0]
                        return <BadgeCard group={props.group} style={style()} theme={theme} font={font} />
                      }}
                    </For>
                  </ul>
                </div>
              </div>
            </Show>
            <Show when={import.meta.env.DEV || siteSettings.badgeLayout === "rows"}>
              <div data-slot="rows-layout">
                <For each={content().integrations.badges.styles}>
                  {(style) => (
                    <div data-slot="row">
                      <h4>{style.name}</h4>
                      <ul data-slot="badge-grid">
                        <For each={["light", "dark"] as const}>
                          {(theme) => <BadgeCard group={props.group} style={style} theme={theme} font={font} />}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  )

  // Created once: Site reads its aside more than once, and a fresh element each time breaks hydration.
  const aside = <OnThisPage items={sections()} />

  return (
    <Site page="brand" markdown={markdown} aside={aside}>
      <Title>{content().title}</Title>
      <ShareMeta title={content().title} description={content().description} image={ogImage("/brand")} />
      <LocaleLinks path="/brand" />
      <Meta name="description" content={content().description} />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: language.route("/") },
          { name: content().hero.title, path: language.route("/brand") },
        ])}
      />

      <section data-component="hero">
        <PageTitle title={content().hero.title} />
        <p>{content().hero.body}</p>
        <div data-slot="hero-actions">
          <a href={content().hero.all.href} download="opencode-brand-assets.zip" data-component="site-button">
            {content().hero.all.text}
            <DownloadIcon />
          </a>
          <AgentRulesButton label={content().hero.copy.text} copied={content().hero.copy.copied} source={rules} />
        </div>
      </section>

      <ContentsMenu items={sections()} />

      <section data-component="block">
        <Heading level={2} id={anchor(content().naming.title)} label>
          {content().naming.title}
        </Heading>
        <div data-slot="body">
          <div data-slot="paragraphs">
            <p data-slot="text">{content().naming.body}</p>
            <p data-slot="text">
              <For each={content().naming.code.split("`")}>
                {(part, index) => (index() % 2 ? <code>{part}</code> : part)}
              </For>
            </p>
          </div>
        </div>
      </section>

      <For each={content().families}>
        {(family, familyIndex) => (
          <section data-component="block">
            <Heading level={2} id={anchor(family.title)} label>
              {family.title}
            </Heading>
            <div data-slot="body">
              <p data-slot="text">{family.body}</p>
              <ul data-component="brand-tiles">
                <For each={family.assets}>
                  {(asset) => (
                    <li>
                      <div
                        data-slot="preview"
                        data-tone={asset.tone}
                        data-kind={family.kind}
                        data-square={asset.file.endsWith("-square") ? "" : undefined}
                      >
                        <img
                          src={asset.svg}
                          // The files' own sizes: the logo 240 × 300 (square 300 × 300), the wordmarks 640 × 115.
                          width={family.kind === "logo" ? (asset.file.endsWith("-square") ? 300 : 240) : 640}
                          height={family.kind === "logo" ? 300 : 115}
                          alt={`OpenCode ${lower(family.title)}, ${lower(asset.name)}`}
                        />
                      </div>
                      <div data-slot="meta">
                        <span data-slot="name">{asset.name}</span>
                        <Actions
                          actions={svgActions(asset.file, asset.png, asset.svg, i18n.t("brand.ui.copySvg"))}
                          detail={i18n.t("brand.ui.familyAsset", {
                            family: lower(family.title),
                            name: lower(asset.name),
                          })}
                        />
                      </div>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={familyIndex() === 0}>
                <div data-component="brand-sub">
                  <Heading level={3} id={`${anchor(family.title)}-${anchor(content().icons.title)}`}>
                    {content().icons.title}
                  </Heading>
                  <p>{content().icons.body}</p>
                  <ul data-component="brand-tiles">
                    <For each={content().icons.items}>
                      {(item) => (
                        <li>
                          <div data-slot="preview" data-kind={item.kind} data-tone={item.tone}>
                            <img
                              src={item.png}
                              width={96}
                              height={96}
                              alt={i18n.t("brand.ui.avatarAlt", { name: lower(item.name) })}
                            />
                          </div>
                          <div data-slot="meta">
                            <span data-slot="name">{item.name}</span>
                            <Actions
                              actions={[{ label: "PNG", href: item.png, download: `${item.file}.png` }]}
                              detail={i18n.t("brand.ui.avatarAsset", { name: lower(item.name), tone: tone(item.tone) })}
                            />
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </div>
          </section>
        )}
      </For>

      <section
        data-component="block"
        data-design="brandPalette variantBackground"
        data-palette={siteSettings.brandPalette === "blue + clay" ? "blue" : undefined}
        data-variant-background={siteSettings.variantBackground}
      >
        <Heading level={2} id={anchor(content().variants.title)} label>
          {content().variants.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">{content().variants.body}</p>
          <For each={content().variants.groups}>
            {(group) => (
              <div data-component="brand-variant">
                <Heading level={3} id={`${anchor(content().variants.title)}-${anchor(group.name)}`}>
                  {group.name}
                </Heading>
                <p>{group.body}</p>
                <For each={group.rows}>
                  {(row, rowIndex) => (
                    <div data-slot="row">
                      <h4>{row.title}</h4>
                      <ul data-component="brand-tiles">
                        <For each={row.tiles}>
                          {(tile) => (
                            <li>
                              <div
                                data-slot="preview"
                                data-variant={group.variant}
                                data-tone={tile.tone}
                                data-stop={rowIndex()}
                                data-kind={tile.file.includes("-logo-") ? "logo" : "wordmark"}
                              >
                                <img
                                  src={tile.svg}
                                  width={tile.file.includes("-logo-") ? 240 : 640}
                                  height={tile.file.includes("-logo-") ? 300 : 115}
                                  alt={`OpenCode ${lower(row.title)}, ${lower(group.name)}, ${lower(tile.name)}`}
                                />
                              </div>
                              <div data-slot="meta">
                                <span data-slot="name">{tile.name}</span>
                                <Actions
                                  actions={svgActions(tile.file, tile.png, tile.svg, i18n.t("brand.ui.copySvg"))}
                                  detail={i18n.t("brand.ui.variantAsset", {
                                    group: lower(group.name),
                                    row: lower(row.title),
                                    name: lower(tile.name),
                                    tone: tone(tile.tone),
                                  })}
                                />
                              </div>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </section>

      <section data-component="block">
        <Heading level={2} id={anchor(content().colors.title)} label>
          {content().colors.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">{content().colors.body}</p>
          <For each={content().colors.palettes}>
            {(palette) => (
              <div data-component="palette">
                <Heading level={3} id={`${anchor(content().colors.title)}-${anchor(palette.name)}`}>
                  {palette.name}
                </Heading>
                <ul>
                  <For each={palette.swatches}>
                    {(swatch) => {
                      const formats = colorFormats(swatch.hex)
                      return (
                        <li>
                          <span data-slot="swatch" style={{ background: swatch.hex }} />
                          <div data-slot="title-row">
                            <span data-slot="name">{swatch.name}</span>
                            <span data-slot="use">
                              {swatch.use}
                              <Show when={"ink" in swatch && swatch.ink}>{(ink) => <> {ink()}</>}</Show>
                            </span>
                          </div>
                          {/* Each row copies its value: the icon turns into a check and "Copied" is announced. */}
                          <div data-slot="formats">
                            <For
                              each={[
                                ["HEX", formats.hex],
                                ["RGB", formats.rgb],
                                ["OKLCH", formats.oklch],
                              ]}
                            >
                              {(format) => {
                                const key = `${palette.name}-${format[1]}`
                                return (
                                  <button
                                    type="button"
                                    data-slot="format"
                                    aria-label={i18n.t("brand.ui.copyValue", { format: format[0], value: format[1] })}
                                    onClick={() => copy(key, format[1])}
                                  >
                                    <span data-slot="format-name">{format[0]}</span>
                                    <span data-slot="value">
                                      {format[1]}
                                      {copied() === key ? <CheckIcon /> : <CopyIcon />}
                                    </span>
                                    <span data-slot="sr-only" aria-live="polite">
                                      {copied() === key ? i18n.t("site.action.copied") : ""}
                                    </span>
                                  </button>
                                )
                              }}
                            </For>
                          </div>
                        </li>
                      )
                    }}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </section>

      <section data-component="block">
        <Heading level={2} id={anchor(content().usage.title)} label>
          {content().usage.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">{content().usage.body}</p>
          <ul data-component="usage">
            {/* Production leaves it out while "off" is the default (script/fold-settings.ts). */}
            <Show when={import.meta.env.DEV || siteSettings.strokeDiagram !== "off"}>
              <li data-slot="stroke" data-hidden={siteSettings.strokeDiagram === "off" ? "" : undefined}>
                <div data-slot="figure">
                  <StrokeDiagrams />
                </div>
                <Heading level={3} id={`${anchor(content().usage.title)}-${anchor(content().usage.stroke.title)}`}>
                  {content().usage.stroke.title}
                </Heading>
                <span>{content().usage.stroke.body}</span>
              </li>
            </Show>
            <li data-slot="clear-space">
              <div data-slot="figure">
                <ClearSpace />
                <ClearSpaceWordmark />
              </div>
              <Heading level={3} id={`${anchor(content().usage.title)}-${anchor(content().usage.clearSpace.title)}`}>
                {content().usage.clearSpace.title}
              </Heading>
              <span>{content().usage.clearSpace.body}</span>
            </li>
            <li data-slot="pixels">
              <div data-component="brand-pixels">
                <figure data-verdict="do">
                  <div data-slot="preview" aria-hidden="true">
                    <PixelGrid good cell={16} />
                    <PixelGrid good cell={12} />
                    <PixelGrid good cell={8} />
                  </div>
                  <figcaption>
                    <Marked
                      text={i18n.t("brand.ui.do", { caption: content().usage.pixels.do })}
                      slots={{ verdict: "verdict" }}
                    />
                  </figcaption>
                </figure>
                <figure data-verdict="dont">
                  <div data-slot="preview" aria-hidden="true">
                    <PixelGrid good={false} cell={16} />
                    <PixelGrid good={false} cell={12} />
                    <PixelGrid good={false} cell={8} />
                  </div>
                  <figcaption>
                    <Marked
                      text={i18n.t("brand.ui.doNot", { caption: content().usage.pixels.dont })}
                      slots={{ verdict: "verdict" }}
                    />
                  </figcaption>
                </figure>
              </div>
              <Heading level={3} id={`${anchor(content().usage.title)}-${anchor(content().usage.pixels.title)}`}>
                {content().usage.pixels.title}
              </Heading>
              <span>{content().usage.pixels.body}</span>
              <div data-slot="sizes">
                <For each={content().usage.pixels.sizes}>
                  {(size) => (
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{size.title}</th>
                          <th scope="col">{i18n.t("brand.ui.stroke")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={size.steps}>
                          {(step) => (
                            <tr>
                              <td>
                                {step[0]} × {step[1]}px
                              </td>
                              <td>{step[0] / size.strokes}px</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  )}
                </For>
              </div>
            </li>
            <li data-slot="group-heading">
              <Heading level={3} id={`${anchor(content().usage.title)}-${anchor(content().usage.minimumTitle)}`}>
                {content().usage.minimumTitle}
              </Heading>
            </li>
            <For each={content().usage.minimum}>
              {(rule) => (
                <li>
                  <div data-slot="figure" aria-hidden="true">
                    <div data-slot="minimum" data-kind={rule.kind}>
                      {rule.kind === "logo" ? (
                        <Mark
                          code="var(--logo-code)"
                          inner="var(--logo-inner)"
                          style={{ width: `${rule.width}px`, height: `${rule.height}px` }}
                        />
                      ) : (
                        <Wordmark
                          code="var(--logo-code)"
                          open="var(--logo-open)"
                          inner="var(--logo-inner)"
                          style={{ width: `${rule.width}px`, height: `${rule.height}px` }}
                        />
                      )}
                      <Dimension kind="horizontal" size={rule.width} />
                      <span data-slot="value">
                        {rule.width} × {rule.height}px
                      </span>
                    </div>
                  </div>
                  <h4>{rule.title}</h4>
                  <span>{rule.body}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </section>

      <section data-component="block">
        <Heading level={2} id={anchor(content().donts.title)} label>
          {content().donts.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">{content().donts.body}</p>
          <svg data-slot="defs" width="0" height="0" aria-hidden="true">
            <defs>
              <linearGradient id="brand-dont-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#f43f5e" />
                <stop offset="0.5" stop-color="#a855f7" />
                <stop offset="1" stop-color="#06b6d4" />
              </linearGradient>
            </defs>
          </svg>
          <ul data-component="brand-dont-grid">
            <For each={content().donts.examples}>
              {(example) => (
                <li>
                  <figure data-verdict="dont">
                    <div data-slot="preview" data-example={example.id} aria-hidden="true">
                      <Switch>
                        <Match when={example.id === "two-tone"}>
                          <Wordmark code="#7c3aed" open="#ea580c" inner="#fdba74" />
                        </Match>
                        <Match when={example.id === "gradient"}>
                          <Mark code="url(#brand-dont-gradient)" inner="#f9a8d4" />
                        </Match>
                        <Match when={example.id === "bright"}>
                          <Wordmark code="#e5484d" open="#e5484d" inner="#e5484d" />
                        </Match>
                        <Match when={example.id === "inverted"}>
                          <Mark code="var(--logo-inner)" inner="var(--logo-code)" />
                        </Match>
                        <Match when={example.id === "low-contrast"}>
                          <Wordmark code="#a1a1a1" open="#a8a8a8" inner="#bababa" />
                        </Match>
                        <Match when={example.id === "shadow"}>
                          <Mark code="var(--logo-code)" inner="var(--logo-inner)" />
                        </Match>
                        <Match when={example.id === "stretch"}>
                          <Mark code="var(--logo-code)" inner="var(--logo-inner)" />
                        </Match>
                        <Match when={example.id === "glow"}>
                          <Wordmark code="var(--logo-code)" open="var(--logo-open)" inner="var(--logo-inner)" />
                        </Match>
                        <Match when={example.id === "lockup"}>
                          <div data-slot="lockup">
                            <Mark code="var(--logo-code)" inner="var(--logo-inner)" />
                            <span>OpenCode Pro</span>
                          </div>
                        </Match>
                        <Match when={example.id === "color"}>
                          <Wordmark code="#1f1f1f" open="#626262" inner="#d2d2d2" />
                        </Match>
                      </Switch>
                    </div>
                    <figcaption>
                      <Marked
                        text={i18n.t("brand.ui.doNot", { caption: example.caption })}
                        slots={{ verdict: "verdict" }}
                      />
                    </figcaption>
                  </figure>
                </li>
              )}
            </For>
          </ul>
        </div>
      </section>

      <section data-component="block">
        <Heading level={2} id={anchor(content().integrations.title)} label>
          {content().integrations.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">{content().integrations.body}</p>
          <Show when={siteSettings.brandBadge === "on"}>
            <p data-slot="text" data-design="brandBadge">
              {content().integrations.badges.body} {content().integrations.badges.sizes}
            </p>
            <For each={content().integrations.badges.groups}>
              {(group) => (
                <div data-component="brand-sub" data-design="badgeFont badgeLayout badgeTabStyle">
                  <Heading level={3} id={`${anchor(content().integrations.title)}-${group.label}`}>
                    {group.title}
                  </Heading>
                  <p>{group.body}</p>
                  <Badges group={group} />
                </div>
              )}
            </For>
          </Show>
          <div data-component="brand-sub">
            <Heading
              level={3}
              id={`${anchor(content().integrations.title)}-${anchor(content().integrations.lockup.title)}`}
            >
              {content().integrations.lockup.title}
            </Heading>
            <p>{content().integrations.lockup.body}</p>
            <ul data-component="brand-tiles" data-slot="lockups">
              <For each={content().integrations.lockup.partners}>
                {(partner) => (
                  <For each={partner.tones}>
                    {(tone) => (
                      <li>
                        <div data-slot="preview" data-tone={tone} data-kind="lockup">
                          <PartnerLockup partner={partner.name} />
                        </div>
                        <span data-slot="name">
                          OpenCode × {partner.name}, {themeName(tone)}
                        </span>
                      </li>
                    )}
                  </For>
                )}
              </For>
            </ul>
          </div>
          <div data-component="brand-sub">
            <Heading
              level={3}
              id={`${anchor(content().integrations.title)}-${anchor(content().integrations.naming.title)}`}
            >
              {content().integrations.naming.title}
            </Heading>
            <p>{content().integrations.naming.body}</p>
            <p>
              <For each={content().integrations.naming.rule.split("`")}>
                {(part, index) => (index() % 2 ? <code>{part}</code> : part)}
              </For>
            </p>
          </div>
        </div>
      </section>

      <section data-component="block">
        <Heading level={2} id={anchor(content().trademarks.title)} label>
          {content().trademarks.title}
        </Heading>
        <div data-slot="body">
          <p data-slot="text">
            {content().trademarks.body} {content().trademarks.contact.before}
            <a href={`mailto:${content().trademarks.contact.email}`}>{content().trademarks.contact.email}</a>
            {content().trademarks.contact.after}
          </p>
        </div>
      </section>
    </Site>
  )
}

// The partner marks from public/logos/tools (24 × 24 viewBox), drawn in the logo's ink.
const partnerMarks: Record<string, { path: string; size: number }> = {
  // The round mark fills its box, so it is drawn smaller than the logo's 60px to look as tall.
  GitHub: {
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
    size: 36,
  },
  Figma: {
    path: "M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-3.117V7.51zm0 1.471H8.148c-2.476 0-4.49-2.014-4.49-4.49S5.672 0 8.148 0h4.588v8.981zm-4.587-7.51c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.02 3.019 3.02h3.117V1.471H8.148zm4.587 15.019H8.148c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM8.148 8.981c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h3.117V8.981H8.148zM8.172 24c-2.489 0-4.515-2.014-4.515-4.49s2.014-4.49 4.49-4.49h4.588v4.441c0 2.503-2.047 4.539-4.563 4.539zm-.024-7.51a3.023 3.023 0 0 0-3.019 3.019c0 1.665 1.365 3.019 3.044 3.019 1.705 0 3.093-1.376 3.093-3.068v-2.97H8.148zm7.704 0h-.098c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h.098c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.49-4.49 4.49zm-.097-7.509c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h.098c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-.098z",
    size: 40,
  },
}

/**
 * The OpenCode logo at 32 × 40px (an 8px stroke), a 12px ×, and a partner's logo, with 3 strokes (24px)
 * on each side of the ×.
 */
function PartnerLockup(props: { partner: string }) {
  const i18n = useI18n()
  const mark = () => partnerMarks[props.partner]
  return (
    <svg
      data-component="partner-lockup"
      width="132"
      height="40"
      viewBox="0 0 132 40"
      role="img"
      aria-label={i18n.t("brand.ui.lockupAlt", { partner: props.partner })}
    >
      <svg x="0" y="0" width="32" height="40" viewBox="0 0 240 300">
        <path d={markInner} style={{ fill: "var(--logo-inner)" }} />
        <path d={markOuter} style={{ fill: "var(--logo-code)" }} />
      </svg>
      <path data-slot="times" d="M56 14L68 26M68 14L56 26" />
      <svg
        x={92 + (40 - mark().size) / 2}
        y={(40 - mark().size) / 2}
        width={mark().size}
        height={mark().size}
        viewBox="0 0 24 24"
      >
        <path d={mark().path} style={{ fill: "var(--logo-code)" }} />
      </svg>
    </svg>
  )
}

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

const markInner = "M180 240H60V120H180V240Z"
const markOuter = "M180 60H60V240H180V60ZM240 300H0V0H240V300Z"

// The wordmark letters from opencode-wordmark-light.svg: [inner shade, outer shape]. The first four spell "open".
const letters = [
  [
    "M49.2346 82.1433H16.4141V49.2861H49.2346V82.1433Z",
    "M49.2308 32.8573H16.4103V82.143H49.2308V32.8573ZM65.641 98.5716H0V16.4287H65.641V98.5716Z",
  ],
  [
    "M131.281 82.1433H98.4609V49.2861H131.281V82.1433Z",
    "M98.4649 82.143H131.285V32.8573H98.4649V82.143ZM147.696 98.5716H98.4649V115H82.0547V16.4287H147.696V98.5716Z",
  ],
  [
    "M229.746 65.7139V82.1424H180.516V65.7139H229.746Z",
    "M229.743 65.7144H180.512V82.143H229.743V98.5716H164.102V16.4287H229.743V65.7144ZM180.512 49.2859H213.332V32.8573H180.512V49.2859Z",
  ],
  [
    "M295.383 98.5718H262.562V49.2861H295.383V98.5718Z",
    "M295.387 32.8573H262.567V98.5716H246.156V16.4287H295.387V32.8573ZM311.797 98.5716H295.387V32.8573H311.797V98.5716Z",
  ],
  [
    "M393.848 82.1433H344.617V49.2861H393.848V82.1433Z",
    "M393.844 32.8573H344.613V82.143H393.844V98.5716H328.203V16.4287H393.844V32.8573Z",
  ],
  [
    "M459.485 82.1433H426.664V49.2861H459.485V82.1433Z",
    "M459.489 32.8573H426.668V82.143H459.489V32.8573ZM475.899 98.5716H410.258V16.4287H475.899V98.5716Z",
  ],
  [
    "M541.539 82.1433H508.719V49.2861H541.539V82.1433Z",
    "M541.535 32.8571H508.715V82.1428H541.535V32.8571ZM557.946 98.5714H492.305V16.4286H541.535V0H557.946V98.5714Z",
  ],
  [
    "M639.996 65.7139V82.1424H590.766V65.7139H639.996Z",
    "M590.77 32.8573V49.2859H623.59V32.8573H590.77ZM640 65.7144H590.77V82.143H640V98.5716H574.359V16.4287H640V65.7144Z",
  ],
]

/** The logo drawn inline, so specimens can take any colors. */
function Mark(props: { code: string; inner: string; style?: JSX.CSSProperties }) {
  return (
    <svg data-slot="mark" viewBox="0 0 240 300" style={props.style} aria-hidden="true">
      <path d={markInner} style={{ fill: props.inner }} />
      <path d={markOuter} style={{ fill: props.code }} />
    </svg>
  )
}

/** The wordmark drawn inline, so specimens can take any colors. */
function Wordmark(props: { code: string; open: string; inner: string; style?: JSX.CSSProperties }) {
  return (
    <svg data-slot="wordmark" viewBox="0 0 640 115" preserveAspectRatio="none" style={props.style} aria-hidden="true">
      <For each={letters}>
        {(letter, index) => (
          <>
            <path d={letter[0]} style={{ fill: props.inner }} />
            <path d={letter[1]} style={{ fill: index() < 4 ? props.open : props.code }} />
          </>
        )}
      </For>
    </svg>
  )
}

/** A thin dimension line with end ticks, drawn on whole pixels. */
function Dimension(props: { kind: "vertical" | "horizontal"; size: number }) {
  const vertical = () => props.kind === "vertical"
  return (
    <svg
      data-slot="dimension"
      width={vertical() ? 9 : props.size}
      height={vertical() ? props.size : 9}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      {vertical() ? (
        <path d={`M0 0.5H9M4.5 0V${props.size}M0 ${props.size - 0.5}H9`} />
      ) : (
        <path d={`M0.5 0V9M0 4.5H${props.size}M${props.size - 0.5} 0V9`} />
      )}
    </svg>
  )
}

/**
 * What one stroke is, in the style from Settings › Stroke diagram. Every style is in the markup and CSS
 * shows the chosen one, so the server's default and the saved setting hydrate the same nodes. The
 * logo is 96 × 120px, so one stroke is 24px; measurements are blue, lines are 1px on half pixels.
 */
function StrokeDiagrams() {
  const i18n = useI18n()
  const logo = (x: number, y: number) => (
    <svg x={x} y={y} width="96" height="120" viewBox="0 0 240 300">
      <path d={markInner} style={{ fill: "var(--logo-inner)" }} />
      <path d={markOuter} style={{ fill: "var(--logo-code)" }} />
    </svg>
  )
  // The 16 × 20px logo's pixels at the bottom-left corner (columns 0–7, rows 12–19): outline or inner shade.
  const corner = Array.from({ length: 64 }, (_, index) => {
    const col = index % 8
    const row = 12 + Math.floor(index / 8)
    return { col, row: row - 12, fill: col < 4 || row > 15 ? "var(--logo-code)" : "var(--logo-inner)" }
  })
  const ring = Array.from({ length: 6 * 7 }, (_, index) => ({
    col: (index % 6) - 1,
    row: Math.floor(index / 6) - 1,
  })).filter((tile) => tile.col < 0 || tile.col > 3 || tile.row < 0 || tile.row > 4)
  return (
    <div
      data-component="stroke-diagram"
      data-style={siteSettings.strokeDiagram}
      data-design="strokeDiagram"
      role="img"
      aria-label={i18n.t("brand.ui.strokeAlt")}
    >
      <svg data-variant="highlight" width="320" height="210" viewBox="0 0 320 210" aria-hidden="true">
        {logo(112, 48)}
        <g shape-rendering="crispEdges">
          <rect data-slot="unit" data-source x="112.5" y="48.5" width="23" height="119" />
          <path data-slot="extension" d="M112.5 37V48M135.5 37V48M112.5 168V176M207.5 168V176" />
          <path
            data-slot="dimension"
            d="M112.5 28V37M112 32.5H136M135.5 28V37M112.5 176V185M112 180.5H208M207.5 176V185"
          />
        </g>
        <text x="124" y="22" text-anchor="middle">
          1 stroke
        </text>
        <text x="160" y="200" text-anchor="middle">
          4 strokes
        </text>
      </svg>

      <svg data-variant="ruler" width="320" height="210" viewBox="0 0 320 210" aria-hidden="true">
        {logo(112, 40)}
        <g shape-rendering="crispEdges">
          <rect data-slot="unit" data-source x="112.5" y="40.5" width="23" height="119" />
          <rect data-slot="band" x="112" y="176" width="24" height="5" />
          <path data-slot="extension" d="M112.5 160V172M135.5 160V172" />
          <path
            data-slot="dimension"
            d="M112 176.5H208M112.5 172V185M136.5 172V181M160.5 172V181M184.5 172V181M207.5 172V185"
          />
        </g>
        <For each={[0, 1, 2, 3, 4]}>
          {(unit) => (
            <text x={112 + unit * 24} y="200" text-anchor="middle">
              {unit}
            </text>
          )}
        </For>
        <text x="100" y="181" text-anchor="end">
          1 stroke
        </text>
      </svg>

      <svg data-variant="zoom" width="320" height="210" viewBox="0 0 320 210" aria-hidden="true">
        <svg x="40" y="92" width="16" height="20" viewBox="0 0 240 300">
          <path d={markInner} style={{ fill: "var(--logo-inner)" }} />
          <path d={markOuter} style={{ fill: "var(--logo-code)" }} />
        </svg>
        <text data-slot="note" x="48" y="82" text-anchor="middle">
          16 × 20px
        </text>
        <g shape-rendering="crispEdges">
          <For each={corner}>
            {(cell) => (
              <rect x={128 + cell.col * 14} y={56 + cell.row * 14} width="14" height="14" style={{ fill: cell.fill }} />
            )}
          </For>
          <path
            data-slot="grid"
            d={[
              ...Array.from({ length: 9 }, (_, k) => `M${128 + k * 14 + (k === 8 ? -0.5 : 0.5)} 56V168`),
              ...Array.from({ length: 9 }, (_, k) => `M128 ${56 + k * 14 + (k === 8 ? -0.5 : 0.5)}H240`),
            ].join("")}
          />
          <rect data-slot="crop" x="40.5" y="104.5" width="7" height="7" />
          <path data-slot="extension" d="M48 104L128 56M48 112L128 168" />
          <path data-slot="dimension" d="M128.5 36V45M128 40.5H184M183.5 36V45" />
        </g>
        <text x="156" y="30" text-anchor="middle">
          1 stroke = 4px
        </text>
      </svg>

      <svg data-variant="tiles" width="320" height="210" viewBox="0 0 320 210" aria-hidden="true">
        {logo(112, 40)}
        <g shape-rendering="crispEdges">
          <For each={ring}>
            {(tile) => (
              <rect
                data-slot="tile"
                x={112 + tile.col * 24 + 0.5}
                y={40 + tile.row * 24 + 0.5}
                width="23"
                height="23"
              />
            )}
          </For>
          <rect data-slot="unit" data-source x="88.5" y="16.5" width="23" height="23" />
          <rect data-slot="tile" x="256.5" y="88.5" width="23" height="23" />
          <rect data-slot="tile" x="280.5" y="88.5" width="23" height="23" />
        </g>
        <text x="100" y="10" text-anchor="middle">
          1 stroke
        </text>
        <text x="280" y="128" text-anchor="middle">
          2 strokes
        </text>
      </svg>

      <svg data-variant="animated" width="320" height="210" viewBox="0 0 320 210" aria-hidden="true">
        {logo(112, 48)}
        <g shape-rendering="crispEdges">
          <rect data-slot="space" x="88.5" y="24.5" width="143" height="167" />
          <g data-slot="lift">
            <rect data-slot="unit" data-source x="112.5" y="48.5" width="23" height="119" />
          </g>
          <path data-slot="dimension" data-late d="M88.5 8V17M88 12.5H112M111.5 8V17" />
        </g>
        <text data-late x="140" y="16">
          1 stroke
        </text>
      </svg>
    </div>
  )
}

/**
 * The logo's clear space as a technical drawing. The logo is 96 by 120px, so one stroke, the outline's
 * thickness and a quarter of the width, is 24px. Straight lines sit on half pixels to stay 1px sharp.
 */
function ClearSpace() {
  const i18n = useI18n()
  // Corners of the clear-space box (two strokes out), with the direction each crop mark points.
  const corners = [
    [72, 40, -1, -1],
    [264, 40, 1, -1],
    [72, 256, -1, 1],
    [264, 256, 1, 1],
  ]
  const edge = (value: number, direction: number) => value - direction * 0.5
  return (
    <svg
      data-component="clear-space"
      width="352"
      height="280"
      viewBox="-8 8 352 280"
      role="img"
      aria-label={i18n.t("brand.ui.clearSpaceAlt")}
    >
      <defs>
        <pattern id="brand-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" data-slot="hatch" />
        </pattern>
      </defs>
      <path d="M72 40H264V256H72ZM120 88V208H216V88Z" fill="url(#brand-hatch)" fill-rule="evenodd" />
      <svg x="120" y="88" width="96" height="120" viewBox="0 0 240 300">
        <path d={markInner} style={{ fill: "var(--logo-inner)" }} />
        <path d={markOuter} style={{ fill: "var(--logo-code)" }} />
      </svg>
      <g shape-rendering="crispEdges">
        <rect data-slot="outline" x="72.5" y="40.5" width="191" height="215" />
        <rect data-slot="outline" x="120.5" y="88.5" width="95" height="119" />
        <path
          data-slot="crop"
          d={corners
            .map(
              (corner) =>
                `M${corner[0] + corner[2] * 4} ${edge(corner[1], corner[3])}H${corner[0] + corner[2] * 18}` +
                `M${edge(corner[0], corner[2])} ${corner[1] + corner[3] * 4}V${corner[1] + corner[3] * 18}`,
            )
            .join("")}
        />
        {/* One stroke-sized square of the logo's outline, then two of them in the margin to its left and
            below. Each square's outline is inset half a pixel inside its own cell, as the tiles in the
            stroke diagram are, so no square runs past the clear-space outline. */}
        <rect data-slot="unit" data-source x="120.5" y="184.5" width="23" height="23" />
        <rect data-slot="unit" x="96.5" y="184.5" width="23" height="23" />
        <rect data-slot="unit" x="72.5" y="184.5" width="23" height="23" />
        <rect data-slot="unit" x="120.5" y="208.5" width="23" height="23" />
        <rect data-slot="unit" x="120.5" y="232.5" width="23" height="23" />
      </g>
      <Callout x={132} y={196} drop={72} label={i18n.t("brand.ui.oneStroke")} />
    </svg>
  )
}

/**
 * The wordmark with two strokes of clear space: the wordmark at 312 × 56px, so a stroke (a seventh of
 * its height, the thickness of its letters) is 8px. Marked as the logo is: the wordmark's bottom-left
 * square (the descender row, under the "o"), two of them in the margin to its left and two below the
 * wordmark, so the squares make one L on the 8px module grid, and the label down left.
 */
function ClearSpaceWordmark() {
  const i18n = useI18n()
  const corners = [
    [32, 56, -1, -1],
    [376, 56, 1, -1],
    [32, 144, -1, 1],
    [376, 144, 1, 1],
  ]
  const edge = (value: number, direction: number) => value - direction * 0.5
  return (
    <svg
      data-component="clear-space"
      width="520"
      height="152"
      viewBox="-56 24 520 152"
      role="img"
      aria-label={i18n.t("brand.ui.clearSpaceWordmarkAlt")}
    >
      <defs>
        <pattern id="brand-hatch-wordmark" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" data-slot="hatch" />
        </pattern>
      </defs>
      <path d="M32 56H376V144H32ZM48 72V128H360V72Z" fill="url(#brand-hatch-wordmark)" fill-rule="evenodd" />
      <svg x="48" y="72" width="312" height="56" viewBox="0 0 640 115" preserveAspectRatio="none">
        <For each={letters}>
          {(letter, index) => (
            <>
              <path d={letter[0]} style={{ fill: "var(--logo-inner)" }} />
              <path d={letter[1]} style={{ fill: index() < 4 ? "var(--logo-open)" : "var(--logo-code)" }} />
            </>
          )}
        </For>
      </svg>
      <g shape-rendering="crispEdges">
        <rect data-slot="outline" x="32.5" y="56.5" width="343" height="87" />
        <rect data-slot="outline" x="48.5" y="72.5" width="311" height="55" />
        <path
          data-slot="crop"
          d={corners
            .map(
              (corner) =>
                `M${corner[0] + corner[2] * 4} ${edge(corner[1], corner[3])}H${corner[0] + corner[2] * 18}` +
                `M${edge(corner[0], corner[2])} ${corner[1] + corner[3] * 4}V${corner[1] + corner[3] * 18}`,
            )
            .join("")}
        />
        <rect data-slot="unit" data-source x="48.5" y="120.5" width="7" height="7" />
        <rect data-slot="unit" x="40.5" y="120.5" width="7" height="7" />
        <rect data-slot="unit" x="32.5" y="120.5" width="7" height="7" />
        <rect data-slot="unit" x="48.5" y="128.5" width="7" height="7" />
        <rect data-slot="unit" x="48.5" y="136.5" width="7" height="7" />
      </g>
      <Callout x={52} y={124} drop={40} label={i18n.t("brand.ui.oneStroke")} />
    </svg>
  )
}

/**
 * A measurement callout: a dot on the marked cell, a leader at exactly 45° down and to the left (it
 * drops as far as it runs), a short horizontal tick, then the label, right-aligned to the tick. Every
 * position comes from the dot, so the angle holds however the drawing is placed or scaled.
 */
function Callout(props: { x: number; y: number; drop: number; label: string }) {
  const language = useLanguage()
  // Toward the inline start: left in left-to-right text, right in right-to-left (Arabic). The label's
  // logical end meets the tick either way.
  const side = () => (language.dir(language.locale()) === "rtl" ? 1 : -1)
  const end = () => ({ x: props.x + side() * props.drop, y: props.y + props.drop })
  return (
    <>
      <path data-slot="leader" d={`M${props.x} ${props.y}L${end().x} ${end().y}H${end().x + side() * 8}`} />
      <circle data-slot="leader-dot" cx={props.x} cy={props.y} r="2" />
      <text x={end().x + side() * 12} y={end().y + 4} text-anchor="end">
        {props.label}
      </text>
    </>
  )
}

/** One action on an asset: a download, or copying the SVG at `href`. */
// `group` starts a titled part of the menu ("" for a plain divider); `value` is text to copy instead of
// the file at `href`.
type AssetAction = { label: string; href: string; download?: string; copy?: boolean; group?: string; value?: string }

/** PNG, SVG and Copy SVG for an asset that has both files. */
function svgActions(file: string, png: string, svg: string, copy: string): AssetAction[] {
  return [
    { label: "PNG", href: png, download: `${file}.png` },
    { label: "SVG", href: svg, download: `${file}.svg` },
    { label: copy, href: svg, copy: true },
  ]
}

function CheckIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={checkPath} stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 8L10 12L14 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}

/** A picture frame: the PNG. */
function ImageIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3.75 3.75H16.25V16.25H3.75V3.75ZM3.75 13.5L8 9.25L12.5 13.75M11.5 12.75L13.5 10.75L16.25 13.5"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  )
}

/** A path with its anchor points: the SVG. */
function VectorIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 15.5C6 9 9 5.5 15.5 4.5M3 14H6V17H3V14ZM14 3H17V6H14V3Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={copyPath} stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

/** The pixel-grid columns and rows: the 16 × 20px logo with one empty pixel around it. */
const gridSize = [18, 22]

/**
 * A 16 × 20px logo magnified on its pixel grid, or the same logo at 15 × 19px and off the grid. Each cell is
 * filled by how much of it the logo covers, the way a browser anti-aliases it, so off-grid edges turn grey.
 * Drawn at whole-pixel cell sizes; the page shows one size per breakpoint.
 */
function PixelGrid(props: { good: boolean; cell: number }) {
  const logo = props.good ? { x: 1, y: 1, w: 16, h: 20 } : { x: 1.4, y: 1.5, w: 15, h: 19 }
  const c = props.cell
  const left = 44
  const top = 30
  const width = gridSize[0] * c
  const height = gridSize[1] * c
  const lx = left + logo.x * c
  const rx = left + (logo.x + logo.w) * c
  const ty = top + logo.y * c
  const by = top + (logo.y + logo.h) * c
  const sx = lx + (logo.w / 4) * c
  const cells = Array.from({ length: gridSize[0] * gridSize[1] }, (_, index) => {
    const i = index % gridSize[0]
    const j = Math.floor(index / gridSize[0])
    const cover = (x0: number, x1: number, y0: number, y1: number) =>
      Math.max(0, Math.min(i + 1, x1) - Math.max(i, x0)) * Math.max(0, Math.min(j + 1, y1) - Math.max(j, y0))
    const x = [logo.x, logo.x + logo.w / 4, logo.x + (logo.w * 3) / 4, logo.x + logo.w]
    const y = [logo.y, logo.y + logo.h / 5, logo.y + (logo.h * 2) / 5, logo.y + (logo.h * 4) / 5, logo.y + logo.h]
    const code = cover(x[0], x[3], y[0], y[4]) - cover(x[1], x[2], y[1], y[3])
    const inner = cover(x[1], x[2], y[2], y[3])
    return { i, j, fill: cellFill(code, inner) }
  }).filter((cell) => cell.fill)
  // Each run of same-coloured cells in a row as one rectangle, grown down over the rows below with the
  // same run: the pixels of a square per cell in a fraction of the markup. Rectangles, not paths, as
  // crispEdges rounds a path's edges differently when the drawing sits on a fraction of a pixel.
  const runs = cells.reduce<{ i: number; j: number; n: number; fill?: string }[]>((list, cell) => {
    const last = list.at(-1)
    if (!last || last.fill !== cell.fill || last.j !== cell.j || last.i + last.n !== cell.i)
      return [...list, { ...cell, n: 1 }]
    last.n++
    return list
  }, [])
  const blocks = runs.reduce<((typeof runs)[number] & { rows: number })[]>((list, run) => {
    const above = list.find(
      (block) => block.i === run.i && block.n === run.n && block.fill === run.fill && block.j + block.rows === run.j,
    )
    if (!above) return [...list, { ...run, rows: 1 }]
    above.rows++
    return list
  }, [])
  const grid = [
    ...Array.from({ length: gridSize[0] + 1 }, (_, k) => {
      const x = left + k * c + (k === gridSize[0] ? -0.5 : 0.5)
      return `M${x} ${top}V${top + height}`
    }),
    ...Array.from({ length: gridSize[1] + 1 }, (_, k) => {
      const y = top + k * c + (k === gridSize[1] ? -0.5 : 0.5)
      return `M${left} ${y}H${left + width}`
    }),
  ].join("")
  return (
    <svg
      data-component="pixel-grid"
      data-cell={c}
      direction="ltr"
      width={left + width + 8}
      height={top + height + 34}
      viewBox={`0 0 ${left + width + 8} ${top + height + 34}`}
    >
      <g shape-rendering="crispEdges">
        <For each={blocks}>
          {(block) => (
            <rect
              x={left + block.i * c}
              y={top + block.j * c}
              width={block.n * c}
              height={block.rows * c}
              style={{ fill: block.fill }}
            />
          )}
        </For>
        <path data-slot="grid" d={grid} />
        <path
          data-slot="dimension"
          d={
            `M${lx} ${top - 14}V${top - 7}M${lx} ${top - 10.5}H${rx}M${rx} ${top - 14}V${top - 7}` +
            `M${left - 14} ${ty}H${left - 7}M${left - 10.5} ${ty}V${by}M${left - 14} ${by}H${left - 7}` +
            `M${lx} ${top + height + 7}V${top + height + 14}M${lx} ${top + height + 10.5}H${sx}M${sx} ${top + height + 7}V${top + height + 14}`
          }
        />
      </g>
      <text x={(lx + rx) / 2} y={top - 17} text-anchor="middle">
        {logo.w}px
      </text>
      <text x={left - 17} y={(ty + by) / 2 + 4} text-anchor="end">
        {logo.h}px
      </text>
      <text x={sx + 6} y={top + height + 14}>
        {logo.w / 4}px stroke
      </text>
    </svg>
  )
}

/** A cell's color from how much of it the outline and the inner shade cover, mixed over the figure background. */
function cellFill(code: number, inner: number) {
  if (code > 0.999) return "var(--logo-code)"
  if (inner > 0.999) return "var(--logo-inner)"
  if (code + inner < 0.001) return undefined
  const shade = code < 1 ? (inner / (1 - code)) * 100 : 0
  return `color-mix(in srgb, var(--logo-code) ${(code * 100).toFixed(1)}%, color-mix(in srgb, var(--logo-inner) ${shade.toFixed(1)}%, var(--bg-weak)))`
}
