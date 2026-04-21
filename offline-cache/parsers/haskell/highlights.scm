; ----------------------------------------------------------------------------
; Parameters and variables
; NOTE: These are at the top, so that they have low priority,
; and don't override destructured parameters
(variable) @variable

(decl/function
  patterns: (patterns
    (_) @variable.parameter))

(expression/lambda
  (_)+ @variable.parameter
  "->")

(decl/function
  (infix
    (pattern) @variable.parameter))

; ----------------------------------------------------------------------------
; Literals and comments
(integer) @number

(negation) @number

(expression/literal
  (float)) @number.float

(char) @character

(string) @string

(comment) @comment

(haddock) @comment.documentation

; ----------------------------------------------------------------------------
; Punctuation
[
  "("
  ")"
  "{"
  "}"
  "["
  "]"
] @punctuation.bracket

[
  ","
  ";"
] @punctuation.delimiter

; ----------------------------------------------------------------------------
; Keywords, operators, includes
[
  "forall"
  ; "∀" ; utf-8 is not cross-platform safe
] @keyword.repeat

(pragma) @keyword.directive

[
  "if"
  "then"
  "else"
  "case"
  "of"
] @keyword.conditional

[
  "import"
  "qualified"
  "module"
] @keyword.import

[
  (operator)
  (constructor_operator)
  (all_names)
  "."
  ".."
  "="
  "|"
  "::"
  "=>"
  "->"
  "<-"
  "\\"
  "`"
  "@"
] @operator

(wildcard) @character.special

(module
  (module_id) @module)

[
  "where"
  "let"
  "in"
  "class"
  "instance"
  "pattern"
  "data"
  "newtype"
  "family"
  "type"
  "as"
  "hiding"
  "deriving"
  "via"
  "stock"
  "anyclass"
  "do"
  "mdo"
  "rec"
  "infix"
  "infixl"
  "infixr"
] @keyword

; ----------------------------------------------------------------------------
; Functions and variables
(decl
  [
    name: (variable) @function
    names: (binding_list
      (variable) @function)
  ])

(decl/bind
  name: (variable) @variable)

; Consider signatures (and accompanying functions)
; with only one value on the rhs as variables
(decl/signature
  name: (variable) @variable
  type: (type))

((decl/signature
  name: (variable) @_name
  type: (type))
  .
  (decl
    name: (variable) @variable)
  match: (_)
  (#eq? @_name @variable))

; but consider a type that involves 'IO' a decl/function
(decl/signature
  name: (variable) @function
  type: (type/apply
    constructor: (name) @_type)
  (#eq? @_type "IO"))

((decl/signature
  name: (variable) @_name
  type: (type/apply
    constructor: (name) @_type)
  (#eq? @_type "IO"))
  .
  (decl
    name: (variable) @function)
  match: (_)
  (#eq? @_name @function))

((decl/signature) @function
  .
  (decl/function
    name: (variable) @function))

(decl/bind
  name: (variable) @function
  (match
    expression: (expression/lambda)))

; view patterns
(view_pattern
  [
    (expression/variable) @function.call
    (expression/qualified
      (variable) @function.call)
  ])

; consider infix functions as operators
(infix_id
  [
    (variable) @operator
    (qualified
      (variable) @operator)
  ])

; decl/function calls with an infix operator
; e.g. func <$> a <*> b
(infix
  left_operand: [
    (variable) @function.call
    (qualified
      ((module) @module
        (variable) @function.call))
  ])

; infix operators applied to variables
((expression/variable) @variable
  .
  (operator))

((operator)
  .
  [
    (expression/variable) @variable
    (expression/qualified
      (variable) @variable)
  ])

; infix operator function definitions
(function
  (infix
    left_operand: [
      (variable) @variable
      (qualified
        ((module) @module
          (variable) @variable))
    ])
  match: (match))

; decl/function calls with infix operators
([
  (expression/variable) @function.call
  (expression/qualified
    (variable) @function.call)
]
  .
  (operator) @_op
  (#any-of? @_op "$" "<$>" ">>=" "=<<"))

; right hand side of infix operator
((infix
  [
    (operator)
    (infix_id
      (variable))
  ] ; infix or `func`
  .
  [
    (variable) @function.call
    (qualified
      (variable) @function.call)
  ])
  .
  (operator) @_op
  (#any-of? @_op "$" "<$>" "=<<"))

; decl/function composition, arrows, monadic composition (lhs)
([
  (expression/variable) @function
  (expression/qualified
    (variable) @function)
]
  .
  (operator) @_op
  (#any-of? @_op "." ">>>" "***" ">=>" "<=<"))

; right hand side of infix operator
((infix
  [
    (operator)
    (infix_id
      (variable))
  ] ; infix or `func`
  .
  [
    (variable) @function
    (qualified
      (variable) @function)
  ])
  .
  (operator) @_op
  (#any-of? @_op "." ">>>" "***" ">=>" "<=<"))

; function composition, arrows, monadic composition (rhs)
((operator) @_op
  .
  [
    (expression/variable) @function
    (expression/qualified
      (variable) @function)
  ]
  (#any-of? @_op "." ">>>" "***" ">=>" "<=<"))

; function defined in terms of a function composition
(decl/function
  name: (variable) @function
  (match
    expression: (infix
      operator: (operator) @_op
      (#any-of? @_op "." ">>>" "***" ">=>" "<=<"))))

(apply
  [
    (expression/variable) @function.call
    (expression/qualified
      (variable) @function.call)
  ])

; function compositions, in parentheses, applied
; lhs
(apply
  .
  (expression/parens
    (infix
      [
        (variable) @function.call
        (qualified
          (variable) @function.call)
      ]
      .
      (operator))))

; rhs
(apply
  .
  (expression/parens
    (infix
      (operator)
      .
      [
        (variable) @function.call
        (qualified
          (variable) @function.call)
      ])))

; variables being passed to a function call
(apply
  (_)
  .
  [
    (expression/variable) @variable
    (expression/qualified
      (variable) @variable)
  ])

; main is always a function
; (this prevents `main = undefined` from being highlighted as a variable)
(decl/bind
  name: (variable) @function
  (#eq? @function "main"))

; scoped function types (func :: a -> b)
(signature
  pattern: (pattern/variable) @function
  type: (function))

; signatures that have a function type
; + binds that follow them
(decl/signature
  name: (variable) @function
  type: (function))

((decl/signature
  name: (variable) @_name
  type: (quantified_type))
  .
  (decl/bind
    (variable) @function)
  (#eq? @function @_name))

; Treat constructor assignments (smart constructors) as functions, e.g. mkJust = Just
(bind
  name: (variable) @function
  match: (match
    expression: (constructor)))

; Function composition
(bind
  name: (variable) @function
  match: (match
    expression: (infix
      operator: (operator) @_op
      (#eq? @_op "."))))

; ----------------------------------------------------------------------------
; Types
(name) @type

(type/unit) @type

(type/unit
  [
    "("
    ")"
  ] @type)

(type/list
  [
    "["
    "]"
  ] @type)

(type/star) @type

(constructor) @constructor

; True or False
((constructor) @boolean
  (#any-of? @boolean "True" "False"))

; otherwise (= True)
((variable) @boolean
  (#eq? @boolean "otherwise"))

; ----------------------------------------------------------------------------
; Quasi-quotes
(quoter) @function.call

(quasiquote
  quoter: [
    (quoter) @_name
    (quoter
      (qualified
        id: (variable) @_name))
  ]
  (#eq? @_name "qq")
  body: (quasiquote_body) @string)

; namespaced quasi-quoter
(quoter
  [
    (variable) @function.call
    (_
      (module) @module
      .
      (variable) @function.call)
  ])

; Highlighting of quasiquote_body for other languages is handled by injections.scm
; ----------------------------------------------------------------------------
; Exceptions/error handling
((variable) @keyword.exception
  (#any-of? @keyword.exception
    "error" "undefined" "try" "tryJust" "tryAny" "catch" "catches" "catchJust" "handle" "handleJust"
    "throw" "throwIO" "throwTo" "throwError" "ioError" "mask" "mask_" "uninterruptibleMask"
    "uninterruptibleMask_" "bracket" "bracket_" "bracketOnErrorSource" "finally" "fail"
    "onException" "expectationFailure"))

; ----------------------------------------------------------------------------
; Debugging
((variable) @keyword.debug
  (#any-of? @keyword.debug
    "trace" "traceId" "traceShow" "traceShowId" "traceWith" "traceShowWith" "traceStack" "traceIO"
    "traceM" "traceShowM" "traceEvent" "traceEventWith" "traceEventIO" "flushEventLog" "traceMarker"
    "traceMarkerIO"))

; ----------------------------------------------------------------------------
; Fields
(field_name
  (variable) @variable.member)

(import_name
  (name)
  .
  (children
    (variable) @variable.member))

; ----------------------------------------------------------------------------
; Spell checking
(comment) @spell
