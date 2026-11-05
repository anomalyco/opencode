#ifndef TREE_SITTER_SUBTREE_H_
#define TREE_SITTER_SUBTREE_H_

#ifdef __cplusplus
extern "C" {
#endif

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include "./length.h"
#include "./array.h"
#include "./error_costs.h"
#include "./host.h"
#include "tree_sitter/api.h"
#include "./parser.h"

#define TS_TREE_STATE_NONE USHRT_MAX
#define NULL_SUBTREE ((Subtree) {.ptr = NULL})

// The serialized state of an external scanner.
//
// Every time an external token subtree is created after a call to an
// external scanner, the scanner's `serialize` function is called to
// retrieve a serialized copy of its state. The bytes are then copied
// onto the subtree itself so that the scanner's state can later be
// restored using its `deserialize` function.
//
// Small byte arrays are stored inline, and long ones are allocated
// separately on the heap.
typedef struct {
  union {
    char *long_data;
    char short_data[24];
  };
  uint32_t length;
} ExternalScannerState;

// A compact representation of a subtree.
//
// This representation is used for small leaf nodes that are not
// errors, and were not created by an external scanner.
//
// The idea behind the layout of this struct is that the `is_inline`
// bit will fall exactly into the same location as the least significant
// bit of the pointer in `Subtree` or `MutableSubtree`, respectively.
// Because of alignment, for any valid pointer this will be 0, giving
// us the opportunity to make use of this bit to signify whether to use
// the pointer or the inline struct.
typedef struct SubtreeInlineData SubtreeInlineData;

#define SUBTREE_BITS    \
  bool visible : 1;     \
  bool named : 1;       \
  bool extra : 1;       \
  bool has_changes : 1; \
  bool is_missing : 1;  \
  bool is_keyword : 1;

#define SUBTREE_SIZE           \
  uint8_t padding_columns;     \
  uint8_t padding_rows : 4;    \
  uint8_t lookahead_bytes : 4; \
  uint8_t padding_bytes;       \
  uint8_t size_bytes;

#if TS_BIG_ENDIAN
#if TS_PTR_SIZE == 32

struct SubtreeInlineData {
  uint16_t parse_state;
  uint8_t symbol;
  SUBTREE_BITS
  bool unused : 1;
  bool is_inline : 1;
  SUBTREE_SIZE
};

#else

struct SubtreeInlineData {
  SUBTREE_SIZE
  uint16_t parse_state;
  uint8_t symbol;
  SUBTREE_BITS
  bool unused : 1;
  bool is_inline : 1;
};

#endif
#else

struct SubtreeInlineData {
  bool is_inline : 1;
  SUBTREE_BITS
  uint8_t symbol;
  uint16_t parse_state;
  SUBTREE_SIZE
};

#endif

#undef SUBTREE_BITS
#undef SUBTREE_SIZE

// A heap-allocated representation of a subtree.
//
// This representation is used for parent nodes, external tokens,
// errors, and other leaf nodes whose data is too large to fit into
// the inline representation.
typedef struct {
  volatile uint32_t ref_count;
  Length padding;
  Length size;
  uint32_t lookahead_bytes;
  uint32_t error_cost;
  uint32_t child_count;
  TSSymbol symbol;
  TSStateId parse_state;

  bool visible : 1;
  bool named : 1;
  bool extra : 1;
  bool fragile_left : 1;
  bool fragile_right : 1;
  bool has_changes : 1;
  bool has_external_tokens : 1;
  bool has_external_scanner_state_change : 1;
  bool depends_on_column: 1;
  bool is_missing : 1;
  bool is_keyword : 1;

  union {
    // Non-terminal subtrees (`child_count > 0`)
    struct {
      uint32_t visible_child_count;
      uint32_t named_child_count;
      uint32_t visible_descendant_count;
      int32_t dynamic_precedence;
      uint16_t repeat_depth;
      uint16_t production_id;
      struct {
        TSSymbol symbol;
        TSStateId parse_state;
      } first_leaf;
    };

    // External terminal subtrees (`child_count == 0 && has_external_tokens`)
    ExternalScannerState external_scanner_state;

    // Error terminal subtrees (`child_count == 0 && symbol == ts_builtin_sym_error`)
    int32_t lookahead_char;
  };
} SubtreeHeapData;

// The fundamental building block of a syntax tree.
typedef union {
  SubtreeInlineData data;
  const SubtreeHeapData *ptr;
} Subtree;

// Like Subtree, but mutable.
typedef union {
  SubtreeInlineData data;
  SubtreeHeapData *ptr;
} MutableSubtree;

typedef Array(Subtree) SubtreeArray;
typedef Array(MutableSubtree) MutableSubtreeArray;

typedef struct {
  MutableSubtreeArray free_trees;
  MutableSubtreeArray tree_stack;
} SubtreePool;

void ts_external_scanner_state_init(ExternalScannerState *self, const char *data, unsigned length);
const char *ts_external_scanner_state_data(const ExternalScannerState *self);
bool ts_external_scanner_state_eq(const ExternalScannerState *self, const char *buffer, unsigned length);
void ts_external_scanner_state_delete(ExternalScannerState *self);

void ts_subtree_array_copy(SubtreeArray self, SubtreeArray *dest);
void ts_subtree_array_clear(SubtreePool *pool, SubtreeArray *self);
void ts_subtree_array_delete(SubtreePool *pool, SubtreeArray *self);
void ts_subtree_array_remove_trailing_extras(SubtreeArray *self, SubtreeArray *destination);
void ts_subtree_array_reverse(SubtreeArray *self);

SubtreePool ts_subtree_pool_new(uint32_t capacity);
void ts_subtree_pool_delete(SubtreePool *self);

Subtree ts_subtree_new_leaf(
  SubtreePool *pool, TSSymbol symbol, Length padding, Length size,
  uint32_t lookahead_bytes, TSStateId parse_state,
  bool has_external_tokens, bool depends_on_column,
  bool is_keyword, const TSLanguage *language
);
Subtree ts_subtree_new_error(
  SubtreePool *pool, int32_t lookahead_char, Length padding, Length size,
  uint32_t bytes_scanned, TSStateId parse_state, const TSLanguage *language
);
MutableSubtree ts_subtree_new_node(
  TSSymbol symbol,
  SubtreeArray *chiildren,
  unsigned production_id,
  const TSLanguage *language
);
Subtree ts_subtree_new_error_node(
  SubtreeArray *children,
  bool extra,
  const TSLanguage * language
);
Subtree ts_subtree_new_missing_leaf(
  SubtreePool *pool,
  TSSymbol symbol,
  Length padding,
  uint32_t lookahead_bytes,
  const TSLanguage *language
);
MutableSubtree ts_subtree_make_mut(SubtreePool *pool, Subtree self);
void ts_subtree_retain(Subtree self);
void ts_subtree_release(SubtreePool *pool, Subtree self);
int ts_subtree_compare(Subtree left, Subtree right, SubtreePool *pool);
void ts_subtree_set_symbol(MutableSubtree *self, TSSymbol symbol, const TSLanguage *language);
void ts_subtree_compress(MutableSubtree self, unsigned count, const TSLanguage *language, MutableSubtreeArray *stack);
void ts_subtree_summarize_children(MutableSubtree self, const TSLanguage *language);
Subtree ts_subtree_edit(Subtree self, const TSInputEdit *edit, SubtreePool *pool);
char *ts_subtree_string(Subtree self, TSSymbol alias_symbol, bool alias_is_named, const TSLanguage *language, bool include_all);
void ts_subtree_print_dot_graph(Subtree self, const TSLanguage *language, FILE *f);
Subtree ts_subtree_last_external_token(Subtree tree);
const ExternalScannerState *ts_subtree_external_scanner_state(Subtree self);
bool ts_subtree_external_scanner_state_eq(Subtree self, Subtree other);

#define SUBTREE_GET(self, name) ((self).data.is_inline ? (self).data.name : (self).ptr->name)

static inline TSSymbol ts_subtree_symbol(Subtree self) { return SUBTREE_GET(self, symbol); }
static inline bool ts_subtree_visible(Subtree self) { return SUBTREE_GET(self, visible); }
static inline bool ts_subtree_named(Subtree self) { return SUBTREE_GET(self, named); }
static inline bool ts_subtree_extra(Subtree self) { return SUBTREE_GET(self, extra); }
static inline bool ts_subtree_has_changes(Subtree self) { return SUBTREE_GET(self, has_changes); }
static inline bool ts_subtree_missing(Subtree self) { return SUBTREE_GET(self, is_missing); }
static inline bool ts_subtree_is_keyword(Subtree self) { return SUBTREE_GET(self, is_keyword); }
static inline TSStateId ts_subtree_parse_state(Subtree self) { return SUBTREE_GET(self, parse_state); }
static inline uint32_t ts_subtree_lookahead_bytes(Subtree self) { return SUBTREE_GET(self, lookahead_bytes); }

#undef SUBTREE_GET

// Get the size needed to store a heap-allocated subtree with the given
// number of children.
static inline size_t ts_subtree_alloc_size(uint32_t child_count) {
  return child_count * sizeof(Subtree) + sizeof(SubtreeHeapData);
}

// Get a subtree's children, which are allocated immediately before the
// tree's own heap data.
#define ts_subtree_children(self) \
  ((self).data.is_inline ? NULL : (Subtree *)((self).ptr) - (self).ptr->child_count)

static inline void ts_subtree_set_extra(MutableSubtree *self, bool is_extra) {
  if (self->data.is_inline) {
    self->data.extra = is_extra;
  } else {
    self->ptr->extra = is_extra;
  }
}

static inline TSSymbol ts_subtree_leaf_symbol(Subtree self) {
  if (self.data.is_inline) return self.data.symbol;
  if (self.ptr->child_count == 0) return self.ptr->symbol;
  return self.ptr->first_leaf.symbol;
}

static inline TSStateId ts_subtree_leaf_parse_state(Subtree self) {
  if (self.data.is_inline) return self.data.parse_state;
  if (self.ptr->child_count == 0) return self.ptr->parse_state;
  return self.ptr->first_leaf.parse_state;
}

static inline Length ts_subtree_padding(Subtree self) {
  if (self.data.is_inline) {
    Length result = {self.data.padding_bytes, {self.data.padding_rows, self.data.padding_columns}};
    return result;
  } else {
    return self.ptr->padding;
  }
}

static inline Length ts_subtree_size(Subtree self) {
  if (self.data.is_inline) {
    Length result = {self.data.size_bytes, {0, self.data.size_bytes}};
    return result;
  } else {
    return self.ptr->size;
  }
}

static inline Length ts_subtree_total_size(Subtree self) {
  return length_add(ts_subtree_padding(self), ts_subtree_size(self));
}

static inline uint32_t ts_subtree_total_bytes(Subtree self) {
  return ts_subtree_total_size(self).bytes;
}

static inline uint32_t ts_subtree_child_count(Subtree self) {
  return self.data.is_inline ? 0 : self.ptr->child_count;
}

static inline uint32_t ts_subtree_repeat_depth(Subtree self) {
  return self.data.is_inline ? 0 : self.ptr->repeat_depth;
}

static inline uint32_t ts_subtree_is_repetition(Subtree self) {
  return self.data.is_inline
    ? 0
    : !self.ptr->named && !self.ptr->visible && self.ptr->child_count != 0;
}

static inline uint32_t ts_subtree_visible_descendant_count(Subtree self) {
  return (self.data.is_inline || self.ptr->child_count == 0)
    ? 0
    : self.ptr->visible_descendant_count;
}

static inline uint32_t ts_subtree_visible_child_count(Subtree self) {
  if (ts_subtree_child_count(self) > 0) {
    return self.ptr->visible_child_count;
  } else {
    return 0;
  }
}

static inline uint32_t ts_subtree_error_cost(Subtree self) {
  if (ts_subtree_missing(self)) {
    return ERROR_COST_PER_MISSING_TREE + ERROR_COST_PER_RECOVERY;
  } else {
    return self.data.is_inline ? 0 : self.ptr->error_cost;
  }
}

static inline int32_t ts_subtree_dynamic_precedence(Subtree self) {
  return (self.data.is_inline || self.ptr->child_count == 0) ? 0 : self.ptr->dynamic_precedence;
}

static inline uint16_t ts_subtree_production_id(Subtree self) {
  if (ts_subtree_child_count(self) > 0) {
    return self.ptr->production_id;
  } else {
    return 0;
  }
}

static inline bool ts_subtree_fragile_left(Subtree self) {
  return self.data.is_inline ? false : self.ptr->fragile_left;
}

static inline bool ts_subtree_fragile_right(Subtree self) {
  return self.data.is_inline ? false : self.ptr->fragile_right;
}

static inline bool ts_subtree_has_external_tokens(Subtree self) {
  return self.data.is_inline ? false : self.ptr->has_external_tokens;
}

static inline bool ts_subtree_has_external_scanner_state_change(Subtree self) {
  return self.data.is_inline ? false : self.ptr->has_external_scanner_state_change;
}

static inline bool ts_subtree_depends_on_column(Subtree self) {
  return self.data.is_inline ? false : self.ptr->depends_on_column;
}

static inline bool ts_subtree_is_fragile(Subtree self) {
  return self.data.is_inline ? false : (self.ptr->fragile_left || self.ptr->fragile_right);
}

static inline bool ts_subtree_is_error(Subtree self) {
  return ts_subtree_symbol(self) == ts_builtin_sym_error;
}

static inline bool ts_subtree_is_eof(Subtree self) {
  return ts_subtree_symbol(self) == ts_builtin_sym_end;
}

static inline Subtree ts_subtree_from_mut(MutableSubtree self) {
  Subtree result;
  result.data = self.data;
  return result;
}

static inline MutableSubtree ts_subtree_to_mut_unsafe(Subtree self) {
  MutableSubtree result;
  result.data = self.data;
  return result;
}

#ifdef __cplusplus
}
#endif

#endif  // TREE_SITTER_SUBTREE_H_
