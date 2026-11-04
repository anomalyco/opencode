#ifndef TREE_SITTER_LENGTH_H_
#define TREE_SITTER_LENGTH_H_

#include <stdlib.h>
#include <stdbool.h>
#include "./point.h"
#include "tree_sitter/api.h"

typedef struct {
  uint32_t bytes;
  TSPoint extent;
} Length;

static const Length LENGTH_UNDEFINED = {0, {0, 1}};
static const Length LENGTH_MAX = {UINT32_MAX, {UINT32_MAX, UINT32_MAX}};

static inline bool length_is_undefined(Length length) {
  return length.bytes == 0 && length.extent.column != 0;
}

static inline Length length_min(Length len1, Length len2) {
  return (len1.bytes < len2.bytes) ? len1 : len2;
}

static inline Length length_add(Length len1, Length len2) {
  Length result;
  result.bytes = len1.bytes + len2.bytes;
  result.extent = point_add(len1.extent, len2.extent);
  return result;
}

static inline Length length_sub(Length len1, Length len2) {
  Length result;
  result.bytes = (len1.bytes >= len2.bytes) ? len1.bytes - len2.bytes : 0;
  result.extent = point_sub(len1.extent, len2.extent);
  return result;
}

static inline Length length_zero(void) {
  Length result = {0, {0, 0}};
  return result;
}

static inline Length length_saturating_sub(Length len1, Length len2) {
  if (len1.bytes > len2.bytes) {
    return length_sub(len1, len2);
  } else {
    return length_zero();
  }
}

#endif
