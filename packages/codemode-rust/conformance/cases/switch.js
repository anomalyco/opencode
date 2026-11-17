const f = (x) => {
  const out = []
  switch (x) {
    case 1: out.push("one")
    case 2: out.push("two"); break
    case "3": out.push("string three"); break
    default: out.push("default")
    case 4: out.push("four")
  }
  return out.join(",")
}
return [f(1), f(2), f(3), f("3"), f(4), f(9)]
