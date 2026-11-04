---
title: DNS
description: Use Bun's DNS module to resolve DNS records
---

Bun implements it's own `dns` module, and the `node:dns` module.

```ts
import * as dns from "node:dns";

const addrs = await dns.promises.resolve4("bun.com", { ttl: true });
console.log(addrs);
// => [{ address: "172.67.161.226", family: 4, ttl: 0 }, ...]
```

```ts
import { dns } from "bun";

dns.prefetch("bun.com", 443);
```

---

## DNS caching in Bun

Bun supports DNS caching. This cache makes repeated connections to the same hosts faster.

At the time of writing, we cache up to 255 entries for a maximum of 30 seconds (each). If any connections to a host fail, we remove the entry from the cache. When multiple connections are made to the same host simultaneously, DNS lookups are deduplicated to avoid making multiple requests for the same host.

This cache is automatically used by:

- `bun install`
- `fetch()`
- `node:http` (client)
- `Bun.connect`
- `node:net`
- `node:tls`

### When should I prefetch a DNS entry?

Web browsers expose [`<link rel="dns-prefetch">`](https://developer.mozilla.org/en-US/docs/Web/Performance/dns-prefetch) to allow developers to prefetch DNS entries. This is useful when you know you'll need to connect to a host in the near future and want to avoid the initial DNS lookup.

In Bun, you can use the `dns.prefetch` API to achieve the same effect.

```ts
import { dns } from "bun";

dns.prefetch("my.database-host.com", 5432);
```

An example where you might want to use this is a database driver. When your application first starts up, you can prefetch the DNS entry for the database host so that by the time it finishes loading everything, the DNS query to resolve the database host may already be completed.

### `dns.prefetch`

<Warning>This API is experimental and may change in the future.</Warning>

To prefetch a DNS entry, you can use the `dns.prefetch` API. This API is useful when you know you'll need to connect to a host soon and want to avoid the initial DNS lookup.

```ts
dns.prefetch(hostname: string, port: number): void;
```

Here's an example:

```ts
import { dns } from "bun";

dns.prefetch("bun.com", 443);
//
// ... sometime later ...
await fetch("https://bun.com");
```

### `dns.getCacheStats()`

<Warning>This API is experimental and may change in the future.</Warning>

To get the current cache stats, you can use the `dns.getCacheStats` API. This API returns an object with the following properties:

```ts
{
  cacheHitsCompleted: number; // Cache hits completed
  cacheHitsInflight: number; // Cache hits in flight
  cacheMisses: number; // Cache misses
  size: number; // Number of items in the DNS cache
  errors: number; // Number of times a connection failed
  totalCount: number; // Number of times a connection was requested at all (including cache hits and misses)
}
```

Example:

```ts
import { dns } from "bun";

const stats = dns.getCacheStats();
console.log(stats);
// => { cacheHitsCompleted: 0, cacheHitsInflight: 0, cacheMisses: 0, size: 0, errors: 0, totalCount: 0 }
```

### Configuring DNS cache TTL

Bun defaults to 30 seconds for the TTL of DNS cache entries. To change this, you can set the environment variable `$BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS`. For example, to set the TTL to 5 seconds:

```sh
BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=5 bun run my-script.ts
```

#### Why is 30 seconds the default?

Unfortunately, the system API underneath (`getaddrinfo`) does not provide a way to get the TTL of a DNS entry. This means we have to pick a number arbitrarily. We chose 30 seconds because it's long enough to see the benefits of caching, and short enough to be unlikely to cause issues if a DNS entry changes. [Amazon Web Services recommends 5 seconds](https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/jvm-ttl-dns.html) for the Java Virtual Machine, however the JVM defaults to cache indefinitely.
