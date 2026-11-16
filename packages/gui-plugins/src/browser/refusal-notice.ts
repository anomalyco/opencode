import { destinationOrigin, type Policy } from "./policy"

/** A refused Chromium navigation is an absolute destination, never text to turn into a web search or host name. */
export function navigationNotice(url: string, policy: Policy) {
  if (URL.canParse(url) && /^https?:$/i.test(new URL(url).protocol) && !destinationOrigin(url))
    return { reason: "browser.address.credentials" } as const

  // An address supplied by a document may contain credentials, misleading direction controls or a whole data URL.
  // Only display a bounded, plain target for the named external protocols. Never use this display value to open it.
  if (
    url.length <= 2048 &&
    !/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(url) &&
    URL.canParse(url)
  ) {
    const target = new URL(url)

    if (!target.username && !target.password && /^(?:mailto|tel|sms|vscode|slack|zoommtg):$/.test(target.protocol))
      return { reason: "external", target: url } as const
  }

  return { reason: policy.fileRoots?.length ? "browser.address.workspace" : "browser.address.web" } as const
}
