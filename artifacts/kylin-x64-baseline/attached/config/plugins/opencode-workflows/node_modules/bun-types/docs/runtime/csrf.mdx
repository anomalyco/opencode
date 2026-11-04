---
title: CSRF Protection
description: Generate and verify CSRF tokens with Bun's built-in API
---

Bun provides a built-in API for generating and verifying [CSRF (Cross-Site Request Forgery)](https://owasp.org/www-community/attacks/csrf) tokens through `Bun.CSRF`. Tokens are signed with HMAC and include expiration timestamps to limit the token validity window.

```ts title="csrf.ts" icon="/icons/typescript.svg"
// Generate a token
const token = Bun.CSRF.generate("my-secret");

// Verify it
const isValid = Bun.CSRF.verify(token, { secret: "my-secret" });
console.log(isValid); // true
```

---

## `Bun.CSRF.generate()`

Generate a CSRF token. The token contains a cryptographic nonce, a timestamp, and an HMAC signature, encoded as a string.

```ts title="generate.ts" icon="/icons/typescript.svg"
const token = Bun.CSRF.generate("my-secret-key");
```

**Parameters:**

- `secret` (string, optional) — The secret key used to sign the token. If not provided, Bun generates a random in-memory default secret (unique per thread).
- `options` (object, optional):

| Option      | Type     | Default       | Description                                                                                            |
| ----------- | -------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `expiresIn` | `number` | `86400000`    | Milliseconds until the token expires. Defaults to 24 hours.                                            |
| `encoding`  | `string` | `"base64url"` | Token encoding format: `"base64"`, `"base64url"`, or `"hex"`.                                          |
| `algorithm` | `string` | `"sha256"`    | HMAC algorithm: `"sha256"`, `"sha384"`, `"sha512"`, `"sha512-256"`, `"blake2b256"`, or `"blake2b512"`. |

**Returns:** `string` — the encoded token.

```ts title="generate-options.ts" icon="/icons/typescript.svg"
// Token that expires in 1 hour, encoded as hex
const token = Bun.CSRF.generate("my-secret", {
  expiresIn: 60 * 60 * 1000,
  encoding: "hex",
});

// Using a different algorithm
const token2 = Bun.CSRF.generate("my-secret", {
  algorithm: "sha512",
});
```

---

## `Bun.CSRF.verify()`

Verify a CSRF token. Returns `true` if the token is valid and has not expired, `false` otherwise.

```ts title="verify.ts" icon="/icons/typescript.svg"
const isValid = Bun.CSRF.verify(token, { secret: "my-secret-key" });
```

**Parameters:**

- `token` (string, required) — The token to verify.
- `options` (object, optional):

| Option      | Type     | Default       | Description                                                                                          |
| ----------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `secret`    | `string` | (auto)        | The secret used to sign the token. If not provided, uses the same in-memory default as `generate()`. |
| `maxAge`    | `number` | `86400000`    | Maximum token age in milliseconds, independent of the token's own `expiresIn`.                       |
| `encoding`  | `string` | `"base64url"` | Must match the encoding used during `generate()`.                                                    |
| `algorithm` | `string` | `"sha256"`    | Must match the algorithm used during `generate()`.                                                   |

**Returns:** `boolean`

```ts title="verify-options.ts" icon="/icons/typescript.svg"
// Verify a hex-encoded token
const isValid = Bun.CSRF.verify(hexToken, {
  secret: "my-secret",
  encoding: "hex",
});

// Enforce a shorter max age than what the token was generated with
const isValid2 = Bun.CSRF.verify(token, {
  secret: "my-secret",
  maxAge: 60 * 1000, // reject tokens older than 1 minute
});
```

---

## Using with `Bun.serve()`

A typical pattern is to generate a token when rendering a form, embed it in a hidden field, and verify it when the form is submitted.

```ts title="server.ts" icon="/icons/typescript.svg"
const SECRET = process.env.CSRF_SECRET || "my-secret";

const server = Bun.serve({
  routes: {
    "/form": () => {
      const token = Bun.CSRF.generate(SECRET);

      return new Response(
        `<form method="POST" action="/submit">
          <input type="hidden" name="_csrf" value="${token}" />
          <input type="text" name="message" />
          <button type="submit">Send</button>
        </form>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },

    "/submit": {
      POST: async req => {
        const formData = await req.formData();
        const csrfToken = formData.get("_csrf");

        if (typeof csrfToken !== "string" || !Bun.CSRF.verify(csrfToken, { secret: SECRET })) {
          return new Response("Invalid CSRF token", { status: 403 });
        }

        return new Response("OK");
      },
    },
  },
});

console.log(`Listening on ${server.url}`);
```

---

## Default secret

If you omit the `secret` parameter in both `generate()` and `verify()`, Bun uses a random secret generated once per thread. This is convenient for single-thread applications but won't work across multiple servers, workers, or after a restart.

```ts title="default-secret.ts" icon="/icons/typescript.svg"
// Both calls use the same per-thread default secret within this runtime context.
const token = Bun.CSRF.generate();
const isValid = Bun.CSRF.verify(token); // true
```

For production use, always provide an explicit secret shared across your infrastructure.

---

## TypeScript

```ts title="types.ts" icon="/icons/typescript.svg"
type CSRFAlgorithm = "blake2b256" | "blake2b512" | "sha256" | "sha384" | "sha512" | "sha512-256";

interface CSRFGenerateOptions {
  expiresIn?: number;
  encoding?: "base64" | "base64url" | "hex";
  algorithm?: CSRFAlgorithm;
}

interface CSRFVerifyOptions {
  secret?: string;
  encoding?: "base64" | "base64url" | "hex";
  algorithm?: CSRFAlgorithm;
  maxAge?: number;
}

namespace Bun.CSRF {
  function generate(secret?: string, options?: CSRFGenerateOptions): string;
  function verify(token: string, options?: CSRFVerifyOptions): boolean;
}
```
