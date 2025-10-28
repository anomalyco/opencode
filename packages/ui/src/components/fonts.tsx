import { Style, Link } from "@solidjs/meta"
import geist from "../assets/fonts/geist.woff2"
import geistMono from "../assets/fonts/geist-mono.woff2"

export const Fonts = () => {
  return (
    <>
      <Style>{`
        @font-face {
          font-family: "Geist";
          src: url("${geist}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
        }
        @font-face {
          font-family: "Geist Fallback";
          src: local("Arial");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        @font-face {
          font-family: "Geist Mono";
          src: url("${geistMono}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
        }
        @font-face {
          font-family: "Geist Mono Fallback";
          src: local("Courier New");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
      `}</Style>
      <Link rel="preload" href={geist} as="font" type="font/woff2" crossorigin="anonymous" />
      <Link rel="preload" href={geistMono} as="font" type="font/woff2" crossorigin="anonymous" />
    </>
  )
}
