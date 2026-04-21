; The MIT License (MIT)
;
; Copyright (c) 2016 Rob Rix
;
; Permission is hereby granted, free of charge, to any person obtaining a copy
; of this software and associated documentation files (the "Software"), to deal
; in the Software without restriction, including without limitation the rights
; to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
; copies of the Software, and to permit persons to whom the Software is
; furnished to do so, subject to the following conditions:
; 
; The above copyright notice and this permission notice shall be included in all
; copies or substantial portions of the Software.
; 
; THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
; IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
; FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
; AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
; LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
; OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
; SOFTWARE.
; DECLARATIONS AND SCOPES
(method) @local.scope

(class) @local.scope

[
  (block)
  (do_block)
] @local.scope

(identifier) @local.reference

(constant) @local.reference

(instance_variable) @local.reference

(module
  name: (constant) @local.definition.namespace)

(class
  name: (constant) @local.definition.type)

(method
  name: [
    (identifier)
    (constant)
  ] @local.definition.function)

(singleton_method
  name: [
    (identifier)
    (constant)
  ] @local.definition.function)

(method_parameters
  (identifier) @local.definition.var)

(lambda_parameters
  (identifier) @local.definition.var)

(block_parameters
  (identifier) @local.definition.var)

(splat_parameter
  (identifier) @local.definition.var)

(hash_splat_parameter
  (identifier) @local.definition.var)

(optional_parameter
  name: (identifier) @local.definition.var)

(destructured_parameter
  (identifier) @local.definition.var)

(block_parameter
  name: (identifier) @local.definition.var)

(keyword_parameter
  name: (identifier) @local.definition.var)

(assignment
  left: (_) @local.definition.var)

(left_assignment_list
  (identifier) @local.definition.var)

(rest_assignment
  (identifier) @local.definition.var)

(destructured_left_assignment
  (identifier) @local.definition.var)
