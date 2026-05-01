import { Link, Style } from "@solidjs/meta"
import { Show } from "solid-js"
import inter from "../assets/fonts/inter.woff2"
import ibmPlexMonoBold from "../assets/fonts/ibm-plex-mono-bold.woff2"
import ibmPlexMonoMedium from "../assets/fonts/ibm-plex-mono-medium.woff2"
import ibmPlexMonoRegular from "../assets/fonts/ibm-plex-mono.woff2"

export const Font = () => {
  return (
    <>
      <Style>{`
        @font-face {
          font-family: "Inter";
          src: url("${inter}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
        }
        @font-face {
          font-family: "Inter Fallback";
          src: local("Arial");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoRegular}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 400;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoMedium}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 500;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoBold}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 700;
        }
        @font-face {
          font-family: "IBM Plex Mono Fallback";
          src: local("Courier New");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        /*
         * The IBM Plex Mono assets above are symlinks to the BlexMonoNerdFontMono
         * binaries (which include the full Nerd Font glyph set). Re-declare them
         * under a Nerd-Font-flavored family name so Ghostty's terminal renderer,
         * which scans the font chain via /nerd|powerline/i to pick a glyph-aware
         * font for cell metrics, finds a match. The browser dedupes by URL so
         * this adds no extra network or memory cost.
         */
        @font-face {
          font-family: "BlexMono Nerd Font Mono";
          src: url("${ibmPlexMonoRegular}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 400;
        }
        @font-face {
          font-family: "BlexMono Nerd Font Mono";
          src: url("${ibmPlexMonoMedium}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 500;
        }
        @font-face {
          font-family: "BlexMono Nerd Font Mono";
          src: url("${ibmPlexMonoBold}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 700;
        }
      `}</Style>
      <Show when={typeof location === "undefined" || location.protocol !== "file:"}>
        <Link rel="preload" href={inter} as="font" type="font/woff2" crossorigin="anonymous" />
        <Link rel="preload" href={ibmPlexMonoRegular} as="font" type="font/woff2" crossorigin="anonymous" />
      </Show>
    </>
  )
}
