; Identifiers
(identifier) @variable

(field_expression
  (identifier) @variable.member .)

; Symbols
(quote_expression
  ":" @string.special.symbol
  [
    (identifier)
    (operator)
  ] @string.special.symbol)

; Function calls
(call_expression
  (identifier) @function.call)

(call_expression
  (field_expression
    (identifier) @function.call .))

(broadcast_call_expression
  (identifier) @function.call)

(broadcast_call_expression
  (field_expression
    (identifier) @function.call .))

(binary_expression
  (_)
  (operator) @_pipe
  (identifier) @function.call
  (#any-of? @_pipe "|>" ".|>"))

; Macros
(macro_identifier
  "@" @function.macro
  (identifier) @function.macro)

(macro_definition
  (signature
    (call_expression
      .
      (identifier) @function.macro)))

; Built-in functions
; filter(name -> Base.eval(Core, name) isa Core.Builtin, names(Core))
((identifier) @function.builtin
  (#any-of? @function.builtin
    "applicable" "fieldtype" "getfield" "getglobal" "invoke" "isa" "isdefined" "modifyfield!"
    "modifyglobal!" "nfields" "replacefield!" "replaceglobal!" "setfield!" "setfieldonce!"
    "setglobal!" "setglobalonce!" "swapfield!" "swapglobal!" "throw" "tuple" "typeassert" "typeof"))

; Type definitions
(type_head
  (_) @type.definition)

; Type annotations
(parametrized_type_expression
  [
    (identifier) @type
    (field_expression
      (identifier) @type .)
  ]
  (curly_expression
    (_) @type))

(typed_expression
  (identifier) @type .)

(unary_typed_expression
  (identifier) @type .)

(where_expression
  [
    (curly_expression
      (_) @type)
    (_) @type
  ] .)

(unary_expression
  (operator) @operator
  (_) @type
  (#any-of? @operator "<:" ">:"))

(binary_expression
  (_) @type
  (operator) @operator
  (_) @type
  (#any-of? @operator "<:" ">:"))

; Built-in types
; filter(name -> typeof(Base.eval(Core, name)) in [DataType, UnionAll], names(Core))
((identifier) @type.builtin
  (#any-of? @type.builtin
    "AbstractArray" "AbstractChar" "AbstractFloat" "AbstractString" "Any" "ArgumentError" "Array"
    "AssertionError" "Bool" "BoundsError" "Char" "ConcurrencyViolationError" "Cvoid" "DataType"
    "DenseArray" "DivideError" "DomainError" "ErrorException" "Exception" "Expr" "Float16" "Float32"
    "Float64" "Function" "GlobalRef" "IO" "InexactError" "InitError" "Int" "Int128" "Int16" "Int32"
    "Int64" "Int8" "Integer" "InterruptException" "LineNumberNode" "LoadError" "Method"
    "MethodError" "Module" "NTuple" "NamedTuple" "Nothing" "Number" "OutOfMemoryError"
    "OverflowError" "Pair" "Ptr" "QuoteNode" "ReadOnlyMemoryError" "Real" "Ref" "SegmentationFault"
    "Signed" "StackOverflowError" "String" "Symbol" "Task" "Tuple" "Type" "TypeError" "TypeVar"
    "UInt" "UInt128" "UInt16" "UInt32" "UInt64" "UInt8" "UndefInitializer" "UndefKeywordError"
    "UndefRefError" "UndefVarError" "Union" "UnionAll" "Unsigned" "VecElement" "WeakRef"))

; Keywords
[
  "global"
  "local"
] @keyword

(compound_statement
  [
    "begin"
    "end"
  ] @keyword)

(quote_statement
  [
    "quote"
    "end"
  ] @keyword)

(let_statement
  [
    "let"
    "end"
  ] @keyword)

(if_statement
  [
    "if"
    "end"
  ] @keyword.conditional)

(elseif_clause
  "elseif" @keyword.conditional)

(else_clause
  "else" @keyword.conditional)

(ternary_expression
  [
    "?"
    ":"
  ] @keyword.conditional.ternary)

(try_statement
  [
    "try"
    "end"
  ] @keyword.exception)

(catch_clause
  "catch" @keyword.exception)

(finally_clause
  "finally" @keyword.exception)

(for_statement
  [
    "for"
    "end"
  ] @keyword.repeat)

(for_binding
  "outer" @keyword.repeat)

; comprehensions
(for_clause
  "for" @keyword.repeat)

(if_clause
  "if" @keyword.conditional)

(while_statement
  [
    "while"
    "end"
  ] @keyword.repeat)

[
  (break_statement)
  (continue_statement)
] @keyword.repeat

[
  "const"
  "mutable"
] @keyword.modifier

(function_definition
  [
    "function"
    "end"
  ] @keyword.function)

(do_clause
  [
    "do"
    "end"
  ] @keyword.function)

(macro_definition
  [
    "macro"
    "end"
  ] @keyword)

(return_statement
  "return" @keyword.return)

(module_definition
  [
    "module"
    "baremodule"
    "end"
  ] @keyword.import)

(export_statement
  "export" @keyword.import)

(public_statement
  "public" @keyword.import)

(import_statement
  "import" @keyword.import)

(using_statement
  "using" @keyword.import)

(import_alias
  "as" @keyword.import)

(selected_import
  ":" @punctuation.delimiter)

(struct_definition
  [
    "mutable"
    "struct"
    "end"
  ] @keyword.type)

(abstract_definition
  [
    "abstract"
    "type"
    "end"
  ] @keyword.type)

(primitive_definition
  [
    "primitive"
    "type"
    "end"
  ] @keyword.type)

; Operators & Punctuation
(operator) @operator

(adjoint_expression
  "'" @operator)

(range_expression
  ":" @operator)

(arrow_function_expression
  "->" @operator)

[
  "."
  "..."
] @punctuation.special

[
  ","
  ";"
  "::"
] @punctuation.delimiter

; Treat `::` as operator in type contexts, see
; https://github.com/nvim-treesitter/nvim-treesitter/pull/7392
(typed_expression
  "::" @operator)

(unary_typed_expression
  "::" @operator)

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

; Interpolation
(string_interpolation
  .
  "$" @punctuation.special)

(interpolation_expression
  .
  "$" @punctuation.special)

; Keyword operators
((operator) @keyword.operator
  (#any-of? @keyword.operator "in" "isa"))

(where_expression
  "where" @keyword.operator)

; Built-in constants
((identifier) @constant.builtin
  (#any-of? @constant.builtin "nothing" "missing"))

((identifier) @variable.builtin
  (#any-of? @variable.builtin "begin" "end")
  (#has-ancestor? @variable.builtin index_expression))

; Literals
(boolean_literal) @boolean

(integer_literal) @number

(float_literal) @number.float

((identifier) @number.float
  (#any-of? @number.float "NaN" "NaN16" "NaN32" "Inf" "Inf16" "Inf32"))

(character_literal) @character

(escape_sequence) @string.escape

(string_literal) @string

(prefixed_string_literal
  prefix: (identifier) @function.macro) @string

(command_literal) @string.special

(prefixed_command_literal
  prefix: (identifier) @function.macro) @string.special

((string_literal) @string.documentation
  .
  [
    (abstract_definition)
    (assignment)
    (const_statement)
    (function_definition)
    (macro_definition)
    (module_definition)
    (struct_definition)
  ])

(source_file
  (string_literal) @string.documentation
  .
  [
    (identifier)
    (call_expression)
  ])

[
  (line_comment)
  (block_comment)
] @comment @spell
