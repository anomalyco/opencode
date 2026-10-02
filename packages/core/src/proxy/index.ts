export * as Proxy from "./index"

// Chosen seam (Task 1): `FetchHttpClient.Fetch` is a `Context.Reference<typeof fetch>`
// that `FetchHttpClient.layer` reads to build the HttpClient. Provide it with the
// proxy-aware fetch:
//
//   FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, proxyFetch)))
//
// Verified against effect@4.0.0-beta.83 (`dist/unstable/http/FetchHttpClient.d.ts`)
// and the probe in `test/proxy/seam.test.ts`.
