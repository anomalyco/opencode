[
  "@media"
  "@charset"
  "@namespace"
  "@supports"
  "@keyframes"
  (at_keyword)
] @keyword.directive

"@import" @keyword.import

[
  (to)
  (from)
] @keyword

(comment) @comment @spell

(tag_name) @tag

(class_name) @type

(id_name) @constant

[
  (property_name)
  (feature_name)
] @property

[
  (nesting_selector)
  (universal_selector)
] @character.special

(function_name) @function

[
  "~"
  ">"
  "+"
  "-"
  "*"
  "/"
  "="
  "^="
  "|="
  "~="
  "$="
  "*="
] @operator

[
  "and"
  "or"
  "not"
  "only"
] @keyword.operator

(important) @keyword.modifier

(attribute_selector
  (plain_value) @string)

(pseudo_element_selector
  "::"
  (tag_name) @attribute)

(pseudo_class_selector
  (class_name) @attribute)

(attribute_name) @tag.attribute

(namespace_name) @module

(keyframes_name) @variable

((property_name) @variable
  (#lua-match? @variable "^[-][-]"))

((plain_value) @variable
  (#lua-match? @variable "^[-][-]"))

[
  (string_value)
  (color_value)
  (unit)
] @string

(integer_value) @number

(float_value) @number.float

[
  "#"
  ","
  "."
  ":"
  "::"
  ";"
] @punctuation.delimiter

[
  "{"
  ")"
  "("
  "}"
  "["
  "]"
] @punctuation.bracket
