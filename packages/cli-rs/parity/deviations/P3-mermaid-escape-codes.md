# P.3: escape sequences in diagram text

**TypeScript.** The Mermaid renderer measures text with `string-width`, which strips ANSI escape sequences
(`ESC [ 31 m` and the like) from the whole string before it counts, but draws text one grapheme at a time, where each
character of the sequence but `ESC` takes a cell. A label holding an escape sequence is measured narrower than it is
drawn, so its box or row is too narrow and the text overruns it.

**Rust.** Text is measured as it is drawn, grapheme by grapheme: each character of an escape sequence but `ESC` takes
a cell, and boxes and rows fit the text. Every other grapheme measures as `string-width` 7 measures it.

**Reason.** A diagram cannot show an escape sequence's effect, and measuring a label as wide as it draws keeps it
inside its box. Copying the strip would copy a TS defect.
