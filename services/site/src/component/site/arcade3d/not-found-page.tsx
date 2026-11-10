import { Meta, Title } from "@solidjs/meta"
import { HttpStatusCode } from "@solidjs/start"
import { createSignal, Match, onMount, Switch } from "solid-js"
import { Arcade404 } from "../arcade/arcade"
import { isPhone } from "../arcade/phone"
import { toneScript } from "../arcade/tone"
import { siteSettings } from "../settings"
import { Arcade3D } from "./arcade3d"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"

/**
 * The not-found page: the real 404 route and its previews render this same tree, so the preview's
 * HTML (which the dev server serves for bad URLs) hydrates cleanly as the 404 route. Settings ›
 * 404 arcade › Mode picks the version (layers by default; settings.ts loads the saved mode after
 * hydration, so the server's layers markup always hydrates). Phones get the layers stack with its
 * still light and the hybrid's phone flow (arcade/phone.ts), which loads no WebGL there. Each mode's
 * setting comes first in its `when`, so production folds the modes it never shows out of the bundle.
 * Production's page is plain HTML, and its script renders production's mode again in the browser
 * (client/islands/arcade.tsx): change both.
 */
export function NotFoundPage(props: { title: string; status: number }) {
  const [phone, setPhone] = createSignal(false)
  onMount(() => setPhone(isPhone()))
  return (
    // Names its surface for the funnel, whatever the address (lib/funnel.ts).
    <main data-page="not-found" data-funnel-surface="www-404">
      <Title>{props.title}</Title>
      <Meta name="robots" content="noindex" />
      {/* A dead link pasted into a chat still unfurls, so the 404 has its own card (script/og.ts). */}
      <ShareMeta
        title={props.title}
        description="The page you followed isn't here. Insert a coin, or head back home."
        image={ogImage("/404")}
        englishOnly
      />
      <HttpStatusCode code={props.status} />
      {/* Before anything is parsed, so the saved tone applies from the first paint. */}
      <script innerHTML={toneScript} />
      <Switch fallback={<Arcade404 mode="layers" />}>
        <Match when={siteSettings.arcadeMode === "3D" && !phone()}>
          <Arcade3D />
        </Match>
        <Match when={siteSettings.arcadeMode === "image" && !phone()}>
          <Arcade404 />
        </Match>
        <Match when={siteSettings.arcadeMode === "hybrid" && !phone()}>
          <Arcade404 mode="hybrid" />
        </Match>
      </Switch>
    </main>
  )
}
