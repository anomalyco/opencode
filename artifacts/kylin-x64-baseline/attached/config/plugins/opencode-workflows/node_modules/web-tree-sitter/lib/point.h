#ifndef TREE_SITTER_POINT_H_
#define TREE_SITTER_POINT_H_

#include "tree_sitter/api.h"

#define POINT_ZERO ((TSPoint) {0, 0})
#define POINT_MAX ((TSPoint) {UINT32_MAX, UINT32_MAX})

static inline TSPoint point__new(unsigned row, unsigned column) {
  TSPoint result = {row, column};
  return result;
}

static inline TSPoint point_add(TSPoint a, TSPoint b) {
  if (b.row > 0)
    return point__new(a.row + b.row, b.column);
  else
    return point__new(a.row, a.column + b.column);
}

static inline TSPoint point_sub(TSPoint a, TSPoint b) {
  if (a.row > b.row)
    return point__new(a.row - b.row, a.column);
  else
    return point__new(0, (a.column >= b.column) ? a.column - b.column : 0);
}

static inline bool point_lte(TSPoint a, TSPoint b) {
  return (a.row < b.row) || (a.row == b.row && a.column <= b.column);
}

static inline bool point_lt(TSPoint a, TSPoint b) {
  return (a.row < b.row) || (a.row == b.row && a.column < b.column);
}

static inline bool point_gt(TSPoint a, TSPoint b) {
  return (a.row > b.row) || (a.row == b.row && a.column > b.column);
}

static inline bool point_gte(TSPoint a, TSPoint b) {
  return (a.row > b.row) || (a.row == b.row && a.column >= b.column);
}

static inline bool point_eq(TSPoint a, TSPoint b) {
  return a.row == b.row && a.column == b.column;
}

#endif
