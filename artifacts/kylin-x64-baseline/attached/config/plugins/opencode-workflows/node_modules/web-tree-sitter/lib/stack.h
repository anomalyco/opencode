#ifndef TREE_SITTER_PARSE_STACK_H_
#define TREE_SITTER_PARSE_STACK_H_

#ifdef __cplusplus
extern "C" {
#endif

#include "./array.h"
#include "./subtree.h"
#include <stdio.h>

typedef struct Stack Stack;

typedef unsigned StackVersion;
#define STACK_VERSION_NONE ((StackVersion)-1)

typedef struct {
  SubtreeArray subtrees;
  StackVersion version;
} StackSlice;
typedef Array(StackSlice) StackSliceArray;

typedef struct {
  Length position;
  unsigned depth;
  TSStateId state;
} StackSummaryEntry;
typedef Array(StackSummaryEntry) StackSummary;

// Create a stack.
Stack *ts_stack_new(SubtreePool *subtree_pool);

// Release the memory reserved for a given stack.
void ts_stack_delete(Stack *self);

// Get the stack's current number of versions.
uint32_t ts_stack_version_count(const Stack *self);

// Get the stack's current number of halted versions.
uint32_t ts_stack_halted_version_count(Stack *self);

// Get the state at the top of the given version of the stack. If the stack is
// empty, this returns the initial state, 0.
TSStateId ts_stack_state(const Stack *self, StackVersion version);

// Get the last external token associated with a given version of the stack.
Subtree ts_stack_last_external_token(const Stack *self, StackVersion version);

// Set the last external token associated with a given version of the stack.
void ts_stack_set_last_external_token(Stack *self, StackVersion version, Subtree token);

// Get the position of the given version of the stack within the document.
Length ts_stack_position(const Stack *, StackVersion);

// Push a tree and state onto the given version of the stack.
//
// This transfers ownership of the tree to the Stack. Callers that
// need to retain ownership of the tree for their own purposes should
// first retain the tree.
void ts_stack_push(Stack *self, StackVersion version, Subtree subtree, bool pending, TSStateId state);

// Pop the given number of entries from the given version of the stack. This
// operation can increase the number of stack versions by revealing multiple
// versions which had previously been merged. It returns an array that
// specifies the index of each revealed version and the trees that were
// removed from that version.
StackSliceArray ts_stack_pop_count(Stack *self, StackVersion version, uint32_t count);

// Remove an error at the top of the given version of the stack.
SubtreeArray ts_stack_pop_error(Stack *self, StackVersion version);

// Remove any pending trees from the top of the given version of the stack.
StackSliceArray ts_stack_pop_pending(Stack *self, StackVersion version);

// Remove all trees from the given version of the stack.
StackSliceArray ts_stack_pop_all(Stack *self, StackVersion version);

// Get the maximum number of tree nodes reachable from this version of the stack
// since the last error was detected.
unsigned ts_stack_node_count_since_error(const Stack *self, StackVersion version);

int ts_stack_dynamic_precedence(Stack *self, StackVersion version);

bool ts_stack_has_advanced_since_error(const Stack *self, StackVersion version);

// Compute a summary of all the parse states near the top of the given
// version of the stack and store the summary for later retrieval.
void ts_stack_record_summary(Stack *self, StackVersion version, unsigned max_depth);

// Retrieve a summary of all the parse states near the top of the
// given version of the stack.
StackSummary *ts_stack_get_summary(Stack *self, StackVersion version);

// Get the total cost of all errors on the given version of the stack.
unsigned ts_stack_error_cost(const Stack *self, StackVersion version);

// Merge the given two stack versions if possible, returning true
// if they were successfully merged and false otherwise.
bool ts_stack_merge(Stack *self, StackVersion version1, StackVersion version2);

// Determine whether the given two stack versions can be merged.
bool ts_stack_can_merge(Stack *self, StackVersion version1, StackVersion version2);

Subtree ts_stack_resume(Stack *self, StackVersion version);

void ts_stack_pause(Stack *self, StackVersion version, Subtree lookahead);

void ts_stack_halt(Stack *self, StackVersion version);

bool ts_stack_is_active(const Stack *self, StackVersion version);

bool ts_stack_is_paused(const Stack *self, StackVersion version);

bool ts_stack_is_halted(const Stack *self, StackVersion version);

void ts_stack_renumber_version(Stack *self, StackVersion v1, StackVersion v2);

void ts_stack_swap_versions(Stack *, StackVersion v1, StackVersion v2);

StackVersion ts_stack_copy_version(Stack *self, StackVersion version);

// Remove the given version from the stack.
void ts_stack_remove_version(Stack *self, StackVersion version);

void ts_stack_clear(Stack *self);

bool ts_stack_print_dot_graph(Stack *self, const TSLanguage *language, FILE *f);

#ifdef __cplusplus
}
#endif

#endif  // TREE_SITTER_PARSE_STACK_H_
