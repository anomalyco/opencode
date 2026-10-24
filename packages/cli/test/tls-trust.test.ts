import { describe, expect, test } from "bun:test"
import { X509Certificate } from "node:crypto"
import https from "node:https"
import tls from "node:tls"
import { TlsTrust } from "../src/tls-trust"

// Public root certificates from https://emudhra.we-have-a-problem.com/roots.json
const EMSIGN_ECC_ROOT_CA_G3_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIICTjCCAdOgAwIBAgIKPPYHqWhwDtqLhDAKBggqhkjOPQQDAzBrMQswCQYDVQQG",
  "EwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNo",
  "bm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0g",
  "RzMwHhcNMTgwMjE4MTgzMDAwWhcNNDMwMjE4MTgzMDAwWjBrMQswCQYDVQQGEwJJ",
  "TjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBUZWNobm9s",
  "b2dpZXMgTGltaXRlZDEgMB4GA1UEAxMXZW1TaWduIEVDQyBSb290IENBIC0gRzMw",
  "djAQBgcqhkjOPQIBBgUrgQQAIgNiAAQjpQy4LRL1KPOxst3iAhKAnjlfSU2fySU0",
  "WXTsuwYc58Byr+iuL+FBVIcUqEqy6HyC5ltqtdyzdc6LBtCGI79G1Y4PPwT01xyS",
  "fvalY8L1X44uT6EYGQIrMgqCZH0Wk9GjQjBAMB0GA1UdDgQWBBR8XQKEE9TMipuB",
  "zhccLikenEhjQjAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAKBggq",
  "hkjOPQQDAwNpADBmAjEAvvNhzwIQHWSVB7gYboiFBS+DCBeQyh+KTOgNG3qxrdWB",
  "CUfvO6wIBHxcmbHtRwfSAjEAnbpV/KlK6O3t5nYBQnvI+GDZjVGLVTv7jHvrZQnD",
  "+JbNR6iC8hZVdyR+EhCVBCyj",
  "-----END CERTIFICATE-----",
].join("\n")

const AAA_CERTIFICATE_SERVICES_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIEMjCCAxqgAwIBAgIBATANBgkqhkiG9w0BAQUFADB7MQswCQYDVQQGEwJHQjEb",
  "MBkGA1UECAwSR3JlYXRlciBNYW5jaGVzdGVyMRAwDgYDVQQHDAdTYWxmb3JkMRow",
  "GAYDVQQKDBFDb21vZG8gQ0EgTGltaXRlZDEhMB8GA1UEAwwYQUFBIENlcnRpZmlj",
  "YXRlIFNlcnZpY2VzMB4XDTA0MDEwMTAwMDAwMFoXDTI4MTIzMTIzNTk1OVowezEL",
  "MAkGA1UEBhMCR0IxGzAZBgNVBAgMEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4GA1UE",
  "BwwHU2FsZm9yZDEaMBgGA1UECgwRQ29tb2RvIENBIExpbWl0ZWQxITAfBgNVBAMM",
  "GEFBQSBDZXJ0aWZpY2F0ZSBTZXJ2aWNlczCCASIwDQYJKoZIhvcNAQEBBQADggEP",
  "ADCCAQoCggEBAL5AnfRu4ep2hxxNRUSOvkbIgwadwSr+GB+O5AL686tdUIoWMQua",
  "BtDFcCLNSS1UY8y2bmhGC1Pqy0wkwLxyTurxFa70VJoSCsN6sjNg4tqJVfMiWPPe",
  "3M/vg4aijJRPn2jymJBGhCfHdr/jzDUsi14HZGWCwEiwqJH5YZ92IFCokcdmtet4",
  "YgNW8IoaE+oxox6gmf049vYnMlhvB/VruPsUK6+3qszWY19zjNoFmag4qMsXeDZR",
  "rOme9Hg6jc8P2ULimAyrL58OAd7vn5lJ8S3frHRNG5i1R8XlKdH5kBjHYpy+g8cm",
  "ez6KJcfA3Z3mNWgQIJ2P2N7Sw4ScDV7oL8kCAwEAAaOBwDCBvTAdBgNVHQ4EFgQU",
  "oBEKIz6W8Qfs4q8p74Klf9AwpLQwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQF",
  "MAMBAf8wewYDVR0fBHQwcjA4oDagNIYyaHR0cDovL2NybC5jb21vZG9jYS5jb20v",
  "QUFBQ2VydGlmaWNhdGVTZXJ2aWNlcy5jcmwwNqA0oDKGMGh0dHA6Ly9jcmwuY29t",
  "b2RvLm5ldC9BQUFDZXJ0aWZpY2F0ZVNlcnZpY2VzLmNybDANBgkqhkiG9w0BAQUF",
  "AAOCAQEACFb8AvCb6P+k+tZ7xkSAzk/ExfYAWMymtrwUSWgEdujm7l3sAg9g1o1Q",
  "GE8mTgHj5rCl7r+8dFRBv/38ErjHT1r0iWAFf2C3BUrz9vHCv8S5dIa2LX1rzNLz",
  "Rt0vxuBqw8M0Ayx9lt1awg6nCpnBBYurDC/zXDrPbDdVCYfeU0BsWO/8tqtlbgT2",
  "G9w84FoVxp7Z8VlIMCFlA2zs6SFz7JsDoeA3raAVGI/6ugLOpyypEBMs1OUIJqsi",
  "l2D4kF501KKaU73yqWjgom7C12yxow+ev+to51byrvLjKzg6CYG1a4XXvi3tPxq3",
  "smPi9WIsgtRqAEFQ8TmDn5XpNpaYbg==",
  "-----END CERTIFICATE-----",
].join("\n")

const EMSIGN_ROOT_TLS_CA_G3_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIICKTCCAa+gAwIBAgIQDnYGcvFDRZ/I/gqwvAXjlDAKBggqhkjOPQQDAzBWMQsw",
  "CQYDVQQGEwJJTjElMCMGA1UECgwcZU11ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRl",
  "ZDEgMB4GA1UEAwwXZW1TaWduIFJvb3QgVExTIENBIC0gRzMwHhcNMjQwMjA4MDgx",
  "OTMyWhcNNDkwMjA3MDgxOTMyWjBWMQswCQYDVQQGEwJJTjElMCMGA1UECgwcZU11",
  "ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAwwXZW1TaWduIFJvb3Qg",
  "VExTIENBIC0gRzMwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAARfD9w/q1cWxL6D9bMG",
  "H6CQ4u+gAV6GN9s+PwQx9Bl4hC+0iU8QOk8mWO/RwXQy10DCSxT8vSIJClHKp+Ao",
  "4qJKdYeV0SwZ7LMQziyLfxIUOY6Grja/sQFwLKYf8EdDXAyjQjBAMB0GA1UdDgQW",
  "BBThOqshfPHjTVSu1HK3/YtZQiCQVDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/",
  "BAUwAwEB/zAKBggqhkjOPQQDAwNoADBlAjBhCFTkly7Yl7+s4hiw+k6ZJTXT2AiI",
  "rvmsmfqPr5E7ecwXb6kXA5LTFd6rjwTuV3sCMQC9w6ZSbVq1mveMO6dKFziOzClT",
  "KCT2RFT6yXtq6nzgRICgBmiXbJAXsmZ8yAwjyWc=",
  "-----END CERTIFICATE-----",
].join("\n")

describe("TlsTrust", () => {
  test("filters distrusted eMudhra and AAA cross-sign roots and deduplicates by fingerprint", () => {
    const benign = tls
      .getCACertificates("bundled")
      .find((pem) => !TlsTrust.DISTRUSTED_CA_FINGERPRINTS.has(new X509Certificate(pem).fingerprint256))
    expect(benign).toBeDefined()
    const benignRewrapped = benign!.replace(/\n/g, "\r\n")

    const input = [
      benign!,
      benignRewrapped,
      EMSIGN_ECC_ROOT_CA_G3_PEM,
      AAA_CERTIFICATE_SERVICES_PEM,
      EMSIGN_ROOT_TLS_CA_G3_PEM,
    ]
    expect(TlsTrust.hasDistrustedCA(input)).toBe(true)

    const filtered = TlsTrust.filterCACertificates(input)
    expect(filtered).toEqual([benign!])
    expect(TlsTrust.hasDistrustedCA(filtered)).toBe(false)
  })

  test("wrapFetch injects tls.ca only when the caller did not supply one and preserves preconnect", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: FetchInitCapture | undefined }> = []
    const preconnectCalls: Array<string | URL> = []
    type FetchInitCapture = RequestInit & { tls?: { ca?: unknown; rejectUnauthorized?: boolean } }
    const base = Object.assign(
      (async (input: RequestInfo | URL, init?: FetchInitCapture) => {
        calls.push({ input, init })
        return new Response("ok")
      }) as typeof globalThis.fetch,
      {
        preconnect: (url: string | URL) => {
          preconnectCalls.push(url)
        },
      },
    )

    const ca = ["-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----"]
    const wrapped = TlsTrust.wrapFetch(base, ca)

    wrapped.preconnect("https://opencode.ai")
    expect(preconnectCalls).toEqual(["https://opencode.ai"])

    await wrapped("https://example.com/no-init")
    expect(calls[0]?.init?.tls).toEqual({ ca })

    await wrapped("https://example.com/with-init", { method: "POST" })
    expect(calls[1]?.init?.method).toBe("POST")
    expect(calls[1]?.init?.tls).toEqual({ ca })

    await wrapped("https://example.com/with-tls", { tls: { rejectUnauthorized: false } } as RequestInit)
    expect(calls[2]?.init?.tls).toEqual({ rejectUnauthorized: false, ca })

    const customCA = ["-----BEGIN CERTIFICATE-----\ncustom\n-----END CERTIFICATE-----"]
    await wrapped("https://example.com/custom-ca", { tls: { ca: customCA } } as RequestInit)
    expect(calls[3]?.init?.tls).toEqual({ ca: customCA })
  })

  test("wrapWebSocket injects tls.ca, normalizes string protocols, and preserves caller tls.ca", () => {
    const calls: Array<{ url: string | URL; options: unknown }> = []
    class FakeWebSocket {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      constructor(url: string | URL, options?: unknown) {
        calls.push({ url, options })
      }
    }

    const ca = ["-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----"]
    const Wrapped = TlsTrust.wrapWebSocket(FakeWebSocket as unknown as typeof globalThis.WebSocket, ca)

    expect(Wrapped.OPEN).toBe(1)
    expect(Wrapped.CLOSED).toBe(3)

    const ws1 = new Wrapped("wss://example.com/default")
    expect(ws1).toBeInstanceOf(FakeWebSocket)
    expect(calls[0]?.options).toEqual({ tls: { ca } })

    new Wrapped("wss://example.com/proto-str", "chat")
    expect(calls[1]?.options).toEqual({ protocols: ["chat"], tls: { ca } })

    new Wrapped("wss://example.com/proto-arr", ["chat", "superchat"])
    expect(calls[2]?.options).toEqual({ protocols: ["chat", "superchat"], tls: { ca } })

    const BagWebSocket = Wrapped as unknown as new (
      url: string,
      options: TlsTrust.WebSocketClientOptions,
    ) => globalThis.WebSocket

    new BagWebSocket("wss://example.com/bag", {
      headers: { authorization: "Bearer token" },
      protocols: "v1",
      tls: { rejectUnauthorized: false },
    })
    expect(calls[3]?.options).toEqual({
      headers: { authorization: "Bearer token" },
      protocols: ["v1"],
      tls: { rejectUnauthorized: false, ca },
    })

    const customCA = ["-----BEGIN CERTIFICATE-----\ncustom\n-----END CERTIFICATE-----"]
    new BagWebSocket("wss://example.com/custom-ca", {
      protocols: "v1",
      tls: { ca: customCA },
    })
    expect(calls[4]?.options).toEqual({
      protocols: ["v1"],
      tls: { ca: customCA },
    })
  })

  test.skipIf(Boolean(process.env.OPENCODE_TEST_LIVE_CA) === false)(
    "rejects compromised eMudhra chains and trusts standard and Sectigo endpoints",
    async () => {
      const certificates = [...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")])]
      const ca = TlsTrust.filterCACertificates(certificates)
      const safeFetch = TlsTrust.wrapFetch(globalThis.fetch, ca)

      await expect(safeFetch("https://dv-g3b-emudhra.we-have-a-problem.com/")).rejects.toThrow()
      await expect(safeFetch("https://dv-g3b-aaa-emudhra.we-have-a-problem.com/")).rejects.toThrow()

      await new Promise<void>((resolve, reject) => {
        https
          .get("https://dv-g3b-emudhra.we-have-a-problem.com/", { ca }, (res) => {
            res.resume()
            reject(new Error(`Unexpected status ${res.statusCode}`))
          })
          .on("error", () => resolve())
      })

      const healthy = await Promise.all([
        safeFetch("https://github.com/"),
        safeFetch("https://api.anthropic.com/"),
        safeFetch("https://models.dev/"),
        safeFetch("https://opencode.ai/"),
        safeFetch("https://registry.npmjs.org/"),
        safeFetch("https://zerossl.com/"),
      ])
      expect(healthy.every((res) => res.status > 0)).toBe(true)
    },
  )
})
