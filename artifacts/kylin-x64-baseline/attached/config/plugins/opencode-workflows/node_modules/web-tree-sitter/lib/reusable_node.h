#include "./subtree.h"

typedef struct {
  Subtree tree;
  uint32_t child_index;
  uint32_t byte_offset;
} StackEntry;

typedef struct {
  Array(StackEntry) stack;
  Subtree last_external_token;
} ReusableNode;

static inline ReusableNode reusable_node_new(void) {
  return (ReusableNode) {array_new(), NULL_SUBTREE};
}

static inline void reusable_node_clear(ReusableNode *self) {
  array_clear(&self->stack);
  self->last_external_token = NULL_SUBTREE;
}

static inline Subtree reusable_node_tree(ReusableNode *self) {
  return self->stack.size > 0
    ? self->stack.contents[self->stack.size - 1].tree
    : NULL_SUBTREE;
}

static inline uint32_t reusable_node_byte_offset(ReusableNode *self) {
  return self->stack.size > 0
    ? self->stack.contents[self->stack.size - 1].byte_offset
    : UINT32_MAX;
}

static inline void reusable_node_delete(ReusableNode *self) {
  array_delete(&self->stack);
}

static inline void reusable_node_advance(ReusableNode *self) {
  StackEntry last_entry = *array_back(&self->stack);
  uint32_t byte_offset = last_entry.byte_offset + ts_subtree_total_bytes(last_entry.tree);
  if (ts_subtree_has_external_tokens(last_entry.tree)) {
    self->last_external_token = ts_subtree_last_external_token(last_entry.tree);
  }

  Subtree tree;
  uint32_t next_index;
  do {
    StackEntry popped_entry = array_pop(&self->stack);
    next_index = popped_entry.child_index + 1;
    if (self->stack.size == 0) return;
    tree = array_back(&self->stack)->tree;
  } while (ts_subtree_child_count(tree) <= next_index);

  array_push(&self->stack, ((StackEntry) {
    .tree = ts_subtree_children(tree)[next_index],
    .child_index = next_index,
    .byte_offset = byte_offset,
  }));
}

static inline bool reusable_node_descend(ReusableNode *self) {
  StackEntry last_entry = *array_back(&self->stack);
  if (ts_subtree_child_count(last_entry.tree) > 0) {
    array_push(&self->stack, ((StackEntry) {
      .tree = ts_subtree_children(last_entry.tree)[0],
      .child_index = 0,
      .byte_offset = last_entry.byte_offset,
    }));
    return true;
  } else {
    return false;
  }
}

static inline void reusable_node_advance_past_leaf(ReusableNode *self) {
  while (reusable_node_descend(self)) {}
  reusable_node_advance(self);
}

static inline void reusable_node_reset(ReusableNode *self, Subtree tree) {
  reusable_node_clear(self);
  array_push(&self->stack, ((StackEntry) {
    .tree = tree,
    .child_index = 0,
    .byte_offset = 0,
  }));

  // Never reuse the root node, because it has a non-standard internal structure
  // due to transformations that are applied when it is accepted: adding the EOF
  // child and any extra children.
  if (!reusable_node_descend(self)) {
    reusable_node_clear(self);
  }
}
