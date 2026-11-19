const out = []
const s = "https://ex.test/a b?q=1&r=é€😀#h;/,+"
out.push(encodeURI(s), encodeURIComponent(s), decodeURI(encodeURI(s)), decodeURIComponent(encodeURIComponent(s)), decodeURI("%3B%2F%3f%41%23"), decodeURIComponent("%3B%2F%3f%41%23"), encodeURIComponent("-_.!~*'()"), encodeURI(1), decodeURI(undefined), encodeURIComponent({ toString() { return "a b" } }))
for (const f of [() => decodeURIComponent("%"), () => decodeURI("%E0%A4%A"), () => decodeURI("%C0%80"), () => decodeURI("%ED%A0%80"), () => decodeURI("%F8%80%80%80"), () => decodeURIComponent("%zz"), () => decodeURIComponent("%E2%82")]) { try { out.push(f()) } catch (e) { out.push([e.name, e.message, e instanceof URIError]) } }
out.push(["a b", "c/d"].map(encodeURIComponent))
return out
