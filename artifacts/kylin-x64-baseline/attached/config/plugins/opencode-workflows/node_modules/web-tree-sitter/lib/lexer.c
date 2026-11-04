#include "./length.h"
#include "./lexer.h"
#include "./unicode.h"

#include "tree_sitter/api.h"

#include <stdarg.h>
#include <stdio.h>

#define LOG(message, character)              \
  if (self->logger.log) {                    \
    snprintf(                                \
      self->debug_buffer,                    \
      TREE_SITTER_SERIALIZATION_BUFFER_SIZE, \
      32 <= character && character < 127 ?   \
        message " character:'%c'" :          \
        message " character:%d",             \
      character                              \
    );                                       \
    self->logger.log(                        \
      self->logger.payload,                  \
      TSLogTypeLex,                          \
      self->debug_buffer                     \
    );                                       \
  }

static const int32_t BYTE_ORDER_MARK = 0xFEFF;

static const TSRange DEFAULT_RANGE = {
  .start_point = {
    .row = 0,
    .column = 0,
  },
  .end_point = {
    .row = UINT32_MAX,
    .column = UINT32_MAX,
  },
  .start_byte = 0,
  .end_byte = UINT32_MAX
};

/**
 * Sets the column data to the given value and marks it valid.
 * @param self The lexer state.
 * @param val The new value of the column data.
 */
static void ts_lexer__set_column_data(Lexer *self, uint32_t val) {
  self->column_data.valid = true;
  self->column_data.value = val;
}

/**
 * Increments the value of the column data; no-op if invalid.
 * @param self The lexer state.
 */
static void ts_lexer__increment_column_data(Lexer *self) {
  if (self->column_data.valid) {
    self->column_data.value++;
  }
}

/**
 * Marks the column data as invalid.
 * @param self The lexer state.
 */
static void ts_lexer__invalidate_column_data(Lexer *self) {
  self->column_data.valid = false;
  self->column_data.value = 0;
}

// Check if the lexer has reached EOF. This state is stored
// by setting the lexer's `current_included_range_index` such that
// it has consumed all of its available ranges.
static bool ts_lexer__eof(const TSLexer *_self) {
  Lexer *self = (Lexer *)_self;
  return self->current_included_range_index == self->included_range_count;
}

// Clear the currently stored chunk of source code, because the lexer's
// position has changed.
static void ts_lexer__clear_chunk(Lexer *self) {
  self->chunk = NULL;
  self->chunk_size = 0;
  self->chunk_start = 0;
}

// Call the lexer's input callback to obtain a new chunk of source code
// for the current position.
static void ts_lexer__get_chunk(Lexer *self) {
  self->chunk_start = self->current_position.bytes;
  self->chunk = self->input.read(
    self->input.payload,
    self->current_position.bytes,
    self->current_position.extent,
    &self->chunk_size
  );
  if (!self->chunk_size) {
    self->current_included_range_index = self->included_range_count;
    self->chunk = NULL;
  }
}

// Decode the next unicode character in the current chunk of source code.
// This assumes that the lexer has already retrieved a chunk of source
// code that spans the current position.
static void ts_lexer__get_lookahead(Lexer *self) {
  uint32_t position_in_chunk = self->current_position.bytes - self->chunk_start;
  uint32_t size = self->chunk_size - position_in_chunk;

  if (size == 0) {
    self->lookahead_size = 1;
    self->data.lookahead = '\0';
    return;
  }

  const uint8_t *chunk = (const uint8_t *)self->chunk + position_in_chunk;
  DecodeFunction decode =
    self->input.encoding == TSInputEncodingUTF8    ? ts_decode_utf8     :
    self->input.encoding == TSInputEncodingUTF16LE ? ts_decode_utf16_le :
    self->input.encoding == TSInputEncodingUTF16BE ? ts_decode_utf16_be : self->input.decode;

  self->lookahead_size = decode(chunk, size, &self->data.lookahead);

  // If this chunk ended in the middle of a multi-byte character,
  // try again with a fresh chunk.
  if (self->data.lookahead == TS_DECODE_ERROR && size < 4) {
    ts_lexer__get_chunk(self);
    chunk = (const uint8_t *)self->chunk;
    size = self->chunk_size;
    self->lookahead_size = decode(chunk, size, &self->data.lookahead);
  }

  if (self->data.lookahead == TS_DECODE_ERROR) {
    self->lookahead_size = 1;
  }
}

static void ts_lexer_goto(Lexer *self, Length position) {
  if (position.bytes != self->current_position.bytes) {
    ts_lexer__invalidate_column_data(self);
  }

  self->current_position = position;

  // Move to the first valid position at or after the given position.
  bool found_included_range = false;
  for (unsigned i = 0; i < self->included_range_count; i++) {
    TSRange *included_range = &self->included_ranges[i];
    if (
      included_range->end_byte > self->current_position.bytes &&
      included_range->end_byte > included_range->start_byte
    ) {
      if (included_range->start_byte >= self->current_position.bytes) {
        self->current_position = (Length) {
          .bytes = included_range->start_byte,
          .extent = included_range->start_point,
        };
      }

      self->current_included_range_index = i;
      found_included_range = true;
      break;
    }
  }

  if (found_included_range) {
    // If the current position is outside of the current chunk of text,
    // then clear out the current chunk of text.
    if (self->chunk && (
      self->current_position.bytes < self->chunk_start ||
      self->current_position.bytes >= self->chunk_start + self->chunk_size
    )) {
      ts_lexer__clear_chunk(self);
    }

    self->lookahead_size = 0;
    self->data.lookahead = '\0';
  }

  // If the given position is beyond any of included ranges, move to the EOF
  // state - past the end of the included ranges.
  else {
    self->current_included_range_index = self->included_range_count;
    TSRange *last_included_range = &self->included_ranges[self->included_range_count - 1];
    self->current_position = (Length) {
      .bytes = last_included_range->end_byte,
      .extent = last_included_range->end_point,
    };
    ts_lexer__clear_chunk(self);
    self->lookahead_size = 1;
    self->data.lookahead = '\0';
  }
}

/**
 * Actually advances the lexer. Does not log anything.
 * @param self The lexer state.
 * @param skip Whether to mark the consumed codepoint as whitespace.
 */
static void ts_lexer__do_advance(Lexer *self, bool skip) {
  if (self->lookahead_size) {
    if (self->data.lookahead == '\n') {
      self->current_position.extent.row++;
      self->current_position.extent.column = 0;
      ts_lexer__set_column_data(self, 0);
    } else {
      bool is_bom = self->current_position.bytes == 0 && 
        self->data.lookahead == BYTE_ORDER_MARK;
      if (!is_bom) ts_lexer__increment_column_data(self);
      self->current_position.extent.column += self->lookahead_size;
    }
    self->current_position.bytes += self->lookahead_size;
  }

  const TSRange *current_range = &self->included_ranges[self->current_included_range_index];
  while (
    self->current_position.bytes >= current_range->end_byte ||
    current_range->end_byte == current_range->start_byte
  ) {
    if (self->current_included_range_index < self->included_range_count) {
      self->current_included_range_index++;
    }
    if (self->current_included_range_index < self->included_range_count) {
      current_range++;
      self->current_position = (Length) {
        current_range->start_byte,
        current_range->start_point,
      };
    } else {
      current_range = NULL;
      break;
    }
  }

  if (skip) self->token_start_position = self->current_position;

  if (current_range) {
    if (
      self->current_position.bytes < self->chunk_start ||
      self->current_position.bytes >= self->chunk_start + self->chunk_size
    ) {
      ts_lexer__get_chunk(self);
    }
    ts_lexer__get_lookahead(self);
  } else {
    ts_lexer__clear_chunk(self);
    self->data.lookahead = '\0';
    self->lookahead_size = 1;
  }
}

// Advance to the next character in the source code, retrieving a new
// chunk of source code if needed.
static void ts_lexer__advance(TSLexer *_self, bool skip) {
  Lexer *self = (Lexer *)_self;
  if (!self->chunk) return;

  if (skip) {
    LOG("skip", self->data.lookahead)
  } else {
    LOG("consume", self->data.lookahead)
  }

  ts_lexer__do_advance(self, skip);
}

// Mark that a token match has completed. This can be called multiple
// times if a longer match is found later.
static void ts_lexer__mark_end(TSLexer *_self) {
  Lexer *self = (Lexer *)_self;
  if (!ts_lexer__eof(&self->data)) {
    // If the lexer is right at the beginning of included range,
    // then the token should be considered to end at the *end* of the
    // previous included range, rather than here.
    TSRange *current_included_range = &self->included_ranges[
      self->current_included_range_index
    ];
    if (
      self->current_included_range_index > 0 &&
      self->current_position.bytes == current_included_range->start_byte
    ) {
      TSRange *previous_included_range = current_included_range - 1;
      self->token_end_position = (Length) {
        previous_included_range->end_byte,
        previous_included_range->end_point,
      };
      return;
    }
  }
  self->token_end_position = self->current_position;
}

static uint32_t ts_lexer__get_column(TSLexer *_self) {
  Lexer *self = (Lexer *)_self;

  self->did_get_column = true;

  if (!self->column_data.valid) {
    // Record current position
    uint32_t goal_byte = self->current_position.bytes;

    // Back up to the beginning of the line
    Length start_of_col = {
      self->current_position.bytes - self->current_position.extent.column,
      {self->current_position.extent.row, 0},
    };
    ts_lexer_goto(self, start_of_col);
    ts_lexer__set_column_data(self, 0);
    ts_lexer__get_chunk(self);

    if (!ts_lexer__eof(_self)) {
      ts_lexer__get_lookahead(self);

      // Advance to the recorded position
      while (self->current_position.bytes < goal_byte && !ts_lexer__eof(_self) && self->chunk) {
        ts_lexer__do_advance(self, false);
        if (ts_lexer__eof(_self)) break;
      }
    }
  }

  return self->column_data.value;
}

// Is the lexer at a boundary between two disjoint included ranges of
// source code? This is exposed as an API because some languages' external
// scanners need to perform custom actions at these boundaries.
static bool ts_lexer__is_at_included_range_start(const TSLexer *_self) {
  const Lexer *self = (const Lexer *)_self;
  if (self->current_included_range_index < self->included_range_count) {
    TSRange *current_range = &self->included_ranges[self->current_included_range_index];
    return self->current_position.bytes == current_range->start_byte;
  } else {
    return false;
  }
}

static void ts_lexer__log(const TSLexer *_self, const char *fmt, ...) {
  Lexer *self = (Lexer *)_self;
  va_list args;
  va_start(args, fmt);
  if (self->logger.log) {
    vsnprintf(self->debug_buffer, TREE_SITTER_SERIALIZATION_BUFFER_SIZE, fmt, args);
    self->logger.log(self->logger.payload, TSLogTypeLex, self->debug_buffer);
  }
  va_end(args);
}

void ts_lexer_init(Lexer *self) {
  *self = (Lexer) {
    .data = {
      // The lexer's methods are stored as struct fields so that generated
      // parsers can call them without needing to be linked against this
      // library.
      .advance = ts_lexer__advance,
      .mark_end = ts_lexer__mark_end,
      .get_column = ts_lexer__get_column,
      .is_at_included_range_start = ts_lexer__is_at_included_range_start,
      .eof = ts_lexer__eof,
      .log = ts_lexer__log,
      .lookahead = 0,
      .result_symbol = 0,
    },
    .chunk = NULL,
    .chunk_size = 0,
    .chunk_start = 0,
    .current_position = {0, {0, 0}},
    .logger = {
      .payload = NULL,
      .log = NULL
    },
    .included_ranges = NULL,
    .included_range_count = 0,
    .current_included_range_index = 0,
    .did_get_column = false,
    .column_data = {
      .valid = false,
      .value = 0
    }
  };
  ts_lexer_set_included_ranges(self, NULL, 0);
}

void ts_lexer_delete(Lexer *self) {
  ts_free(self->included_ranges);
}

void ts_lexer_set_input(Lexer *self, TSInput input) {
  self->input = input;
  ts_lexer__clear_chunk(self);
  ts_lexer_goto(self, self->current_position);
}

// Move the lexer to the given position. This doesn't do any work
// if the parser is already at the given position.
void ts_lexer_reset(Lexer *self, Length position) {
  if (position.bytes != self->current_position.bytes) {
    ts_lexer_goto(self, position);
  }
}

void ts_lexer_start(Lexer *self) {
  self->token_start_position = self->current_position;
  self->token_end_position = LENGTH_UNDEFINED;
  self->data.result_symbol = 0;
  self->did_get_column = false;
  if (!ts_lexer__eof(&self->data)) {
    if (!self->chunk_size) ts_lexer__get_chunk(self);
    if (!self->lookahead_size) ts_lexer__get_lookahead(self);
    if (self->current_position.bytes == 0) {
      if (self->data.lookahead == BYTE_ORDER_MARK) {
        ts_lexer__advance(&self->data, true);
      }
      ts_lexer__set_column_data(self, 0);
    }
  }
}

void ts_lexer_finish(Lexer *self, uint32_t *lookahead_end_byte) {
  if (length_is_undefined(self->token_end_position)) {
    ts_lexer__mark_end(&self->data);
  }

  // If the token ended at an included range boundary, then its end position
  // will have been reset to the end of the preceding range. Reset the start
  // position to match.
  if (self->token_end_position.bytes < self->token_start_position.bytes) {
    self->token_start_position = self->token_end_position;
  }

  uint32_t current_lookahead_end_byte = self->current_position.bytes + 1;

  // In order to determine that a byte sequence is invalid UTF8 or UTF16,
  // the character decoding algorithm may have looked at the following byte.
  // Therefore, the next byte *after* the current (invalid) character
  // affects the interpretation of the current character.
  if (self->data.lookahead == TS_DECODE_ERROR) {
    current_lookahead_end_byte += 4; // the maximum number of bytes read to identify an invalid code point
  }

  if (current_lookahead_end_byte > *lookahead_end_byte) {
    *lookahead_end_byte = current_lookahead_end_byte;
  }
}

void ts_lexer_mark_end(Lexer *self) {
  ts_lexer__mark_end(&self->data);
}

bool ts_lexer_set_included_ranges(
  Lexer *self,
  const TSRange *ranges,
  uint32_t count
) {
  if (count == 0 || !ranges) {
    ranges = &DEFAULT_RANGE;
    count = 1;
  } else {
    uint32_t previous_byte = 0;
    for (unsigned i = 0; i < count; i++) {
      const TSRange *range = &ranges[i];
      if (
        range->start_byte < previous_byte ||
        range->end_byte < range->start_byte
      ) return false;
      previous_byte = range->end_byte;
    }
  }

  size_t size = count * sizeof(TSRange);
  self->included_ranges = ts_realloc(self->included_ranges, size);
  memcpy(self->included_ranges, ranges, size);
  self->included_range_count = count;
  ts_lexer_goto(self, self->current_position);
  return true;
}

TSRange *ts_lexer_included_ranges(const Lexer *self, uint32_t *count) {
  *count = self->included_range_count;
  return self->included_ranges;
}

#undef LOG
