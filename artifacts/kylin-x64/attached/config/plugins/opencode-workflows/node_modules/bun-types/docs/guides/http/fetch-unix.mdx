---
title: fetch with unix domain sockets in Bun
sidebarTitle: Fetch with unix domain sockets
mode: center
---

In Bun, the `unix` option in `fetch()` lets you send HTTP requests over a [unix domain socket](https://en.wikipedia.org/wiki/Unix_domain_socket).

```ts fetch-unix.ts icon="/icons/typescript.svg"
const unix = "/var/run/docker.sock";

const response = await fetch("http://localhost/info", { unix });

const body = await response.json();
console.log(body); // { ... }
```

---

The `unix` option is a string that specifies the local file path to a unix domain socket. The `fetch()` function will use the socket to send the request to the server instead of using a TCP network connection. `https` is also supported by using the `https://` protocol in the URL instead of `http://`.

To send a `POST` request to an API endpoint over a unix domain socket:

```ts fetch-unix.ts icon="/icons/typescript.svg"
const response = await fetch("https://hostname/a/path", {
  unix: "/var/run/path/to/unix.sock",
  method: "POST",
  body: JSON.stringify({ message: "Hello from Bun!" }),
  headers: {
    "Content-Type": "application/json",
  },
});

const body = await response.json();
```
