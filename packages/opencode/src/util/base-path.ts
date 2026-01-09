/**
 * Normalizes a base path to ensure consistent format:
 * - Returns empty string for root path or undefined
 * - Ensures leading slash
 * - Removes trailing slashes
 */
export function normalizeBasePath(path?: string): string {
  if (!path || path === "/") return ""

  // Ensure leading slash, remove trailing slashes
  let normalized = path.startsWith("/") ? path : `/${path}`
  normalized = normalized.replace(/\/+$/, "")

  return normalized
}

/**
 * Joins a base path with additional path segments.
 * Handles normalization of the base path and proper joining of segments.
 */
export function joinPath(basePath: string, ...segments: string[]): string {
  const base = normalizeBasePath(basePath)
  const path = segments.join("/").replace(/\/+/g, "/")
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

/**
 * Generates the JavaScript snippet that wraps history.pushState/replaceState
 * to automatically prepend the basePath to URLs.
 */
export function generateBasePathScript(basePath: string): string {
  return `<script>
window.__OPENCODE_BASE_PATH__="${basePath}";
(function() {
  var basePath = window.__OPENCODE_BASE_PATH__ || "";
  if (!basePath) return;

  var origPushState = history.pushState.bind(history);
  var origReplaceState = history.replaceState.bind(history);

  function addBasePathIfNeeded(url) {
    if (!url || typeof url !== "string") return url;
    if (url.startsWith("/") && !url.startsWith(basePath)) {
      return basePath + url;
    }
    return url;
  }

  history.pushState = function(state, title, url) {
    return origPushState(state, title, addBasePathIfNeeded(url));
  };

  history.replaceState = function(state, title, url) {
    return origReplaceState(state, title, addBasePathIfNeeded(url));
  };
})();
</script>`
}

/**
 * Rewrites HTML content to include basePath in asset references.
 * - Rewrites href="/...", src="/...", content="/..." to include basePath
 * - Injects the basePath script before </head>
 * - Does NOT rewrite protocol-relative URLs (//...)
 */
export function rewriteHtmlForBasePath(html: string, basePath: string): string {
  if (!basePath) return html

  // Rewrite absolute paths in HTML to include basePath
  // Matches href="/...", src="/...", content="/..." but not href="//..." (protocol-relative)
  let result = html.replace(/(href|src|content)="\/(?!\/)/g, `$1="${basePath}/`)

  // Inject basePath script before </head>
  result = result.replace("</head>", `${generateBasePathScript(basePath)}</head>`)

  return result
}

/**
 * Rewrites JavaScript content to work with basePath.
 * - Patches window.location.origin references to include basePath
 * - Patches Vite's base path function for dynamic asset loading
 *
 * Note: The Vite patch is fragile and depends on minified output format.
 */
export function rewriteJsForBasePath(js: string, basePath: string): string {
  if (!basePath) return js

  let result = js

  // Replace the pattern where the app determines the server URL
  // In minified code it appears as: :window.location.origin)
  result = result.replace(
    /:window\.location\.origin\)/g,
    `:window.location.origin+(window.__OPENCODE_BASE_PATH__||""))`,
  )

  // Patch Vite's base path function to use our basePath instead of "/"
  // The function looks like: function(t){return"/"+t}
  // This handles all dynamic asset loading
  result = result.replace(/function\(t\)\{return"\/"\+t\}/g, `function(t){return"${basePath}/"+t}`)

  return result
}

/**
 * Rewrites CSS content to include basePath in url() references.
 * - Rewrites url(/...) to url(/basePath/...)
 * - Does NOT rewrite protocol-relative URLs (//...)
 */
export function rewriteCssForBasePath(css: string, basePath: string): string {
  if (!basePath) return css

  // Rewrite url(/assets/...) to url(/basePath/assets/...)
  return css.replace(/url\(\/(?!\/)/g, `url(${basePath}/`)
}
