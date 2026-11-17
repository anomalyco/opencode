const H = "\ud83d", L = "\ude00", S = "\ud800"
const others = ["a", "Z", "1", " ", "中", "\ufffd", "\uffff", "\ue000", "\u0378", "\u{40000}", "\u{10000}", "\u{e0001}", "\u{30000}", "😀", "", "\u2fe0", "\ud7fc", "ゝ", "\u{1f9ff}", "\u{e01ef}", "\u{f0000}"]
const out = []
for (const s of [H, L, S, "\udfff", "a" + H]) out.push(others.map((o) => s.localeCompare(o)).join(","))
out.push([H.localeCompare(L), S.localeCompare(H), H.localeCompare(H), (H + "a").localeCompare(H + "b"), ("a" + H).localeCompare("a")].join(","))
out.push(...(() => { const H2 = "\ud83d", L2 = "\ude00"; return [("a" + H2).localeCompare("A" + L2), ("A" + H2).localeCompare("a" + L2), ("é" + H2).localeCompare("e" + L2), [L2, "b" + H2, "B" + L2, H2, "a", "\ue000", "\ufffd", "b" + L2].sort((x, y) => x.localeCompare(y)).map((x) => JSON.stringify(x)).join()] })())
return out
