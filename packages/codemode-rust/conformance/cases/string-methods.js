const s = "  Hello, World  "
const t = s.trim()
return [t, t.length, t.toUpperCase(), t.toLowerCase(), t.slice(0, 5), t.slice(-5), t.substring(7, 12), t.indexOf("o"), t.lastIndexOf("o"), t.includes("World"), t.startsWith("Hell"), t.endsWith("!"), t.split(", "), "a,b,,c".split(","), "abc".split(""), "7".padStart(3, "0"), "x".padEnd(3, "."), "ab".repeat(3), t.replace("o", "0"), t.replaceAll("o", "0"), t.charAt(1), t.charCodeAt(0), t.at(-1), s.trimStart(), s.trimEnd()]
