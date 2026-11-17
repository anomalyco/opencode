const b = require("buffer")
const { URL: U } = await import("node:url")
const u = require("util")
return [b.Buffer.from("ab").length, new U("https://a.test/x").pathname, new u.TextEncoder().encode("é").length, "a-b".split(/-/), [..."x1y2".matchAll(/\d/g)].length]
