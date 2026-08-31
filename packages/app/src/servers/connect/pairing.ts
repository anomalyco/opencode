import { Option, Schema } from "effect"
import ipaddr from "ipaddr.js"

const PairingInfo = Schema.Struct({
  urls: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  username: Schema.String,
  password: Schema.String.check(Schema.isMinLength(1)),
})
export type PairingInfo = typeof PairingInfo.Type

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(PairingInfo))
const tailnet = ipaddr.IPv6.parseCIDR("fd7a:115c:a1e0::/48")
const order = { public: 0, tailnet: 1, private: 2, linkLocal: 3, loopback: 4, unusable: 5 }

export function readPairing(value: string) {
  const result = decode(value)
  if (Option.isNone(result)) return
  if (
    !result.value.urls.every((value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    })
  )
    return
  return {
    ...result.value,
    urls: result.value.urls.toSorted((a, b) => {
      const left = new URL(a)
      const right = new URL(b)
      return (
        order[pairingAddressScope(left)] - order[pairingAddressScope(right)] ||
        Number(left.protocol !== "https:") - Number(right.protocol !== "https:")
      )
    }),
  }
}

export function pairingAddressScope(url: URL) {
  const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname
  if (!ipaddr.isValid(hostname)) {
    const labels = hostname.split(".").filter(Boolean)
    if (labels.at(-1) === "localhost") return "loopback"
    if (labels.slice(-2).join(".") === "ts.net") return "tailnet"
    if (labels.length === 1 || ["local", "lan", "internal"].includes(labels.at(-1) ?? "")) return "private"
    return "public"
  }

  const address = ipaddr.process(hostname)
  if (address instanceof ipaddr.IPv6 && address.match(tailnet)) return "tailnet"
  switch (address.range()) {
    case "unicast":
      return "public"
    case "carrierGradeNat":
      return "tailnet"
    case "private":
    case "uniqueLocal":
      return "private"
    case "linkLocal":
      return "linkLocal"
    case "loopback":
      return "loopback"
    default:
      return "unusable"
  }
}
