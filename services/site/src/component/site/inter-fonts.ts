import interLatin from "../../asset/fonts/inter-latin.woff2"
import interRest from "../../asset/fonts/inter-rest.woff2"

/** Inter's Latin file, which pages preload (most need nothing else). */
export { interLatin }

// Inter as WOFF2, split so most pages only fetch the Latin file (about 95 KB instead of the 870 KB
// TTF). The other file has the Greek, Cyrillic, Vietnamese and symbol glyphs. The ranges must not
// overlap: a character in both that Inter lacks would fetch the second file only to fall back. The
// Latin file keeps both axes (weight, optical size) but only the OpenType features the site uses
// (pyftsubset --layout-features="calt,case,ccmp,locl,tnum,pnum,kern,mark,mkmk,cpsp,liga"): no
// character variants or stylistic sets.
export const interFaces = [
  [
    interRest,
    "U+0180-0191, U+0193-0217, U+021C-0236, U+0238-02BA, U+02BD-02C5, U+02C8, U+02CA-02D7, U+02DE-02FF, U+0309, U+030D-0325, U+032A-058F, U+0E3F, U+1D00-1E9D, U+1E9F-1FFF, U+2070-20AB, U+20AD-20B8, U+20BA-20BC, U+20BE-2112, U+2114-2115, U+2117-2121, U+2123-2125, U+2127-212D, U+212F-218F, U+2200-2211, U+2213-2214, U+2216-2218, U+221A-221D, U+221F-2247, U+2249-225F, U+2261-2263, U+2266-2302, U+2304-2317, U+2319-2324, U+2326-232A, U+232C-238A, U+238C-23CD, U+23CF-259F, U+2600-2712, U+2714, U+2716-2E7F, U+A640-A9FF, U+E000-F8FF",
  ],
  [
    interLatin,
    "U+0000-017F, U+0192, U+0218-021B, U+0237, U+02BB-02BC, U+02C6-02C7, U+02C9, U+02D8-02DD, U+0300-0308, U+030A-030C, U+0326-0329, U+1E9E, U+2000-206F, U+20AC, U+20B9, U+20BD, U+2113, U+2116, U+2122, U+2126, U+212E, U+2190-21FF, U+2212, U+2215, U+2219, U+221E, U+2248, U+2260, U+2264-2265, U+2303, U+2318, U+2325, U+232B, U+238B, U+23CE, U+25A0-25FF, U+2713, U+2715, U+FB01-FB02, U+FEFF, U+FFFD",
  ],
]
  .map(
    ([url, range]) =>
      `@font-face { font-family: "Inter"; src: local("Inter"), local("Inter Variable"), url(${url}) format("woff2"); font-weight: 100 900; font-display: optional; unicode-range: ${range}; }`,
  )
  .join("\n")
