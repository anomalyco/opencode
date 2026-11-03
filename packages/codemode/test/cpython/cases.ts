// These are trusted differential fixtures, not arbitrary guest source. The reference runner uses real CPython.
export interface Case {
  group: string
  name: string
  code: string
  /** When set, the reference must raise this exception and Code Mode must fail without additional host effects. */
  raises?: "TypeError" | "ValueError"
}

export const cases: Case[] = [
  { group: "basics", name: "truth and division", code: "return [([] or 7), -7 // 3, -7 % 3, 3 < 4 < 5]" },
  {
    group: "basics",
    name: "captures and comprehensions",
    code: "def multiplier(n):\n    def apply(x):\n        return n*x\n    return apply\nreturn [multiplier(3)(i) for i in range(6) if i % 2]",
  },
  {
    group: "async",
    name: "lazy body and ordered gather",
    code: 'import asyncio\nasync def fetch(n):\n    print(n)\n    return await tools.echo({"value": n})\npending = [fetch(i) for i in range(3)]\nprint("ready")\nreturn await asyncio.gather(*pending)',
  },
  {
    group: "unpack",
    name: "parallel results",
    code: 'import asyncio\na, b = await asyncio.gather(tools.echo({"value": 2}), tools.echo({"value": 5}))\nreturn [b, a]',
  },
  {
    group: "unpack",
    name: "dictionary items",
    code: 'rows = []\nfor name, n in {"a": 1, "b": 2}.items():\n    rows.append(name * n)\nreturn rows',
  },
  { group: "unpack", name: "swapping names", code: "x, y = (1, 2)\nx, y = y, x\nreturn [x, y]" },
  { group: "unpack", name: "too few values", code: "a, b = [1]\nreturn a", raises: "ValueError" },
  { group: "unpack", name: "too many values", code: "a, b = [1, 2, 3]\nreturn b", raises: "ValueError" },
  { group: "fstrings", name: "expressions and literal braces", code: 'n = 3\nreturn f"{{total}}: {2*n} ✓"' },
  {
    group: "fstrings",
    name: "expressions run once in order",
    code: 'def seen(n):\n    print(n)\n    return n\nreturn f"{seen(1)}:{seen(2)}"',
  },
  { group: "fstrings", name: "dictionary lookup", code: `row = {"id": 42}\nreturn f"id={row['id']}"` },
  {
    group: "keywords",
    name: "reordered user arguments",
    code: "def pair(left, right):\n    return [left, right]\nreturn pair(right=2, left=1)",
  },
  {
    group: "keywords",
    name: "positional and keyword",
    code: "def pair(left, right):\n    return [left, right]\nreturn pair(1, right=2)",
  },
  {
    group: "keywords",
    name: "multiple values for argument",
    code: "def first(a):\n    return a\nreturn first(1, a=2)",
    raises: "TypeError",
  },
  {
    group: "keywords",
    name: "unexpected argument",
    code: "def first(a):\n    return a\nreturn first(other=1)",
    raises: "TypeError",
  },
  {
    group: "keywords",
    name: "tool keywords and dictionary agree",
    code: 'return [await tools.echo(value=42), await tools.echo({"value": 42})]',
  },
  {
    group: "sorted",
    name: "sort returns a new list",
    code: "xs = [1, 3, -5, 2]\nreturn [sorted(xs), sorted(xs, reverse=True), xs]",
  },
  {
    group: "sorted",
    name: "stable descending key",
    code: 'names = ["bb", "c", "aa", "d"]\nreturn sorted(names, key=len, reverse=True)',
  },
  {
    group: "sorted",
    name: "key evaluated once in input order",
    code: 'def by_rank(row):\n    print(row["name"])\n    return row["rank"]\nreturn sorted([{"rank": 2, "name": "a"}, {"rank": 1, "name": "b"}, {"rank": 2, "name": "c"}], key=by_rank)',
  },
  { group: "sorted", name: "incomparable values", code: 'return sorted([1, "1"])', raises: "TypeError" },
  { group: "slices", name: "zero step", code: "return [1, 2][::0]", raises: "ValueError" },
]

// Cross the sequence boundaries in both directions. An omitted bound differs from an explicit -1 with a negative step.
for (const start of ["", "-7", "-1", "0", "2", "7"]) {
  for (const stop of ["", "-7", "-1", "0", "2", "7"]) {
    for (const step of ["", ":1", ":-1", ":2", ":-2"]) {
      const slice = `[${start}:${stop}${step}]`
      cases.push({ group: "slices", name: slice, code: `return [[1, 2, 3, 4]${slice}, "a😀éz"${slice}, []${slice}]` })
    }
  }
}
