# Widget binary format, version 1

The host-written binary encoding of widget messages. It covers views,
step outputs, 2D draw commands and live posts, for nodes per `specs/v2/widgets.md` at d7097dae1 and later. Semantics
don't change: every message decodes to the same values the JSON would, under the same client rules (defaults,
clamps, unknown node types dropped).

## Where it is produced and read

- **widget-mobile's widget encoder (`packages/widgets-rs`, on psychoscript-mobile) writes it, in Rust, from the VM's
  value.** It needs no prelude change.
  - **Steps and draws.** The host runs `<program>\nreturn __widget_native_step(__input())` (`widgets.md`, Native
    hosts). The prelude hands the view, or a draw's commands, to the host global `__widget_emit` as a `HostValue`,
    which is cheaper than the result path's VM → JSON → `Data`; the rest of an `init` or `event` step's output
    (`state`, `submit`, `dismiss`, `send`) is the run's result, under its JSON rules. The host writes `S` from both
    (the flags and JSON from the result, `N` from the emitted view) and `D` from the emitted commands.
  - **Live.** `__host.post(message)` already receives a `HostValue`. The host encodes each post and hands a wake-up's
    posts to the app in one call (`on_posts_bytes(Vec<Vec<u8>>)`, beside today's `on_posts`).
  - **Native tree building.** As a native host (`widgets.md`, Native hosts), the encoder builds
    the tree while it encodes a view: it computes each node's path, writes `id` and `pointer`, skips `key`, the
    handler markers and the other props the prelude would remove, and keeps the canvas ids by key and whether there
    are handlers. A live `draw` post carries a `key`, which it writes as the canvas's `str(id)`. The bytes are the same.
- **iOS and Android** decode the bytes into their existing types (`AgentWidgetNode`, `AgentWidgetDrawList`, step
  output).
- **Rune doesn't use bytes.** It reads the `HostValue` straight into its structs (`Node`, `Command`, `StepOutput`),
  and for a GPU batch borrows the `ArrayBuffer`'s bytes in place (`TypedArray::with_bytes`).
- **GPU batches** need the prelude's `widget.gpu` (not implemented yet) and psychoscript's typed arrays (PR #13). The
  encoder itself doesn't depend on either.

## Conventions

- **Little-endian** for all fixed-width numbers.
- **varint:** unsigned LEB128, at most 10 bytes.
- **f64 / f32:** IEEE 754, little-endian.
- **str:** a varint byte length, then UTF-8 (unpaired surrogates as U+FFFD, as JSON gives them today).
- **json:** a str holding JSON text (`JSON.stringify` rules), for generic data the client only sends back or forwards.
- **Version.** Every top-level message starts with the version byte `0x01`, then a kind byte. A client that gets
  another version treats the message as malformed.

## Top-level messages

| bytes | message |
| --- | --- |
| `01 'S' flags json(state) [json(submit)] [json(send.value)] N` | init or event step output (`'S'` is the kind; `N` begins with its own `'N'`, `G` with `'G'`). `flags`: bit 0 submit, bit 1 dismiss, bit 2 send, bit 3 send.wake |
| `01 D` | draw step output (`{ commands }`); section `D` begins with its own `'D'` |
| `01 01 N` | live `render` |
| `01 02 str(id) D` | live `draw` |
| `01 03` | live `frame` request |
| `01 09 G` | live `frame` request carrying a GPU batch |
| `01 0A G` | live standalone GPU batch (`{ type: "gpu", … }`, a batch sent before `sleep`/`fetch`) |
| `01 04 json(value)` | `submit` |
| `01 05` | `dismiss` |
| `01 06 u8(wake) json(value)` | `send` |
| `01 07 u8(on)` | `capture` |
| `01 0B str(key) u8(set) [str(value)]` | `storage` (`widgets-live.md`, Storage): `set` 1 with the value's JSON text, 0 for a delete. The encoder fails a key that isn't 1 to 256 characters or a value that isn't text of at most 64 KiB as an invalid post |

`state`, `submit` and `send` stay JSON: they're generic data, the client never inspects them, and
`state` goes back verbatim in the next step input. The step input stays JSON.

## Views: section `N`

`N` = `'N'` `varint(len I)` `varint(len F)` `varint(len S)`, followed by the three streams in that order, each length
in bytes:
- **I:** varints (types, prop tags, ints, counts);
- **F:** f64s;
- **S:** strs.

A reader keeps one cursor per stream. A node is:

```
varint type, (varint tag, value)*, varint 0, [varint childCount, node × childCount]   // children only for containers
```

**Types:** 1 column, 2 row, 3 text, 4 markdown, 5 image, 6 carousel, 7 card, 8 button, 9 checkbox, 10 slider,
11 select, 12 input, 13 divider, 14 canvas, 16 stack, 17 table. Containers: 1, 2, 6, 7, 16. Type 63 is a node type the host
doesn't know: the I stream holds 63 and then 0, and the S stream holds its name. Clients drop it like an unknown type
today.

**Prop tag:** `id << 3 | kind`. **Kinds:**

| kind | value |
| --- | --- |
| 0 int | I: varint (bools as 0/1, enums as their index) |
| 1 f64 | F: f64 |
| 2 str | S: str |
| 3 f64 list | I: count; F: count × f64 |
| 4 str list | I: count; S: count × str |
| 5 options | I: count; per option: I hasDescription, S value, S label, S description if present |

**Prop ids:**

| id | prop | kind | id | prop | kind |
| --- | --- | --- | --- | --- | --- |
| 1 | gap | f64 | 19 | max | f64 |
| 2 | align | int: start 0, center 1, end 2, stretch 3 | 20 | step | f64 |
| 3 | wrap | int | 21 | options | options |
| 4 | text | str | 22 | multiple | int |
| 5 | style | int: title 0, body 1, caption 2, code 3 | 23 | placeholder | str |
| 6 | tone | int: default 0, muted 1, accent 2, success 3, warning 4, error 5 | 24 | multiline | int |
| 7 | src | str | 25 | height | f64 |
| 8 | alt | str | 26 | width | f64 |
| 9 | aspect | f64 | 27 | fps | f64 |
| 10 | id | str | 28 | duration | f64 |
| 11 | index | f64 | 29 | wgsl | str |
| 12 | selected | int | 30 | values | f64 list |
| 13 | label | str | 31 | poster | str |
| 14 | variant | int: primary 0, secondary 1, danger 2 | 32 | fill | int |
| 15 | disabled | int | 33 | fullscreen | int |
| 16 | checked | int | 34 | capture | str |
| 17 | value | f64 (slider), str (input, one-value select), str list (multiple select) | 35 | pointer | int |
| 18 | min | f64 | 36 | place | int: top-left 0, top 1, top-right 2, left 3, center 4, right 5, bottom-left 6, bottom 7, bottom-right 8, fill 9 |
| | | | 37 | inset | f64 (all sides) or f64 list of 4 (top, right, bottom, left) |
| | | | 38 | gpu | int (a GPU canvas, `widgets-gpu.md`) |
| | | | 39 | columns | str list: the columns' labels |
| | | | 40 | columns' `align` | f64 list, one per column: start 0, end 1 |
| | | | 41 | rows | str list: the cells row by row, each row as wide as `columns` (a missing cell is `""`; a number as `String(number)`) |
| | | | 42 | sort | f64 list: column, then 1 when `descending` else 0 |
| | | | 43 | table's `selected` | int: the row |
| | | | 44 | selectable | int |
| | | | 45 | sortable | int |

**Rules for the encoder** (`write_node`). It writes the props the tree has, in its key order:
- `type` and `children` are never props.
- It flattens nested `children` arrays and drops `null`, `false` and `undefined` children, as clients do today.
- It leaves out a prop with an unknown key, a `null`/`undefined` value, a non-finite number, an enum string no client
  knows (the client then uses its default), or a value of the wrong JSON type.
- It doesn't check required props: the client does, as today, and an invalid view stays a program error.
- `place`/`inset` go on any node. They mean something only for a stack's children: the reader keeps them per child.
- A table's `columns` go out as props 39 and 40, its `rows` as prop 41 (as many cells per row as there are columns),
  `sort` as 42 and a number `selected` as 43. A table whose `columns` or `rows` aren't lists, or whose cells aren't
  strings or numbers, has them left out, and the client takes the view as invalid.

**Rules for the decoder.** It skips a tag whose id it doesn't know, by kind. That is the forward-compatibility rule:
new props get new ids, and a changed meaning gets a new id.

## Draw commands: section `D`

`D` = `'D' u32 commands u32 ints u32 floats u32 stringBytes`, followed by:
- `ints × u32`;
- `floats × f32`;
- the string stream (strs).

Colors are resolved by the host: a color is two ints, `kind` (0 RGBA, 1–9 the tokens text, muted, accent, bg,
surface, border, success, warning, error) and `value` (`r<<24 | g<<16 | b<<8 | a`, or 0 for a token). Per command,
in each stream's order:

| op (int) | I | F | S |
| --- | --- | --- | --- |
| 1 save, 2 restore | – | – | – |
| 3 translate, 5 scale | – | x, y | – |
| 4 rotate, 6 alpha | – | value (alpha clamped to 0..1) | – |
| 7 rect | paint | x, y, w, h, paint | – |
| 8 rrect | paint | x, y, w, h, r, paint | – |
| 9 circle | paint | cx, cy, r, paint | – |
| 10 line | paint | x1, y1, x2, y2, paint | – |
| 11 path | count, then per segment its verb (1 M, 2 L, 3 Q, 4 C, 5 Z), then paint | per segment 2 / 2 / 4 / 6 / 0 coordinates, then paint | – |
| 12 text | weight, align (0 left, 1 center, 2 right), hasColor, [color], mono | x, y, size | text |
| 13 image | – | x, y, w, h | src |

`paint` adds these to the streams:
- **I:** `fillKind` (0 none, 1 color, 2 linear, 3 radial); then a color for kind 1, or `stopCount` for kinds 2 and 3;
  then a stop's color per stop; then `hasStroke`, the stroke color if present, and `cap` (0 butt, 1 round).
- **F:** for a gradient, its geometry (4 or 3 floats) and each stop's offset (clamped to 0..1), in the same order as
  the I stream; then `width` (default 1).

The host first checks the commands (`widgets.md`, Draw command checks): a failing draw fails the step or post as a
program error in phase `draw`, with that section's message, and the streams hold the normalised commands (alpha and
stop offsets clamped, a text size clamped, a negative width 0). The streams are the same layout Android keeps in
`AgentWidgetDrawList`, except that colors are (kind, value) pairs rather than palette-resolved ARGB.

## GPU batch: section `G` (live, per `widgets-gpu.md`)

`G` = `'G' u32 opsBytes varint opCount arg × opCount u32 byteLength bytes × byteLength`.

`opsBytes` counts from `opCount` to the end of the last op. Each op is the spec's JSON tuple, written as an arg:

```
arg = 00 null | 01 false | 02 true | 03 f64 | 04 str | 05 varint n arg×n (list) | 06 varint n (str key, arg)×n (object)
```

`bytes` are the batch's `ArrayBuffer` (or typed array) bytes. The host borrows them in place
(`TypedArray::with_bytes`) and copies them once, into the message. Ops address them by `[byteOffset, byteLength]` as
in the spec. On mobile the batch is replayed inside the app's native library (`widget-mobile`, on psychoscript-mobile
and psychoscript-gpu), so it never needs to reach the app. The encoding above is for a host whose app does the replay.

## Errors

- **The host can't encode** (a draw rule above, an over-limit batch, an unknown post type): a program error, reported
  as today (phase `view`, `draw` or `gpu`). A step fails as an invalid step output does (the previous view stays); a
  live post fails as an invalid post does (`widgets-live.md`: the run ends with the error and can be restarted).
- **The client gets a malformed message:** a wrong version or kind, a truncated stream or section, a length past the
  end, an unknown kind or GPU arg tag, a draw op or segment verb outside the table, invalid UTF-8, a stream not
  consumed exactly, or a count over the limits (2,000 draw commands, 4 MB of GPU bytes). That is a client error: log
  it in dev mode, drop the message, keep the previous state, and don't report it to the agent.
- **A well-formed but invalid view** (a required prop missing, an unknown root type): a program error, as today.

Every read is bounds-checked. The prototype's Rust draw reader isn't: it assumes well-formed streams.

