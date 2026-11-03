// These are trusted differential fixtures, not arbitrary guest source. The reference runner uses real CPython.
export interface Case {
  group: string
  name: string
  code: string
  /** When set, the reference must raise this exception and Code Mode must fail without additional host effects. */
  raises?: "TypeError" | "ValueError"
}

export const cases: Case[] = [
  {
    group: "inspection",
    name: "bounded attribute lookup",
    code: `return getattr(' Hi ','strip')(),hasattr('Hi','splitlines'),getattr('Hi','missing',7)`,
  },
  {
    group: "helpers",
    name: "unbound string methods as callbacks",
    code: `return list(map(str.strip,[' a ',' b'])), list(filter(str.isdigit,['2','a','3'])), 'strip' in dir(str)`,
  },
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
  {
    group: "unpack",
    name: "grouped subscript is still an assignment",
    code: "x = [0]\n(x[0]) = 5\n(x)[0] += 1\nreturn x",
  },
  { group: "unpack", name: "too few values", code: "a, b = [1]\nreturn a", raises: "ValueError" },
  { group: "unpack", name: "too many values", code: "a, b = [1, 2, 3]\nreturn b", raises: "ValueError" },
  {
    group: "unpack",
    name: "nested tuple and list patterns",
    code: 'a, [b, *rest], *tail = [1, "😀xyz", 5, 6]\nreturn [a, b, rest, tail]',
  },
  {
    group: "unpack",
    name: "star is a fresh list",
    code: "source = [1, 2]\n*rest, = source\nrest.append(3)\nreturn [source,rest]",
  },
  { group: "unpack", name: "middle star can be empty", code: "[first, *rest, last] = (1,2)\nreturn first, rest, last" },
  {
    group: "unpack",
    name: "nested failure assigns earlier siblings only",
    code: "a, b, c = 0, 0, 0\ntry:\n    a, (b, *_, c) = 1, [2]\nexcept Exception:\n    return [a, b, c]",
  },
  {
    group: "unpack",
    name: "nested group inside star",
    code: "first, *[middle, *rest], last = range(6)\nreturn first, middle, rest, last",
  },
  {
    group: "unpack",
    name: "loop and comprehension patterns",
    code: 'out = []\nfor k, (v, *rest) in {"a": [1,2,3]}.items():\n    out.append([k,v,rest])\nreturn [r for _, *r in out]',
  },
  {
    group: "unpack",
    name: "insufficient values around star",
    code: "a, *rest, b = [1]\nreturn b",
    raises: "ValueError",
  },
  {
    group: "lambda",
    name: "stable sort by field",
    code: 'return sorted([{"n": 1}, {"n": 3}], key=lambda row: row["n"], reverse=True)',
  },
  {
    group: "lambda",
    name: "lexical capture and keyword parameters",
    code: "f = lambda a: lambda x, y: a + x - y\nreturn f(3)(y=1, x=5)",
  },
  {
    group: "lambda",
    name: "late binding in comprehension",
    code: "fns = [lambda: x for x in range(3)]\nreturn [f() for f in fns]",
  },
  {
    group: "lambda",
    name: "body is lazy, arguments are not",
    code: "f = lambda x: tools.echo(value=x)\nreturn await f(7)",
  },
  {
    group: "lambda",
    name: "parenthesized keyword calls remain expressions",
    code: "f = lambda x: x\n(f(x=3))\nreturn (f)(x=7)",
  },
  {
    group: "async",
    name: "allowlisted imports with aliases",
    code: "import asyncio as aio\nfrom asyncio import gather as together\na, *b = await together(tools.echo(value=3), tools.echo(value=4))\nreturn a, b, await aio.gather()",
  },
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
  {
    group: "text",
    name: "split and rsplit with Python whitespace",
    code: `s = '  a\\t b\\x1c c  '
return [(s.split(None, n), s.rsplit(maxsplit=n)) for n in [-2, 0, 1, 2, 10]]`,
  },
  {
    group: "text",
    name: "explicit separators and empty fields",
    code: `s = '::a::::'
return [(s.split('::',n),s.rsplit('::',n)) for n in [-1,0,1,2,3,8]]`,
  },
  {
    group: "text",
    name: "all Python line boundaries",
    code: `s='a\\r\\nb\\x0bc\\x0cd\\x1ce\\x1df\\x1eg\\x85h\\u2028i\\u2029'
return s.splitlines(),s.splitlines(keepends=True), ''.splitlines(), 'a\\n'.splitlines()`,
  },
  {
    group: "text",
    name: "unicode offsets and empty substring",
    code: `s='🍎a😀a'
return [(s.find('a',i),s.rfind('a',i),s.find('',i),s.count('',i),s.startswith(('', 'a'),i)) for i in [-9,-2,0,1,4,5]]`,
  },
  {
    group: "text",
    name: "text filtering pipeline",
    code: `s='opened\\n Priority CHANGED by Dana \\r\\nclosed'
return '\\n'.join(x.strip().lower().removeprefix('priority ').removesuffix(' dana') for x in s.splitlines() if 'priority' in x.lower())`,
  },
  {
    group: "text",
    name: "replacements are literal and respect count",
    code: `return [('A😀'.replace('','-',n),'aaaa'.replace('aa','$&',n)) for n in [-1,0,1,2,7]]`,
  },
  {
    group: "text",
    name: "partition, trim and predicates",
    code: `return 'a:b:c'.rpartition(':'), 'abc'.partition('!'), '😀ab😀'.strip('😀'), '１２'.isdecimal(), '²'.isdigit(), 'ß'.upper(), 'α'.isalpha(), 'abc'.endswith(('b','bc'))`,
  },
  { group: "text", name: "empty separator", code: `return 'abc'.split('')`, raises: "ValueError" },
  {
    group: "inspection",
    name: "type identity, hierarchy and display",
    code: `xs=['',{},[],(),1,1.5,False,None]
return [(type(x).__name__, str(type(x)), isinstance(x,(str,dict)), isinstance(x,int), type(x) is bool) for x in xs]`,
  },
  {
    group: "inspection",
    name: "repr and safe dir",
    code: `row={"a": ["x'y", "a\\nb", True, None]}
return repr(row), repr('a\\t\\x00b'), repr('2"3'), 'splitlines' in dir(''), 'append' in dir([]), callable(len), callable(row)`,
  },
  {
    group: "iterators",
    name: "lazy callbacks and short circuit",
    code: `def see(x):
    print(x)
    return x
it = map(see, range(5))
return any(it), next(it), list(it), list(it)`,
  },
  {
    group: "iterators",
    name: "lazy generator and filter composition",
    code: `def see(x):
    print(x)
    return x
g = (see(x) for x in range(6) if x % 2)
print('ready')
p = filter(lambda x: x > 1,g)
return next(p), sum(p), next(g,'done')`,
  },
  {
    group: "iterators",
    name: "zips, enumerate, dict comprehensions",
    code: `return {name: (i,n) for i,(name,n) in enumerate(zip(['a','b','c'], reversed([1,2])), start=3) if n>0}`,
  },
  {
    group: "iterators",
    name: "min/max/sorted with composite keys",
    code: `rows = [{'n':2, 'name':'b'}, {'n':2,'name':'a'}, {'n':1,'name':'c'}]
key = lambda row: (-row['n'], row['name'])
return max(rows, key=key), min(rows,key=key), sorted(rows,key=key), max([],default=5)`,
  },
  {
    group: "helpers",
    name: "dict construction update and copies",
    code: `x=dict([('a',2)], b=3)
y=x.copy()
x.update(zip(['c'],[5]), b=4)
return x.setdefault('c',8),x.pop('a'),x.pop('z',0),x,y,dict.fromkeys(['a','b'],1)`,
  },
  {
    group: "helpers",
    name: "list operations and stable in-place sort",
    code: `a = [1,2]
a.extend(a)
a.insert(-1,9)
p=a.pop(1)
a.remove(1)
b=a.copy()
a.sort(key=lambda x:-x)
return a,b,p,b.count(2),b.index(9)`,
  },
  {
    group: "helpers",
    name: "scalar sets and numeric equality",
    code: `s={True,1,2,False,0}
s.add(8)
s.discard(0)
return sorted(s), len(s), s=={True,2,8}, sorted(s.intersection([2,3,4])), sorted({x%3 for x in range(8)}), sorted(s.union([5]).difference([1]))`,
  },
  {
    group: "helpers",
    name: "numeric conversions conditionals and inline suites",
    code: `xs=[]
for s in [' -12 ', '1_000']: xs.append(int(s))
return (abs(xs[0]) if all(xs) else missing()), float('.5e2'), tuple(xs)`,
  },
  {
    group: "json",
    name: "format, load and compose",
    code: `import json
value={'z': (True, None, '\\n😀'), 'a': [2]}
return json.dumps(value),json.dumps(value,indent=2,sort_keys=True,ensure_ascii=False),json.loads(json.dumps(value,separators=(',',':')))`,
  },
  {
    group: "regex",
    name: "compiled groups, flags, Unicode span",
    code: `import re
m=re.compile(r'(?P<who>[a-z]+) (\\d+)', flags=re.I).search('💚AlicE 23!')
return m.group(0),m.group('who',2),m.groups(),m.span(),m.start(2),m.end('who')`,
  },
  {
    group: "regex",
    name: "findall, split, escape and substitute",
    code: `from re import sub as replace
import re
return re.findall(r'(\\d+)([a-z]?)','1 2b 3c'), re.split(r'(:)','a:b:c',maxsplit=1),replace(r'(\\d+)', r'[\\1]','a2b33',count=1),re.escape('a b.C'),re.fullmatch('[abc]+','abX') is None`,
  },
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
