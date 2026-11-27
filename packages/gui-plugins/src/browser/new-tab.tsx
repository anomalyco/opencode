import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { createMemo, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { usePlugin, type SessionRef } from "@opencode/plugin/gui"
import { ADDRESS_SUGGESTIONS, type AddressPage } from "./address-machine"
import { AddressField, BrowserNavigation, PageRow, type AddressControls } from "./address-field"
import { bare } from "./history/page"
import type definition from "./index"
import type { Model } from "./model"
import { absolutePath, SESSION_LINKS, type createSessionLinks, type SessionLink } from "./session-links"

// The New tab page has no tab: its field shows a blank page, and what the person enters opens in a new tab.
const BLANK: AddressPage = { tabID: undefined, url: "", loading: false, generation: 0, error: undefined }

/** The browser bar across the top of the side panel's New tab page, as a blank browser tab draws it. */
export function NewTabBar(props: {
  model: Model
  open: (url: string) => void
  /** Hands the New tab view the field that takes the keyboard when the person opens the New tab. */
  autofocus: (control: { focus(): void }) => () => void
}) {
  const plugin = usePlugin<typeof definition>()
  let field: AddressControls | undefined

  onMount(() => {
    if (field) onCleanup(props.autofocus(field))
  })

  return (
    <div
      data-component="browser-bar"
      class="h-11 shrink-0 flex items-center gap-2 px-3 border-b-[0.5px] border-v2-border-border-muted"
    >
      <BrowserNavigation back={false} forward={false} loading={false} reloadable={false} go={() => {}} reload={() => {}} />
      <AddressField
        model={props.model}
        page={() => BLANK}
        icon={() => undefined}
        failed={() => false}
        disabled={() => false}
        navigate={(url) => props.open(url)}
        controls={(controls) => {
          field = controls
        }}
      />
      {/* The element picker and the page's options act on a page, and there is none yet. */}
      <div class="flex shrink-0 items-center gap-1">
        <IconButton
          variant="ghost-muted"
          size="large"
          disabled
          aria-label={plugin.t("inspect")}
          icon={<Icon name="select-element" />}
        />
        <IconButton
          variant="ghost-muted"
          size="large"
          disabled
          aria-label={plugin.t("options")}
          icon={<Icon name="outline-dots" />}
        />
      </div>
    </div>
  )
}

/**
 * The side panel's New tab page lists under its launchers the pages the agent named in this session, then the pages the
 * browser showed last that are not among them.
 */
export function NewTabPages(props: {
  session: SessionRef
  model: Model
  /** Reads a session's pages, remembering the replies it read for as long as the browser plugin runs. */
  links: ReturnType<typeof createSessionLinks>
  open: (url: string) => void
  /** Shows a workspace file the agent showed in the browser. */
  openFile: (path: string) => void
}) {
  const plugin = usePlugin<typeof definition>()

  const session = createMemo(() => {
    const id = props.session.id

    if (!id) return []

    return props
      .links(props.session.server.data.session.message.list(id), SESSION_LINKS, props.session.server.url)
      .flatMap((link): SessionLink[] => {
        if (link.type === "page") return [link]
        const path = workspaceFile(link.path)

        return path === undefined ? [] : [{ ...link, path }]
      })
  })

  const recent = createMemo(() => {
    const listed = new Set(session().map((link) => link.key))

    return props.model
      .visits()
      .filter((visit) => !listed.has(visit.url))
      .slice(0, ADDRESS_SUGGESTIONS)
  })

  // The window opens a file only inside the session's workspace; the agent's own call may show others, which the server
  // grants it. A file elsewhere is left out rather than listed where it cannot open.
  const workspaceFile = (path: string) => {
    if (!absolutePath(path)) return path
    const root = props.session.location?.directory.replaceAll("\\", "/").replace(/\/+$/, "")
    const file = path.replaceAll("\\", "/")

    return root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : undefined
  }

  // A page the browser showed has its title and icon; another shows its address alone.
  const visit = (url: string) => props.model.visits().find((item) => item.url === url)

  return (
    <>
      <PageSection title={plugin.t("home.session")} show={session().length > 0}>
        <For each={session()}>
          {(link) =>
            link.type === "file" ? (
              <PageRow icon={undefined} title="" detail={link.path} onClick={() => props.openFile(link.path)} />
            ) : (
              <PageRow
                icon={visit(link.url)?.icon}
                title={visit(link.url)?.title ?? ""}
                detail={bare(link.url)}
                onClick={() => props.open(link.url)}
              />
            )
          }
        </For>
      </PageSection>
      <PageSection title={plugin.t("home.recent")} show={recent().length > 0}>
        <For each={recent()}>
          {(item) => (
            <PageRow icon={item.icon} title={item.title} detail={bare(item.url)} onClick={() => props.open(item.url)} />
          )}
        </For>
      </PageSection>
    </>
  )
}

function PageSection(props: { title: string; show: boolean; children: JSX.Element }) {
  const heading = createUniqueId()

  return (
    <Show when={props.show}>
      <section class="flex flex-col gap-1 pt-6" aria-labelledby={heading}>
        <h2 id={heading} class="px-2 pb-1 text-[13px] font-[440] text-v2-text-text-muted">
          {props.title}
        </h2>
        {props.children}
      </section>
    </Show>
  )
}
