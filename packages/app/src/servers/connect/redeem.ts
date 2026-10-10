import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { isMixedContent } from "./browser"
import { legacyPairingLink, pairingLink, redeemPairingLink, type Pairing } from "./pairing"

export type Redemption = { readonly pairing: Pairing } | { readonly error: string }

/** Redeems a pasted or scanned pairing link; resolves undefined when the value is not a pairing link at all. */
export type RedeemPairing = (value: string) => Promise<Redemption | undefined>

/** The code of the last link a form redeemed, and the token the server returned for it. */
type Redeemed = { code?: string; pairing?: Pairing }

// Pasted and scanned links share one redeem path so every surface explains a failure the same way.
// Each form keeps the last token it redeemed: the code is spent, so a retry after a failed connection check reuses it,
// whichever form the link takes (a scanned QR payload, or the link the scanner then shows).
export function useRedeemPairing(): RedeemPairing {
  const language = useLanguage()
  const platform = usePlatform()
  const last: Redeemed = {}

  return async (value) => {
    const link = pairingLink(value)

    if (!link) return legacyPairingLink(value) ? { error: language.t("server.connect.link.legacy") } : undefined

    // The same code again: reuse its token. An address the user edited since (another forwarded port, say) wins; the
    // token works on every address of the server.
    if (last.pairing && last.code === link.code) {
      const url = link.urls.includes(last.pairing.url) ? last.pairing.url : (link.urls[0] ?? last.pairing.url)

      return { pairing: { url, password: last.pairing.password } }
    }

    const result = await redeemPairingLink(link)

    if (result.type === "paired") {
      last.code = link.code
      last.pairing = result.pairing

      return { pairing: result.pairing }
    }

    if (result.type === "expired") return { error: language.t("server.connect.link.expired") }

    // A QR code can carry several addresses; the HTTPS page can reach none of them only when every one is plain HTTP.
    if (platform.platform === "web" && link.urls.every((url) => isMixedContent(location.href, url)))
      return { error: language.t("server.connect.mixedContent") }

    return { error: language.t("server.connect.link.unreachable", { url: link.urls.join(", ") }) }
  }
}
