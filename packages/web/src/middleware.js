export function onRequest(context, next) {
  const url = new URL(context.request.url)

  // Handle favicon requests with base path
  if (url.pathname === "/favicon.ico") {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${url.origin}/docs/favicon.ico`,
      },
    })
  }
  if (url.pathname === "/favicon.svg") {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${url.origin}/docs/favicon.svg`,
      },
    })
  }
  if (url.pathname === "/apple-touch-icon.png") {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${url.origin}/docs/apple-touch-icon.png`,
      },
    })
  }

  // Continue with request
  return next()
}
