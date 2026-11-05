#ifndef TREE_SITTER_WASM_H_
#define TREE_SITTER_WASM_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "tree_sitter/api.h"
#include "./parser.h"

bool ts_wasm_store_start(TSWasmStore *self, TSLexer *lexer, const TSLanguage *language);
void ts_wasm_store_reset(TSWasmStore *self);
bool ts_wasm_store_has_error(const TSWasmStore *self);

bool ts_wasm_store_call_lex_main(TSWasmStore *self, TSStateId state);
bool ts_wasm_store_call_lex_keyword(TSWasmStore *self, TSStateId state);

uint32_t ts_wasm_store_call_scanner_create(TSWasmStore *self);
void ts_wasm_store_call_scanner_destroy(TSWasmStore *self, uint32_t scanner_address);
bool ts_wasm_store_call_scanner_scan(TSWasmStore *self, uint32_t scanner_address, uint32_t valid_tokens_ix);
uint32_t ts_wasm_store_call_scanner_serialize(TSWasmStore *self, uint32_t scanner_address, char *buffer);
void ts_wasm_store_call_scanner_deserialize(TSWasmStore *self, uint32_t scanner, const char *buffer, unsigned length);

void ts_wasm_language_retain(const TSLanguage *self);
void ts_wasm_language_release(const TSLanguage *self);

#ifdef __cplusplus
}
#endif

#endif  // TREE_SITTER_WASM_H_
