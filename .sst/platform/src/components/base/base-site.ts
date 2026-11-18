import path from "path";
import { Input } from "../input";

export interface BaseSiteDev {
  /**
   * The `url` when this is running in dev mode.
   *
   * Since this component is not deployed in `sst dev`, there is no real URL. But if you are
   * using this component's `url` or linking to this component's `url`, it can be useful to
   * have a placeholder URL. It avoids having to handle it being `undefined`.
   * @default `"http://url-unavailable-in-dev.mode"`
   */
  url?: Input<string>;
  /**
   * The command that `sst dev` runs to start this in dev mode.
   * @default `"npm run dev"`
   */
  command?: Input<string>;
  /**
   * Configure if you want to automatically start this when `sst dev` starts. You can still
   * start it manually later.
   * @default `true`
   */
  autostart?: Input<boolean>;
  /**
   * Change the directory from where the `command` is run.
   * @default Uses the `path`
   */
  directory?: Input<string>;
  /**
   * The title of the tab in the multiplexer.
   */
  title?: Input<string>;
}

export interface BaseSiteFileOptions {
  /**
   * A glob pattern or array of glob patterns of files to apply these options to.
   */
  files: string | string[];
  /**
   * A glob pattern or array of glob patterns of files to exclude from the ones matched
   * by the `files` glob pattern.
   */
  ignore?: string | string[];
  /**
   * The `Cache-Control` header to apply to the matched files.
   */
  cacheControl?: string;
  /**
   * The `Content-Type` header to apply to the matched files.
   */
  contentType?: string;
}

export function getContentType(filename: string, textEncoding: string) {
  const ext =
    filename.endsWith(".well-known/site-association-json") ||
    filename.endsWith(".well-known/apple-app-site-association")
      ? ".json"
      : path.extname(filename);
  const extensions = {
    [".txt"]: { mime: "text/plain", isText: true },
    [".htm"]: { mime: "text/html", isText: true },
    [".html"]: { mime: "text/html", isText: true },
    [".xhtml"]: { mime: "application/xhtml+xml", isText: true },
    [".css"]: { mime: "text/css", isText: true },
    [".js"]: { mime: "text/javascript", isText: true },
    [".mjs"]: { mime: "text/javascript", isText: true },
    [".apng"]: { mime: "image/apng", isText: false },
    [".avif"]: { mime: "image/avif", isText: false },
    [".gif"]: { mime: "image/gif", isText: false },
    [".jpeg"]: { mime: "image/jpeg", isText: false },
    [".jpg"]: { mime: "image/jpeg", isText: false },
    [".png"]: { mime: "image/png", isText: false },
    [".svg"]: { mime: "image/svg+xml", isText: true },
    [".bmp"]: { mime: "image/bmp", isText: false },
    [".tiff"]: { mime: "image/tiff", isText: false },
    [".webp"]: { mime: "image/webp", isText: false },
    [".ico"]: { mime: "image/vnd.microsoft.icon", isText: false },
    [".eot"]: { mime: "application/vnd.ms-fontobject", isText: false },
    [".ttf"]: { mime: "font/ttf", isText: false },
    [".otf"]: { mime: "font/otf", isText: false },
    [".woff"]: { mime: "font/woff", isText: false },
    [".woff2"]: { mime: "font/woff2", isText: false },
    [".json"]: { mime: "application/json", isText: true },
    [".jsonld"]: { mime: "application/ld+json", isText: true },
    [".xml"]: { mime: "application/xml", isText: true },
    [".pdf"]: { mime: "application/pdf", isText: false },
    [".zip"]: { mime: "application/zip", isText: false },
    [".wasm"]: { mime: "application/wasm", isText: false },
    [".webmanifest"]: { mime: "application/manifest+json", isText: true },
  };
  const extensionData = extensions[ext as keyof typeof extensions];
  const mime = extensionData?.mime ?? "application/octet-stream";
  const charset =
    extensionData?.isText && textEncoding !== "none"
      ? `;charset=${textEncoding}`
      : "";
  return `${mime}${charset}`;
}
