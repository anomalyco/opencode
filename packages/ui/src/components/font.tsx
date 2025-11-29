import { Style, Link } from "@solidjs/meta"
import geist from "../assets/fonts/geist.woff2"
import tx02 from "../assets/fonts/tx-02.woff2"

export const Font = () => {
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
          font-family: "Berkeley Mono";
          src: url("${tx02}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 400 700;
        }
        @font-face {
          font-family: "Berkeley Mono Fallback";
          src: local("Courier New");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
      `}</Style>
      <Link rel="preload" href={geist} as="font" type="font/woff2" crossorigin="anonymous" />
      <Link rel="preload" href={tx02} as="font" type="font/woff2" crossorigin="anonymous" />
    </>
  )
}
