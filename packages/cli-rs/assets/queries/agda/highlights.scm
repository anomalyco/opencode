; Constants
(integer) @number

; Variables and Symbols
(typed_binding
  (atom
    (qid) @variable))

(untyped_binding) @variable

(typed_binding
  (expr) @type)

(id) @function

(bid) @function

(function_name
  (atom
    (qid) @function))

(field_name) @function

[
  (data_name)
  (record_name)
] @constructor

; Set
(SetN) @type.builtin

(expr
  .
  (atom) @function)

((atom) @boolean
  (#any-of? @boolean "true" "false" "True" "False"))

; Imports and Module Declarations
"import" @keyword.import

(module_name) @module

; Pragmas and comments
(pragma) @keyword.directive

(comment) @comment @spell

; Keywords
[
  "where"
  "data"
  "rewrite"
  "postulate"
  "public"
  "private"
  "tactic"
  "Prop"
  "quote"
  "renaming"
  "open"
  "in"
  "hiding"
  "constructor"
  "abstract"
  "let"
  "field"
  "mutual"
  "module"
  "infix"
  "infixl"
  "infixr"
] @keyword

"record" @keyword.type

;(expr
;	f_name: (atom) @function)
; Brackets
[
  "("
  ")"
  "{"
  "}"
] @punctuation.bracket

"=" @operator
