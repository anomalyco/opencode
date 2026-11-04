#include <stdbool.h>
#include "./point.h"
#include "./subtree.h"
#include "./tree.h"
#include "./language.h"

typedef struct {
  Subtree parent;
  const TSTree *tree;
  Length position;
  uint32_t child_index;
  uint32_t structural_child_index;
  const TSSymbol *alias_sequence;
} NodeChildIterator;

static inline bool ts_node__is_relevant(TSNode self, bool include_anonymous);

// TSNode - constructors

TSNode ts_node_new(
  const TSTree *tree,
  const Subtree *subtree,
  Length position,
  TSSymbol alias
) {
  return (TSNode) {
    {position.bytes, position.extent.row, position.extent.column, alias},
    subtree,
    tree,
  };
}

static inline TSNode ts_node__null(void) {
  return ts_node_new(NULL, NULL, length_zero(), 0);
}

// TSNode - accessors

uint32_t ts_node_start_byte(TSNode self) {
  return self.context[0];
}

TSPoint ts_node_start_point(TSNode self) {
  return (TSPoint) {self.context[1], self.context[2]};
}

static inline uint32_t ts_node__alias(const TSNode *self) {
  return self->context[3];
}

static inline Subtree ts_node__subtree(TSNode self) {
  return *(const Subtree *)self.id;
}

// NodeChildIterator

static inline NodeChildIterator ts_node_iterate_children(const TSNode *node) {
  Subtree subtree = ts_node__subtree(*node);
  if (ts_subtree_child_count(subtree) == 0) {
    return (NodeChildIterator) {NULL_SUBTREE, node->tree, length_zero(), 0, 0, NULL};
  }
  const TSSymbol *alias_sequence = ts_language_alias_sequence(
    node->tree->language,
    subtree.ptr->production_id
  );
  return (NodeChildIterator) {
    .tree = node->tree,
    .parent = subtree,
    .position = {ts_node_start_byte(*node), ts_node_start_point(*node)},
    .child_index = 0,
    .structural_child_index = 0,
    .alias_sequence = alias_sequence,
  };
}

static inline bool ts_node_child_iterator_done(NodeChildIterator *self) {
  return self->child_index == self->parent.ptr->child_count;
}

static inline bool ts_node_child_iterator_next(
  NodeChildIterator *self,
  TSNode *result
) {
  if (!self->parent.ptr || ts_node_child_iterator_done(self)) return false;
  const Subtree *child = &ts_subtree_children(self->parent)[self->child_index];
  TSSymbol alias_symbol = 0;
  if (!ts_subtree_extra(*child)) {
    if (self->alias_sequence) {
      alias_symbol = self->alias_sequence[self->structural_child_index];
    }
    self->structural_child_index++;
  }
  if (self->child_index > 0) {
    self->position = length_add(self->position, ts_subtree_padding(*child));
  }
  *result = ts_node_new(
    self->tree,
    child,
    self->position,
    alias_symbol
  );
  self->position = length_add(self->position, ts_subtree_size(*child));
  self->child_index++;
  return true;
}

// TSNode - private

static inline bool ts_node__is_relevant(TSNode self, bool include_anonymous) {
  Subtree tree = ts_node__subtree(self);
  if (include_anonymous) {
    return ts_subtree_visible(tree) || ts_node__alias(&self);
  } else {
    TSSymbol alias = ts_node__alias(&self);
    if (alias) {
      return ts_language_symbol_metadata(self.tree->language, alias).named;
    } else {
      return ts_subtree_visible(tree) && ts_subtree_named(tree);
    }
  }
}

static inline uint32_t ts_node__relevant_child_count(
  TSNode self,
  bool include_anonymous
) {
  Subtree tree = ts_node__subtree(self);
  if (ts_subtree_child_count(tree) > 0) {
    if (include_anonymous) {
      return tree.ptr->visible_child_count;
    } else {
      return tree.ptr->named_child_count;
    }
  } else {
    return 0;
  }
}

static inline TSNode ts_node__child(
  TSNode self,
  uint32_t child_index,
  bool include_anonymous
) {
  TSNode result = self;
  bool did_descend = true;

  while (did_descend) {
    did_descend = false;

    TSNode child;
    uint32_t index = 0;
    NodeChildIterator iterator = ts_node_iterate_children(&result);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (ts_node__is_relevant(child, include_anonymous)) {
        if (index == child_index) {
          return child;
        }
        index++;
      } else {
        uint32_t grandchild_index = child_index - index;
        uint32_t grandchild_count = ts_node__relevant_child_count(child, include_anonymous);
        if (grandchild_index < grandchild_count) {
          did_descend = true;
          result = child;
          child_index = grandchild_index;
          break;
        }
        index += grandchild_count;
      }
    }
  }

  return ts_node__null();
}

static bool ts_subtree_has_trailing_empty_descendant(
  Subtree self,
  Subtree other
) {
  for (unsigned i = ts_subtree_child_count(self) - 1; i + 1 > 0; i--) {
    Subtree child = ts_subtree_children(self)[i];
    if (ts_subtree_total_bytes(child) > 0) break;
    if (child.ptr == other.ptr || ts_subtree_has_trailing_empty_descendant(child, other)) {
      return true;
    }
  }
  return false;
}

static inline TSNode ts_node__prev_sibling(TSNode self, bool include_anonymous) {
  Subtree self_subtree = ts_node__subtree(self);
  bool self_is_empty = ts_subtree_total_bytes(self_subtree) == 0;
  uint32_t target_end_byte = ts_node_end_byte(self);

  TSNode node = ts_node_parent(self);
  TSNode earlier_node = ts_node__null();
  bool earlier_node_is_relevant = false;

  while (!ts_node_is_null(node)) {
    TSNode earlier_child = ts_node__null();
    bool earlier_child_is_relevant = false;
    bool found_child_containing_target = false;

    TSNode child;
    NodeChildIterator iterator = ts_node_iterate_children(&node);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (child.id == self.id) break;
      if (iterator.position.bytes > target_end_byte) {
        found_child_containing_target = true;
        break;
      }

      if (iterator.position.bytes == target_end_byte &&
          (!self_is_empty ||
           ts_subtree_has_trailing_empty_descendant(ts_node__subtree(child), self_subtree))) {
        found_child_containing_target = true;
        break;
      }

      if (ts_node__is_relevant(child, include_anonymous)) {
        earlier_child = child;
        earlier_child_is_relevant = true;
      } else if (ts_node__relevant_child_count(child, include_anonymous) > 0) {
        earlier_child = child;
        earlier_child_is_relevant = false;
      }
    }

    if (found_child_containing_target) {
      if (!ts_node_is_null(earlier_child)) {
        earlier_node = earlier_child;
        earlier_node_is_relevant = earlier_child_is_relevant;
      }
      node = child;
    } else if (earlier_child_is_relevant) {
      return earlier_child;
    } else if (!ts_node_is_null(earlier_child)) {
      node = earlier_child;
    } else if (earlier_node_is_relevant) {
      return earlier_node;
    } else {
      node = earlier_node;
      earlier_node = ts_node__null();
      earlier_node_is_relevant = false;
    }
  }

  return ts_node__null();
}

static inline TSNode ts_node__next_sibling(TSNode self, bool include_anonymous) {
  uint32_t target_end_byte = ts_node_end_byte(self);

  TSNode node = ts_node_parent(self);
  TSNode later_node = ts_node__null();
  bool later_node_is_relevant = false;

  while (!ts_node_is_null(node)) {
    TSNode later_child = ts_node__null();
    bool later_child_is_relevant = false;
    TSNode child_containing_target = ts_node__null();

    TSNode child;
    NodeChildIterator iterator = ts_node_iterate_children(&node);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (iterator.position.bytes <= target_end_byte) continue;
      uint32_t start_byte = ts_node_start_byte(self);
      uint32_t child_start_byte = ts_node_start_byte(child);

      bool is_empty = start_byte == target_end_byte;
      bool contains_target = is_empty ?
        child_start_byte < start_byte :
        child_start_byte <= start_byte;

      if (contains_target) {
        if (ts_node__subtree(child).ptr != ts_node__subtree(self).ptr) {
          child_containing_target = child;
        }
      } else if (ts_node__is_relevant(child, include_anonymous)) {
        later_child = child;
        later_child_is_relevant = true;
        break;
      } else if (ts_node__relevant_child_count(child, include_anonymous) > 0) {
        later_child = child;
        later_child_is_relevant = false;
        break;
      }
    }

    if (!ts_node_is_null(child_containing_target)) {
      if (!ts_node_is_null(later_child)) {
        later_node = later_child;
        later_node_is_relevant = later_child_is_relevant;
      }
      node = child_containing_target;
    } else if (later_child_is_relevant) {
      return later_child;
    } else if (!ts_node_is_null(later_child)) {
      node = later_child;
    } else if (later_node_is_relevant) {
      return later_node;
    } else {
      node = later_node;
    }
  }

  return ts_node__null();
}

static inline TSNode ts_node__first_child_for_byte(
  TSNode self,
  uint32_t goal,
  bool include_anonymous
) {
  TSNode node = self;
  bool did_descend = true;

  NodeChildIterator last_iterator;
  bool has_last_iterator = false;

  while (did_descend) {
    did_descend = false;

    TSNode child;
    NodeChildIterator iterator = ts_node_iterate_children(&node);
  loop:
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (ts_node_end_byte(child) > goal) {
        if (ts_node__is_relevant(child, include_anonymous)) {
          return child;
        } else if (ts_node_child_count(child) > 0) {
          if (iterator.child_index < ts_subtree_child_count(ts_node__subtree(child))) {
            last_iterator = iterator;
            has_last_iterator = true;
          }
          did_descend = true;
          node = child;
          break;
        }
      }
    }

    if (!did_descend && has_last_iterator) {
      iterator = last_iterator;
      has_last_iterator = false;
      goto loop;
    }
  }

  return ts_node__null();
}

static inline TSNode ts_node__descendant_for_byte_range(
  TSNode self,
  uint32_t range_start,
  uint32_t range_end,
  bool include_anonymous
) {
  if (range_start > range_end) {
    return ts_node__null();
  }
  TSNode node = self;
  TSNode last_visible_node = self;

  bool did_descend = true;
  while (did_descend) {
    did_descend = false;

    TSNode child;
    NodeChildIterator iterator = ts_node_iterate_children(&node);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      uint32_t node_end = iterator.position.bytes;

      // The end of this node must extend far enough forward to touch
      // the end of the range
      if (node_end < range_end) continue;

      // ...and exceed the start of the range, unless the node itself is
      // empty, in which case it must at least be equal to the start of the range.
      bool is_empty = ts_node_start_byte(child) == node_end;
      if (is_empty ? node_end < range_start : node_end <= range_start) continue;

      // The start of this node must extend far enough backward to
      // touch the start of the range.
      if (range_start < ts_node_start_byte(child)) break;

      node = child;
      if (ts_node__is_relevant(node, include_anonymous)) {
        last_visible_node = node;
      }
      did_descend = true;
      break;
    }
  }

  return last_visible_node;
}

static inline TSNode ts_node__descendant_for_point_range(
  TSNode self,
  TSPoint range_start,
  TSPoint range_end,
  bool include_anonymous
) {
  if (point_gt(range_start, range_end)) {
    return ts_node__null();
  }
  TSNode node = self;
  TSNode last_visible_node = self;

  bool did_descend = true;
  while (did_descend) {
    did_descend = false;

    TSNode child;
    NodeChildIterator iterator = ts_node_iterate_children(&node);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      TSPoint node_end = iterator.position.extent;

      // The end of this node must extend far enough forward to touch
      // the end of the range
      if (point_lt(node_end, range_end)) continue;

      // ...and exceed the start of the range, unless the node itself is
      // empty, in which case it must at least be equal to the start of the range.
      bool is_empty =  point_eq(ts_node_start_point(child), node_end);
      if (is_empty ? point_lt(node_end, range_start) : point_lte(node_end, range_start)) {
        continue;
      }

      // The start of this node must extend far enough backward to
      // touch the start of the range.
      if (point_lt(range_start, ts_node_start_point(child))) break;

      node = child;
      if (ts_node__is_relevant(node, include_anonymous)) {
        last_visible_node = node;
      }
      did_descend = true;
      break;
    }
  }

  return last_visible_node;
}

// TSNode - public

uint32_t ts_node_end_byte(TSNode self) {
  return ts_node_start_byte(self) + ts_subtree_size(ts_node__subtree(self)).bytes;
}

TSPoint ts_node_end_point(TSNode self) {
  return point_add(ts_node_start_point(self), ts_subtree_size(ts_node__subtree(self)).extent);
}

TSSymbol ts_node_symbol(TSNode self) {
  TSSymbol symbol = ts_node__alias(&self);
  if (!symbol) symbol = ts_subtree_symbol(ts_node__subtree(self));
  return ts_language_public_symbol(self.tree->language, symbol);
}

const char *ts_node_type(TSNode self) {
  TSSymbol symbol = ts_node__alias(&self);
  if (!symbol) symbol = ts_subtree_symbol(ts_node__subtree(self));
  return ts_language_symbol_name(self.tree->language, symbol);
}

const TSLanguage *ts_node_language(TSNode self) {
  return self.tree->language;
}

TSSymbol ts_node_grammar_symbol(TSNode self) {
  return ts_subtree_symbol(ts_node__subtree(self));
}

const char *ts_node_grammar_type(TSNode self) {
  TSSymbol symbol = ts_subtree_symbol(ts_node__subtree(self));
  return ts_language_symbol_name(self.tree->language, symbol);
}

char *ts_node_string(TSNode self) {
  TSSymbol alias_symbol = ts_node__alias(&self);
  return ts_subtree_string(
    ts_node__subtree(self),
    alias_symbol,
    ts_language_symbol_metadata(self.tree->language, alias_symbol).visible,
    self.tree->language,
    false
  );
}

bool ts_node_eq(TSNode self, TSNode other) {
  return self.tree == other.tree && self.id == other.id;
}

bool ts_node_is_null(TSNode self) {
  return self.id == 0;
}

bool ts_node_is_extra(TSNode self) {
  return ts_subtree_extra(ts_node__subtree(self));
}

bool ts_node_is_named(TSNode self) {
  TSSymbol alias = ts_node__alias(&self);
  return alias
    ? ts_language_symbol_metadata(self.tree->language, alias).named
    : ts_subtree_named(ts_node__subtree(self));
}

bool ts_node_is_missing(TSNode self) {
  return ts_subtree_missing(ts_node__subtree(self));
}

bool ts_node_has_changes(TSNode self) {
  return ts_subtree_has_changes(ts_node__subtree(self));
}

bool ts_node_has_error(TSNode self) {
  return ts_subtree_error_cost(ts_node__subtree(self)) > 0;
}

bool ts_node_is_error(TSNode self) {
  TSSymbol symbol = ts_node_symbol(self);
  return symbol == ts_builtin_sym_error;
}

uint32_t ts_node_descendant_count(TSNode self) {
  return ts_subtree_visible_descendant_count(ts_node__subtree(self)) + 1;
}

TSStateId ts_node_parse_state(TSNode self) {
  return ts_subtree_parse_state(ts_node__subtree(self));
}

TSStateId ts_node_next_parse_state(TSNode self) {
  const TSLanguage *language = self.tree->language;
  uint16_t state = ts_node_parse_state(self);
  if (state == TS_TREE_STATE_NONE) {
    return TS_TREE_STATE_NONE;
  }
  uint16_t symbol = ts_node_grammar_symbol(self);
  return ts_language_next_state(language, state, symbol);
}

TSNode ts_node_parent(TSNode self) {
  TSNode node = ts_tree_root_node(self.tree);
  if (node.id == self.id) return ts_node__null();

  while (true) {
    TSNode next_node = ts_node_child_with_descendant(node, self);
    if (next_node.id == self.id || ts_node_is_null(next_node)) break;
    node = next_node;
  }

  return node;
}

TSNode ts_node_child_with_descendant(TSNode self, TSNode descendant) {
  uint32_t start_byte = ts_node_start_byte(descendant);
  uint32_t end_byte = ts_node_end_byte(descendant);
  bool is_empty = start_byte == end_byte;

  do {
    NodeChildIterator iter = ts_node_iterate_children(&self);
    do {
      if (
        !ts_node_child_iterator_next(&iter, &self)
        || ts_node_start_byte(self) > start_byte
      ) {
        return ts_node__null();
      }
      if (self.id == descendant.id) {
        return self;
      }

      // If the descendant is empty, and the end byte is within `self`,
      // we check whether `self` contains it or not.
      if (is_empty && iter.position.bytes >= end_byte && ts_node_child_count(self) > 0) {
        TSNode child = ts_node_child_with_descendant(self, descendant);
        // If the child is not null, return self if it's relevant, else return the child
        if (!ts_node_is_null(child)) {
          return ts_node__is_relevant(self, true) ? self : child;
        }
      }
    } while ((is_empty ? iter.position.bytes <= end_byte : iter.position.bytes < end_byte) || ts_node_child_count(self) == 0);
  } while (!ts_node__is_relevant(self, true));

  return self;
}

TSNode ts_node_child(TSNode self, uint32_t child_index) {
  return ts_node__child(self, child_index, true);
}

TSNode ts_node_named_child(TSNode self, uint32_t child_index) {
  return ts_node__child(self, child_index, false);
}

TSNode ts_node_child_by_field_id(TSNode self, TSFieldId field_id) {
recur:
  if (!field_id || ts_node_child_count(self) == 0) return ts_node__null();

  const TSFieldMapEntry *field_map, *field_map_end;
  ts_language_field_map(
    self.tree->language,
    ts_node__subtree(self).ptr->production_id,
    &field_map,
    &field_map_end
  );
  if (field_map == field_map_end) return ts_node__null();

  // The field mappings are sorted by their field id. Scan all
  // the mappings to find the ones for the given field id.
  while (field_map->field_id < field_id) {
    field_map++;
    if (field_map == field_map_end) return ts_node__null();
  }
  while (field_map_end[-1].field_id > field_id) {
    field_map_end--;
    if (field_map == field_map_end) return ts_node__null();
  }

  TSNode child;
  NodeChildIterator iterator = ts_node_iterate_children(&self);
  while (ts_node_child_iterator_next(&iterator, &child)) {
    if (!ts_subtree_extra(ts_node__subtree(child))) {
      uint32_t index = iterator.structural_child_index - 1;
      if (index < field_map->child_index) continue;

      // Hidden nodes' fields are "inherited" by their visible parent.
      if (field_map->inherited) {

        // If this is the *last* possible child node for this field,
        // then perform a tail call to avoid recursion.
        if (field_map + 1 == field_map_end) {
          self = child;
          goto recur;
        }

        // Otherwise, descend into this child, but if it doesn't contain
        // the field, continue searching subsequent children.
        else {
          TSNode result = ts_node_child_by_field_id(child, field_id);
          if (result.id) return result;
          field_map++;
          if (field_map == field_map_end) return ts_node__null();
        }
      }

      else if (ts_node__is_relevant(child, true)) {
        return child;
      }

      // If the field refers to a hidden node with visible children,
      // return the first visible child.
      else if (ts_node_child_count(child) > 0 ) {
        return ts_node_child(child, 0);
      }

      // Otherwise, continue searching subsequent children.
      else {
        field_map++;
        if (field_map == field_map_end) return ts_node__null();
      }
    }
  }

  return ts_node__null();
}

static inline const char *ts_node__field_name_from_language(TSNode self, uint32_t structural_child_index) {
    const TSFieldMapEntry *field_map, *field_map_end;
    ts_language_field_map(
      self.tree->language,
      ts_node__subtree(self).ptr->production_id,
      &field_map,
      &field_map_end
    );
    for (; field_map != field_map_end; field_map++) {
      if (!field_map->inherited && field_map->child_index == structural_child_index) {
        return self.tree->language->field_names[field_map->field_id];
      }
    }
    return NULL;
}

const char *ts_node_field_name_for_child(TSNode self, uint32_t child_index) {
  TSNode result = self;
  bool did_descend = true;
  const char *inherited_field_name = NULL;

  while (did_descend) {
    did_descend = false;

    TSNode child;
    uint32_t index = 0;
    NodeChildIterator iterator = ts_node_iterate_children(&result);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (ts_node__is_relevant(child, true)) {
        if (index == child_index) {
          if (ts_node_is_extra(child)) {
            return NULL;
          }
          const char *field_name = ts_node__field_name_from_language(result, iterator.structural_child_index - 1);
          if (field_name) return field_name;
          return inherited_field_name;
        }
        index++;
      } else {
        uint32_t grandchild_index = child_index - index;
        uint32_t grandchild_count = ts_node__relevant_child_count(child, true);
        if (grandchild_index < grandchild_count) {
          const char *field_name = ts_node__field_name_from_language(result, iterator.structural_child_index - 1);
          if (field_name) inherited_field_name = field_name;

          did_descend = true;
          result = child;
          child_index = grandchild_index;
          break;
        }
        index += grandchild_count;
      }
    }
  }

  return NULL;
}

const char *ts_node_field_name_for_named_child(TSNode self, uint32_t named_child_index) {
  TSNode result = self;
  bool did_descend = true;
  const char *inherited_field_name = NULL;

  while (did_descend) {
    did_descend = false;

    TSNode child;
    uint32_t index = 0;
    NodeChildIterator iterator = ts_node_iterate_children(&result);
    while (ts_node_child_iterator_next(&iterator, &child)) {
      if (ts_node__is_relevant(child, false)) {
        if (index == named_child_index) {
          if (ts_node_is_extra(child)) {
            return NULL;
          }
          const char *field_name = ts_node__field_name_from_language(result, iterator.structural_child_index - 1);
          if (field_name) return field_name;
          return inherited_field_name;
        }
        index++;
      } else {
        uint32_t named_grandchild_index = named_child_index - index;
        uint32_t grandchild_count = ts_node__relevant_child_count(child, false);
        if (named_grandchild_index < grandchild_count) {
          const char *field_name = ts_node__field_name_from_language(result, iterator.structural_child_index - 1);
          if (field_name) inherited_field_name = field_name;

          did_descend = true;
          result = child;
          named_child_index = named_grandchild_index;
          break;
        }
        index += grandchild_count;
      }
    }
  }

  return NULL;
}

TSNode ts_node_child_by_field_name(
  TSNode self,
  const char *name,
  uint32_t name_length
) {
  TSFieldId field_id = ts_language_field_id_for_name(
    self.tree->language,
    name,
    name_length
  );
  return ts_node_child_by_field_id(self, field_id);
}

uint32_t ts_node_child_count(TSNode self) {
  Subtree tree = ts_node__subtree(self);
  if (ts_subtree_child_count(tree) > 0) {
    return tree.ptr->visible_child_count;
  } else {
    return 0;
  }
}

uint32_t ts_node_named_child_count(TSNode self) {
  Subtree tree = ts_node__subtree(self);
  if (ts_subtree_child_count(tree) > 0) {
    return tree.ptr->named_child_count;
  } else {
    return 0;
  }
}

TSNode ts_node_next_sibling(TSNode self) {
  return ts_node__next_sibling(self, true);
}

TSNode ts_node_next_named_sibling(TSNode self) {
  return ts_node__next_sibling(self, false);
}

TSNode ts_node_prev_sibling(TSNode self) {
  return ts_node__prev_sibling(self, true);
}

TSNode ts_node_prev_named_sibling(TSNode self) {
  return ts_node__prev_sibling(self, false);
}

TSNode ts_node_first_child_for_byte(TSNode self, uint32_t byte) {
  return ts_node__first_child_for_byte(self, byte, true);
}

TSNode ts_node_first_named_child_for_byte(TSNode self, uint32_t byte) {
  return ts_node__first_child_for_byte(self, byte, false);
}

TSNode ts_node_descendant_for_byte_range(
  TSNode self,
  uint32_t start,
  uint32_t end
) {
  return ts_node__descendant_for_byte_range(self, start, end, true);
}

TSNode ts_node_named_descendant_for_byte_range(
  TSNode self,
  uint32_t start,
  uint32_t end
) {
  return ts_node__descendant_for_byte_range(self, start, end, false);
}

TSNode ts_node_descendant_for_point_range(
  TSNode self,
  TSPoint start,
  TSPoint end
) {
  return ts_node__descendant_for_point_range(self, start, end, true);
}

TSNode ts_node_named_descendant_for_point_range(
  TSNode self,
  TSPoint start,
  TSPoint end
) {
  return ts_node__descendant_for_point_range(self, start, end, false);
}

void ts_node_edit(TSNode *self, const TSInputEdit *edit) {
  uint32_t start_byte = ts_node_start_byte(*self);
  TSPoint start_point = ts_node_start_point(*self);

  if (start_byte >= edit->old_end_byte) {
    start_byte = edit->new_end_byte + (start_byte - edit->old_end_byte);
    start_point = point_add(edit->new_end_point, point_sub(start_point, edit->old_end_point));
  } else if (start_byte > edit->start_byte) {
    start_byte = edit->new_end_byte;
    start_point = edit->new_end_point;
  }

  self->context[0] = start_byte;
  self->context[1] = start_point.row;
  self->context[2] = start_point.column;
}
