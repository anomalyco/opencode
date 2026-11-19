const words = ["apple", "Apple", "APPLE", "äpple", "resume", "résumé", "Resume", "co-op", "coop", "co op", "a1", "a10", "a2", "file10", "file9", "", "Z", "z", "_x", "-x", "x", "naïve", "naive", "straße", "strasse", "Ab", "aB", "ab", "AB", "é", "é", "Å", "Å", "中", "日", "😀", "ı", "İ", "ß", "ss"]
const sorted = [...words].sort((a, b) => a.localeCompare(b))
const signs = words.map((a) => words.map((b) => Math.sign(a.localeCompare(b)) + 1).join("")).join("/")
return { sorted, signs, nfd: "\u00e9".localeCompare("e\u0301"), empty: "".localeCompare(""), undef: "undefined".localeCompare() }
