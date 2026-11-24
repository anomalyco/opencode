; Punctuation
[
  ","
  ";"
] @punctuation.delimiter

[
  "("
  ")"
  "<<"
  ">>"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

"%" @punctuation.special

; Identifiers
(identifier) @variable

; Unused Identifiers
((identifier) @comment
  (#match? @comment "^_"))

; Comments
(comment) @comment @spell

; Strings
(string) @string

; Modules
(alias) @module

; Atoms & Keywords
[
  (atom)
  (quoted_atom)
  (keyword)
  (quoted_keyword)
] @string.special.symbol

; Interpolation
(interpolation
  [
    "#{"
    "}"
  ] @string.special)

; Escape sequences
(escape_sequence) @string.escape

; Integers
(integer) @number

; Floats
(float) @number.float

; Characters
[
  (char)
  (charlist)
] @character

; Booleans
(boolean) @boolean

; Nil
(nil) @constant.builtin

; Operators
(operator_identifier) @operator

(unary_operator
  operator: _ @operator)

(binary_operator
  operator: _ @operator)

; Pipe Operator
(binary_operator
  operator: "|>"
  right: (identifier) @function)

(dot
  operator: _ @operator)

(stab_clause
  operator: _ @operator)

; Local Function Calls
(call
  target: (identifier) @function.call)

; Remote Function Calls
(call
  target: (dot
    left: [
      (atom) @type
      (_)
    ]
    right: (identifier) @function.call)
  (arguments))

; Definition Function Calls
(call
  target: ((identifier) @keyword.function
    (#any-of? @keyword.function
      "def" "defdelegate" "defexception" "defguard" "defguardp" "defimpl" "defmacro" "defmacrop"
      "defmodule" "defn" "defnp" "defoverridable" "defp" "defprotocol" "defstruct"))
  (arguments
    [
      (call
        (identifier) @function)
      (identifier) @function
      (binary_operator
        left: (call
          target: (identifier) @function)
        operator: "when")
    ])?)

; Kernel Keywords & Special Forms
(call
  target: ((identifier) @keyword
    (#any-of? @keyword
      "alias" "case" "catch" "cond" "else" "for" "if" "import" "quote" "raise" "receive" "require"
      "reraise" "super" "throw" "try" "unless" "unquote" "unquote_splicing" "use" "with")))

; Special Constants
((identifier) @constant.builtin
  (#any-of? @constant.builtin "__CALLER__" "__DIR__" "__ENV__" "__MODULE__" "__STACKTRACE__"))

; Reserved Keywords
[
  "after"
  "catch"
  "do"
  "end"
  "fn"
  "rescue"
  "when"
  "else"
] @keyword

; Operator Keywords
[
  "and"
  "in"
  "not in"
  "not"
  "or"
] @keyword.operator

; Capture Operator
(unary_operator
  operator: "&"
  operand: [
    (integer) @operator
    (binary_operator
      left: [
        (call
          target: (dot
            left: (_)
            right: (identifier) @function))
        (identifier) @function
      ]
      operator: "/"
      right: (integer) @operator)
  ])

; Non-String Sigils
(sigil
  "~" @string.special
  (sigil_name) @string.special @_sigil_name
  quoted_start: _ @string.special
  quoted_end: _ @string.special
  ((sigil_modifiers) @string.special)?
  (#not-any-of? @_sigil_name "s" "S"))

; String Sigils
(sigil
  "~" @string
  (sigil_name) @string @_sigil_name
  quoted_start: _ @string
  (quoted_content) @string
  quoted_end: _ @string
  ((sigil_modifiers) @string)?
  (#any-of? @_sigil_name "s" "S"))

; Module attributes
(unary_operator
  operator: "@"
  operand: [
    (identifier)
    (call
      target: (identifier))
  ] @constant) @constant

; Documentation
(unary_operator
  operator: "@"
  operand: (call
    target: ((identifier) @_identifier
      (#any-of? @_identifier "moduledoc" "typedoc" "shortdoc" "doc")) @comment.documentation
    (arguments
      [
        (string)
        (boolean)
        (charlist)
        (sigil
          "~" @comment.documentation
          (sigil_name) @comment.documentation
          quoted_start: _ @comment.documentation
          (quoted_content) @comment.documentation
          quoted_end: _ @comment.documentation)
      ] @comment.documentation))) @comment.documentation
