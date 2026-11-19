// JSON.parse's errors carry its host runtime's message after the reference's own prefix.
const texts = ["a", "", "{", "[1,]", '{"a":}', "[1 2]", "tru", '"abc', "1e", "01", "{a:1}", "[1]x", "  ", "nul", '"\\x"', "-",
  '{"a" 1}', "[", '{"a":1,}', '"\t"', "1.", ".5", "[1,,2]", "{,}", '"\\u12"', "Infinity", "NaN", '{"a":1}}', "1 2", "/"]
return texts.map((t) => {
  try {
    return ["ok", JSON.parse(t)]
  } catch (e) {
    return [e.name, e.message]
  }
})
