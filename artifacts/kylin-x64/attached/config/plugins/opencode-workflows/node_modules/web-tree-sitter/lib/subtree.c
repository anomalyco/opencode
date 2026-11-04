#include <ctype.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include "./alloc.h"
#include "./array.h"
#include "./atomic.h"
#include "./subtree.h"
#include "./length.h"
#include "./language.h"
#include "./error_costs.h"
#include "./ts_assert.h"
#include <stddef.h>

typedef struct {
  Length start;
  Length old_end;
  Length new_end;
} Edit;

#define TS_MAX_INLINE_TREE_LENGTH UINT8_MAX
#define TS_MAX_TREE_POOL_SIZE 32

// ExternalScannerState

void ts_external_scanner_state_init(ExternalScannerState *self, const char *data, unsigned length) {
  self->length = length;
  if (length > sizeof(self->short_data)) {
    self->long_data = ts_malloc(length);
    memcpy(self->long_data, data, length);
  } else {
    memcpy(self->short_data, data, length);
  }
}

ExternalScannerState ts_external_scanner_state_copy(const ExternalScannerState *self) {
  ExternalScannerState result = *self;
  if (self->length > sizeof(self->short_data)) {
    result.long_data = ts_malloc(self->length);
    memcpy(result.long_data, self->long_data, self->length);
  }
  return result;
}

void ts_external_scanner_state_delete(ExternalScannerState *self) {
  if (self->length > sizeof(self->short_data)) {
    ts_free(self->long_data);
  }
}

const char *ts_external_scanner_state_data(const ExternalScannerState *self) {
  if (self->length > sizeof(self->short_data)) {
    return self->long_data;
  } else {
    return self->short_data;
  }
}

bool ts_external_scanner_state_eq(const ExternalScannerState *self, const char *buffer, unsigned length) {
  return
    self->length == length &&
    memcmp(ts_external_scanner_state_data(self), buffer, length) == 0;
}

// SubtreeArray

void ts_subtree_array_copy(SubtreeArray self, SubtreeArray *dest) {
  dest->size = self.size;
  dest->capacity = self.capacity;
  dest->contents = self.contents;
  if (self.capacity > 0) {
    dest->contents = ts_calloc(self.capacity, sizeof(Subtree));
    memcpy(dest->contents, self.contents, self.size * sizeof(Subtree));
    for (uint32_t i = 0; i < self.size; i++) {
      ts_subtree_retain(*array_get(dest, i));
    }
  }
}

void ts_subtree_array_clear(SubtreePool *pool, SubtreeArray *self) {
  for (uint32_t i = 0; i < self->size; i++) {
    ts_subtree_release(pool, *array_get(self, i));
  }
  array_clear(self);
}

void ts_subtree_array_delete(SubtreePool *pool, SubtreeArray *self) {
  ts_subtree_array_clear(pool, self);
  array_delete(self);
}

void ts_subtree_array_remove_trailing_extras(
  SubtreeArray *self,
  SubtreeArray *destination
) {
  array_clear(destination);
  while (self->size > 0) {
    Subtree last = *array_get(self, self->size - 1);
    if (ts_subtree_extra(last)) {
      self->size--;
      array_push(destination, last);
    } else {
      break;
    }
  }
  ts_subtree_array_reverse(destination);
}

void ts_subtree_array_reverse(SubtreeArray *self) {
  for (uint32_t i = 0, limit = self->size / 2; i < limit; i++) {
    size_t reverse_index = self->size - 1 - i;
    Subtree swap = *array_get(self, i);
    *array_get(self, i) = *array_get(self, reverse_index);
    *array_get(self, reverse_index) = swap;
  }
}

// SubtreePool

SubtreePool ts_subtree_pool_new(uint32_t capacity) {
  SubtreePool self = {array_new(), array_new()};
  array_reserve(&self.free_trees, capacity);
  return self;
}

void ts_subtree_pool_delete(SubtreePool *self) {
  if (self->free_trees.contents) {
    for (unsigned i = 0; i < self->free_trees.size; i++) {
      ts_free(array_get(&self->free_trees, i)->ptr);
    }
    array_delete(&self->free_trees);
  }
  if (self->tree_stack.contents) array_delete(&self->tree_stack);
}

static SubtreeHeapData *ts_subtree_pool_allocate(SubtreePool *self) {
  if (self->free_trees.size > 0) {
    return array_pop(&self->free_trees).ptr;
  } else {
    return ts_malloc(sizeof(SubtreeHeapData));
  }
}

static void ts_subtree_pool_free(SubtreePool *self, SubtreeHeapData *tree) {
  if (self->free_trees.capacity > 0 && self->free_trees.size + 1 <= TS_MAX_TREE_POOL_SIZE) {
    array_push(&self->free_trees, (MutableSubtree) {.ptr = tree});
  } else {
    ts_free(tree);
  }
}

// Subtree

static inline bool ts_subtree_can_inline(Length padding, Length size, uint32_t lookahead_bytes) {
  return
    padding.bytes < TS_MAX_INLINE_TREE_LENGTH &&
    padding.extent.row < 16 &&
    padding.extent.column < TS_MAX_INLINE_TREE_LENGTH &&
    size.bytes < TS_MAX_INLINE_TREE_LENGTH &&
    size.extent.row == 0 &&
    size.extent.column < TS_MAX_INLINE_TREE_LENGTH &&
    lookahead_bytes < 16;
}

Subtree ts_subtree_new_leaf(
  SubtreePool *pool, TSSymbol symbol, Length padding, Length size,
  uint32_t lookahead_bytes, TSStateId parse_state,
  bool has_external_tokens, bool depends_on_column,
  bool is_keyword, const TSLanguage *language
) {
  TSSymbolMetadata metadata = ts_language_symbol_metadata(language, symbol);
  bool extra = symbol == ts_builtin_sym_end;

  bool is_inline = (
    symbol <= UINT8_MAX &&
    !has_external_tokens &&
    ts_subtree_can_inline(padding, size, lookahead_bytes)
  );

  if (is_inline) {
    return (Subtree) {{
      .parse_state = parse_state,
      .symbol = symbol,
      .padding_bytes = padding.bytes,
      .padding_rows = padding.extent.row,
      .padding_columns = padding.extent.column,
      .size_bytes = size.bytes,
      .lookahead_bytes = lookahead_bytes,
      .visible = metadata.visible,
      .named = metadata.named,
      .extra = extra,
      .has_changes = false,
      .is_missing = false,
      .is_keyword = is_keyword,
      .is_inline = true,
    }};
  } else {
    SubtreeHeapData *data = ts_subtree_pool_allocate(pool);
    *data = (SubtreeHeapData) {
      .ref_count = 1,
      .padding = padding,
      .size = size,
      .lookahead_bytes = lookahead_bytes,
      .error_cost = 0,
      .child_count = 0,
      .symbol = symbol,
      .parse_state = parse_state,
      .visible = metadata.visible,
      .named = metadata.named,
      .extra = extra,
      .fragile_left = false,
      .fragile_right = false,
      .has_changes = false,
      .has_external_tokens = has_external_tokens,
      .has_external_scanner_state_change = false,
      .depends_on_column = depends_on_column,
      .is_missing = false,
      .is_keyword = is_keyword,
      {{.first_leaf = {.symbol = 0, .parse_state = 0}}}
    };
    return (Subtree) {.ptr = data};
  }
}

void ts_subtree_set_symbol(
  MutableSubtree *self,
  TSSymbol symbol,
  const TSLanguage *language
) {
  TSSymbolMetadata metadata = ts_language_symbol_metadata(language, symbol);
  if (self->data.is_inline) {
    ts_assert(symbol < UINT8_MAX);
    self->data.symbol = symbol;
    self->data.named = metadata.named;
    self->data.visible = metadata.visible;
  } else {
    self->ptr->symbol = symbol;
    self->ptr->named = metadata.named;
    self->ptr->visible = metadata.visible;
  }
}

Subtree ts_subtree_new_error(
  SubtreePool *pool, int32_t lookahead_char, Length padding, Length size,
  uint32_t bytes_scanned, TSStateId parse_state, const TSLanguage *language
) {
  Subtree result = ts_subtree_new_leaf(
    pool, ts_builtin_sym_error, padding, size, bytes_scanned,
    parse_state, false, false, false, language
  );
  SubtreeHeapData *data = (SubtreeHeapData *)result.ptr;
  data->fragile_left = true;
  data->fragile_right = true;
  data->lookahead_char = lookahead_char;
  return result;
}

// Clone a subtree.
MutableSubtree ts_subtree_clone(Subtree self) {
  size_t alloc_size = ts_subtree_alloc_size(self.ptr->child_count);
  Subtree *new_children = ts_malloc(alloc_size);
  Subtree *old_children = ts_subtree_children(self);
  memcpy(new_children, old_children, alloc_size);
  SubtreeHeapData *result = (SubtreeHeapData *)&new_children[self.ptr->child_count];
  if (self.ptr->child_count > 0) {
    for (uint32_t i = 0; i < self.ptr->child_count; i++) {
      ts_subtree_retain(new_children[i]);
    }
  } else if (self.ptr->has_external_tokens) {
    result->external_scanner_state = ts_external_scanner_state_copy(
      &self.ptr->external_scanner_state
    );
  }
  result->ref_count = 1;
  return (MutableSubtree) {.ptr = result};
}

// Get mutable version of a subtree.
//
// This takes ownership of the subtree. If the subtree has only one owner,
// this will directly convert it into a mutable version. Otherwise, it will
// perform a copy.
MutableSubtree ts_subtree_make_mut(SubtreePool *pool, Subtree self) {
  if (self.data.is_inline) return (MutableSubtree) {self.data};
  if (self.ptr->ref_count == 1) return ts_subtree_to_mut_unsafe(self);
  MutableSubtree result = ts_subtree_clone(self);
  ts_subtree_release(pool, self);
  return result;
}

void ts_subtree_compress(
  MutableSubtree self,
  unsigned count,
  const TSLanguage *language,
  MutableSubtreeArray *stack
) {
  unsigned initial_stack_size = stack->size;

  MutableSubtree tree = self;
  TSSymbol symbol = tree.ptr->symbol;
  for (unsigned i = 0; i < count; i++) {
    if (tree.ptr->ref_count > 1 || tree.ptr->child_count < 2) break;

    MutableSubtree child = ts_subtree_to_mut_unsafe(ts_subtree_children(tree)[0]);
    if (
      child.data.is_inline ||
      child.ptr->child_count < 2 ||
      child.ptr->ref_count > 1 ||
      child.ptr->symbol != symbol
    ) break;

    MutableSubtree grandchild = ts_subtree_to_mut_unsafe(ts_subtree_children(child)[0]);
    if (
      grandchild.data.is_inline ||
      grandchild.ptr->child_count < 2 ||
      grandchild.ptr->ref_count > 1 ||
      grandchild.ptr->symbol != symbol
    ) break;

    ts_subtree_children(tree)[0] = ts_subtree_from_mut(grandchild);
    ts_subtree_children(child)[0] = ts_subtree_children(grandchild)[grandchild.ptr->child_count - 1];
    ts_subtree_children(grandchild)[grandchild.ptr->child_count - 1] = ts_subtree_from_mut(child);
    array_push(stack, tree);
    tree = grandchild;
  }

  while (stack->size > initial_stack_size) {
    tree = array_pop(stack);
    MutableSubtree child = ts_subtree_to_mut_unsafe(ts_subtree_children(tree)[0]);
    MutableSubtree grandchild = ts_subtree_to_mut_unsafe(ts_subtree_children(child)[child.ptr->child_count - 1]);
    ts_subtree_summarize_children(grandchild, language);
    ts_subtree_summarize_children(child, language);
    ts_subtree_summarize_children(tree, language);
  }
}

// Assign all of the node's properties that depend on its children.
void ts_subtree_summarize_children(
  MutableSubtree self,
  const TSLanguage *language
) {
  ts_assert(!self.data.is_inline);

  self.ptr->named_child_count = 0;
  self.ptr->visible_child_count = 0;
  self.ptr->error_cost = 0;
  self.ptr->repeat_depth = 0;
  self.ptr->visible_descendant_count = 0;
  self.ptr->has_external_tokens = false;
  self.ptr->depends_on_column = false;
  self.ptr->has_external_scanner_state_change = false;
  self.ptr->dynamic_precedence = 0;

  uint32_t structural_index = 0;
  const TSSymbol *alias_sequence = ts_language_alias_sequence(language, self.ptr->production_id);
  uint32_t lookahead_end_byte = 0;

  const Subtree *children = ts_subtree_children(self);
  for (uint32_t i = 0; i < self.ptr->child_count; i++) {
    Subtree child = children[i];

    if (
      self.ptr->size.extent.row == 0 &&
      ts_subtree_depends_on_column(child)
    ) {
      self.ptr->depends_on_column = true;
    }

    if (ts_subtree_has_external_scanner_state_change(child)) {
      self.ptr->has_external_scanner_state_change = true;
    }

    if (i == 0) {
      self.ptr->padding = ts_subtree_padding(child);
      self.ptr->size = ts_subtree_size(child);
    } else {
      self.ptr->size = length_add(self.ptr->size, ts_subtree_total_size(child));
    }

    uint32_t child_lookahead_end_byte =
      self.ptr->padding.bytes +
      self.ptr->size.bytes +
      ts_subtree_lookahead_bytes(child);
    if (child_lookahead_end_byte > lookahead_end_byte) {
      lookahead_end_byte = child_lookahead_end_byte;
    }

    if (ts_subtree_symbol(child) != ts_builtin_sym_error_repeat) {
      self.ptr->error_cost += ts_subtree_error_cost(child);
    }

    uint32_t grandchild_count = ts_subtree_child_count(child);
    if (
      self.ptr->symbol == ts_builtin_sym_error ||
      self.ptr->symbol == ts_builtin_sym_error_repeat
    ) {
      if (!ts_subtree_extra(child) && !(ts_subtree_is_error(child) && grandchild_count == 0)) {
        if (ts_subtree_visible(child)) {
          self.ptr->error_cost += ERROR_COST_PER_SKIPPED_TREE;
        } else if (grandchild_count > 0) {
          self.ptr->error_cost += ERROR_COST_PER_SKIPPED_TREE * child.ptr->visible_child_count;
        }
      }
    }

    self.ptr->dynamic_precedence += ts_subtree_dynamic_precedence(child);
    self.ptr->visible_descendant_count += ts_subtree_visible_descendant_count(child);

    if (
      !ts_subtree_extra(child) &&
      ts_subtree_symbol(child) != 0 &&
      alias_sequence &&
      alias_sequence[structural_index] != 0
    ) {
      self.ptr->visible_descendant_count++;
      self.ptr->visible_child_count++;
      if (ts_language_symbol_metadata(language, alias_sequence[structural_index]).named) {
        self.ptr->named_child_count++;
      }
    } else if (ts_subtree_visible(child)) {
      self.ptr->visible_descendant_count++;
      self.ptr->visible_child_count++;
      if (ts_subtree_named(child)) self.ptr->named_child_count++;
    } else if (grandchild_count > 0) {
      self.ptr->visible_child_count += child.ptr->visible_child_count;
      self.ptr->named_child_count += child.ptr->named_child_count;
    }

    if (ts_subtree_has_external_tokens(child)) self.ptr->has_external_tokens = true;

    if (ts_subtree_is_error(child)) {
      self.ptr->fragile_left = self.ptr->fragile_right = true;
      self.ptr->parse_state = TS_TREE_STATE_NONE;
    }

    if (!ts_subtree_extra(child)) structural_index++;
  }

  self.ptr->lookahead_bytes = lookahead_end_byte - self.ptr->size.bytes - self.ptr->padding.bytes;

  if (
    self.ptr->symbol == ts_builtin_sym_error ||
    self.ptr->symbol == ts_builtin_sym_error_repeat
  ) {
    self.ptr->error_cost +=
      ERROR_COST_PER_RECOVERY +
      ERROR_COST_PER_SKIPPED_CHAR * self.ptr->size.bytes +
      ERROR_COST_PER_SKIPPED_LINE * self.ptr->size.extent.row;
  }

  if (self.ptr->child_count > 0) {
    Subtree first_child = children[0];
    Subtree last_child = children[self.ptr->child_count - 1];

    self.ptr->first_leaf.symbol = ts_subtree_leaf_symbol(first_child);
    self.ptr->first_leaf.parse_state = ts_subtree_leaf_parse_state(first_child);

    if (ts_subtree_fragile_left(first_child)) self.ptr->fragile_left = true;
    if (ts_subtree_fragile_right(last_child)) self.ptr->fragile_right = true;

    if (
      self.ptr->child_count >= 2 &&
      !self.ptr->visible &&
      !self.ptr->named &&
      ts_subtree_symbol(first_child) == self.ptr->symbol
    ) {
      if (ts_subtree_repeat_depth(first_child) > ts_subtree_repeat_depth(last_child)) {
        self.ptr->repeat_depth = ts_subtree_repeat_depth(first_child) + 1;
      } else {
        self.ptr->repeat_depth = ts_subtree_repeat_depth(last_child) + 1;
      }
    }
  }
}

// Create a new parent node with the given children.
//
// This takes ownership of the children array.
MutableSubtree ts_subtree_new_node(
  TSSymbol symbol,
  SubtreeArray *children,
  unsigned production_id,
  const TSLanguage *language
) {
  TSSymbolMetadata metadata = ts_language_symbol_metadata(language, symbol);
  bool fragile = symbol == ts_builtin_sym_error || symbol == ts_builtin_sym_error_repeat;

  // Allocate the node's data at the end of the array of children.
  size_t new_byte_size = ts_subtree_alloc_size(children->size);
  if (children->capacity * sizeof(Subtree) < new_byte_size) {
    children->contents = ts_realloc(children->contents, new_byte_size);
    children->capacity = (uint32_t)(new_byte_size / sizeof(Subtree));
  }
  SubtreeHeapData *data = (SubtreeHeapData *)&children->contents[children->size];

  *data = (SubtreeHeapData) {
    .ref_count = 1,
    .symbol = symbol,
    .child_count = children->size,
    .visible = metadata.visible,
    .named = metadata.named,
    .has_changes = false,
    .has_external_scanner_state_change = false,
    .fragile_left = fragile,
    .fragile_right = fragile,
    .is_keyword = false,
    {{
      .visible_descendant_count = 0,
      .production_id = production_id,
      .first_leaf = {.symbol = 0, .parse_state = 0},
    }}
  };
  MutableSubtree result = {.ptr = data};
  ts_subtree_summarize_children(result, language);
  return result;
}

// Create a new error node containing the given children.
//
// This node is treated as 'extra'. Its children are prevented from having
// having any effect on the parse state.
Subtree ts_subtree_new_error_node(
  SubtreeArray *children,
  bool extra,
  const TSLanguage *language
) {
  MutableSubtree result = ts_subtree_new_node(
    ts_builtin_sym_error, children, 0, language
  );
  result.ptr->extra = extra;
  return ts_subtree_from_mut(result);
}

// Create a new 'missing leaf' node.
//
// This node is treated as 'extra'. Its children are prevented from having
// having any effect on the parse state.
Subtree ts_subtree_new_missing_leaf(
  SubtreePool *pool,
  TSSymbol symbol,
  Length padding,
  uint32_t lookahead_bytes,
  const TSLanguage *language
) {
  Subtree result = ts_subtree_new_leaf(
    pool, symbol, padding, length_zero(), lookahead_bytes,
    0, false, false, false, language
  );
  if (result.data.is_inline) {
    result.data.is_missing = true;
  } else {
    ((SubtreeHeapData *)result.ptr)->is_missing = true;
  }
  return result;
}

void ts_subtree_retain(Subtree self) {
  if (self.data.is_inline) return;
  ts_assert(self.ptr->ref_count > 0);
  atomic_inc((volatile uint32_t *)&self.ptr->ref_count);
  ts_assert(self.ptr->ref_count != 0);
}

void ts_subtree_release(SubtreePool *pool, Subtree self) {
  if (self.data.is_inline) return;
  array_clear(&pool->tree_stack);

  ts_assert(self.ptr->ref_count > 0);
  if (atomic_dec((volatile uint32_t *)&self.ptr->ref_count) == 0) {
    array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(self));
  }

  while (pool->tree_stack.size > 0) {
    MutableSubtree tree = array_pop(&pool->tree_stack);
    if (tree.ptr->child_count > 0) {
      Subtree *children = ts_subtree_children(tree);
      for (uint32_t i = 0; i < tree.ptr->child_count; i++) {
        Subtree child = children[i];
        if (child.data.is_inline) continue;
        ts_assert(child.ptr->ref_count > 0);
        if (atomic_dec((volatile uint32_t *)&child.ptr->ref_count) == 0) {
          array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(child));
        }
      }
      ts_free(children);
    } else {
      if (tree.ptr->has_external_tokens) {
        ts_external_scanner_state_delete(&tree.ptr->external_scanner_state);
      }
      ts_subtree_pool_free(pool, tree.ptr);
    }
  }
}

int ts_subtree_compare(Subtree left, Subtree right, SubtreePool *pool) {
  array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(left));
  array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(right));

  while (pool->tree_stack.size > 0) {
    right = ts_subtree_from_mut(array_pop(&pool->tree_stack));
    left = ts_subtree_from_mut(array_pop(&pool->tree_stack));

    int result = 0;
    if (ts_subtree_symbol(left) < ts_subtree_symbol(right)) result = -1;
    else if (ts_subtree_symbol(right) < ts_subtree_symbol(left)) result = 1;
    else if (ts_subtree_child_count(left) < ts_subtree_child_count(right)) result = -1;
    else if (ts_subtree_child_count(right) < ts_subtree_child_count(left)) result = 1;
    if (result != 0) {
      array_clear(&pool->tree_stack);
      return result;
    }

    for (uint32_t i = ts_subtree_child_count(left); i > 0; i--) {
      Subtree left_child = ts_subtree_children(left)[i - 1];
      Subtree right_child = ts_subtree_children(right)[i - 1];
      array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(left_child));
      array_push(&pool->tree_stack, ts_subtree_to_mut_unsafe(right_child));
    }
  }

  return 0;
}

static inline void ts_subtree_set_has_changes(MutableSubtree *self) {
  if (self->data.is_inline) {
    self->data.has_changes = true;
  } else {
    self->ptr->has_changes = true;
  }
}

Subtree ts_subtree_edit(Subtree self, const TSInputEdit *input_edit, SubtreePool *pool) {
  typedef struct {
    Subtree *tree;
    Edit edit;
  } EditEntry;

  Array(EditEntry) stack = array_new();
  array_push(&stack, ((EditEntry) {
    .tree = &self,
    .edit = (Edit) {
      .start = {input_edit->start_byte, input_edit->start_point},
      .old_end = {input_edit->old_end_byte, input_edit->old_end_point},
      .new_end = {input_edit->new_end_byte, input_edit->new_end_point},
    },
  }));

  while (stack.size) {
    EditEntry entry = array_pop(&stack);
    Edit edit = entry.edit;
    bool is_noop = edit.old_end.bytes == edit.start.bytes && edit.new_end.bytes == edit.start.bytes;
    bool is_pure_insertion = edit.old_end.bytes == edit.start.bytes;
    bool parent_depends_on_column = ts_subtree_depends_on_column(*entry.tree);
    bool column_shifted = edit.new_end.extent.column != edit.old_end.extent.column;

    Length size = ts_subtree_size(*entry.tree);
    Length padding = ts_subtree_padding(*entry.tree);
    Length total_size = length_add(padding, size);
    uint32_t lookahead_bytes = ts_subtree_lookahead_bytes(*entry.tree);
    uint32_t end_byte = total_size.bytes + lookahead_bytes;
    if (edit.start.bytes > end_byte || (is_noop && edit.start.bytes == end_byte)) continue;

    // If the edit is entirely within the space before this subtree, then shift this
    // subtree over according to the edit without changing its size.
    if (edit.old_end.bytes <= padding.bytes) {
      padding = length_add(edit.new_end, length_sub(padding, edit.old_end));
    }

    // If the edit starts in the space before this subtree and extends into this subtree,
    // shrink the subtree's content to compensate for the change in the space before it.
    else if (edit.start.bytes < padding.bytes) {
      size = length_saturating_sub(size, length_sub(edit.old_end, padding));
      padding = edit.new_end;
    }

    // If the edit is within this subtree, resize the subtree to reflect the edit.
    else if (
      edit.start.bytes < total_size.bytes ||
      (edit.start.bytes == total_size.bytes && is_pure_insertion)
    ) {
      size = length_add(
        length_sub(edit.new_end, padding),
        length_saturating_sub(total_size, edit.old_end)
      );
    }

    MutableSubtree result = ts_subtree_make_mut(pool, *entry.tree);

    if (result.data.is_inline) {
      if (ts_subtree_can_inline(padding, size, lookahead_bytes)) {
        result.data.padding_bytes = padding.bytes;
        result.data.padding_rows = padding.extent.row;
        result.data.padding_columns = padding.extent.column;
        result.data.size_bytes = size.bytes;
      } else {
        SubtreeHeapData *data = ts_subtree_pool_allocate(pool);
        data->ref_count = 1;
        data->padding = padding;
        data->size = size;
        data->lookahead_bytes = lookahead_bytes;
        data->error_cost = 0;
        data->child_count = 0;
        data->symbol = result.data.symbol;
        data->parse_state = result.data.parse_state;
        data->visible = result.data.visible;
        data->named = result.data.named;
        data->extra = result.data.extra;
        data->fragile_left = false;
        data->fragile_right = false;
        data->has_changes = false;
        data->has_external_tokens = false;
        data->depends_on_column = false;
        data->is_missing = result.data.is_missing;
        data->is_keyword = result.data.is_keyword;
        result.ptr = data;
      }
    } else {
      result.ptr->padding = padding;
      result.ptr->size = size;
    }

    ts_subtree_set_has_changes(&result);
    *entry.tree = ts_subtree_from_mut(result);

    Length child_left, child_right = length_zero();
    for (uint32_t i = 0, n = ts_subtree_child_count(*entry.tree); i < n; i++) {
      Subtree *child = &ts_subtree_children(*entry.tree)[i];
      Length child_size = ts_subtree_total_size(*child);
      child_left = child_right;
      child_right = length_add(child_left, child_size);

      // If this child ends before the edit, it is not affected.
      if (child_right.bytes + ts_subtree_lookahead_bytes(*child) < edit.start.bytes) continue;

      // Keep editing child nodes until a node is reached that starts after the edit.
      // Also, if this node's validity depends on its column position, then continue
      // invalidating child nodes until reaching a line break.
      if ((
        (child_left.bytes > edit.old_end.bytes) ||
        (child_left.bytes == edit.old_end.bytes && child_size.bytes > 0 && i > 0)
      ) && (
        !parent_depends_on_column ||
        child_left.extent.row > padding.extent.row
      ) && (
        !ts_subtree_depends_on_column(*child) ||
        !column_shifted ||
        child_left.extent.row > edit.old_end.extent.row
      )) {
        break;
      }

      // Transform edit into the child's coordinate space.
      Edit child_edit = {
        .start = length_saturating_sub(edit.start, child_left),
        .old_end = length_saturating_sub(edit.old_end, child_left),
        .new_end = length_saturating_sub(edit.new_end, child_left),
      };

      // Interpret all inserted text as applying to the *first* child that touches the edit.
      // Subsequent children are only never have any text inserted into them; they are only
      // shrunk to compensate for the edit.
      if (
        child_right.bytes > edit.start.bytes ||
        (child_right.bytes == edit.start.bytes && is_pure_insertion)
      ) {
        edit.new_end = edit.start;
      }

      // Children that occur before the edit are not reshaped by the edit.
      else {
        child_edit.old_end = child_edit.start;
        child_edit.new_end = child_edit.start;
      }

      // Queue processing of this child's subtree.
      array_push(&stack, ((EditEntry) {
        .tree = child,
        .edit = child_edit,
      }));
    }
  }

  array_delete(&stack);
  return self;
}

Subtree ts_subtree_last_external_token(Subtree tree) {
  if (!ts_subtree_has_external_tokens(tree)) return NULL_SUBTREE;
  while (tree.ptr->child_count > 0) {
    for (uint32_t i = tree.ptr->child_count - 1; i + 1 > 0; i--) {
      Subtree child = ts_subtree_children(tree)[i];
      if (ts_subtree_has_external_tokens(child)) {
        tree = child;
        break;
      }
    }
  }
  return tree;
}

static size_t ts_subtree__write_char_to_string(char *str, size_t n, int32_t chr) {
  if (chr == -1)
    return snprintf(str, n, "INVALID");
  else if (chr == '\0')
    return snprintf(str, n, "'\\0'");
  else if (chr == '\n')
    return snprintf(str, n, "'\\n'");
  else if (chr == '\t')
    return snprintf(str, n, "'\\t'");
  else if (chr == '\r')
    return snprintf(str, n, "'\\r'");
  else if (0 < chr && chr < 128 && isprint(chr))
    return snprintf(str, n, "'%c'", chr);
  else
    return snprintf(str, n, "%d", chr);
}

static const char *const ROOT_FIELD = "__ROOT__";

static size_t ts_subtree__write_to_string(
  Subtree self, char *string, size_t limit,
  const TSLanguage *language, bool include_all,
  TSSymbol alias_symbol, bool alias_is_named, const char *field_name
) {
  if (!self.ptr) return snprintf(string, limit, "(NULL)");

  char *cursor = string;
  char **writer = (limit > 1) ? &cursor : &string;
  bool is_root = field_name == ROOT_FIELD;
  bool is_visible =
    include_all ||
    ts_subtree_missing(self) ||
    (
      alias_symbol
        ? alias_is_named
        : ts_subtree_visible(self) && ts_subtree_named(self)
    );

  if (is_visible) {
    if (!is_root) {
      cursor += snprintf(*writer, limit, " ");
      if (field_name) {
        cursor += snprintf(*writer, limit, "%s: ", field_name);
      }
    }

    if (ts_subtree_is_error(self) && ts_subtree_child_count(self) == 0 && self.ptr->size.bytes > 0) {
      cursor += snprintf(*writer, limit, "(UNEXPECTED ");
      cursor += ts_subtree__write_char_to_string(*writer, limit, self.ptr->lookahead_char);
    } else {
      TSSymbol symbol = alias_symbol ? alias_symbol : ts_subtree_symbol(self);
      const char *symbol_name = ts_language_symbol_name(language, symbol);
      if (ts_subtree_missing(self)) {
        cursor += snprintf(*writer, limit, "(MISSING ");
        if (alias_is_named || ts_subtree_named(self)) {
          cursor += snprintf(*writer, limit, "%s", symbol_name);
        } else {
          cursor += snprintf(*writer, limit, "\"%s\"", symbol_name);
        }
      } else {
        cursor += snprintf(*writer, limit, "(%s", symbol_name);
      }
    }
  } else if (is_root) {
    TSSymbol symbol = alias_symbol ? alias_symbol : ts_subtree_symbol(self);
    const char *symbol_name = ts_language_symbol_name(language, symbol);
    if (ts_subtree_child_count(self) > 0) {
      cursor += snprintf(*writer, limit, "(%s", symbol_name);
    } else if (ts_subtree_named(self)) {
      cursor += snprintf(*writer, limit, "(%s)", symbol_name);
    } else {
      cursor += snprintf(*writer, limit, "(\"%s\")", symbol_name);
    }
  }

  if (ts_subtree_child_count(self)) {
    const TSSymbol *alias_sequence = ts_language_alias_sequence(language, self.ptr->production_id);
    const TSFieldMapEntry *field_map, *field_map_end;
    ts_language_field_map(
      language,
      self.ptr->production_id,
      &field_map,
      &field_map_end
    );

    uint32_t structural_child_index = 0;
    for (uint32_t i = 0; i < self.ptr->child_count; i++) {
      Subtree child = ts_subtree_children(self)[i];
      if (ts_subtree_extra(child)) {
        cursor += ts_subtree__write_to_string(
          child, *writer, limit,
          language, include_all,
          0, false, NULL
        );
      } else {
        TSSymbol subtree_alias_symbol = alias_sequence
          ? alias_sequence[structural_child_index]
          : 0;
        bool subtree_alias_is_named = subtree_alias_symbol
          ? ts_language_symbol_metadata(language, subtree_alias_symbol).named
          : false;

        const char *child_field_name = is_visible ? NULL : field_name;
        for (const TSFieldMapEntry *map = field_map; map < field_map_end; map++) {
          if (!map->inherited && map->child_index == structural_child_index) {
            child_field_name = language->field_names[map->field_id];
            break;
          }
        }

        cursor += ts_subtree__write_to_string(
          child, *writer, limit,
          language, include_all,
          subtree_alias_symbol, subtree_alias_is_named, child_field_name
        );
        structural_child_index++;
      }
    }
  }

  if (is_visible) cursor += snprintf(*writer, limit, ")");

  return cursor - string;
}

char *ts_subtree_string(
  Subtree self,
  TSSymbol alias_symbol,
  bool alias_is_named,
  const TSLanguage *language,
  bool include_all
) {
  char scratch_string[1];
  size_t size = ts_subtree__write_to_string(
    self, scratch_string, 1,
    language, include_all,
    alias_symbol, alias_is_named, ROOT_FIELD
  ) + 1;
  char *result = ts_malloc(size * sizeof(char));
  ts_subtree__write_to_string(
    self, result, size,
    language, include_all,
    alias_symbol, alias_is_named, ROOT_FIELD
  );
  return result;
}

void ts_subtree__print_dot_graph(const Subtree *self, uint32_t start_offset,
                                 const TSLanguage *language, TSSymbol alias_symbol,
                                 FILE *f) {
  TSSymbol subtree_symbol = ts_subtree_symbol(*self);
  TSSymbol symbol = alias_symbol ? alias_symbol : subtree_symbol;
  uint32_t end_offset = start_offset + ts_subtree_total_bytes(*self);
  fprintf(f, "tree_%p [label=\"", (void *)self);
  ts_language_write_symbol_as_dot_string(language, f, symbol);
  fprintf(f, "\"");

  if (ts_subtree_child_count(*self) == 0) fprintf(f, ", shape=plaintext");
  if (ts_subtree_extra(*self)) fprintf(f, ", fontcolor=gray");
  if (ts_subtree_has_changes(*self)) fprintf(f, ", color=green, penwidth=2");

  fprintf(f, ", tooltip=\""
    "range: %u - %u\n"
    "state: %d\n"
    "error-cost: %u\n"
    "has-changes: %u\n"
    "depends-on-column: %u\n"
    "descendant-count: %u\n"
    "repeat-depth: %u\n"
    "lookahead-bytes: %u",
    start_offset, end_offset,
    ts_subtree_parse_state(*self),
    ts_subtree_error_cost(*self),
    ts_subtree_has_changes(*self),
    ts_subtree_depends_on_column(*self),
    ts_subtree_visible_descendant_count(*self),
    ts_subtree_repeat_depth(*self),
    ts_subtree_lookahead_bytes(*self)
  );

  if (ts_subtree_is_error(*self) && ts_subtree_child_count(*self) == 0 && self->ptr->lookahead_char != 0) {
    fprintf(f, "\ncharacter: '%c'", self->ptr->lookahead_char);
  }

  fprintf(f, "\"]\n");

  uint32_t child_start_offset = start_offset;
  uint32_t child_info_offset =
    language->max_alias_sequence_length *
    ts_subtree_production_id(*self);
  for (uint32_t i = 0, n = ts_subtree_child_count(*self); i < n; i++) {
    const Subtree *child = &ts_subtree_children(*self)[i];
    TSSymbol subtree_alias_symbol = 0;
    if (!ts_subtree_extra(*child) && child_info_offset) {
      subtree_alias_symbol = language->alias_sequences[child_info_offset];
      child_info_offset++;
    }
    ts_subtree__print_dot_graph(child, child_start_offset, language, subtree_alias_symbol, f);
    fprintf(f, "tree_%p -> tree_%p [tooltip=%u]\n", (void *)self, (void *)child, i);
    child_start_offset += ts_subtree_total_bytes(*child);
  }
}

void ts_subtree_print_dot_graph(Subtree self, const TSLanguage *language, FILE *f) {
  fprintf(f, "digraph tree {\n");
  fprintf(f, "edge [arrowhead=none]\n");
  ts_subtree__print_dot_graph(&self, 0, language, 0, f);
  fprintf(f, "}\n");
}

const ExternalScannerState *ts_subtree_external_scanner_state(Subtree self) {
  static const ExternalScannerState empty_state = {{.short_data = {0}}, .length = 0};
  if (
    self.ptr &&
    !self.data.is_inline &&
    self.ptr->has_external_tokens &&
    self.ptr->child_count == 0
  ) {
    return &self.ptr->external_scanner_state;
  } else {
    return &empty_state;
  }
}

bool ts_subtree_external_scanner_state_eq(Subtree self, Subtree other) {
  const ExternalScannerState *state_self = ts_subtree_external_scanner_state(self);
  const ExternalScannerState *state_other = ts_subtree_external_scanner_state(other);
  return ts_external_scanner_state_eq(
    state_self,
    ts_external_scanner_state_data(state_other),
    state_other->length
  );
}
