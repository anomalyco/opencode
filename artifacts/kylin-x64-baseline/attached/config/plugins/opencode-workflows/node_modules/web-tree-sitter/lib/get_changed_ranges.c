#include "./get_changed_ranges.h"
#include "./subtree.h"
#include "./language.h"
#include "./error_costs.h"
#include "./tree_cursor.h"
#include "./ts_assert.h"

// #define DEBUG_GET_CHANGED_RANGES

static void ts_range_array_add(
  TSRangeArray *self,
  Length start,
  Length end
) {
  if (self->size > 0) {
    TSRange *last_range = array_back(self);
    if (start.bytes <= last_range->end_byte) {
      last_range->end_byte = end.bytes;
      last_range->end_point = end.extent;
      return;
    }
  }

  if (start.bytes < end.bytes) {
    TSRange range = { start.extent, end.extent, start.bytes, end.bytes };
    array_push(self, range);
  }
}

bool ts_range_array_intersects(
  const TSRangeArray *self,
  unsigned start_index,
  uint32_t start_byte,
  uint32_t end_byte
) {
  for (unsigned i = start_index; i < self->size; i++) {
    TSRange *range = array_get(self, i);
    if (range->end_byte > start_byte) {
      if (range->start_byte >= end_byte) break;
      return true;
    }
  }
  return false;
}

void ts_range_array_get_changed_ranges(
  const TSRange *old_ranges, unsigned old_range_count,
  const TSRange *new_ranges, unsigned new_range_count,
  TSRangeArray *differences
) {
  unsigned new_index = 0;
  unsigned old_index = 0;
  Length current_position = length_zero();
  bool in_old_range = false;
  bool in_new_range = false;

  while (old_index < old_range_count || new_index < new_range_count) {
    const TSRange *old_range = &old_ranges[old_index];
    const TSRange *new_range = &new_ranges[new_index];

    Length next_old_position;
    if (in_old_range) {
      next_old_position = (Length) {old_range->end_byte, old_range->end_point};
    } else if (old_index < old_range_count) {
      next_old_position = (Length) {old_range->start_byte, old_range->start_point};
    } else {
      next_old_position = LENGTH_MAX;
    }

    Length next_new_position;
    if (in_new_range) {
      next_new_position = (Length) {new_range->end_byte, new_range->end_point};
    } else if (new_index < new_range_count) {
      next_new_position = (Length) {new_range->start_byte, new_range->start_point};
    } else {
      next_new_position = LENGTH_MAX;
    }

    if (next_old_position.bytes < next_new_position.bytes) {
      if (in_old_range != in_new_range) {
        ts_range_array_add(differences, current_position, next_old_position);
      }
      if (in_old_range) old_index++;
      current_position = next_old_position;
      in_old_range = !in_old_range;
    } else if (next_new_position.bytes < next_old_position.bytes) {
      if (in_old_range != in_new_range) {
        ts_range_array_add(differences, current_position, next_new_position);
      }
      if (in_new_range) new_index++;
      current_position = next_new_position;
      in_new_range = !in_new_range;
    } else {
      if (in_old_range != in_new_range) {
        ts_range_array_add(differences, current_position, next_new_position);
      }
      if (in_old_range) old_index++;
      if (in_new_range) new_index++;
      in_old_range = !in_old_range;
      in_new_range = !in_new_range;
      current_position = next_new_position;
    }
  }
}

typedef struct {
  TreeCursor cursor;
  const TSLanguage *language;
  unsigned visible_depth;
  bool in_padding;
  Subtree prev_external_token;
} Iterator;

static Iterator iterator_new(
  TreeCursor *cursor,
  const Subtree *tree,
  const TSLanguage *language
) {
  array_clear(&cursor->stack);
  array_push(&cursor->stack, ((TreeCursorEntry) {
    .subtree = tree,
    .position = length_zero(),
    .child_index = 0,
    .structural_child_index = 0,
  }));
  return (Iterator) {
    .cursor = *cursor,
    .language = language,
    .visible_depth = 1,
    .in_padding = false,
    .prev_external_token = NULL_SUBTREE,
  };
}

static bool iterator_done(Iterator *self) {
  return self->cursor.stack.size == 0;
}

static Length iterator_start_position(Iterator *self) {
  TreeCursorEntry entry = *array_back(&self->cursor.stack);
  if (self->in_padding) {
    return entry.position;
  } else {
    return length_add(entry.position, ts_subtree_padding(*entry.subtree));
  }
}

static Length iterator_end_position(Iterator *self) {
  TreeCursorEntry entry = *array_back(&self->cursor.stack);
  Length result = length_add(entry.position, ts_subtree_padding(*entry.subtree));
  if (self->in_padding) {
    return result;
  } else {
    return length_add(result, ts_subtree_size(*entry.subtree));
  }
}

static bool iterator_tree_is_visible(const Iterator *self) {
  TreeCursorEntry entry = *array_back(&self->cursor.stack);
  if (ts_subtree_visible(*entry.subtree)) return true;
  if (self->cursor.stack.size > 1) {
    Subtree parent = *array_get(&self->cursor.stack, self->cursor.stack.size - 2)->subtree;
    return ts_language_alias_at(
      self->language,
      parent.ptr->production_id,
      entry.structural_child_index
    ) != 0;
  }
  return false;
}

static void iterator_get_visible_state(
  const Iterator *self,
  Subtree *tree,
  TSSymbol *alias_symbol,
  uint32_t *start_byte
) {
  uint32_t i = self->cursor.stack.size - 1;

  if (self->in_padding) {
    if (i == 0) return;
    i--;
  }

  for (; i + 1 > 0; i--) {
    TreeCursorEntry entry = *array_get(&self->cursor.stack, i);

    if (i > 0) {
      const Subtree *parent = array_get(&self->cursor.stack, i - 1)->subtree;
      *alias_symbol = ts_language_alias_at(
        self->language,
        parent->ptr->production_id,
        entry.structural_child_index
      );
    }

    if (ts_subtree_visible(*entry.subtree) || *alias_symbol) {
      *tree = *entry.subtree;
      *start_byte = entry.position.bytes;
      break;
    }
  }
}

static void iterator_ascend(Iterator *self) {
  if (iterator_done(self)) return;
  if (iterator_tree_is_visible(self) && !self->in_padding) self->visible_depth--;
  if (array_back(&self->cursor.stack)->child_index > 0) self->in_padding = false;
  self->cursor.stack.size--;
}

static bool iterator_descend(Iterator *self, uint32_t goal_position) {
  if (self->in_padding) return false;

  bool did_descend = false;
  do {
    did_descend = false;
    TreeCursorEntry entry = *array_back(&self->cursor.stack);
    Length position = entry.position;
    uint32_t structural_child_index = 0;
    for (uint32_t i = 0, n = ts_subtree_child_count(*entry.subtree); i < n; i++) {
      const Subtree *child = &ts_subtree_children(*entry.subtree)[i];
      Length child_left = length_add(position, ts_subtree_padding(*child));
      Length child_right = length_add(child_left, ts_subtree_size(*child));

      if (child_right.bytes > goal_position) {
        array_push(&self->cursor.stack, ((TreeCursorEntry) {
          .subtree = child,
          .position = position,
          .child_index = i,
          .structural_child_index = structural_child_index,
        }));

        if (iterator_tree_is_visible(self)) {
          if (child_left.bytes > goal_position) {
            self->in_padding = true;
          } else {
            self->visible_depth++;
          }
          return true;
        }

        did_descend = true;
        break;
      }

      position = child_right;
      if (!ts_subtree_extra(*child)) structural_child_index++;
      Subtree last_external_token = ts_subtree_last_external_token(*child);
      if (last_external_token.ptr) {
        self->prev_external_token = last_external_token;
      }
    }
  } while (did_descend);

  return false;
}

static void iterator_advance(Iterator *self) {
  if (self->in_padding) {
    self->in_padding = false;
    if (iterator_tree_is_visible(self)) {
      self->visible_depth++;
    } else {
      iterator_descend(self, 0);
    }
    return;
  }

  for (;;) {
    if (iterator_tree_is_visible(self)) self->visible_depth--;
    TreeCursorEntry entry = array_pop(&self->cursor.stack);
    if (iterator_done(self)) return;

    const Subtree *parent = array_back(&self->cursor.stack)->subtree;
    uint32_t child_index = entry.child_index + 1;
    Subtree last_external_token = ts_subtree_last_external_token(*entry.subtree);
    if (last_external_token.ptr) {
      self->prev_external_token = last_external_token;
    }
    if (ts_subtree_child_count(*parent) > child_index) {
      Length position = length_add(entry.position, ts_subtree_total_size(*entry.subtree));
      uint32_t structural_child_index = entry.structural_child_index;
      if (!ts_subtree_extra(*entry.subtree)) structural_child_index++;
      const Subtree *next_child = &ts_subtree_children(*parent)[child_index];

      array_push(&self->cursor.stack, ((TreeCursorEntry) {
        .subtree = next_child,
        .position = position,
        .child_index = child_index,
        .structural_child_index = structural_child_index,
      }));

      if (iterator_tree_is_visible(self)) {
        if (ts_subtree_padding(*next_child).bytes > 0) {
          self->in_padding = true;
        } else {
          self->visible_depth++;
        }
      } else {
        iterator_descend(self, 0);
      }
      break;
    }
  }
}

typedef enum {
  IteratorDiffers,
  IteratorMayDiffer,
  IteratorMatches,
} IteratorComparison;

static IteratorComparison iterator_compare(
  const Iterator *old_iter,
  const Iterator *new_iter
) {
  Subtree old_tree = NULL_SUBTREE;
  Subtree new_tree = NULL_SUBTREE;
  uint32_t old_start = 0;
  uint32_t new_start = 0;
  TSSymbol old_alias_symbol = 0;
  TSSymbol new_alias_symbol = 0;
  iterator_get_visible_state(old_iter, &old_tree, &old_alias_symbol, &old_start);
  iterator_get_visible_state(new_iter, &new_tree, &new_alias_symbol, &new_start);
  TSSymbol old_symbol = ts_subtree_symbol(old_tree);
  TSSymbol new_symbol = ts_subtree_symbol(new_tree);

  if (!old_tree.ptr && !new_tree.ptr) return IteratorMatches;
  if (!old_tree.ptr || !new_tree.ptr) return IteratorDiffers;
  if (old_alias_symbol != new_alias_symbol || old_symbol != new_symbol) return IteratorDiffers;

  uint32_t old_size = ts_subtree_size(old_tree).bytes;
  uint32_t new_size = ts_subtree_size(new_tree).bytes;
  TSStateId old_state = ts_subtree_parse_state(old_tree);
  TSStateId new_state = ts_subtree_parse_state(new_tree);
  bool old_has_external_tokens = ts_subtree_has_external_tokens(old_tree);
  bool new_has_external_tokens = ts_subtree_has_external_tokens(new_tree);
  uint32_t old_error_cost = ts_subtree_error_cost(old_tree);
  uint32_t new_error_cost = ts_subtree_error_cost(new_tree);

  if (
    old_start != new_start ||
    old_symbol == ts_builtin_sym_error ||
    old_size != new_size ||
    old_state == TS_TREE_STATE_NONE ||
    new_state == TS_TREE_STATE_NONE ||
    ((old_state == ERROR_STATE) != (new_state == ERROR_STATE)) ||
    old_error_cost != new_error_cost ||
    old_has_external_tokens != new_has_external_tokens ||
    ts_subtree_has_changes(old_tree) ||
    (
      old_has_external_tokens &&
      !ts_subtree_external_scanner_state_eq(old_iter->prev_external_token, new_iter->prev_external_token)
    )
  ) {
    return IteratorMayDiffer;
  }

  return IteratorMatches;
}

#ifdef DEBUG_GET_CHANGED_RANGES
static inline void iterator_print_state(Iterator *self) {
  TreeCursorEntry entry = *array_back(&self->cursor.stack);
  TSPoint start = iterator_start_position(self).extent;
  TSPoint end = iterator_end_position(self).extent;
  const char *name = ts_language_symbol_name(self->language, ts_subtree_symbol(*entry.subtree));
  printf(
    "(%-25s %s\t depth:%u [%u, %u] - [%u, %u])",
    name, self->in_padding ? "(p)" : "   ",
    self->visible_depth,
    start.row, start.column,
    end.row, end.column
  );
}
#endif

unsigned ts_subtree_get_changed_ranges(
  const Subtree *old_tree, const Subtree *new_tree,
  TreeCursor *cursor1, TreeCursor *cursor2,
  const TSLanguage *language,
  const TSRangeArray *included_range_differences,
  TSRange **ranges
) {
  TSRangeArray results = array_new();

  Iterator old_iter = iterator_new(cursor1, old_tree, language);
  Iterator new_iter = iterator_new(cursor2, new_tree, language);

  unsigned included_range_difference_index = 0;

  Length position = iterator_start_position(&old_iter);
  Length next_position = iterator_start_position(&new_iter);
  if (position.bytes < next_position.bytes) {
    ts_range_array_add(&results, position, next_position);
    position = next_position;
  } else if (position.bytes > next_position.bytes) {
    ts_range_array_add(&results, next_position, position);
    next_position = position;
  }

  do {
    #ifdef DEBUG_GET_CHANGED_RANGES
    printf("At [%-2u, %-2u] Compare ", position.extent.row, position.extent.column);
    iterator_print_state(&old_iter);
    printf("\tvs\t");
    iterator_print_state(&new_iter);
    puts("");
    #endif

    // Compare the old and new subtrees.
    IteratorComparison comparison = iterator_compare(&old_iter, &new_iter);

    // Even if the two subtrees appear to be identical, they could differ
    // internally if they contain a range of text that was previously
    // excluded from the parse, and is now included, or vice-versa.
    if (comparison == IteratorMatches && ts_range_array_intersects(
      included_range_differences,
      included_range_difference_index,
      position.bytes,
      iterator_end_position(&old_iter).bytes
    )) {
      comparison = IteratorMayDiffer;
    }

    bool is_changed = false;
    switch (comparison) {
      // If the subtrees are definitely identical, move to the end
      // of both subtrees.
      case IteratorMatches:
        next_position = iterator_end_position(&old_iter);
        break;

      // If the subtrees might differ internally, descend into both
      // subtrees, finding the first child that spans the current position.
      case IteratorMayDiffer:
        if (iterator_descend(&old_iter, position.bytes)) {
          if (!iterator_descend(&new_iter, position.bytes)) {
            is_changed = true;
            next_position = iterator_end_position(&old_iter);
          }
        } else if (iterator_descend(&new_iter, position.bytes)) {
          is_changed = true;
          next_position = iterator_end_position(&new_iter);
        } else {
          next_position = length_min(
            iterator_end_position(&old_iter),
            iterator_end_position(&new_iter)
          );
        }
        break;

      // If the subtrees are different, record a change and then move
      // to the end of both subtrees.
      case IteratorDiffers:
        is_changed = true;
        next_position = length_min(
          iterator_end_position(&old_iter),
          iterator_end_position(&new_iter)
        );
        break;
    }

    // Ensure that both iterators are caught up to the current position.
    while (
      !iterator_done(&old_iter) &&
      iterator_end_position(&old_iter).bytes <= next_position.bytes
    ) iterator_advance(&old_iter);
    while (
      !iterator_done(&new_iter) &&
      iterator_end_position(&new_iter).bytes <= next_position.bytes
    ) iterator_advance(&new_iter);

    // Ensure that both iterators are at the same depth in the tree.
    while (old_iter.visible_depth > new_iter.visible_depth) {
      iterator_ascend(&old_iter);
    }
    while (new_iter.visible_depth > old_iter.visible_depth) {
      iterator_ascend(&new_iter);
    }

    if (is_changed) {
      #ifdef DEBUG_GET_CHANGED_RANGES
      printf(
        "  change: [[%u, %u] - [%u, %u]]\n",
        position.extent.row + 1, position.extent.column,
        next_position.extent.row + 1, next_position.extent.column
      );
      #endif

      ts_range_array_add(&results, position, next_position);
    }

    position = next_position;

    // Keep track of the current position in the included range differences
    // array in order to avoid scanning the entire array on each iteration.
    while (included_range_difference_index < included_range_differences->size) {
      const TSRange *range = array_get(included_range_differences,
        included_range_difference_index
      );
      if (range->end_byte <= position.bytes) {
        included_range_difference_index++;
      } else {
        break;
      }
    }
  } while (!iterator_done(&old_iter) && !iterator_done(&new_iter));

  Length old_size = ts_subtree_total_size(*old_tree);
  Length new_size = ts_subtree_total_size(*new_tree);
  if (old_size.bytes < new_size.bytes) {
    ts_range_array_add(&results, old_size, new_size);
  } else if (new_size.bytes < old_size.bytes) {
    ts_range_array_add(&results, new_size, old_size);
  }

  *cursor1 = old_iter.cursor;
  *cursor2 = new_iter.cursor;
  *ranges = results.contents;
  return results.size;
}
