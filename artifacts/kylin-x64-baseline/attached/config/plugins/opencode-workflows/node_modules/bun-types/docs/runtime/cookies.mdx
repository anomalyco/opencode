---
title: Cookies
description: Use Bun's native APIs for working with HTTP cookies
---

Bun provides native APIs for working with HTTP cookies through `Bun.Cookie` and `Bun.CookieMap`. These APIs offer fast methods for parsing, generating, and manipulating cookies in HTTP requests and responses.

## CookieMap class

`Bun.CookieMap` provides a Map-like interface for working with collections of cookies. It implements the `Iterable` interface, allowing you to use it with `for...of` loops and other iteration methods.

```ts title="cookies.ts" icon="/icons/typescript.svg"
// Empty cookie map
const cookies = new Bun.CookieMap();

// From a cookie string
const cookies1 = new Bun.CookieMap("name=value; foo=bar");

// From an object
const cookies2 = new Bun.CookieMap({
  session: "abc123",
  theme: "dark",
});

// From an array of name/value pairs
const cookies3 = new Bun.CookieMap([
  ["session", "abc123"],
  ["theme", "dark"],
]);
```

### In HTTP servers

In Bun's HTTP server, the `cookies` property on the request object (in `routes`) is an instance of `CookieMap`:

```ts title="server.ts" icon="/icons/typescript.svg"
const server = Bun.serve({
  routes: {
    "/": req => {
      // Access request cookies
      const cookies = req.cookies;

      // Get a specific cookie
      const sessionCookie = cookies.get("session");
      if (sessionCookie != null) {
        console.log(sessionCookie);
      }

      // Check if a cookie exists
      if (cookies.has("theme")) {
        // ...
      }

      // Set a cookie, it will be automatically applied to the response
      cookies.set("visited", "true");

      return new Response("Hello");
    },
  },
});

console.log("Server listening at: " + server.url);
```

### Methods

#### `get(name: string): string | null`

Retrieves a cookie by name. Returns `null` if the cookie doesn't exist.

```ts title="get-cookie.ts" icon="/icons/typescript.svg"
// Get by name
const cookie = cookies.get("session");

if (cookie != null) {
  console.log(cookie);
}
```

#### `has(name: string): boolean`

Checks if a cookie with the given name exists.

```ts title="has-cookie.ts" icon="/icons/typescript.svg"
// Check if cookie exists
if (cookies.has("session")) {
  // Cookie exists
}
```

#### `set(name: string, value: string): void`

#### `set(options: CookieInit): void`

#### `set(cookie: Cookie): void`

Adds or updates a cookie in the map. Cookies default to `{ path: "/", sameSite: "lax" }`.

```ts title="set-cookie.ts" icon="/icons/typescript.svg"
// Set by name and value
cookies.set("session", "abc123");

// Set using options object
cookies.set({
  name: "theme",
  value: "dark",
  maxAge: 3600,
  secure: true,
});

// Set using Cookie instance
const cookie = new Bun.Cookie("visited", "true");
cookies.set(cookie);
```

#### `delete(name: string): void`

#### `delete(options: CookieStoreDeleteOptions): void`

Removes a cookie from the map. When applied to a Response, this adds a cookie with an empty string value and an expiry date in the past. A cookie will only delete successfully on the browser if the domain and path is the same as it was when the cookie was created.

```ts title="delete-cookie.ts" icon="/icons/typescript.svg"
// Delete by name using default domain and path.
cookies.delete("session");

// Delete with domain/path options.
cookies.delete({
  name: "session",
  domain: "example.com",
  path: "/admin",
});
```

#### `toJSON(): Record<string, string>`

Converts the cookie map to a serializable format.

```ts title="cookie-to-json.ts" icon="/icons/typescript.svg"
const json = cookies.toJSON();
```

#### `toSetCookieHeaders(): string[]`

Returns an array of values for Set-Cookie headers that can be used to apply all cookie changes.

When using `Bun.serve()`, you don't need to call this method explicitly. Any changes made to the `req.cookies` map are automatically applied to the response headers. This method is primarily useful when working with other HTTP server implementations.

```js title="node-server.js" icon="file-code"
import { createServer } from "node:http";
import { CookieMap } from "bun";

const server = createServer((req, res) => {
  const cookieHeader = req.headers.cookie || "";
  const cookies = new CookieMap(cookieHeader);

  cookies.set("view-count", Number(cookies.get("view-count") || "0") + 1);
  cookies.delete("session");

  res.writeHead(200, {
    "Content-Type": "text/plain",
    "Set-Cookie": cookies.toSetCookieHeaders(),
  });
  res.end(`Found ${cookies.size} cookies`);
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000/");
});
```

### Iteration

`CookieMap` provides several methods for iteration:

```ts title="iterate-cookies.ts" icon="/icons/typescript.svg"
// Iterate over [name, cookie] entries
for (const [name, value] of cookies) {
  console.log(`${name}: ${value}`);
}

// Using entries()
for (const [name, value] of cookies.entries()) {
  console.log(`${name}: ${value}`);
}

// Using keys()
for (const name of cookies.keys()) {
  console.log(name);
}

// Using values()
for (const value of cookies.values()) {
  console.log(value);
}

// Using forEach
cookies.forEach((value, name) => {
  console.log(`${name}: ${value}`);
});
```

### Properties

#### `size: number`

Returns the number of cookies in the map.

```ts title="cookie-size.ts" icon="/icons/typescript.svg"
console.log(cookies.size); // Number of cookies
```

## Cookie class

`Bun.Cookie` represents an HTTP cookie with its name, value, and attributes.

```ts title="cookie-class.ts" icon="/icons/typescript.svg"
import { Cookie } from "bun";

// Create a basic cookie
const cookie = new Bun.Cookie("name", "value");

// Create a cookie with options
const secureSessionCookie = new Bun.Cookie("session", "abc123", {
  domain: "example.com",
  path: "/admin",
  expires: new Date(Date.now() + 86400000), // 1 day
  httpOnly: true,
  secure: true,
  sameSite: "strict",
});

// Parse from a cookie string
const parsedCookie = new Bun.Cookie("name=value; Path=/; HttpOnly");

// Create from an options object
const objCookie = new Bun.Cookie({
  name: "theme",
  value: "dark",
  maxAge: 3600,
  secure: true,
});
```

### Constructors

```ts title="constructors.ts" icon="/icons/typescript.svg"
// Basic constructor with name/value
new Bun.Cookie(name: string, value: string);

// Constructor with name, value, and options
new Bun.Cookie(name: string, value: string, options: CookieInit);

// Constructor from cookie string
new Bun.Cookie(cookieString: string);

// Constructor from cookie object
new Bun.Cookie(options: CookieInit);
```

### Properties

```ts title="cookie-properties.ts" icon="/icons/typescript.svg"
cookie.name; // string - Cookie name
cookie.value; // string - Cookie value
cookie.domain; // string | null - Domain scope (null if not specified)
cookie.path; // string - URL path scope (defaults to "/")
cookie.expires; // number | undefined - Expiration timestamp (ms since epoch)
cookie.secure; // boolean - Require HTTPS
cookie.sameSite; // "strict" | "lax" | "none" - SameSite setting
cookie.partitioned; // boolean - Whether the cookie is partitioned (CHIPS)
cookie.maxAge; // number | undefined - Max age in seconds
cookie.httpOnly; // boolean - Accessible only via HTTP (not JavaScript)
```

### Methods

#### `isExpired(): boolean`

Checks if the cookie has expired.

```ts title="is-expired.ts" icon="/icons/typescript.svg"
// Expired cookie (Date in the past)
const expiredCookie = new Bun.Cookie("name", "value", {
  expires: new Date(Date.now() - 1000),
});
console.log(expiredCookie.isExpired()); // true

// Valid cookie (Using maxAge instead of expires)
const validCookie = new Bun.Cookie("name", "value", {
  maxAge: 3600, // 1 hour in seconds
});
console.log(validCookie.isExpired()); // false

// Session cookie (no expiration)
const sessionCookie = new Bun.Cookie("name", "value");
console.log(sessionCookie.isExpired()); // false
```

#### `serialize(): string`

#### `toString(): string`

Returns a string representation of the cookie suitable for a `Set-Cookie` header.

```ts title="serialize-cookie.ts" icon="/icons/typescript.svg"
const cookie = new Bun.Cookie("session", "abc123", {
  domain: "example.com",
  path: "/admin",
  expires: new Date(Date.now() + 86400000),
  secure: true,
  httpOnly: true,
  sameSite: "strict",
});

console.log(cookie.serialize());
// => "session=abc123; Domain=example.com; Path=/admin; Expires=Sun, 19 Mar 2025 15:03:26 GMT; Secure; HttpOnly; SameSite=strict"
console.log(cookie.toString());
// => "session=abc123; Domain=example.com; Path=/admin; Expires=Sun, 19 Mar 2025 15:03:26 GMT; Secure; HttpOnly; SameSite=strict"
```

#### `toJSON(): CookieInit`

Converts the cookie to a plain object suitable for JSON serialization.

```ts title="cookie-json.ts" icon="/icons/typescript.svg"
const cookie = new Bun.Cookie("session", "abc123", {
  secure: true,
  httpOnly: true,
});

const json = cookie.toJSON();
// => {
//   name: "session",
//   value: "abc123",
//   path: "/",
//   secure: true,
//   httpOnly: true,
//   sameSite: "lax",
//   partitioned: false
// }

// Works with JSON.stringify
const jsonString = JSON.stringify(cookie);
```

### Static methods

#### `Cookie.parse(cookieString: string): Cookie`

Parses a cookie string into a `Cookie` instance.

```ts title="parse-cookie.ts" icon="/icons/typescript.svg"
const cookie = Bun.Cookie.parse("name=value; Path=/; Secure; SameSite=Lax");

console.log(cookie.name); // "name"
console.log(cookie.value); // "value"
console.log(cookie.path); // "/"
console.log(cookie.secure); // true
console.log(cookie.sameSite); // "lax"
```

#### `Cookie.from(name: string, value: string, options?: CookieInit): Cookie`

Factory method to create a cookie.

```ts title="cookie-from.ts" icon="/icons/typescript.svg"
const cookie = Bun.Cookie.from("session", "abc123", {
  httpOnly: true,
  secure: true,
  maxAge: 3600,
});
```

## Types

```ts title="types.ts" icon="/icons/typescript.svg"
interface CookieInit {
  name?: string;
  value?: string;
  domain?: string;
  /** Defaults to '/'. To allow the browser to set the path, use an empty string. */
  path?: string;
  expires?: number | Date | string;
  secure?: boolean;
  /** Defaults to `lax`. */
  sameSite?: CookieSameSite;
  httpOnly?: boolean;
  partitioned?: boolean;
  maxAge?: number;
}

interface CookieStoreDeleteOptions {
  name: string;
  domain?: string | null;
  path?: string;
}

interface CookieStoreGetOptions {
  name?: string;
  url?: string;
}

type CookieSameSite = "strict" | "lax" | "none";

class Cookie {
  constructor(name: string, value: string, options?: CookieInit);
  constructor(cookieString: string);
  constructor(cookieObject?: CookieInit);

  readonly name: string;
  value: string;
  domain?: string;
  path: string;
  expires?: Date;
  secure: boolean;
  sameSite: CookieSameSite;
  partitioned: boolean;
  maxAge?: number;
  httpOnly: boolean;

  isExpired(): boolean;

  serialize(): string;
  toString(): string;
  toJSON(): CookieInit;

  static parse(cookieString: string): Cookie;
  static from(name: string, value: string, options?: CookieInit): Cookie;
}

class CookieMap implements Iterable<[string, string]> {
  constructor(init?: string[][] | Record<string, string> | string);

  get(name: string): string | null;

  toSetCookieHeaders(): string[];

  has(name: string): boolean;
  set(name: string, value: string, options?: CookieInit): void;
  set(options: CookieInit): void;
  delete(name: string): void;
  delete(options: CookieStoreDeleteOptions): void;
  delete(name: string, options: Omit<CookieStoreDeleteOptions, "name">): void;
  toJSON(): Record<string, string>;

  readonly size: number;

  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  forEach(callback: (value: string, key: string, map: CookieMap) => void): void;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
```
