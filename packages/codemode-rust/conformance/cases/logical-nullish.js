let a = null, b = 0, c = 1
a ??= "set"; b ||= "falsy"; c &&= "truthy"
const o = { p: { q: 1 } }
return [a, b, c, 0 || "x", 0 ?? "x", "" && "y", o?.p?.q, o.missing?.q, o.missing?.(), null ?? undefined ?? 3, !0, !!""]
