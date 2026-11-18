import { MetaProvider } from "@solidjs/meta"
import { Router } from "@solidjs/router"
import { Arcade404 } from "~/component/site/arcade/arcade"
import { I18nProvider } from "~/context/i18n"
import { LanguageProvider } from "~/context/language"
import { swap } from "../solid"

/**
 * The not-found page's arcade (arcade.tsx, in production's mode, not-found-page.tsx), with its own
 * frame, search and tooltips (chrome.tsx): rendered again in the browser in place of the server's
 * copy, whose screen the first-paint script already pinned in place, so the token can be dragged
 * into the slot. Its frame reads the language and adds head tags, so it gets the app's providers, as
 * search does (overlays/search.tsx); the router has no routes.
 */
export default function arcade(root: HTMLElement) {
  void swap(
    () => (
      <Router
        explicitLinks={true}
        root={() => (
          <LanguageProvider>
            <I18nProvider>
              <MetaProvider>
                <Arcade404 mode="layers" />
              </MetaProvider>
            </I18nProvider>
          </LanguageProvider>
        )}
      />
    ),
    root,
  )
}
