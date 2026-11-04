---
title: Proxy HTTP requests using fetch()
sidebarTitle: Proxy HTTP requests using fetch()
mode: center
---

In Bun, `fetch` supports sending requests through an HTTP or HTTPS proxy. This is useful on corporate networks or when you need to ensure a request is sent through a specific IP address.

```ts proxy.ts icon="/icons/typescript.svg"
await fetch("https://example.com", {
  // The URL of the proxy server
  proxy: "https://username:password@proxy.example.com:8080",
});
```

---

The `proxy` option can be a URL string or an object with `url` and optional `headers`. The URL can include the username and password if the proxy requires authentication. It can be `http://` or `https://`.

---

## Custom proxy headers

To send custom headers to the proxy server (useful for proxy authentication tokens, custom routing, etc.), use the object format:

```ts proxy-headers.ts icon="/icons/typescript.svg"
await fetch("https://example.com", {
  proxy: {
    url: "https://proxy.example.com:8080",
    headers: {
      "Proxy-Authorization": "Bearer my-token",
      "X-Proxy-Region": "us-east-1",
    },
  },
});
```

The `headers` property accepts a plain object or a `Headers` instance. These headers are sent directly to the proxy server in `CONNECT` requests (for HTTPS targets) or in the proxy request (for HTTP targets).

If you provide a `Proxy-Authorization` header, it will override any credentials specified in the proxy URL.

---

## Environment variables

You can also set the `$HTTP_PROXY` or `$HTTPS_PROXY` environment variable to the proxy URL. This is useful when you want to use the same proxy for all requests.

```sh terminal icon="terminal"
HTTPS_PROXY=https://username:password@proxy.example.com:8080 bun run index.ts
```
