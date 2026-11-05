#ifndef TREE_SITTER_GET_CHANGED_RANGES_H_
#define TREE_SITTER_GET_CHANGED_RANGES_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "./tree_cursor.h"
#include "./subtree.h"

typedef Array(TSRange) TSRangeArray;

void ts_range_array_get_changed_ranges(
  const TSRange *old_ranges, unsigned old_range_count,
  const TSRange *new_ranges, unsigned new_range_count,
  TSRangeArray *differences
);

bool ts_range_array_intersects(
  const TSRangeArray *self, unsigned start_index,
  uint32_t start_byte, uint32_t end_byte
);

unsigned ts_subtree_get_changed_ranges(
  const Subtree *old_tree, const Subtree *new_tree,
  TreeCursor *cursor1, TreeCursor *cursor2,
  const TSLanguage *language,
  const TSRangeArray *included_range_differences,
  TSRange **ranges
);

#ifdef __cplusplus
}
#endif

#endif  // TREE_SITTER_GET_CHANGED_RANGES_H_
