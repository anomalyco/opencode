// Wordmark "imecode": left half spells "ime", right half spells "code".
// The "code" half is unchanged from upstream; only the left half was redrawn
// from "open" -> "ime". Marks "_^~," are decorative cells (see `marks` below):
// _ = interior hole, ^ = top bar, ~ = foot shadow. All four rows of each half
// MUST stay equal width or the renderers (splash.ts, logo.tsx, bg-pulse) misalign.
export const logo = {
  left: ["▀           ", "█ █▀█▀█ █▀▀█", "█ █_█_█ █^^^", "▀ ▀~▀~▀ ▀▀▀▀"],
  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
