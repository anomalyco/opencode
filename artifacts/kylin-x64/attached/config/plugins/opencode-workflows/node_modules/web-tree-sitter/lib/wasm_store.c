#include "tree_sitter/api.h"
#include "./parser.h"
#include <stdint.h>

#ifdef TREE_SITTER_FEATURE_WASM

#include "./alloc.h"
#include "./array.h"
#include "./atomic.h"
#include "./language.h"
#include "./lexer.h"
#include "./wasm/wasm-stdlib.h"
#include "./wasm_store.h"

#include <string.h>
#include <wasm.h>
#include <wasmtime.h>

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable : 4100)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#endif

#define array_len(a) (sizeof(a) / sizeof(a[0]))

// The following symbols from the C and C++ standard libraries are available
// for external scanners to use.
const char *STDLIB_SYMBOLS[] = {
  #include "./stdlib-symbols.txt"
};

// The contents of the `dylink.0` custom section of a wasm module,
// as specified by the current WebAssembly dynamic linking ABI proposal.
typedef struct {
  uint32_t memory_size;
  uint32_t memory_align;
  uint32_t table_size;
  uint32_t table_align;
} WasmDylinkInfo;

// WasmLanguageId - A pointer used to identify a language. This language id is
// reference-counted, so that its ownership can be shared between the language
// itself and the instances of the language that are held in wasm stores.
typedef struct {
  volatile uint32_t ref_count;
  volatile uint32_t is_language_deleted;
} WasmLanguageId;

// LanguageWasmModule - Additional data associated with a wasm-backed
// `TSLanguage`. This data is read-only and does not reference a particular
// wasm store, so it can be shared by all users of a `TSLanguage`. A pointer to
// this is stored on the language itself.
typedef struct {
  volatile uint32_t ref_count;
  WasmLanguageId *language_id;
  wasmtime_module_t *module;
  const char *name;
  char *symbol_name_buffer;
  char *field_name_buffer;
  WasmDylinkInfo dylink_info;
} LanguageWasmModule;

// LanguageWasmInstance - Additional data associated with an instantiation of
// a `TSLanguage` in a particular wasm store. The wasm store holds one of
// these structs for each language that it has instantiated.
typedef struct {
  WasmLanguageId *language_id;
  wasmtime_instance_t instance;
  int32_t external_states_address;
  int32_t lex_main_fn_index;
  int32_t lex_keyword_fn_index;
  int32_t scanner_create_fn_index;
  int32_t scanner_destroy_fn_index;
  int32_t scanner_serialize_fn_index;
  int32_t scanner_deserialize_fn_index;
  int32_t scanner_scan_fn_index;
} LanguageWasmInstance;

typedef struct {
  uint32_t reset_heap;
  uint32_t proc_exit;
  uint32_t abort;
  uint32_t assert_fail;
  uint32_t notify_memory_growth;
  uint32_t debug_message;
  uint32_t at_exit;
  uint32_t args_get;
  uint32_t args_sizes_get;
} BuiltinFunctionIndices;

// TSWasmStore - A struct that allows a given `Parser` to use wasm-backed
// languages. This struct is mutable, and can only be used by one parser at a
// time.
struct TSWasmStore {
  wasm_engine_t *engine;
  wasmtime_store_t *store;
  wasmtime_table_t function_table;
  wasmtime_memory_t memory;
  TSLexer *current_lexer;
  LanguageWasmInstance *current_instance;
  Array(LanguageWasmInstance) language_instances;
  uint32_t current_memory_offset;
  uint32_t current_function_table_offset;
  uint32_t *stdlib_fn_indices;
  BuiltinFunctionIndices builtin_fn_indices;
  wasmtime_global_t stack_pointer_global;
  wasm_globaltype_t *const_i32_type;
  bool has_error;
  uint32_t lexer_address;
};

typedef Array(char) StringData;

// LanguageInWasmMemory - The memory layout of a `TSLanguage` when compiled to
// wasm32. This is used to copy static language data out of the wasm memory.
typedef struct {
  uint32_t abi_version;
  uint32_t symbol_count;
  uint32_t alias_count;
  uint32_t token_count;
  uint32_t external_token_count;
  uint32_t state_count;
  uint32_t large_state_count;
  uint32_t production_id_count;
  uint32_t field_count;
  uint16_t max_alias_sequence_length;
  int32_t parse_table;
  int32_t small_parse_table;
  int32_t small_parse_table_map;
  int32_t parse_actions;
  int32_t symbol_names;
  int32_t field_names;
  int32_t field_map_slices;
  int32_t field_map_entries;
  int32_t symbol_metadata;
  int32_t public_symbol_map;
  int32_t alias_map;
  int32_t alias_sequences;
  int32_t lex_modes;
  int32_t lex_fn;
  int32_t keyword_lex_fn;
  TSSymbol keyword_capture_token;
  struct {
    int32_t states;
    int32_t symbol_map;
    int32_t create;
    int32_t destroy;
    int32_t scan;
    int32_t serialize;
    int32_t deserialize;
  } external_scanner;
  int32_t primary_state_ids;
  int32_t name;
  int32_t reserved_words;
  uint16_t max_reserved_word_set_size;
  uint32_t supertype_count;
  int32_t supertype_symbols;
  int32_t supertype_map_slices;
  int32_t supertype_map_entries;
  TSLanguageMetadata metadata;
} LanguageInWasmMemory;

// LexerInWasmMemory - The memory layout of a `TSLexer` when compiled to wasm32.
// This is used to copy mutable lexing state in and out of the wasm memory.
typedef struct {
  int32_t lookahead;
  TSSymbol result_symbol;
  int32_t advance;
  int32_t mark_end;
  int32_t get_column;
  int32_t is_at_included_range_start;
  int32_t eof;
} LexerInWasmMemory;

// Linear memory layout:
// [ <-- stack | stdlib statics | lexer | language statics --> | serialization_buffer | heap --> ]
#define MAX_MEMORY_SIZE (128 * 1024 * 1024 / MEMORY_PAGE_SIZE)

/************************
 * WasmDylinkMemoryInfo
 ***********************/

static uint8_t read_u8(const uint8_t **p) {
  return *(*p)++;
}

static inline uint64_t read_uleb128(const uint8_t **p, const uint8_t *end) {
  uint64_t value = 0;
  unsigned shift = 0;
  do {
    if (*p == end)  return UINT64_MAX;
    value += (uint64_t)(**p & 0x7f) << shift;
    shift += 7;
  } while (*((*p)++) >= 128);
  return value;
}

static bool wasm_dylink_info__parse(
  const uint8_t *bytes,
  size_t length,
  WasmDylinkInfo *info
) {
  const uint8_t WASM_MAGIC_NUMBER[4] = {0, 'a', 's', 'm'};
  const uint8_t WASM_VERSION[4] = {1, 0, 0, 0};
  const uint8_t WASM_CUSTOM_SECTION = 0x0;
  const uint8_t WASM_DYLINK_MEM_INFO = 0x1;

  const uint8_t *p = bytes;
  const uint8_t *end = bytes + length;

  if (length < 8) return false;
  if (memcmp(p, WASM_MAGIC_NUMBER, 4) != 0) return false;
  p += 4;
  if (memcmp(p, WASM_VERSION, 4) != 0) return false;
  p += 4;

  while (p < end) {
    uint8_t section_id = read_u8(&p);
    uint32_t section_length = read_uleb128(&p, end);
    const uint8_t *section_end = p + section_length;
    if (section_end > end) return false;

    if (section_id == WASM_CUSTOM_SECTION) {
      uint32_t name_length = read_uleb128(&p, section_end);
      const uint8_t *name_end = p + name_length;
      if (name_end > section_end) return false;

      if (name_length == 8 && memcmp(p, "dylink.0", 8) == 0) {
        p = name_end;
        while (p < section_end) {
          uint8_t subsection_type = read_u8(&p);
          uint32_t subsection_size = read_uleb128(&p, section_end);
          const uint8_t *subsection_end = p + subsection_size;
          if (subsection_end > section_end) return false;
          if (subsection_type == WASM_DYLINK_MEM_INFO) {
            info->memory_size = read_uleb128(&p, subsection_end);
            info->memory_align = read_uleb128(&p, subsection_end);
            info->table_size = read_uleb128(&p, subsection_end);
            info->table_align = read_uleb128(&p, subsection_end);
            return true;
          }
          p = subsection_end;
        }
      }
    }
    p = section_end;
  }
  return false;
}

/*******************************************
 * Native callbacks exposed to wasm modules
 *******************************************/

 static wasm_trap_t *callback__abort(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  return wasmtime_trap_new("wasm module called abort", 24);
}

static wasm_trap_t *callback__debug_message(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  wasmtime_context_t *context = wasmtime_caller_context(caller);
  TSWasmStore *store = env;
  ts_assert(args_and_results_len == 2);
  uint32_t string_address = args_and_results[0].i32;
  uint32_t value = args_and_results[1].i32;
  uint8_t *memory = wasmtime_memory_data(context, &store->memory);
  printf("DEBUG: %s %u\n", &memory[string_address], value);
  return NULL;
}

static wasm_trap_t *callback__noop(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  return NULL;
}

static wasm_trap_t *callback__lexer_advance(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  wasmtime_context_t *context = wasmtime_caller_context(caller);
  ts_assert(args_and_results_len == 2);

  TSWasmStore *store = env;
  TSLexer *lexer = store->current_lexer;
  bool skip = args_and_results[1].i32;
  lexer->advance(lexer, skip);

  uint8_t *memory = wasmtime_memory_data(context, &store->memory);
  memcpy(&memory[store->lexer_address], &lexer->lookahead, sizeof(lexer->lookahead));
  return NULL;
}

static wasm_trap_t *callback__lexer_mark_end(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  TSWasmStore *store = env;
  TSLexer *lexer = store->current_lexer;
  lexer->mark_end(lexer);
  return NULL;
}

static wasm_trap_t *callback__lexer_get_column(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  TSWasmStore *store = env;
  TSLexer *lexer = store->current_lexer;
  uint32_t result = lexer->get_column(lexer);
  args_and_results[0].i32 = result;
  return NULL;
}

static wasm_trap_t *callback__lexer_is_at_included_range_start(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  TSWasmStore *store = env;
  TSLexer *lexer = store->current_lexer;
  bool result = lexer->is_at_included_range_start(lexer);
  args_and_results[0].i32 = result;
  return NULL;
}

static wasm_trap_t *callback__lexer_eof(
  void *env,
  wasmtime_caller_t* caller,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  TSWasmStore *store = env;
  TSLexer *lexer = store->current_lexer;
  bool result = lexer->eof(lexer);
  args_and_results[0].i32 = result;
  return NULL;
}

typedef struct {
  uint32_t *storage_location;
  wasmtime_func_unchecked_callback_t callback;
  wasm_functype_t *type;
} FunctionDefinition;

static void *copy(const void *data, size_t size) {
  void *result = ts_malloc(size);
  memcpy(result, data, size);
  return result;
}

static void *copy_unsized_static_array(
  const uint8_t *data,
  int32_t start_address,
  const int32_t all_addresses[],
  size_t address_count
) {
  int32_t end_address = 0;
  for (unsigned i = 0; i < address_count; i++) {
    if (all_addresses[i] > start_address) {
      if (!end_address || all_addresses[i] < end_address) {
        end_address = all_addresses[i];
      }
    }
  }

  if (!end_address) return NULL;
  size_t size = end_address - start_address;
  void *result = ts_malloc(size);
  memcpy(result, &data[start_address], size);
  return result;
}

static void *copy_strings(
  const uint8_t *data,
  int32_t array_address,
  size_t count,
  StringData *string_data
) {
  const char **result = ts_malloc(count * sizeof(char *));
  for (unsigned i = 0; i < count; i++) {
    int32_t address;
    memcpy(&address, &data[array_address + i * sizeof(address)], sizeof(address));
    if (address == 0) {
      result[i] = (const char *)-1;
    } else {
      const uint8_t *string = &data[address];
      uint32_t len = strlen((const char *)string);
      result[i] = (const char *)(uintptr_t)string_data->size;
      array_extend(string_data, len + 1, string);
    }
  }
  for (unsigned i = 0; i < count; i++) {
    if (result[i] == (const char *)-1) {
      result[i] = NULL;
    } else {
      result[i] = string_data->contents + (uintptr_t)result[i];
    }
  }
  return result;
}

static void *copy_string(
  const uint8_t *data,
  int32_t address
) {
  const char *string = (const char *)&data[address];
  size_t len = strlen(string);
  char *result = ts_malloc(len + 1);
  memcpy(result, string, len + 1);
  return result;
}

static bool name_eq(const wasm_name_t *name, const char *string) {
  return strncmp(string, name->data, name->size) == 0;
}

static inline wasm_functype_t* wasm_functype_new_4_0(
  wasm_valtype_t* p1,
  wasm_valtype_t* p2,
  wasm_valtype_t* p3,
  wasm_valtype_t* p4
) {
  wasm_valtype_t* ps[4] = {p1, p2, p3, p4};
  wasm_valtype_vec_t params, results;
  wasm_valtype_vec_new(&params, 4, ps);
  wasm_valtype_vec_new_empty(&results);
  return wasm_functype_new(&params, &results);
}

#define format(output, ...) \
  do { \
    size_t message_length = snprintf((char *)NULL, 0, __VA_ARGS__); \
    *output = ts_malloc(message_length + 1); \
    snprintf(*output, message_length + 1, __VA_ARGS__); \
  } while (0)

WasmLanguageId *language_id_new(void) {
  WasmLanguageId *self = ts_malloc(sizeof(WasmLanguageId));
  self->is_language_deleted = false;
  self->ref_count = 1;
  return self;
}

WasmLanguageId *language_id_clone(WasmLanguageId *self) {
  atomic_inc(&self->ref_count);
  return self;
}

void language_id_delete(WasmLanguageId *self) {
  if (atomic_dec(&self->ref_count) == 0) {
    ts_free(self);
  }
}

static wasmtime_extern_t get_builtin_extern(
  wasmtime_table_t *table,
  unsigned index
) {
  return (wasmtime_extern_t) {
    .kind = WASMTIME_EXTERN_FUNC,
    .of.func = (wasmtime_func_t) {
      .store_id = table->store_id,
      .__private = index
    }
  };
}

static bool ts_wasm_store__provide_builtin_import(
  TSWasmStore *self,
  const wasm_name_t *import_name,
  wasmtime_extern_t *import
) {
  wasmtime_error_t *error = NULL;
  wasmtime_context_t *context = wasmtime_store_context(self->store);

  // Dynamic linking parameters
  if (name_eq(import_name, "__memory_base")) {
    wasmtime_val_t value = WASM_I32_VAL(self->current_memory_offset);
    wasmtime_global_t global;
    error = wasmtime_global_new(context, self->const_i32_type, &value, &global);
    ts_assert(!error);
    *import = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_GLOBAL, .of.global = global};
  } else if (name_eq(import_name, "__table_base")) {
    wasmtime_val_t value = WASM_I32_VAL(self->current_function_table_offset);
    wasmtime_global_t global;
    error = wasmtime_global_new(context, self->const_i32_type, &value, &global);
    ts_assert(!error);
    *import = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_GLOBAL, .of.global = global};
  } else if (name_eq(import_name, "__stack_pointer")) {
    *import = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_GLOBAL, .of.global = self->stack_pointer_global};
  } else if (name_eq(import_name, "__indirect_function_table")) {
    *import = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_TABLE, .of.table = self->function_table};
  } else if (name_eq(import_name, "memory")) {
    *import = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_MEMORY, .of.memory = self->memory};
  }

  // Builtin functions
  else if (name_eq(import_name, "__assert_fail")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.assert_fail);
  } else if (name_eq(import_name, "__cxa_atexit")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.at_exit);
  } else if (name_eq(import_name, "args_get")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.args_get);
  } else if (name_eq(import_name, "args_sizes_get")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.args_sizes_get);
  } else if (name_eq(import_name, "abort")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.abort);
  } else if (name_eq(import_name, "proc_exit")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.proc_exit);
  } else if (name_eq(import_name, "emscripten_notify_memory_growth")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.notify_memory_growth);
  } else if (name_eq(import_name, "tree_sitter_debug_message")) {
    *import = get_builtin_extern(&self->function_table, self->builtin_fn_indices.debug_message);
  } else {
    return false;
  }

  return true;
}

static bool ts_wasm_store__call_module_initializer(
  TSWasmStore *self,
  const wasm_name_t *export_name,
  wasmtime_extern_t *export,
  wasm_trap_t **trap
) {
  if (
    name_eq(export_name, "_initialize") ||
    name_eq(export_name, "__wasm_apply_data_relocs") ||
    name_eq(export_name, "__wasm_call_ctors")
  ) {
    wasmtime_context_t *context = wasmtime_store_context(self->store);
    wasmtime_func_t initialization_func = export->of.func;
    wasmtime_error_t *error = wasmtime_func_call(context, &initialization_func, NULL, 0, NULL, 0, trap);
    ts_assert(!error);
    return true;
  } else {
    return false;
  }
}

TSWasmStore *ts_wasm_store_new(TSWasmEngine *engine, TSWasmError *wasm_error) {
  TSWasmStore *self = ts_calloc(1, sizeof(TSWasmStore));
  wasmtime_store_t *store = wasmtime_store_new(engine, self, NULL);
  wasmtime_context_t *context = wasmtime_store_context(store);
  wasmtime_error_t *error = NULL;
  wasm_trap_t *trap = NULL;
  wasm_message_t message = WASM_EMPTY_VEC;
  wasm_exporttype_vec_t export_types = WASM_EMPTY_VEC;
  wasm_importtype_vec_t import_types = WASM_EMPTY_VEC;
  wasmtime_extern_t *imports = NULL;
  wasmtime_module_t *stdlib_module = NULL;
  wasm_memorytype_t *memory_type = NULL;
  wasm_tabletype_t *table_type = NULL;

  // Define functions called by scanners via function pointers on the lexer.
  LexerInWasmMemory lexer = {
    .lookahead = 0,
    .result_symbol = 0,
  };
  FunctionDefinition lexer_definitions[] = {
    {
      (uint32_t *)&lexer.advance,
      callback__lexer_advance,
      wasm_functype_new_2_0(wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      (uint32_t *)&lexer.mark_end,
      callback__lexer_mark_end,
      wasm_functype_new_1_0(wasm_valtype_new_i32())
    },
    {
      (uint32_t *)&lexer.get_column,
      callback__lexer_get_column,
      wasm_functype_new_1_1(wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      (uint32_t *)&lexer.is_at_included_range_start,
      callback__lexer_is_at_included_range_start,
      wasm_functype_new_1_1(wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      (uint32_t *)&lexer.eof,
      callback__lexer_eof,
      wasm_functype_new_1_1(wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
  };

  // Define builtin functions that can be imported by scanners.
  BuiltinFunctionIndices builtin_fn_indices;
  FunctionDefinition builtin_definitions[] = {
    {
      &builtin_fn_indices.proc_exit,
      callback__abort,
      wasm_functype_new_1_0(wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.abort,
      callback__abort,
      wasm_functype_new_0_0()
    },
    {
      &builtin_fn_indices.assert_fail,
      callback__abort,
      wasm_functype_new_4_0(wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.notify_memory_growth,
      callback__noop,
      wasm_functype_new_1_0(wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.debug_message,
      callback__debug_message,
      wasm_functype_new_2_0(wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.at_exit,
      callback__noop,
      wasm_functype_new_3_1(wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.args_get,
      callback__noop,
      wasm_functype_new_2_1(wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
    {
      &builtin_fn_indices.args_sizes_get,
      callback__noop,
      wasm_functype_new_2_1(wasm_valtype_new_i32(), wasm_valtype_new_i32(), wasm_valtype_new_i32())
    },
  };

  // Create all of the wasm functions.
  unsigned builtin_definitions_len = array_len(builtin_definitions);
  unsigned lexer_definitions_len = array_len(lexer_definitions);
  for (unsigned i = 0; i < builtin_definitions_len; i++) {
    FunctionDefinition *definition = &builtin_definitions[i];
    wasmtime_func_t func;
    wasmtime_func_new_unchecked(context, definition->type, definition->callback, self, NULL, &func);
    *definition->storage_location = func.__private;
    wasm_functype_delete(definition->type);
  }
  for (unsigned i = 0; i < lexer_definitions_len; i++) {
    FunctionDefinition *definition = &lexer_definitions[i];
    wasmtime_func_t func;
    wasmtime_func_new_unchecked(context, definition->type, definition->callback, self, NULL, &func);
    *definition->storage_location = func.__private;
    wasm_functype_delete(definition->type);
  }

  // Compile the stdlib module.
  error = wasmtime_module_new(engine, STDLIB_WASM, STDLIB_WASM_LEN, &stdlib_module);
  if (error) {
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindCompile;
    format(
      &wasm_error->message,
      "failed to compile wasm stdlib: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }

  // Retrieve the stdlib module's imports.
  wasmtime_module_imports(stdlib_module, &import_types);

  // Find the initial number of memory pages needed by the stdlib.
  const wasm_memorytype_t *stdlib_memory_type = NULL;
  for (unsigned i = 0; i < import_types.size; i++) {
    wasm_importtype_t *import_type = import_types.data[i];
    const wasm_name_t *import_name = wasm_importtype_name(import_type);
    if (name_eq(import_name, "memory")) {
      const wasm_externtype_t *type = wasm_importtype_type(import_type);
      stdlib_memory_type = wasm_externtype_as_memorytype_const(type);
    }
  }
  if (!stdlib_memory_type) {
    wasm_error->kind = TSWasmErrorKindCompile;
    format(
      &wasm_error->message,
      "wasm stdlib is missing the 'memory' import"
    );
    goto error;
  }

  // Initialize store's memory
  uint64_t initial_memory_pages = wasmtime_memorytype_minimum(stdlib_memory_type);
  wasm_limits_t memory_limits = {.min = initial_memory_pages, .max = MAX_MEMORY_SIZE};
  memory_type = wasm_memorytype_new(&memory_limits);
  wasmtime_memory_t memory;
  error = wasmtime_memory_new(context, memory_type, &memory);
  if (error) {
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindAllocate;
    format(
      &wasm_error->message,
      "failed to allocate wasm memory: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }
  wasm_memorytype_delete(memory_type);
  memory_type = NULL;

  // Initialize store's function table
  wasm_limits_t table_limits = {.min = 1, .max = wasm_limits_max_default};
  table_type = wasm_tabletype_new(wasm_valtype_new(WASM_FUNCREF), &table_limits);
  wasmtime_val_t initializer = {.kind = WASMTIME_FUNCREF};
  wasmtime_table_t function_table;
  error = wasmtime_table_new(context, table_type, &initializer, &function_table);
  if (error) {
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindAllocate;
    format(
      &wasm_error->message,
      "failed to allocate wasm table: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }
  wasm_tabletype_delete(table_type);
  table_type = NULL;

  unsigned stdlib_symbols_len = array_len(STDLIB_SYMBOLS);

  // Define globals for the stack and heap start addresses.
  wasm_globaltype_t *const_i32_type = wasm_globaltype_new(wasm_valtype_new_i32(), WASM_CONST);
  wasm_globaltype_t *var_i32_type = wasm_globaltype_new(wasm_valtype_new_i32(), WASM_VAR);

  wasmtime_val_t stack_pointer_value = WASM_I32_VAL(0);
  wasmtime_global_t stack_pointer_global;
  error = wasmtime_global_new(context, var_i32_type, &stack_pointer_value, &stack_pointer_global);
  wasm_globaltype_delete(var_i32_type);
  ts_assert(!error);

  *self = (TSWasmStore) {
    .engine = wasmtime_engine_clone(engine),
    .store = store,
    .memory = memory,
    .function_table = function_table,
    .language_instances = array_new(),
    .stdlib_fn_indices = ts_calloc(stdlib_symbols_len, sizeof(uint32_t)),
    .builtin_fn_indices = builtin_fn_indices,
    .stack_pointer_global = stack_pointer_global,
    .current_memory_offset = 0,
    .current_function_table_offset = 0,
    .const_i32_type = const_i32_type,
  };

  // Set up the imports for the stdlib module.
  imports = ts_calloc(import_types.size, sizeof(wasmtime_extern_t));
  for (unsigned i = 0; i < import_types.size; i++) {
    wasm_importtype_t *type = import_types.data[i];
    const wasm_name_t *import_name = wasm_importtype_name(type);
    if (!ts_wasm_store__provide_builtin_import(self, import_name, &imports[i])) {
      wasm_error->kind = TSWasmErrorKindInstantiate;
      format(
        &wasm_error->message,
        "unexpected import in wasm stdlib: %.*s\n",
        (int)import_name->size, import_name->data
      );
      goto error;
    }
  }

  // Instantiate the stdlib module.
  wasmtime_instance_t instance;
  error = wasmtime_instance_new(context, stdlib_module, imports, import_types.size, &instance, &trap);
  ts_free(imports);
  imports = NULL;
  if (error) {
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindInstantiate;
    format(
      &wasm_error->message,
      "failed to instantiate wasm stdlib module: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }
  if (trap) {
    wasm_trap_message(trap, &message);
    wasm_error->kind = TSWasmErrorKindInstantiate;
    format(
      &wasm_error->message,
      "trapped when instantiating wasm stdlib module: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }
  wasm_importtype_vec_delete(&import_types);

  // Process the stdlib module's exports.
  for (unsigned i = 0; i < stdlib_symbols_len; i++) {
    self->stdlib_fn_indices[i] = UINT32_MAX;
  }
  wasmtime_module_exports(stdlib_module, &export_types);
  for (unsigned i = 0; i < export_types.size; i++) {
    wasm_exporttype_t *export_type = export_types.data[i];
    const wasm_name_t *name = wasm_exporttype_name(export_type);

    char *export_name;
    size_t name_len;
    wasmtime_extern_t export = {.kind = WASM_EXTERN_GLOBAL};
    bool exists = wasmtime_instance_export_nth(context, &instance, i, &export_name, &name_len, &export);
    ts_assert(exists);

    if (export.kind == WASMTIME_EXTERN_GLOBAL) {
      if (name_eq(name, "__stack_pointer")) {
        self->stack_pointer_global = export.of.global;
      }
    }

    if (export.kind == WASMTIME_EXTERN_FUNC) {
      if (ts_wasm_store__call_module_initializer(self, name, &export, &trap)) {
        if (trap) {
          wasm_trap_message(trap, &message);
          wasm_error->kind = TSWasmErrorKindInstantiate;
          format(
            &wasm_error->message,
            "trap when calling stdlib relocation function: %.*s\n",
            (int)message.size, message.data
          );
          goto error;
        }
        continue;
      }

      if (name_eq(name, "reset_heap")) {
        self->builtin_fn_indices.reset_heap = export.of.func.__private;
        continue;
      }

      for (unsigned j = 0; j < stdlib_symbols_len; j++) {
        if (name_eq(name, STDLIB_SYMBOLS[j])) {
          self->stdlib_fn_indices[j] = export.of.func.__private;
          break;
        }
      }
    }
  }

  if (self->builtin_fn_indices.reset_heap == UINT32_MAX) {
    wasm_error->kind = TSWasmErrorKindInstantiate;
    format(
      &wasm_error->message,
      "missing malloc reset function in wasm stdlib"
    );
    goto error;
  }

  for (unsigned i = 0; i < stdlib_symbols_len; i++) {
    if (self->stdlib_fn_indices[i] == UINT32_MAX) {
      wasm_error->kind = TSWasmErrorKindInstantiate;
      format(
        &wasm_error->message,
        "missing exported symbol in wasm stdlib: %s",
        STDLIB_SYMBOLS[i]
      );
      goto error;
    }
  }

  wasm_exporttype_vec_delete(&export_types);
  wasmtime_module_delete(stdlib_module);

  // Add all of the lexer callback functions to the function table. Store their function table
  // indices on the in-memory lexer.
  uint64_t table_index;
  error = wasmtime_table_grow(context, &function_table, lexer_definitions_len, &initializer, &table_index);
  if (error) {
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindAllocate;
    format(
      &wasm_error->message,
      "failed to grow wasm table to initial size: %.*s",
      (int)message.size, message.data
    );
    goto error;
  }
  for (unsigned i = 0; i < lexer_definitions_len; i++) {
    FunctionDefinition *definition = &lexer_definitions[i];
    wasmtime_func_t func = {function_table.store_id, *definition->storage_location};
    wasmtime_val_t func_val = {.kind = WASMTIME_FUNCREF, .of.funcref = func};
    error = wasmtime_table_set(context, &function_table, table_index, &func_val);
    ts_assert(!error);
    *(int32_t *)(definition->storage_location) = table_index;
    table_index++;
  }

  self->current_function_table_offset = table_index;
  self->lexer_address = initial_memory_pages * MEMORY_PAGE_SIZE;
  self->current_memory_offset = self->lexer_address + sizeof(LexerInWasmMemory);

  // Grow the memory enough to hold the builtin lexer and serialization buffer.
  uint32_t new_pages_needed = (self->current_memory_offset - self->lexer_address - 1) / MEMORY_PAGE_SIZE + 1;
  uint64_t prev_memory_size;
  wasmtime_memory_grow(context, &memory, new_pages_needed, &prev_memory_size);

  uint8_t *memory_data = wasmtime_memory_data(context, &memory);
  memcpy(&memory_data[self->lexer_address], &lexer, sizeof(lexer));
  return self;

error:
  ts_free(self);
  if (stdlib_module) wasmtime_module_delete(stdlib_module);
  if (store) wasmtime_store_delete(store);
  if (import_types.size) wasm_importtype_vec_delete(&import_types);
  if (memory_type) wasm_memorytype_delete(memory_type);
  if (table_type) wasm_tabletype_delete(table_type);
  if (trap) wasm_trap_delete(trap);
  if (error) wasmtime_error_delete(error);
  if (message.size) wasm_byte_vec_delete(&message);
  if (export_types.size) wasm_exporttype_vec_delete(&export_types);
  if (imports) ts_free(imports);
  return NULL;
}

void ts_wasm_store_delete(TSWasmStore *self) {
  if (!self) return;
  ts_free(self->stdlib_fn_indices);
  wasm_globaltype_delete(self->const_i32_type);
  wasmtime_store_delete(self->store);
  wasm_engine_delete(self->engine);
  for (unsigned i = 0; i < self->language_instances.size; i++) {
    LanguageWasmInstance *instance = array_get(&self->language_instances, i);
    language_id_delete(instance->language_id);
  }
  array_delete(&self->language_instances);
  ts_free(self);
}

size_t ts_wasm_store_language_count(const TSWasmStore *self) {
  size_t result = 0;
  for (unsigned i = 0; i < self->language_instances.size; i++) {
    const WasmLanguageId *id = array_get(&self->language_instances, i)->language_id;
    if (!id->is_language_deleted) {
      result++;
    }
  }
  return result;
}

static uint32_t ts_wasm_store__heap_address(TSWasmStore *self) {
  return self->current_memory_offset + TREE_SITTER_SERIALIZATION_BUFFER_SIZE;
}

static uint32_t ts_wasm_store__serialization_buffer_address(TSWasmStore *self) {
  return self->current_memory_offset;
}

static bool ts_wasm_store__instantiate(
  TSWasmStore *self,
  wasmtime_module_t *module,
  const char *language_name,
  const WasmDylinkInfo *dylink_info,
  wasmtime_instance_t *result,
  int32_t *language_address,
  char **error_message
) {
  wasmtime_error_t *error = NULL;
  wasm_trap_t *trap = NULL;
  wasm_message_t message = WASM_EMPTY_VEC;
  char *language_function_name = NULL;
  wasmtime_extern_t *imports = NULL;
  wasmtime_context_t *context = wasmtime_store_context(self->store);

  // Grow the function table to make room for the new functions.
  wasmtime_val_t initializer = {.kind = WASMTIME_FUNCREF};
  uint64_t prev_table_size;
  error = wasmtime_table_grow(context, &self->function_table, dylink_info->table_size, &initializer, &prev_table_size);
  if (error) {
    format(error_message, "invalid function table size %u", dylink_info->table_size);
    goto error;
  }

  // Grow the memory to make room for the new data.
  uint32_t needed_memory_size = ts_wasm_store__heap_address(self) + dylink_info->memory_size;
  uint32_t current_memory_size = wasmtime_memory_data_size(context, &self->memory);
  if (needed_memory_size > current_memory_size) {
    uint32_t pages_to_grow = (
      needed_memory_size - current_memory_size + MEMORY_PAGE_SIZE - 1) /
      MEMORY_PAGE_SIZE;
    uint64_t prev_memory_size;
    error = wasmtime_memory_grow(context, &self->memory, pages_to_grow, &prev_memory_size);
    if (error) {
      format(error_message, "invalid memory size %u", dylink_info->memory_size);
      goto error;
    }
  }

  // Construct the language function name as string.
  format(&language_function_name, "tree_sitter_%s", language_name);

  const uint64_t store_id = self->function_table.store_id;

  // Build the imports list for the module.
  wasm_importtype_vec_t import_types = WASM_EMPTY_VEC;
  wasmtime_module_imports(module, &import_types);
  imports = ts_calloc(import_types.size, sizeof(wasmtime_extern_t));

  for (unsigned i = 0; i < import_types.size; i++) {
    const wasm_importtype_t *import_type = import_types.data[i];
    const wasm_name_t *import_name = wasm_importtype_name(import_type);
    if (import_name->size == 0) {
      format(error_message, "empty import name");
      goto error;
    }

    if (ts_wasm_store__provide_builtin_import(self, import_name, &imports[i])) {
      continue;
    }

    bool defined_in_stdlib = false;
    for (unsigned j = 0; j < array_len(STDLIB_SYMBOLS); j++) {
      if (name_eq(import_name, STDLIB_SYMBOLS[j])) {
        uint16_t address = self->stdlib_fn_indices[j];
        imports[i] = (wasmtime_extern_t) {.kind = WASMTIME_EXTERN_FUNC, .of.func = {store_id, address}};
        defined_in_stdlib = true;
        break;
      }
    }

    if (!defined_in_stdlib) {
      format(
        error_message,
        "invalid import '%.*s'\n",
        (int)import_name->size, import_name->data
      );
      goto error;
    }
  }

  wasmtime_instance_t instance;
  error = wasmtime_instance_new(context, module, imports, import_types.size, &instance, &trap);
  wasm_importtype_vec_delete(&import_types);
  ts_free(imports);
  imports = NULL;
  if (error) {
    wasmtime_error_message(error, &message);
    format(
      error_message,
      "error instantiating wasm module: %.*s\n",
      (int)message.size, message.data
    );
    goto error;
  }
  if (trap) {
    wasm_trap_message(trap, &message);
    format(
      error_message,
      "trap when instantiating wasm module: %.*s\n",
      (int)message.size, message.data
    );
    goto error;
  }

  self->current_memory_offset += dylink_info->memory_size;
  self->current_function_table_offset += dylink_info->table_size;

  // Process the module's exports.
  bool found_language = false;
  wasmtime_extern_t language_extern;
  wasm_exporttype_vec_t export_types = WASM_EMPTY_VEC;
  wasmtime_module_exports(module, &export_types);
  for (unsigned i = 0; i < export_types.size; i++) {
    wasm_exporttype_t *export_type = export_types.data[i];
    const wasm_name_t *name = wasm_exporttype_name(export_type);

    size_t name_len;
    char *export_name;
    wasmtime_extern_t export = {.kind = WASM_EXTERN_GLOBAL};
    bool exists = wasmtime_instance_export_nth(context, &instance, i, &export_name, &name_len, &export);
    ts_assert(exists);

    // If the module exports an initialization or data-relocation function, call it.
    if (ts_wasm_store__call_module_initializer(self, name, &export, &trap)) {
      if (trap) {
        wasm_trap_message(trap, &message);
        format(
          error_message,
          "trap when calling data relocation function: %.*s\n",
          (int)message.size, message.data
        );
        goto error;
      }
    }

    // Find the main language function for the module.
    else if (name_eq(name, language_function_name)) {
      language_extern = export;
      found_language = true;
    }
  }
  wasm_exporttype_vec_delete(&export_types);

  if (!found_language) {
    format(
      error_message,
      "module did not contain language function: %s",
      language_function_name
    );
    goto error;
  }

  // Invoke the language function to get the static address of the language object.
  wasmtime_func_t language_func = language_extern.of.func;
  wasmtime_val_t language_address_val;
  error = wasmtime_func_call(context, &language_func, NULL, 0, &language_address_val, 1, &trap);
  ts_assert(!error);
  if (trap) {
    wasm_trap_message(trap, &message);
    format(
      error_message,
      "trapped when calling language function: %s: %.*s\n",
      language_function_name, (int)message.size, message.data
    );
    goto error;
  }

  if (language_address_val.kind != WASMTIME_I32) {
    format(
      error_message,
      "language function did not return an integer: %s\n",
      language_function_name
    );
    goto error;
  }

  ts_free(language_function_name);
  *result = instance;
  *language_address = language_address_val.of.i32;
  return true;

error:
  if (language_function_name) ts_free(language_function_name);
  if (message.size) wasm_byte_vec_delete(&message);
  if (error) wasmtime_error_delete(error);
  if (trap) wasm_trap_delete(trap);
  if (imports) ts_free(imports);
  return false;
}

static bool ts_wasm_store__sentinel_lex_fn(TSLexer *_lexer, TSStateId state) {
  return false;
}

const TSLanguage *ts_wasm_store_load_language(
  TSWasmStore *self,
  const char *language_name,
  const char *wasm,
  uint32_t wasm_len,
  TSWasmError *wasm_error
) {
  WasmDylinkInfo dylink_info;
  wasmtime_module_t *module = NULL;
  wasmtime_error_t *error = NULL;
  wasm_error->kind = TSWasmErrorKindNone;

  if (!wasm_dylink_info__parse((const unsigned char *)wasm, wasm_len, &dylink_info)) {
    wasm_error->kind = TSWasmErrorKindParse;
    format(&wasm_error->message, "failed to parse dylink section of wasm module");
    goto error;
  }

  // Compile the wasm code.
  error = wasmtime_module_new(self->engine, (const uint8_t *)wasm, wasm_len, &module);
  if (error) {
    wasm_message_t message;
    wasmtime_error_message(error, &message);
    wasm_error->kind = TSWasmErrorKindCompile;
    format(&wasm_error->message, "error compiling wasm module: %.*s", (int)message.size, message.data);
    wasm_byte_vec_delete(&message);
    goto error;
  }

  // Instantiate the module in this store.
  wasmtime_instance_t instance;
  int32_t language_address;
  if (!ts_wasm_store__instantiate(
    self,
    module,
    language_name,
    &dylink_info,
    &instance,
    &language_address,
    &wasm_error->message
  )) {
    wasm_error->kind = TSWasmErrorKindInstantiate;
    goto error;
  }

  // Copy all of the static data out of the language object in wasm memory,
  // constructing a native language object.
  LanguageInWasmMemory wasm_language;
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  const uint8_t *memory = wasmtime_memory_data(context, &self->memory);
  memcpy(&wasm_language, &memory[language_address], sizeof(LanguageInWasmMemory));

  bool has_supertypes =
    wasm_language.abi_version > LANGUAGE_VERSION_WITH_RESERVED_WORDS &&
    wasm_language.supertype_count > 0;

  int32_t addresses[] = {
    wasm_language.parse_table,
    wasm_language.small_parse_table,
    wasm_language.small_parse_table_map,
    wasm_language.parse_actions,
    wasm_language.symbol_names,
    wasm_language.field_names,
    wasm_language.field_map_slices,
    wasm_language.field_map_entries,
    wasm_language.symbol_metadata,
    wasm_language.public_symbol_map,
    wasm_language.alias_map,
    wasm_language.alias_sequences,
    wasm_language.lex_modes,
    wasm_language.lex_fn,
    wasm_language.keyword_lex_fn,
    wasm_language.primary_state_ids,
    wasm_language.name,
    wasm_language.reserved_words,
    has_supertypes ? wasm_language.supertype_symbols : 0,
    has_supertypes ? wasm_language.supertype_map_entries : 0,
    has_supertypes ? wasm_language.supertype_map_slices : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.states : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.symbol_map : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.create : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.destroy : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.scan : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.serialize : 0,
    wasm_language.external_token_count > 0 ? wasm_language.external_scanner.deserialize : 0,
    language_address,
    self->current_memory_offset,
  };
  uint32_t address_count = array_len(addresses);

  TSLanguage *language = ts_calloc(1, sizeof(TSLanguage));
  StringData symbol_name_buffer = array_new();
  StringData field_name_buffer = array_new();

  *language = (TSLanguage) {
    .abi_version = wasm_language.abi_version,
    .symbol_count = wasm_language.symbol_count,
    .alias_count = wasm_language.alias_count,
    .token_count = wasm_language.token_count,
    .external_token_count = wasm_language.external_token_count,
    .state_count = wasm_language.state_count,
    .large_state_count = wasm_language.large_state_count,
    .production_id_count = wasm_language.production_id_count,
    .field_count = wasm_language.field_count,
    .supertype_count = wasm_language.supertype_count,
    .max_alias_sequence_length = wasm_language.max_alias_sequence_length,
    .keyword_capture_token = wasm_language.keyword_capture_token,
    .metadata = wasm_language.metadata,
    .parse_table = copy(
      &memory[wasm_language.parse_table],
      wasm_language.large_state_count * wasm_language.symbol_count * sizeof(uint16_t)
    ),
    .parse_actions = copy_unsized_static_array(
      memory,
      wasm_language.parse_actions,
      addresses,
      address_count
    ),
    .symbol_names = copy_strings(
      memory,
      wasm_language.symbol_names,
      wasm_language.symbol_count + wasm_language.alias_count,
      &symbol_name_buffer
    ),
    .symbol_metadata = copy(
      &memory[wasm_language.symbol_metadata],
      (wasm_language.symbol_count + wasm_language.alias_count) * sizeof(TSSymbolMetadata)
    ),
    .public_symbol_map = copy(
      &memory[wasm_language.public_symbol_map],
      (wasm_language.symbol_count + wasm_language.alias_count) * sizeof(TSSymbol)
    ),
    .lex_modes = copy(
      &memory[wasm_language.lex_modes],
      wasm_language.state_count * sizeof(TSLexerMode)
    ),
  };

  if (language->field_count > 0 && language->production_id_count > 0) {
    language->field_map_slices = copy(
      &memory[wasm_language.field_map_slices],
      wasm_language.production_id_count * sizeof(TSMapSlice)
    );

    // Determine the number of field map entries by finding the greatest index
    // in any of the slices.
    uint32_t field_map_entry_count = 0;
    for (uint32_t i = 0; i < wasm_language.production_id_count; i++) {
      TSMapSlice slice = language->field_map_slices[i];
      uint32_t slice_end = slice.index + slice.length;
      if (slice_end > field_map_entry_count) {
        field_map_entry_count = slice_end;
      }
    }

    language->field_map_entries = copy(
      &memory[wasm_language.field_map_entries],
      field_map_entry_count * sizeof(TSFieldMapEntry)
    );
    language->field_names = copy_strings(
      memory,
      wasm_language.field_names,
      wasm_language.field_count + 1,
      &field_name_buffer
    );
  }

  if (has_supertypes) {
    language->supertype_symbols = copy(
      &memory[wasm_language.supertype_symbols],
      wasm_language.supertype_count * sizeof(TSSymbol)
    );

    // Determine the number of supertype map slices by finding the greatest
    // supertype ID.
    int largest_supertype = 0;
    for (unsigned i = 0; i < language->supertype_count; i++) {
      TSSymbol supertype = language->supertype_symbols[i];
      if (supertype > largest_supertype) {
        largest_supertype = supertype;
      }
    }

    language->supertype_map_slices = copy(
      &memory[wasm_language.supertype_map_slices],
      (largest_supertype + 1) * sizeof(TSMapSlice)
    );

    TSSymbol last_supertype = language->supertype_symbols[language->supertype_count - 1];
    TSMapSlice last_slice = language->supertype_map_slices[last_supertype];
    uint32_t supertype_map_entry_count = last_slice.index + last_slice.length;

    language->supertype_map_entries = copy(
      &memory[wasm_language.supertype_map_entries],
      supertype_map_entry_count * sizeof(char *)
    );
  }

  if (language->max_alias_sequence_length > 0 && language->production_id_count > 0) {
    // The alias map contains symbols, alias counts, and aliases, terminated by a null symbol.
    int32_t alias_map_size = 0;
    for (;;) {
      TSSymbol symbol;
      memcpy(&symbol, &memory[wasm_language.alias_map + alias_map_size], sizeof(symbol));
      alias_map_size += sizeof(TSSymbol);
      if (symbol == 0) break;
      uint16_t value_count;
      memcpy(&value_count, &memory[wasm_language.alias_map + alias_map_size], sizeof(value_count));
      alias_map_size += sizeof(uint16_t);
      alias_map_size += value_count * sizeof(TSSymbol);
    }
    language->alias_map = copy(
      &memory[wasm_language.alias_map],
      alias_map_size
    );
    language->alias_sequences = copy(
      &memory[wasm_language.alias_sequences],
      wasm_language.production_id_count * wasm_language.max_alias_sequence_length * sizeof(TSSymbol)
    );
  }

  if (language->state_count > language->large_state_count) {
    uint32_t small_state_count = wasm_language.state_count - wasm_language.large_state_count;
    language->small_parse_table_map = copy(
      &memory[wasm_language.small_parse_table_map],
      small_state_count * sizeof(uint32_t)
    );
    language->small_parse_table = copy_unsized_static_array(
      memory,
      wasm_language.small_parse_table,
      addresses,
      address_count
    );
  }

  if (language->abi_version >= LANGUAGE_VERSION_WITH_PRIMARY_STATES) {
    language->primary_state_ids = copy(
      &memory[wasm_language.primary_state_ids],
      wasm_language.state_count * sizeof(TSStateId)
    );
  }

  if (language->abi_version >= LANGUAGE_VERSION_WITH_RESERVED_WORDS) {
    language->name = copy_string(memory, wasm_language.name);
    language->reserved_words = copy(
        &memory[wasm_language.reserved_words],
        wasm_language.max_reserved_word_set_size * sizeof(TSSymbol)
    );
    language->max_reserved_word_set_size = wasm_language.max_reserved_word_set_size;
  }

  if (language->external_token_count > 0) {
    language->external_scanner.symbol_map = copy(
      &memory[wasm_language.external_scanner.symbol_map],
      wasm_language.external_token_count * sizeof(TSSymbol)
    );
    language->external_scanner.states = (void *)(uintptr_t)wasm_language.external_scanner.states;
  }

  unsigned name_len = strlen(language_name);
  char *name = ts_malloc(name_len + 1);
  memcpy(name, language_name, name_len);
  name[name_len] = '\0';

  LanguageWasmModule *language_module = ts_malloc(sizeof(LanguageWasmModule));
  *language_module = (LanguageWasmModule) {
    .language_id = language_id_new(),
    .module = module,
    .name = name,
    .symbol_name_buffer = symbol_name_buffer.contents,
    .field_name_buffer = field_name_buffer.contents,
    .dylink_info = dylink_info,
    .ref_count = 1,
  };

  // The lex functions are not used for wasm languages. Use those two fields
  // to mark this language as WASM-based and to store the language's
  // WASM-specific data.
  language->lex_fn = ts_wasm_store__sentinel_lex_fn;
  language->keyword_lex_fn = (bool (*)(TSLexer *, TSStateId))language_module;

  // Clear out any instances of languages that have been deleted.
  for (unsigned i = 0; i < self->language_instances.size; i++) {
    WasmLanguageId *id = array_get(&self->language_instances, i)->language_id;
    if (id->is_language_deleted) {
      language_id_delete(id);
      array_erase(&self->language_instances, i);
      i--;
    }
  }

  // Store this store's instance of this language module.
  array_push(&self->language_instances, ((LanguageWasmInstance) {
    .language_id = language_id_clone(language_module->language_id),
    .instance = instance,
    .external_states_address = wasm_language.external_scanner.states,
    .lex_main_fn_index = wasm_language.lex_fn,
    .lex_keyword_fn_index = wasm_language.keyword_lex_fn,
    .scanner_create_fn_index = wasm_language.external_scanner.create,
    .scanner_destroy_fn_index = wasm_language.external_scanner.destroy,
    .scanner_serialize_fn_index = wasm_language.external_scanner.serialize,
    .scanner_deserialize_fn_index = wasm_language.external_scanner.deserialize,
    .scanner_scan_fn_index = wasm_language.external_scanner.scan,
  }));

  return language;

error:
  if (module) wasmtime_module_delete(module);
  return NULL;
}

bool ts_wasm_store_add_language(
  TSWasmStore *self,
  const TSLanguage *language,
  uint32_t *index
) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  const LanguageWasmModule *language_module = (void *)language->keyword_lex_fn;

  // Search for this store's instance of the language module. Also clear out any
  // instances of languages that have been deleted.
  bool exists = false;
  for (unsigned i = 0; i < self->language_instances.size; i++) {
    WasmLanguageId *id = array_get(&self->language_instances, i)->language_id;
    if (id->is_language_deleted) {
      language_id_delete(id);
      array_erase(&self->language_instances, i);
      i--;
    } else if (id == language_module->language_id) {
      exists = true;
      *index = i;
    }
  }

  // If the language module has not been instantiated in this store, then add
  // it to this store.
  if (!exists) {
    *index = self->language_instances.size;
    char *message;
    wasmtime_instance_t instance;
    int32_t language_address;
    if (!ts_wasm_store__instantiate(
      self,
      language_module->module,
      language_module->name,
      &language_module->dylink_info,
      &instance,
      &language_address,
      &message
    )) {
      ts_free(message);
      return false;
    }

    LanguageInWasmMemory wasm_language;
    const uint8_t *memory = wasmtime_memory_data(context, &self->memory);
    memcpy(&wasm_language, &memory[language_address], sizeof(LanguageInWasmMemory));
    array_push(&self->language_instances, ((LanguageWasmInstance) {
      .language_id = language_id_clone(language_module->language_id),
      .instance = instance,
      .external_states_address = wasm_language.external_scanner.states,
      .lex_main_fn_index = wasm_language.lex_fn,
      .lex_keyword_fn_index = wasm_language.keyword_lex_fn,
      .scanner_create_fn_index = wasm_language.external_scanner.create,
      .scanner_destroy_fn_index = wasm_language.external_scanner.destroy,
      .scanner_serialize_fn_index = wasm_language.external_scanner.serialize,
      .scanner_deserialize_fn_index = wasm_language.external_scanner.deserialize,
      .scanner_scan_fn_index = wasm_language.external_scanner.scan,
    }));
  }

  return true;
}

void ts_wasm_store_reset_heap(TSWasmStore *self) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  wasmtime_func_t func = {
    self->function_table.store_id,
    self->builtin_fn_indices.reset_heap
  };
  wasm_trap_t *trap = NULL;
  wasmtime_val_t args[1] = {
    {.of.i32 = ts_wasm_store__heap_address(self), .kind = WASMTIME_I32},
  };

  wasmtime_error_t *error = wasmtime_func_call(context, &func, args, 1, NULL, 0, &trap);
  ts_assert(!error);
  ts_assert(!trap);
}

bool ts_wasm_store_start(TSWasmStore *self, TSLexer *lexer, const TSLanguage *language) {
  uint32_t instance_index;
  if (!ts_wasm_store_add_language(self, language, &instance_index)) return false;
  self->current_lexer = lexer;
  self->current_instance = array_get(&self->language_instances, instance_index);
  self->has_error = false;
  ts_wasm_store_reset_heap(self);
  return true;
}

void ts_wasm_store_reset(TSWasmStore *self) {
  self->current_lexer = NULL;
  self->current_instance = NULL;
  self->has_error = false;
  ts_wasm_store_reset_heap(self);
}

static void ts_wasm_store__call(
  TSWasmStore *self,
  int32_t function_index,
  wasmtime_val_raw_t *args_and_results,
  size_t args_and_results_len
) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  wasmtime_val_t value;
  bool succeeded = wasmtime_table_get(context, &self->function_table, function_index, &value);
  ts_assert(succeeded);
  ts_assert(value.kind == WASMTIME_FUNCREF);
  wasmtime_func_t func = value.of.funcref;

  wasm_trap_t *trap = NULL;
  wasmtime_error_t *error = wasmtime_func_call_unchecked(context, &func, args_and_results, args_and_results_len, &trap);
  if (error) {
    // wasm_message_t message;
    // wasmtime_error_message(error, &message);
    // fprintf(
    //   stderr,
    //   "error in wasm module: %.*s\n",
    //   (int)message.size, message.data
    // );
    wasmtime_error_delete(error);
    self->has_error = true;
  } else if (trap) {
    // wasm_message_t message;
    // wasm_trap_message(trap, &message);
    // fprintf(
    //   stderr,
    //   "trap in wasm module: %.*s\n",
    //   (int)message.size, message.data
    // );
    wasm_trap_delete(trap);
    self->has_error = true;
  }
}

// The data fields of TSLexer, without the function pointers.
//
// This portion of the struct needs to be copied in and out
// of wasm memory before and after calling a scan function.
typedef struct {
  int32_t lookahead;
  TSSymbol result_symbol;
} TSLexerDataPrefix;

static bool ts_wasm_store__call_lex_function(TSWasmStore *self, unsigned function_index, TSStateId state) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  uint8_t *memory_data = wasmtime_memory_data(context, &self->memory);
  memcpy(
    &memory_data[self->lexer_address],
    self->current_lexer,
    sizeof(TSLexerDataPrefix)
  );

  wasmtime_val_raw_t args[2] = {
    {.i32 = self->lexer_address},
    {.i32 = state},
  };
  ts_wasm_store__call(self, function_index, args, 2);
  if (self->has_error) return false;
  bool result = args[0].i32;

  memcpy(
    self->current_lexer,
    &memory_data[self->lexer_address],
    sizeof(TSLexerDataPrefix)
  );
  return result;
}

bool ts_wasm_store_call_lex_main(TSWasmStore *self, TSStateId state) {
  return ts_wasm_store__call_lex_function(
    self,
    self->current_instance->lex_main_fn_index,
    state
  );
}

bool ts_wasm_store_call_lex_keyword(TSWasmStore *self, TSStateId state) {
  return ts_wasm_store__call_lex_function(
    self,
    self->current_instance->lex_keyword_fn_index,
    state
  );
}

uint32_t ts_wasm_store_call_scanner_create(TSWasmStore *self) {
  wasmtime_val_raw_t args[1] = {{.i32 = 0}};
  ts_wasm_store__call(self, self->current_instance->scanner_create_fn_index, args, 1);
  if (self->has_error) return 0;
  return args[0].i32;
}

void ts_wasm_store_call_scanner_destroy(TSWasmStore *self, uint32_t scanner_address) {
  if (self->current_instance) {
    wasmtime_val_raw_t args[1] = {{.i32 = scanner_address}};
    ts_wasm_store__call(self, self->current_instance->scanner_destroy_fn_index, args, 1);
  }
}

bool ts_wasm_store_call_scanner_scan(
  TSWasmStore *self,
  uint32_t scanner_address,
  uint32_t valid_tokens_ix
) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  uint8_t *memory_data = wasmtime_memory_data(context, &self->memory);

  memcpy(
    &memory_data[self->lexer_address],
    self->current_lexer,
    sizeof(TSLexerDataPrefix)
  );

  uint32_t valid_tokens_address =
    self->current_instance->external_states_address +
    (valid_tokens_ix * sizeof(bool));
  wasmtime_val_raw_t args[3] = {
    {.i32 = scanner_address},
    {.i32 = self->lexer_address},
    {.i32 = valid_tokens_address}
  };
  ts_wasm_store__call(self, self->current_instance->scanner_scan_fn_index, args, 3);
  if (self->has_error) return false;

  memcpy(
    self->current_lexer,
    &memory_data[self->lexer_address],
    sizeof(TSLexerDataPrefix)
  );
  return args[0].i32;
}

uint32_t ts_wasm_store_call_scanner_serialize(
  TSWasmStore *self,
  uint32_t scanner_address,
  char *buffer
) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  uint8_t *memory_data = wasmtime_memory_data(context, &self->memory);
  uint32_t serialization_buffer_address = ts_wasm_store__serialization_buffer_address(self);

  wasmtime_val_raw_t args[2] = {
    {.i32 = scanner_address},
    {.i32 = serialization_buffer_address},
  };
  ts_wasm_store__call(self, self->current_instance->scanner_serialize_fn_index, args, 2);
  if (self->has_error) return 0;

  uint32_t length = args[0].i32;
  if (length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
      self->has_error = true;
      return 0;
  }

  if (length > 0) {
    memcpy(
      ((Lexer *)self->current_lexer)->debug_buffer,
      &memory_data[serialization_buffer_address],
      length
    );
  }
  return length;
}

void ts_wasm_store_call_scanner_deserialize(
  TSWasmStore *self,
  uint32_t scanner_address,
  const char *buffer,
  unsigned length
) {
  wasmtime_context_t *context = wasmtime_store_context(self->store);
  uint8_t *memory_data = wasmtime_memory_data(context, &self->memory);
  uint32_t serialization_buffer_address = ts_wasm_store__serialization_buffer_address(self);

  if (length > 0) {
    memcpy(
      &memory_data[serialization_buffer_address],
      buffer,
      length
    );
  }

  wasmtime_val_raw_t args[3] = {
    {.i32 = scanner_address},
    {.i32 = serialization_buffer_address},
    {.i32 = length},
  };
  ts_wasm_store__call(self, self->current_instance->scanner_deserialize_fn_index, args, 3);
}

bool ts_wasm_store_has_error(const TSWasmStore *self) {
  return self->has_error;
}

bool ts_language_is_wasm(const TSLanguage *self) {
  return self->lex_fn == ts_wasm_store__sentinel_lex_fn;
}

static inline LanguageWasmModule *ts_language__wasm_module(const TSLanguage *self) {
  return (LanguageWasmModule *)self->keyword_lex_fn;
}

void ts_wasm_language_retain(const TSLanguage *self) {
  LanguageWasmModule *module = ts_language__wasm_module(self);
  ts_assert(module->ref_count > 0);
  atomic_inc(&module->ref_count);
}

void ts_wasm_language_release(const TSLanguage *self) {
  LanguageWasmModule *module = ts_language__wasm_module(self);
  ts_assert(module->ref_count > 0);
  if (atomic_dec(&module->ref_count) == 0) {
    // Update the language id to reflect that the language is deleted. This allows any wasm stores
    // that hold wasm instances for this language to delete those instances.
    atomic_inc(&module->language_id->is_language_deleted);
    language_id_delete(module->language_id);

    ts_free((void *)module->field_name_buffer);
    ts_free((void *)module->symbol_name_buffer);
    ts_free((void *)module->name);
    wasmtime_module_delete(module->module);
    ts_free(module);

    ts_free((void *)self->alias_map);
    ts_free((void *)self->alias_sequences);
    ts_free((void *)self->external_scanner.symbol_map);
    ts_free((void *)self->field_map_entries);
    ts_free((void *)self->field_map_slices);
    ts_free((void *)self->supertype_symbols);
    ts_free((void *)self->supertype_map_entries);
    ts_free((void *)self->supertype_map_slices);
    ts_free((void *)self->field_names);
    ts_free((void *)self->lex_modes);
    ts_free((void *)self->name);
    ts_free((void *)self->reserved_words);
    ts_free((void *)self->parse_actions);
    ts_free((void *)self->parse_table);
    ts_free((void *)self->primary_state_ids);
    ts_free((void *)self->public_symbol_map);
    ts_free((void *)self->small_parse_table);
    ts_free((void *)self->small_parse_table_map);
    ts_free((void *)self->symbol_metadata);
    ts_free((void *)self->symbol_names);
    ts_free((void *)self);
  }
}

#ifdef _MSC_VER
#pragma warning(pop)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic pop
#endif

#else

// If the WASM feature is not enabled, define dummy versions of all of the
// wasm-related functions.

void ts_wasm_store_delete(TSWasmStore *self) {
  (void)self;
}

bool ts_wasm_store_start(
  TSWasmStore *self,
  TSLexer *lexer,
  const TSLanguage *language
) {
  (void)self;
  (void)lexer;
  (void)language;
  return false;
}

void ts_wasm_store_reset(TSWasmStore *self) {
  (void)self;
}

bool ts_wasm_store_call_lex_main(TSWasmStore *self, TSStateId state) {
  (void)self;
  (void)state;
  return false;
}

bool ts_wasm_store_call_lex_keyword(TSWasmStore *self, TSStateId state) {
  (void)self;
  (void)state;
  return false;
}

uint32_t ts_wasm_store_call_scanner_create(TSWasmStore *self) {
  (void)self;
  return 0;
}

void ts_wasm_store_call_scanner_destroy(
  TSWasmStore *self,
  uint32_t scanner_address
) {
  (void)self;
  (void)scanner_address;
}

bool ts_wasm_store_call_scanner_scan(
  TSWasmStore *self,
  uint32_t scanner_address,
  uint32_t valid_tokens_ix
) {
  (void)self;
  (void)scanner_address;
  (void)valid_tokens_ix;
  return false;
}

uint32_t ts_wasm_store_call_scanner_serialize(
  TSWasmStore *self,
  uint32_t scanner_address,
  char *buffer
) {
  (void)self;
  (void)scanner_address;
  (void)buffer;
  return 0;
}

void ts_wasm_store_call_scanner_deserialize(
  TSWasmStore *self,
  uint32_t scanner_address,
  const char *buffer,
  unsigned length
) {
  (void)self;
  (void)scanner_address;
  (void)buffer;
  (void)length;
}

bool ts_wasm_store_has_error(const TSWasmStore *self) {
  (void)self;
  return false;
}

bool ts_language_is_wasm(const TSLanguage *self) {
  (void)self;
  return false;
}

void ts_wasm_language_retain(const TSLanguage *self) {
  (void)self;
}

void ts_wasm_language_release(const TSLanguage *self) {
  (void)self;
}

#endif
