; SCOPES
; declarations
(program) @local.scope

(class_declaration
  body: (_) @local.scope)

(record_declaration
  body: (_) @local.scope)

(enum_declaration
  body: (_) @local.scope)

(lambda_expression) @local.scope

(enhanced_for_statement) @local.scope

; block
(block) @local.scope

; if/else
(if_statement) @local.scope ; if+else

(if_statement
  consequence: (_) @local.scope) ; if body in case there are no braces

(if_statement
  alternative: (_) @local.scope) ; else body in case there are no braces

; try/catch
(try_statement) @local.scope ; covers try+catch, individual try and catch are covered by (block)

(catch_clause) @local.scope ; needed because `Exception` variable

; loops
(for_statement) @local.scope ; whole for_statement because loop iterator variable

(for_statement
  ; "for" body in case there are no braces
  body: (_) @local.scope)

(do_statement
  body: (_) @local.scope)

(while_statement
  body: (_) @local.scope)

; Functions
(constructor_declaration) @local.scope

(method_declaration) @local.scope

; DEFINITIONS
(package_declaration
  (identifier) @local.definition.namespace)

(class_declaration
  name: (identifier) @local.definition.type)

(record_declaration
  name: (identifier) @local.definition.type)

(enum_declaration
  name: (identifier) @local.definition.enum)

(method_declaration
  name: (identifier) @local.definition.method)

(local_variable_declaration
  declarator: (variable_declarator
    name: (identifier) @local.definition.var))

(enhanced_for_statement
  ; for (var item : items) {
  name: (identifier) @local.definition.var)

(formal_parameter
  name: (identifier) @local.definition.parameter)

(catch_formal_parameter
  name: (identifier) @local.definition.parameter)

(inferred_parameters
  (identifier) @local.definition.parameter) ; (x,y) -> ...

(lambda_expression
  parameters: (identifier) @local.definition.parameter) ; x -> ...

((scoped_identifier
  (identifier) @local.definition.import)
  (#has-ancestor? @local.definition.import import_declaration))

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @local.definition.field))

; REFERENCES
(identifier) @local.reference

(type_identifier) @local.reference
