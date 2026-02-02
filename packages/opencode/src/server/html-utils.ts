/**
 * Utilities for safely modifying HTML with rootPath injection
 */

import { Log } from "../util/log"

const log = Log.create({ service: "html-utils" })

/**
 * Escapes special characters for safe use in HTML attributes
 */
function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

/**
 * Safely injects rootPath configuration into index.html
 * - Prevents XSS by properly escaping values
 * - Checks for existing tags to avoid duplication
 * - Returns modified HTML or original on any error
 */
export function injectRootPath(html: string, rootPath: string): string {
    if (!rootPath) return html

    try {
        let modifiedHtml = html

        // Check if base tag already exists
        const hasBaseTag = /<base\s+href=/i.test(html)

        // Safely escape rootPath for JSON injection (prevents XSS)
        const safeRootPath = JSON.stringify(rootPath)

        // Add base tag if it doesn't exist
        if (!hasBaseTag) {
            const baseTag = `<base href="${escapeHtmlAttribute(rootPath)}/">`
            modifiedHtml = modifiedHtml.replace(/(<head[^>]*>)/i, `$1\n    ${baseTag}`)
        }

        // Add script tag with safely escaped rootPath
        const scriptTag = `<script>
      console.log("OPENCODE: Injecting rootPath", ${safeRootPath});
      window.__OPENCODE__ = window.__OPENCODE__ || {};
      window.__OPENCODE__.rootPath = ${safeRootPath};
    </script>`
        modifiedHtml = modifiedHtml.replace(/(<head[^>]*>)/i, `$1\n    ${scriptTag}`)

        // Add data-root-path to root div if not already present
        if (!/<div[^>]*id="root"[^>]*data-root-path=/i.test(modifiedHtml)) {
            modifiedHtml = modifiedHtml.replace(
                /(<div[^>]*id="root")/i,
                `$1 data-root-path="${escapeHtmlAttribute(rootPath)}"`
            )
        }

        return modifiedHtml
    } catch (error) {
        log.error("Failed to inject rootPath into HTML", { error })
        return html // Return original HTML on error
    }
}

/**
 * Normalizes URL by removing duplicate slashes (except in protocol)
 */
export function normalizeUrl(baseUrl: string, path?: string): string {
    if (!path) return baseUrl

    try {
        // Normalize path - remove leading extra slashes but keep one
        const normalizedPath = path.replace(/^\/+/, "/")
        const url = new URL(normalizedPath, baseUrl).toString()
        // Replace multiple slashes with single slash, but preserve protocol://
        return url.replace(/([^:]\/)\/+/g, "$1")
    } catch (error) {
        log.error("Failed to normalize URL", { error })
        return baseUrl
    }
}

/**
 * Content Security Policy header value for serving HTML
 */
export const HTML_CSP_HEADER =
    "default-src 'self'; " +
    "script-src 'self' 'wasm-unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "media-src 'self' data:; " +
    "connect-src 'self' data:"
