; let bindings
(let_expression
  (binding_set
    (binding
      .
      (attrpath) @local.definition.var))) @local.scope

; rec attrsets
(rec_attrset_expression
  (binding_set
    (binding
      .
      (attrpath) @local.definition.field))) @local.scope

; functions and parameters
(function_expression
  .
  [
    (identifier) @local.definition.parameter
    (formals
      (formal
        .
        (identifier) @local.definition.parameter))
  ]) @local.scope

((formals)
  "@"
  (identifier) @local.definition.parameter) ; I couldn't get this to work properly inside the (function)

(variable_expression
  (identifier) @local.reference)

(inherited_attrs
  attr: (identifier) @local.reference)
