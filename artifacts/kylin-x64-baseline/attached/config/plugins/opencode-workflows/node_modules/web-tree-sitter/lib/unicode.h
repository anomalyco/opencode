#ifndef TREE_SITTER_UNICODE_H_
#define TREE_SITTER_UNICODE_H_

#ifdef __cplusplus
extern "C" {
#endif

#include <limits.h>
#include <stdint.h>

#define U_EXPORT
#define U_EXPORT2
#include "unicode/utf8.h"
#include "unicode/utf16.h"
#include "portable/endian.h"

#define U16_NEXT_LE(s, i, length, c) UPRV_BLOCK_MACRO_BEGIN { \
    (c)=le16toh((s)[(i)++]); \
    if(U16_IS_LEAD(c)) { \
        uint16_t __c2; \
        if((i)!=(length) && U16_IS_TRAIL(__c2=(s)[(i)])) { \
            ++(i); \
            (c)=U16_GET_SUPPLEMENTARY((c), __c2); \
        } \
    } \
} UPRV_BLOCK_MACRO_END

#define U16_NEXT_BE(s, i, length, c) UPRV_BLOCK_MACRO_BEGIN { \
    (c)=be16toh((s)[(i)++]); \
    if(U16_IS_LEAD(c)) { \
        uint16_t __c2; \
        if((i)!=(length) && U16_IS_TRAIL(__c2=(s)[(i)])) { \
            ++(i); \
            (c)=U16_GET_SUPPLEMENTARY((c), __c2); \
        } \
    } \
} UPRV_BLOCK_MACRO_END

static const int32_t TS_DECODE_ERROR = U_SENTINEL;

static inline uint32_t ts_decode_utf8(
  const uint8_t *string,
  uint32_t length,
  int32_t *code_point
) {
  uint32_t i = 0;
  U8_NEXT(string, i, length, *code_point);
  return i;
}

static inline uint32_t ts_decode_utf16_le(
  const uint8_t *string,
  uint32_t length,
  int32_t *code_point
) {
  uint32_t i = 0;
  U16_NEXT_LE(((uint16_t *)string), i, length, *code_point);
  return i * 2;
}

static inline uint32_t ts_decode_utf16_be(
  const uint8_t *string,
  uint32_t length,
  int32_t *code_point
) {
  uint32_t i = 0;
  U16_NEXT_BE(((uint16_t *)string), i, length, *code_point);
  return i * 2;
}

#ifdef __cplusplus
}
#endif

#endif  // TREE_SITTER_UNICODE_H_
