---
title: Cookies
description: Work with cookies in HTTP requests and responses using Bun's built-in Cookie API.
---

Bun provides a built-in API for working with cookies in HTTP requests and responses. The `BunRequest` object includes a `cookies` property that provides a `CookieMap` for accessing and manipulating cookies. When using `routes`, `Bun.serve()` automatically tracks `request.cookies.set` and applies them to the response.

## Reading cookies

Read cookies from incoming requests using the `cookies` property on the `BunRequest` object:

```ts
Bun.serve({
  routes: {
    "/profile": req => {
      // Access cookies from the request
      const userId = req.cookies.get("user_id");
      const theme = req.cookies.get("theme") || "light";

      return Response.json({
        userId,
        theme,
        message: "Profile page",
      });
    },
  },
});
```

## Setting cookies

To set cookies, use the `set` method on the `CookieMap` from the `BunRequest` object.

```ts
Bun.serve({
  routes: {
    "/login": req => {
      const cookies = req.cookies;

      // Set a cookie with various options
      cookies.set("user_id", "12345", {
        maxAge: 60 * 60 * 24 * 7, // 1 week
        httpOnly: true,
        secure: true,
        path: "/",
      });

      // Add a theme preference cookie
      cookies.set("theme", "dark");

      // Modified cookies from the request are automatically applied to the response
      return new Response("Login successful");
    },
  },
});
```

`Bun.serve()` automatically tracks modified cookies from the request and applies them to the response.

## Deleting cookies

To delete a cookie, use the `delete` method on the `request.cookies` (`CookieMap`) object:

```ts
Bun.serve({
  routes: {
    "/logout": req => {
      // Delete the user_id cookie
      req.cookies.delete("user_id", {
        path: "/",
      });

      return new Response("Logged out successfully");
    },
  },
});
```

Deleted cookies become a `Set-Cookie` header on the response with the `maxAge` set to `0` and an empty `value`.
