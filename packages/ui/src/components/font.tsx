import { Link, Style } from "@solidjs/meta"
import { Show } from "solid-js"
import inter from "../assets/fonts/inter.woff2"
import ibmPlexMonoBold from "../assets/fonts/ibm-plex-mono-bold.woff2"
import ibmPlexMonoMedium from "../assets/fonts/ibm-plex-mono-medium.woff2"
import ibmPlexMonoRegular from "../assets/fonts/ibm-plex-mono.woff2"

type MonoFont = {
  id: string
  family: string
  regular: string
  bold: string
}

const files = import.meta.glob("../assets/fonts/*.woff2", { import: "default" }) as Record<
  string,
  () => Promise<string>
>

export const MONO_NERD_FONTS = [
  {
    id: "jetbrains-mono",
    family: "JetBrains Mono Nerd Font",
    regular: "../assets/fonts/jetbrains-mono-nerd-font.woff2",
    bold: "../assets/fonts/jetbrains-mono-nerd-font-bold.woff2",
  },
  {
    id: "fira-code",
    family: "Fira Code Nerd Font",
    regular: "../assets/fonts/fira-code-nerd-font.woff2",
    bold: "../assets/fonts/fira-code-nerd-font-bold.woff2",
  },
  {
    id: "cascadia-code",
    family: "Cascadia Code Nerd Font",
    regular: "../assets/fonts/cascadia-code-nerd-font.woff2",
    bold: "../assets/fonts/cascadia-code-nerd-font-bold.woff2",
  },
  {
    id: "hack",
    family: "Hack Nerd Font",
    regular: "../assets/fonts/hack-nerd-font.woff2",
    bold: "../assets/fonts/hack-nerd-font-bold.woff2",
  },
  {
    id: "source-code-pro",
    family: "Source Code Pro Nerd Font",
    regular: "../assets/fonts/source-code-pro-nerd-font.woff2",
    bold: "../assets/fonts/source-code-pro-nerd-font-bold.woff2",
  },
  {
    id: "inconsolata",
    family: "Inconsolata Nerd Font",
    regular: "../assets/fonts/inconsolata-nerd-font.woff2",
    bold: "../assets/fonts/inconsolata-nerd-font-bold.woff2",
  },
  {
    id: "roboto-mono",
    family: "Roboto Mono Nerd Font",
    regular: "../assets/fonts/roboto-mono-nerd-font.woff2",
    bold: "../assets/fonts/roboto-mono-nerd-font-bold.woff2",
  },
  {
    id: "ubuntu-mono",
    family: "Ubuntu Mono Nerd Font",
    regular: "../assets/fonts/ubuntu-mono-nerd-font.woff2",
    bold: "../assets/fonts/ubuntu-mono-nerd-font-bold.woff2",
  },
  {
    id: "intel-one-mono",
    family: "Intel One Mono Nerd Font",
    regular: "../assets/fonts/intel-one-mono-nerd-font.woff2",
    bold: "../assets/fonts/intel-one-mono-nerd-font-bold.woff2",
  },
  {
    id: "meslo-lgs",
    family: "Meslo LGS Nerd Font",
    regular: "../assets/fonts/meslo-lgs-nerd-font.woff2",
    bold: "../assets/fonts/meslo-lgs-nerd-font-bold.woff2",
  },
  {
    id: "iosevka",
    family: "Iosevka Nerd Font",
    regular: "../assets/fonts/iosevka-nerd-font.woff2",
    bold: "../assets/fonts/iosevka-nerd-font-bold.woff2",
  },
  {
    id: "geist-mono",
    family: "GeistMono Nerd Font",
    regular: "../assets/fonts/GeistMonoNerdFontMono-Regular.woff2",
    bold: "../assets/fonts/GeistMonoNerdFontMono-Bold.woff2",
  },
] satisfies MonoFont[]

const mono = Object.fromEntries(MONO_NERD_FONTS.map((font) => [font.id, font])) as Record<string, MonoFont>
const loads = new Map<string, Promise<void>>()

function css(font: { family: string; regular: string; bold: string }) {
  return `
    @font-face {
      font-family: "${font.family}";
      src: url("${font.regular}") format("woff2");
      font-display: swap;
      font-style: normal;
      font-weight: 400;
    }
    @font-face {
      font-family: "${font.family}";
      src: url("${font.bold}") format("woff2");
      font-display: swap;
      font-style: normal;
      font-weight: 700;
    }
  `
}

export function ensureMonoFont(id: string | undefined) {
  if (!id || id === "ibm-plex-mono") return Promise.resolve()
  if (typeof document !== "object") return Promise.resolve()
  const font = mono[id]
  if (!font) return Promise.resolve()
  const styleId = `oc-font-${font.id}`
  if (document.getElementById(styleId)) return Promise.resolve()
  const hit = loads.get(font.id)
  if (hit) return hit
  const load = Promise.all([files[font.regular]?.(), files[font.bold]?.()]).then(([regular, bold]) => {
    if (!regular || !bold) return
    if (document.getElementById(styleId)) return
    const style = document.createElement("style")
    style.id = styleId
    style.textContent = css({ family: font.family, regular, bold })
    document.head.appendChild(style)
  })
  loads.set(font.id, load)
  return load
}

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
      `}</Style>
      <Show when={typeof location === "undefined" || location.protocol !== "file:"}>
        <Link rel="preload" href={inter} as="font" type="font/woff2" crossorigin="anonymous" />
        <Link rel="preload" href={ibmPlexMonoRegular} as="font" type="font/woff2" crossorigin="anonymous" />
      </Show>
    </>
  )
}
