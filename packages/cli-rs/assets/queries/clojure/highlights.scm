; >> Explanation
; Parsers for lisps are a bit weird in that they just return the raw forms.
; This means we have to do a bit of extra work in the queries to get things
; highlighted as they should be.
;
; For the most part this means that some things have to be assigned multiple
; groups.
; By doing this we can add a basic capture and then later refine it with more
; specialized captures.
; This can mean that sometimes things are highlighted weirdly because they
; have multiple highlight groups applied to them.
; >> Literals
((dis_expr) @comment
  (#set! priority 105)
  ; Higher priority to mark the whole sexpr as a comment
  )

(kwd_lit) @string.special.symbol

(str_lit) @string

(num_lit) @number

(char_lit) @character

(bool_lit) @boolean

(nil_lit) @constant.builtin

(comment) @comment @spell

(regex_lit) @string.regexp

[
  "'"
  "`"
] @string.escape

[
  "~"
  "~@"
  "#"
] @punctuation.special

[
  "{"
  "}"
  "["
  "]"
  "("
  ")"
] @punctuation.bracket

; >> Symbols
; General symbol highlighting
(sym_lit) @variable

; General function calls
(list_lit
  .
  (sym_lit) @function.call)

(anon_fn_lit
  .
  (sym_lit) @function.call)

; Quoted symbols
(quoting_lit
  (sym_lit) @string.special.symbol)

(syn_quoting_lit
  (sym_lit) @string.special.symbol)

; Used in destructure pattern
((sym_lit) @variable.parameter
  (#lua-match? @variable.parameter "^[&]"))

; Inline function variables
((sym_lit) @variable.builtin
  (#lua-match? @variable.builtin "^%%%d*$"))

((sym_lit) @variable.builtin
  (#eq? @variable.builtin "%&"))

; Constructor
((sym_lit) @constructor
  (#lua-match? @constructor "^-%>[^>].*"))

; Builtin dynamic variables
((sym_lit) @variable.builtin
  (#any-of? @variable.builtin
    "*agent*" "*allow-unresolved-vars*" "*assert*" "*clojure-version*" "*command-line-args*"
    "*compile-files*" "*compile-path*" "*compiler-options*" "*data-readers*"
    "*default-data-reader-fn*" "*err*" "*file*" "*flush-on-newline*" "*fn-loader*" "*in*"
    "*math-context*" "*ns*" "*out*" "*print-dup*" "*print-length*" "*print-level*" "*print-meta*"
    "*print-namespace-maps*" "*print-readably*" "*read-eval*" "*reader-resolver*" "*source-path*"
    "*suppress-read*" "*unchecked-math*" "*use-context-classloader*" "*verbose-defrecords*"
    "*warn-on-reflection*"))

; Builtin repl variables
((sym_lit) @variable.builtin
  (#any-of? @variable.builtin "*1" "*2" "*3" "*e"))

; Types
(sym_lit
  name: (sym_name) @_name
  (#lua-match? @_name "^[%u][^/%s]*$")) @type

; Symbols with `.` but not `/`
(sym_lit
  !namespace
  name: (sym_name) @_name
  (#lua-match? @_name "^[^.]+[.]")) @type

; Interop
; (.instanceMember instance args*)
; (.instanceMember Classname args*)
((sym_lit
  name: (sym_name) @_name) @function.method
  (#lua-match? @_name "^%.[^-]"))

; (.-instanceField instance)
((sym_name) @variable.member
  (#lua-match? @variable.member "^%.%-%S*"))

;  Classname/staticField
(sym_lit
  namespace: (sym_ns) @_namespace
  (#lua-match? @_namespace "^[%u]%S*$")) @variable.member

; (Classname/staticMethod args*)
(list_lit
  .
  (sym_lit
    namespace: (sym_ns) @_namespace
    (#lua-match? @_namespace "^%u")) @function.method)

; TODO: Special casing for the `.` macro
; Operators
((sym_lit) @operator
  (#any-of? @operator "*" "*'" "+" "+'" "-" "-'" "/" "<" "<=" ">" ">=" "=" "=="))

((sym_lit) @keyword.operator
  (#any-of? @keyword.operator "not" "not=" "and" "or"))

; Definition functions
((sym_lit) @keyword
  (#any-of? @keyword
    "def" "defonce" "defrecord" "defmacro" "definline" "definterface" "defmulti" "defmethod"
    "defstruct" "defprotocol" "deftype"))

((sym_lit) @keyword
  (#eq? @keyword "declare"))

((sym_name) @keyword.coroutine
  (#any-of? @keyword.coroutine
    "alts!" "alts!!" "await" "await-for" "await1" "chan" "close!" "future" "go" "sync" "thread"
    "timeout" "<!" "<!!" ">!" ">!!"))

((sym_lit
  name: (sym_name) @_keyword.function.name) @keyword.function
  (#any-of? @_keyword.function.name "defn" "defn-" "fn" "fn*"))

; Comment
((sym_lit) @comment
  (#eq? @comment "comment"))

; Conditionals
((sym_lit) @keyword.conditional
  (#any-of? @keyword.conditional "case" "cond" "cond->" "cond->>" "condp"))

((sym_lit) @keyword.conditional
  (#any-of? @keyword.conditional "if" "if-let" "if-not" "if-some"))

((sym_lit) @keyword.conditional
  (#any-of? @keyword.conditional "when" "when-first" "when-let" "when-not" "when-some"))

; Repeats
((sym_lit) @keyword.repeat
  (#any-of? @keyword.repeat "doseq" "dotimes" "for" "loop" "recur" "while"))

; Exception
((sym_lit) @keyword.exception
  (#any-of? @keyword.exception "throw" "try" "catch" "finally"))

; Includes
((sym_lit) @keyword.import
  (#any-of? @keyword.import "ns" "import" "require" "use"))

; Builtin macros
; TODO: Do all these items belong here?
((sym_lit
  name: (sym_name) @function.macro)
  (#any-of? @function.macro
    "." ".." "->" "->>" "amap" "areduce" "as->" "assert" "binding" "bound-fn" "delay" "do" "dosync"
    "doto" "extend-protocol" "extend-type" "gen-class" "gen-interface" "io!" "lazy-cat" "lazy-seq"
    "let" "letfn" "locking" "memfn" "monitor-enter" "monitor-exit" "proxy" "proxy-super" "pvalues"
    "refer-clojure" "reify" "set!" "some->" "some->>" "time" "unquote" "unquote-splicing" "var"
    "vswap!" "with-bindings" "with-in-str" "with-loading-context" "with-local-vars" "with-open"
    "with-out-str" "with-precision" "with-redefs"))

; All builtin functions
; (->> (ns-publics *ns*)
;      (keep (fn [[s v]] (when-not (:macro (meta v)) s)))
;      sort
;      clojure.pprint/pprint))
; ...and then lots of manual filtering...
((sym_lit
  name: (sym_name) @function.builtin)
  (#any-of? @function.builtin
    "->ArrayChunk" "->Eduction" "->Vec" "->VecNode" "->VecSeq" "-cache-protocol-fn" "-reset-methods"
    "PrintWriter-on" "StackTraceElement->vec" "Throwable->map" "accessor" "aclone" "add-classpath"
    "add-tap" "add-watch" "agent" "agent-error" "agent-errors" "aget" "alength" "alias" "all-ns"
    "alter" "alter-meta!" "alter-var-root" "ancestors" "any?" "apply" "array-map" "aset"
    "aset-boolean" "aset-byte" "aset-char" "aset-double" "aset-float" "aset-int" "aset-long"
    "aset-short" "assoc" "assoc!" "assoc-in" "associative?" "atom" "bases" "bean" "bigdec" "bigint"
    "biginteger" "bit-and" "bit-and-not" "bit-clear" "bit-flip" "bit-not" "bit-or" "bit-set"
    "bit-shift-left" "bit-shift-right" "bit-test" "bit-xor" "boolean" "boolean-array" "boolean?"
    "booleans" "bound-fn*" "bound?" "bounded-count" "butlast" "byte" "byte-array" "bytes" "bytes?"
    "cast" "cat" "char" "char-array" "char-escape-string" "char-name-string" "char?" "chars" "chunk"
    "chunk-append" "chunk-buffer" "chunk-cons" "chunk-first" "chunk-next" "chunk-rest"
    "chunked-seq?" "class" "class?" "clear-agent-errors" "clojure-version" "coll?" "commute" "comp"
    "comparator" "compare" "compare-and-set!" "compile" "complement" "completing" "concat" "conj"
    "conj!" "cons" "constantly" "construct-proxy" "contains?" "count" "counted?" "create-ns"
    "create-struct" "cycle" "dec" "dec'" "decimal?" "dedupe" "default-data-readers" "delay?"
    "deliver" "denominator" "deref" "derive" "descendants" "destructure" "disj" "disj!" "dissoc"
    "dissoc!" "distinct" "distinct?" "doall" "dorun" "double" "double-array" "eduction" "empty"
    "empty?" "ensure" "ensure-reduced" "enumeration-seq" "error-handler" "error-mode" "eval" "even?"
    "every-pred" "every?" "extend" "extenders" "extends?" "false?" "ffirst" "file-seq" "filter"
    "filterv" "find" "find-keyword" "find-ns" "find-protocol-impl" "find-protocol-method" "find-var"
    "first" "flatten" "float" "float-array" "float?" "floats" "flush" "fn?" "fnext" "fnil" "force"
    "format" "frequencies" "future-call" "future-cancel" "future-cancelled?" "future-done?"
    "future?" "gensym" "get" "get-in" "get-method" "get-proxy-class" "get-thread-bindings"
    "get-validator" "group-by" "halt-when" "hash" "hash-combine" "hash-map" "hash-ordered-coll"
    "hash-set" "hash-unordered-coll" "ident?" "identical?" "identity" "ifn?" "in-ns" "inc" "inc'"
    "indexed?" "init-proxy" "inst-ms" "inst-ms*" "inst?" "instance?" "int" "int-array" "int?"
    "integer?" "interleave" "intern" "interpose" "into" "into-array" "ints" "isa?" "iterate"
    "iterator-seq" "juxt" "keep" "keep-indexed" "key" "keys" "keyword" "keyword?" "last" "line-seq"
    "list" "list*" "list?" "load" "load-file" "load-reader" "load-string" "loaded-libs" "long"
    "long-array" "longs" "macroexpand" "macroexpand-1" "make-array" "make-hierarchy" "map"
    "map-entry?" "map-indexed" "map?" "mapcat" "mapv" "max" "max-key" "memoize" "merge" "merge-with"
    "meta" "method-sig" "methods" "min" "min-key" "mix-collection-hash" "mod" "munge" "name"
    "namespace" "namespace-munge" "nat-int?" "neg-int?" "neg?" "newline" "next" "nfirst" "nil?"
    "nnext" "not-any?" "not-empty" "not-every?" "ns-aliases" "ns-imports" "ns-interns" "ns-map"
    "ns-name" "ns-publics" "ns-refers" "ns-resolve" "ns-unalias" "ns-unmap" "nth" "nthnext"
    "nthrest" "num" "number?" "numerator" "object-array" "odd?" "parents" "partial" "partition"
    "partition-all" "partition-by" "pcalls" "peek" "persistent!" "pmap" "pop" "pop!"
    "pop-thread-bindings" "pos-int?" "pos?" "pr" "pr-str" "prefer-method" "prefers"
    "primitives-classnames" "print" "print-ctor" "print-dup" "print-method" "print-simple"
    "print-str" "printf" "println" "println-str" "prn" "prn-str" "promise" "proxy-call-with-super"
    "proxy-mappings" "proxy-name" "push-thread-bindings" "qualified-ident?" "qualified-keyword?"
    "qualified-symbol?" "quot" "rand" "rand-int" "rand-nth" "random-sample" "range" "ratio?"
    "rational?" "rationalize" "re-find" "re-groups" "re-matcher" "re-matches" "re-pattern" "re-seq"
    "read" "read+string" "read-line" "read-string" "reader-conditional" "reader-conditional?"
    "realized?" "record?" "reduce" "reduce-kv" "reduced" "reduced?" "reductions" "ref"
    "ref-history-count" "ref-max-history" "ref-min-history" "ref-set" "refer"
    "release-pending-sends" "rem" "remove" "remove-all-methods" "remove-method" "remove-ns"
    "remove-tap" "remove-watch" "repeat" "repeatedly" "replace" "replicate" "requiring-resolve"
    "reset!" "reset-meta!" "reset-vals!" "resolve" "rest" "restart-agent" "resultset-seq" "reverse"
    "reversible?" "rseq" "rsubseq" "run!" "satisfies?" "second" "select-keys" "send" "send-off"
    "send-via" "seq" "seq?" "seqable?" "seque" "sequence" "sequential?" "set"
    "set-agent-send-executor!" "set-agent-send-off-executor!" "set-error-handler!" "set-error-mode!"
    "set-validator!" "set?" "short" "short-array" "shorts" "shuffle" "shutdown-agents"
    "simple-ident?" "simple-keyword?" "simple-symbol?" "slurp" "some" "some-fn" "some?" "sort"
    "sort-by" "sorted-map" "sorted-map-by" "sorted-set" "sorted-set-by" "sorted?" "special-symbol?"
    "spit" "split-at" "split-with" "str" "string?" "struct" "struct-map" "subs" "subseq" "subvec"
    "supers" "swap!" "swap-vals!" "symbol" "symbol?" "tagged-literal" "tagged-literal?" "take"
    "take-last" "take-nth" "take-while" "tap>" "test" "the-ns" "thread-bound?" "to-array"
    "to-array-2d" "trampoline" "transduce" "transient" "tree-seq" "true?" "type" "unchecked-add"
    "unchecked-add-int" "unchecked-byte" "unchecked-char" "unchecked-dec" "unchecked-dec-int"
    "unchecked-divide-int" "unchecked-double" "unchecked-float" "unchecked-inc" "unchecked-inc-int"
    "unchecked-int" "unchecked-long" "unchecked-multiply" "unchecked-multiply-int"
    "unchecked-negate" "unchecked-negate-int" "unchecked-remainder-int" "unchecked-short"
    "unchecked-subtract" "unchecked-subtract-int" "underive" "unquote" "unquote-splicing"
    "unreduced" "unsigned-bit-shift-right" "update" "update-in" "update-proxy" "uri?" "uuid?" "val"
    "vals" "var-get" "var-set" "var?" "vary-meta" "vec" "vector" "vector-of" "vector?" "volatile!"
    "volatile?" "vreset!" "with-bindings*" "with-meta" "with-redefs-fn" "xml-seq" "zero?" "zipmap"
    ; earlier
    "drop" "drop-last" "drop-while" "double?" "doubles" "ex-data" "ex-info"
    ; 1.10
    "ex-cause" "ex-message"
    ; 1.11
    "NaN?" "abs" "infinite?" "iteration" "random-uuid" "parse-boolean" "parse-double" "parse-long"
    "parse-uuid" "seq-to-map-for-destructuring" "update-keys" "update-vals"
    ; 1.12
    "partitionv" "partitionv-all" "splitv-at"))

; >> Context based highlighting
; def-likes
; Correctly highlight docstrings
;(list_lit
;.
;(sym_lit) @_keyword ; Don't really want to highlight twice
;(#any-of? @_keyword
;"def" "defonce" "defrecord" "defmacro" "definline"
;"defmulti" "defmethod" "defstruct" "defprotocol"
;"deftype")
;.
;(sym_lit)
;.
; TODO: Add @comment highlight
;(str_lit)?
;.
;(_))
; Function definitions
(list_lit
  .
  ((sym_lit
    name: (sym_name) @_keyword.function.name)
    (#any-of? @_keyword.function.name "defn" "defn-" "fn" "fn*"))
  .
  (sym_lit)? @function
  .
  ; TODO: Add @comment highlight
  (str_lit)?)

; TODO: Fix parameter highlighting
;       I think there's a bug here in nvim-treesitter
; TODO: Reproduce bug and file ticket
;.
;[(vec_lit
;  (sym_lit)* @variable.parameter)
; (list_lit
;  (vec_lit
;   (sym_lit)* @variable.parameter))])
;[((list_lit
;   (vec_lit
;    (sym_lit) @variable.parameter)
;   (_)
;  +
; ((vec_lit
;   (sym_lit) @variable.parameter)
;  (_)))
; Meta punctuation
; NOTE: When the above `Function definitions` query captures the
;       the @function it also captures the child meta_lit
;       We capture the meta_lit symbol (^) after so that the later
;       highlighting overrides the former
"^" @punctuation.special

; namespaces
(list_lit
  .
  (sym_lit) @_include
  (#eq? @_include "ns")
  .
  (sym_lit) @module)
