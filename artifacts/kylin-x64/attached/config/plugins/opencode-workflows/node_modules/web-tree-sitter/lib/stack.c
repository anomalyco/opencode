#include "./alloc.h"
#include "./language.h"
#include "./subtree.h"
#include "./array.h"
#include "./stack.h"
#include "./length.h"
#include <assert.h>
#include <inttypes.h>
#include <stdio.h>

#define MAX_LINK_COUNT 8
#define MAX_NODE_POOL_SIZE 50
#define MAX_ITERATOR_COUNT 64

#if defined _WIN32 && !defined __GNUC__
#define forceinline __forceinline
#else
#define forceinline static inline __attribute__((always_inline))
#endif

typedef struct StackNode StackNode;

typedef struct {
  StackNode *node;
  Subtree subtree;
  bool is_pending;
} StackLink;

struct StackNode {
  TSStateId state;
  Length position;
  StackLink links[MAX_LINK_COUNT];
  short unsigned int link_count;
  uint32_t ref_count;
  unsigned error_cost;
  unsigned node_count;
  int dynamic_precedence;
};

typedef struct {
  StackNode *node;
  SubtreeArray subtrees;
  uint32_t subtree_count;
  bool is_pending;
} StackIterator;

typedef Array(StackNode *) StackNodeArray;

typedef enum {
  StackStatusActive,
  StackStatusPaused,
  StackStatusHalted,
} StackStatus;

typedef struct {
  StackNode *node;
  StackSummary *summary;
  unsigned node_count_at_last_error;
  Subtree last_external_token;
  Subtree lookahead_when_paused;
  StackStatus status;
} StackHead;

struct Stack {
  Array(StackHead) heads;
  StackSliceArray slices;
  Array(StackIterator) iterators;
  StackNodeArray node_pool;
  StackNode *base_node;
  SubtreePool *subtree_pool;
};

typedef unsigned StackAction;
enum {
  StackActionNone,
  StackActionStop = 1,
  StackActionPop = 2,
};

typedef StackAction (*StackCallback)(void *, const StackIterator *);

static void stack_node_retain(StackNode *self) {
  if (!self)
    return;
  ts_assert(self->ref_count > 0);
  self->ref_count++;
  ts_assert(self->ref_count != 0);
}

static void stack_node_release(
  StackNode *self,
  StackNodeArray *pool,
  SubtreePool *subtree_pool
) {
recur:
  ts_assert(self->ref_count != 0);
  self->ref_count--;
  if (self->ref_count > 0) return;

  StackNode *first_predecessor = NULL;
  if (self->link_count > 0) {
    for (unsigned i = self->link_count - 1; i > 0; i--) {
      StackLink link = self->links[i];
      if (link.subtree.ptr) ts_subtree_release(subtree_pool, link.subtree);
      stack_node_release(link.node, pool, subtree_pool);
    }
    StackLink link = self->links[0];
    if (link.subtree.ptr) ts_subtree_release(subtree_pool, link.subtree);
    first_predecessor = self->links[0].node;
  }

  if (pool->size < MAX_NODE_POOL_SIZE) {
    array_push(pool, self);
  } else {
    ts_free(self);
  }

  if (first_predecessor) {
    self = first_predecessor;
    goto recur;
  }
}

/// Get the number of nodes in the subtree, for the purpose of measuring
/// how much progress has been made by a given version of the stack.
static uint32_t stack__subtree_node_count(Subtree subtree) {
  uint32_t count = ts_subtree_visible_descendant_count(subtree);
  if (ts_subtree_visible(subtree)) count++;

  // Count intermediate error nodes even though they are not visible,
  // because a stack version's node count is used to check whether it
  // has made any progress since the last time it encountered an error.
  if (ts_subtree_symbol(subtree) == ts_builtin_sym_error_repeat) count++;

  return count;
}

static StackNode *stack_node_new(
  StackNode *previous_node,
  Subtree subtree,
  bool is_pending,
  TSStateId state,
  StackNodeArray *pool
) {
  StackNode *node = pool->size > 0
    ? array_pop(pool)
    : ts_malloc(sizeof(StackNode));
  *node = (StackNode) {
    .ref_count = 1,
    .link_count = 0,
    .state = state
  };

  if (previous_node) {
    node->link_count = 1;
    node->links[0] = (StackLink) {
      .node = previous_node,
      .subtree = subtree,
      .is_pending = is_pending,
    };

    node->position = previous_node->position;
    node->error_cost = previous_node->error_cost;
    node->dynamic_precedence = previous_node->dynamic_precedence;
    node->node_count = previous_node->node_count;

    if (subtree.ptr) {
      node->error_cost += ts_subtree_error_cost(subtree);
      node->position = length_add(node->position, ts_subtree_total_size(subtree));
      node->node_count += stack__subtree_node_count(subtree);
      node->dynamic_precedence += ts_subtree_dynamic_precedence(subtree);
    }
  } else {
    node->position = length_zero();
    node->error_cost = 0;
  }

  return node;
}

static bool stack__subtree_is_equivalent(Subtree left, Subtree right) {
  if (left.ptr == right.ptr) return true;
  if (!left.ptr || !right.ptr) return false;

  // Symbols must match
  if (ts_subtree_symbol(left) != ts_subtree_symbol(right)) return false;

  // If both have errors, don't bother keeping both.
  if (ts_subtree_error_cost(left) > 0 && ts_subtree_error_cost(right) > 0) return true;

  return (
    ts_subtree_padding(left).bytes == ts_subtree_padding(right).bytes &&
    ts_subtree_size(left).bytes == ts_subtree_size(right).bytes &&
    ts_subtree_child_count(left) == ts_subtree_child_count(right) &&
    ts_subtree_extra(left) == ts_subtree_extra(right) &&
    ts_subtree_external_scanner_state_eq(left, right)
  );
}

static void stack_node_add_link(
  StackNode *self,
  StackLink link,
  SubtreePool *subtree_pool
) {
  if (link.node == self) return;

  for (int i = 0; i < self->link_count; i++) {
    StackLink *existing_link = &self->links[i];
    if (stack__subtree_is_equivalent(existing_link->subtree, link.subtree)) {
      // In general, we preserve ambiguities until they are removed from the stack
      // during a pop operation where multiple paths lead to the same node. But in
      // the special case where two links directly connect the same pair of nodes,
      // we can safely remove the ambiguity ahead of time without changing behavior.
      if (existing_link->node == link.node) {
        if (
          ts_subtree_dynamic_precedence(link.subtree) >
          ts_subtree_dynamic_precedence(existing_link->subtree)
        ) {
          ts_subtree_retain(link.subtree);
          ts_subtree_release(subtree_pool, existing_link->subtree);
          existing_link->subtree = link.subtree;
          self->dynamic_precedence =
            link.node->dynamic_precedence + ts_subtree_dynamic_precedence(link.subtree);
        }
        return;
      }

      // If the previous nodes are mergeable, merge them recursively.
      if (
        existing_link->node->state == link.node->state &&
        existing_link->node->position.bytes == link.node->position.bytes &&
        existing_link->node->error_cost == link.node->error_cost
      ) {
        for (int j = 0; j < link.node->link_count; j++) {
          stack_node_add_link(existing_link->node, link.node->links[j], subtree_pool);
        }
        int32_t dynamic_precedence = link.node->dynamic_precedence;
        if (link.subtree.ptr) {
          dynamic_precedence += ts_subtree_dynamic_precedence(link.subtree);
        }
        if (dynamic_precedence > self->dynamic_precedence) {
          self->dynamic_precedence = dynamic_precedence;
        }
        return;
      }
    }
  }

  if (self->link_count == MAX_LINK_COUNT) return;

  stack_node_retain(link.node);
  unsigned node_count = link.node->node_count;
  int dynamic_precedence = link.node->dynamic_precedence;
  self->links[self->link_count++] = link;

  if (link.subtree.ptr) {
    ts_subtree_retain(link.subtree);
    node_count += stack__subtree_node_count(link.subtree);
    dynamic_precedence += ts_subtree_dynamic_precedence(link.subtree);
  }

  if (node_count > self->node_count) self->node_count = node_count;
  if (dynamic_precedence > self->dynamic_precedence) self->dynamic_precedence = dynamic_precedence;
}

static void stack_head_delete(
  StackHead *self,
  StackNodeArray *pool,
  SubtreePool *subtree_pool
) {
  if (self->node) {
    if (self->last_external_token.ptr) {
      ts_subtree_release(subtree_pool, self->last_external_token);
    }
    if (self->lookahead_when_paused.ptr) {
      ts_subtree_release(subtree_pool, self->lookahead_when_paused);
    }
    if (self->summary) {
      array_delete(self->summary);
      ts_free(self->summary);
    }
    stack_node_release(self->node, pool, subtree_pool);
  }
}

static StackVersion ts_stack__add_version(
  Stack *self,
  StackVersion original_version,
  StackNode *node
) {
  StackHead head = {
    .node = node,
    .node_count_at_last_error = array_get(&self->heads, original_version)->node_count_at_last_error,
    .last_external_token = array_get(&self->heads, original_version)->last_external_token,
    .status = StackStatusActive,
    .lookahead_when_paused = NULL_SUBTREE,
  };
  array_push(&self->heads, head);
  stack_node_retain(node);
  if (head.last_external_token.ptr) ts_subtree_retain(head.last_external_token);
  return (StackVersion)(self->heads.size - 1);
}

static void ts_stack__add_slice(
  Stack *self,
  StackVersion original_version,
  StackNode *node,
  SubtreeArray *subtrees
) {
  for (uint32_t i = self->slices.size - 1; i + 1 > 0; i--) {
    StackVersion version = array_get(&self->slices, i)->version;
    if (array_get(&self->heads, version)->node == node) {
      StackSlice slice = {*subtrees, version};
      array_insert(&self->slices, i + 1, slice);
      return;
    }
  }

  StackVersion version = ts_stack__add_version(self, original_version, node);
  StackSlice slice = { *subtrees, version };
  array_push(&self->slices, slice);
}

static StackSliceArray stack__iter(
  Stack *self,
  StackVersion version,
  StackCallback callback,
  void *payload,
  int goal_subtree_count
) {
  array_clear(&self->slices);
  array_clear(&self->iterators);

  StackHead *head = array_get(&self->heads, version);
  StackIterator new_iterator = {
    .node = head->node,
    .subtrees = array_new(),
    .subtree_count = 0,
    .is_pending = true,
  };

  bool include_subtrees = false;
  if (goal_subtree_count >= 0) {
    include_subtrees = true;
    array_reserve(&new_iterator.subtrees, (uint32_t)ts_subtree_alloc_size(goal_subtree_count) / sizeof(Subtree));
  }

  array_push(&self->iterators, new_iterator);

  while (self->iterators.size > 0) {
    for (uint32_t i = 0, size = self->iterators.size; i < size; i++) {
      StackIterator *iterator = array_get(&self->iterators, i);
      StackNode *node = iterator->node;

      StackAction action = callback(payload, iterator);
      bool should_pop = action & StackActionPop;
      bool should_stop = action & StackActionStop || node->link_count == 0;

      if (should_pop) {
        SubtreeArray subtrees = iterator->subtrees;
        if (!should_stop) {
          ts_subtree_array_copy(subtrees, &subtrees);
        }
        ts_subtree_array_reverse(&subtrees);
        ts_stack__add_slice(
          self,
          version,
          node,
          &subtrees
        );
      }

      if (should_stop) {
        if (!should_pop) {
          ts_subtree_array_delete(self->subtree_pool, &iterator->subtrees);
        }
        array_erase(&self->iterators, i);
        i--, size--;
        continue;
      }

      for (uint32_t j = 1; j <= node->link_count; j++) {
        StackIterator *next_iterator;
        StackLink link;
        if (j == node->link_count) {
          link = node->links[0];
          next_iterator = array_get(&self->iterators, i);
        } else {
          if (self->iterators.size >= MAX_ITERATOR_COUNT) continue;
          link = node->links[j];
          StackIterator current_iterator = *array_get(&self->iterators, i);
          array_push(&self->iterators, current_iterator);
          next_iterator = array_back(&self->iterators);
          ts_subtree_array_copy(next_iterator->subtrees, &next_iterator->subtrees);
        }

        next_iterator->node = link.node;
        if (link.subtree.ptr) {
          if (include_subtrees) {
            array_push(&next_iterator->subtrees, link.subtree);
            ts_subtree_retain(link.subtree);
          }

          if (!ts_subtree_extra(link.subtree)) {
            next_iterator->subtree_count++;
            if (!link.is_pending) {
              next_iterator->is_pending = false;
            }
          }
        } else {
          next_iterator->subtree_count++;
          next_iterator->is_pending = false;
        }
      }
    }
  }

  return self->slices;
}

Stack *ts_stack_new(SubtreePool *subtree_pool) {
  Stack *self = ts_calloc(1, sizeof(Stack));

  array_init(&self->heads);
  array_init(&self->slices);
  array_init(&self->iterators);
  array_init(&self->node_pool);
  array_reserve(&self->heads, 4);
  array_reserve(&self->slices, 4);
  array_reserve(&self->iterators, 4);
  array_reserve(&self->node_pool, MAX_NODE_POOL_SIZE);

  self->subtree_pool = subtree_pool;
  self->base_node = stack_node_new(NULL, NULL_SUBTREE, false, 1, &self->node_pool);
  ts_stack_clear(self);

  return self;
}

void ts_stack_delete(Stack *self) {
  if (self->slices.contents)
    array_delete(&self->slices);
  if (self->iterators.contents)
    array_delete(&self->iterators);
  stack_node_release(self->base_node, &self->node_pool, self->subtree_pool);
  for (uint32_t i = 0; i < self->heads.size; i++) {
    stack_head_delete(array_get(&self->heads, i), &self->node_pool, self->subtree_pool);
  }
  array_clear(&self->heads);
  if (self->node_pool.contents) {
    for (uint32_t i = 0; i < self->node_pool.size; i++)
      ts_free(*array_get(&self->node_pool, i));
    array_delete(&self->node_pool);
  }
  array_delete(&self->heads);
  ts_free(self);
}

uint32_t ts_stack_version_count(const Stack *self) {
  return self->heads.size;
}

uint32_t ts_stack_halted_version_count(Stack *self) {
  uint32_t count = 0;
  for (uint32_t i = 0; i < self->heads.size; i++) {
    StackHead *head = array_get(&self->heads, i);
    if (head->status == StackStatusHalted) {
      count++;
    }
  }
  return count;
}

TSStateId ts_stack_state(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->node->state;
}

Length ts_stack_position(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->node->position;
}

Subtree ts_stack_last_external_token(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->last_external_token;
}

void ts_stack_set_last_external_token(Stack *self, StackVersion version, Subtree token) {
  StackHead *head = array_get(&self->heads, version);
  if (token.ptr) ts_subtree_retain(token);
  if (head->last_external_token.ptr) ts_subtree_release(self->subtree_pool, head->last_external_token);
  head->last_external_token = token;
}

unsigned ts_stack_error_cost(const Stack *self, StackVersion version) {
  StackHead *head = array_get(&self->heads, version);
  unsigned result = head->node->error_cost;
  if (
    head->status == StackStatusPaused ||
    (head->node->state == ERROR_STATE && !head->node->links[0].subtree.ptr)) {
    result += ERROR_COST_PER_RECOVERY;
  }
  return result;
}

unsigned ts_stack_node_count_since_error(const Stack *self, StackVersion version) {
  StackHead *head = array_get(&self->heads, version);
  if (head->node->node_count < head->node_count_at_last_error) {
    head->node_count_at_last_error = head->node->node_count;
  }
  return head->node->node_count - head->node_count_at_last_error;
}

void ts_stack_push(
  Stack *self,
  StackVersion version,
  Subtree subtree,
  bool pending,
  TSStateId state
) {
  StackHead *head = array_get(&self->heads, version);
  StackNode *new_node = stack_node_new(head->node, subtree, pending, state, &self->node_pool);
  if (!subtree.ptr) head->node_count_at_last_error = new_node->node_count;
  head->node = new_node;
}

forceinline StackAction pop_count_callback(void *payload, const StackIterator *iterator) {
  unsigned *goal_subtree_count = payload;
  if (iterator->subtree_count == *goal_subtree_count) {
    return StackActionPop | StackActionStop;
  } else {
    return StackActionNone;
  }
}

StackSliceArray ts_stack_pop_count(Stack *self, StackVersion version, uint32_t count) {
  return stack__iter(self, version, pop_count_callback, &count, (int)count);
}


forceinline StackAction pop_pending_callback(void *payload, const StackIterator *iterator) {
  (void)payload;
  if (iterator->subtree_count >= 1) {
    if (iterator->is_pending) {
      return StackActionPop | StackActionStop;
    } else {
      return StackActionStop;
    }
  } else {
    return StackActionNone;
  }
}

StackSliceArray ts_stack_pop_pending(Stack *self, StackVersion version) {
  StackSliceArray pop = stack__iter(self, version, pop_pending_callback, NULL, 0);
  if (pop.size > 0) {
    ts_stack_renumber_version(self, array_get(&pop, 0)->version, version);
    array_get(&pop, 0)->version = version;
  }
  return pop;
}

forceinline StackAction pop_error_callback(void *payload, const StackIterator *iterator) {
  if (iterator->subtrees.size > 0) {
    bool *found_error = payload;
    if (!*found_error && ts_subtree_is_error(*array_get(&iterator->subtrees, 0))) {
      *found_error = true;
      return StackActionPop | StackActionStop;
    } else {
      return StackActionStop;
    }
  } else {
    return StackActionNone;
  }
}

SubtreeArray ts_stack_pop_error(Stack *self, StackVersion version) {
  StackNode *node = array_get(&self->heads, version)->node;
  for (unsigned i = 0; i < node->link_count; i++) {
    if (node->links[i].subtree.ptr && ts_subtree_is_error(node->links[i].subtree)) {
      bool found_error = false;
      StackSliceArray pop = stack__iter(self, version, pop_error_callback, &found_error, 1);
      if (pop.size > 0) {
        ts_assert(pop.size == 1);
        ts_stack_renumber_version(self, array_get(&pop, 0)->version, version);
        return array_get(&pop, 0)->subtrees;
      }
      break;
    }
  }
  return (SubtreeArray) {.size = 0};
}

forceinline StackAction pop_all_callback(void *payload, const StackIterator *iterator) {
  (void)payload;
  return iterator->node->link_count == 0 ? StackActionPop : StackActionNone;
}

StackSliceArray ts_stack_pop_all(Stack *self, StackVersion version) {
  return stack__iter(self, version, pop_all_callback, NULL, 0);
}

typedef struct {
  StackSummary *summary;
  unsigned max_depth;
} SummarizeStackSession;

forceinline StackAction summarize_stack_callback(void *payload, const StackIterator *iterator) {
  SummarizeStackSession *session = payload;
  TSStateId state = iterator->node->state;
  unsigned depth = iterator->subtree_count;
  if (depth > session->max_depth) return StackActionStop;
  for (unsigned i = session->summary->size - 1; i + 1 > 0; i--) {
    StackSummaryEntry entry = *array_get(session->summary, i);
    if (entry.depth < depth) break;
    if (entry.depth == depth && entry.state == state) return StackActionNone;
  }
  array_push(session->summary, ((StackSummaryEntry) {
    .position = iterator->node->position,
    .depth = depth,
    .state = state,
  }));
  return StackActionNone;
}

void ts_stack_record_summary(Stack *self, StackVersion version, unsigned max_depth) {
  SummarizeStackSession session = {
    .summary = ts_malloc(sizeof(StackSummary)),
    .max_depth = max_depth
  };
  array_init(session.summary);
  stack__iter(self, version, summarize_stack_callback, &session, -1);
  StackHead *head = array_get(&self->heads, version);
  if (head->summary) {
    array_delete(head->summary);
    ts_free(head->summary);
  }
  head->summary = session.summary;
}

StackSummary *ts_stack_get_summary(Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->summary;
}

int ts_stack_dynamic_precedence(Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->node->dynamic_precedence;
}

bool ts_stack_has_advanced_since_error(const Stack *self, StackVersion version) {
  const StackHead *head = array_get(&self->heads, version);
  const StackNode *node = head->node;
  if (node->error_cost == 0) return true;
  while (node) {
    if (node->link_count > 0) {
      Subtree subtree = node->links[0].subtree;
      if (subtree.ptr) {
        if (ts_subtree_total_bytes(subtree) > 0) {
          return true;
        } else if (
          node->node_count > head->node_count_at_last_error &&
          ts_subtree_error_cost(subtree) == 0
        ) {
          node = node->links[0].node;
          continue;
        }
      }
    }
    break;
  }
  return false;
}

void ts_stack_remove_version(Stack *self, StackVersion version) {
  stack_head_delete(array_get(&self->heads, version), &self->node_pool, self->subtree_pool);
  array_erase(&self->heads, version);
}

void ts_stack_renumber_version(Stack *self, StackVersion v1, StackVersion v2) {
  if (v1 == v2) return;
  ts_assert(v2 < v1);
  ts_assert((uint32_t)v1 < self->heads.size);
  StackHead *source_head = array_get(&self->heads, v1);
  StackHead *target_head = array_get(&self->heads, v2);
  if (target_head->summary && !source_head->summary) {
    source_head->summary = target_head->summary;
    target_head->summary = NULL;
  }
  stack_head_delete(target_head, &self->node_pool, self->subtree_pool);
  *target_head = *source_head;
  array_erase(&self->heads, v1);
}

void ts_stack_swap_versions(Stack *self, StackVersion v1, StackVersion v2) {
  StackHead temporary_head = *array_get(&self->heads, v1);
  *array_get(&self->heads, v1) = *array_get(&self->heads, v2);
  *array_get(&self->heads, v2) = temporary_head;
}

StackVersion ts_stack_copy_version(Stack *self, StackVersion version) {
  ts_assert(version < self->heads.size);
  StackHead version_head = *array_get(&self->heads, version);
  array_push(&self->heads, version_head);
  StackHead *head = array_back(&self->heads);
  stack_node_retain(head->node);
  if (head->last_external_token.ptr) ts_subtree_retain(head->last_external_token);
  head->summary = NULL;
  return self->heads.size - 1;
}

bool ts_stack_merge(Stack *self, StackVersion version1, StackVersion version2) {
  if (!ts_stack_can_merge(self, version1, version2)) return false;
  StackHead *head1 = array_get(&self->heads, version1);
  StackHead *head2 = array_get(&self->heads, version2);
  for (uint32_t i = 0; i < head2->node->link_count; i++) {
    stack_node_add_link(head1->node, head2->node->links[i], self->subtree_pool);
  }
  if (head1->node->state == ERROR_STATE) {
    head1->node_count_at_last_error = head1->node->node_count;
  }
  ts_stack_remove_version(self, version2);
  return true;
}

bool ts_stack_can_merge(Stack *self, StackVersion version1, StackVersion version2) {
  StackHead *head1 = array_get(&self->heads, version1);
  StackHead *head2 = array_get(&self->heads, version2);
  return
    head1->status == StackStatusActive &&
    head2->status == StackStatusActive &&
    head1->node->state == head2->node->state &&
    head1->node->position.bytes == head2->node->position.bytes &&
    head1->node->error_cost == head2->node->error_cost &&
    ts_subtree_external_scanner_state_eq(head1->last_external_token, head2->last_external_token);
}

void ts_stack_halt(Stack *self, StackVersion version) {
  array_get(&self->heads, version)->status = StackStatusHalted;
}

void ts_stack_pause(Stack *self, StackVersion version, Subtree lookahead) {
  StackHead *head = array_get(&self->heads, version);
  head->status = StackStatusPaused;
  head->lookahead_when_paused = lookahead;
  head->node_count_at_last_error = head->node->node_count;
}

bool ts_stack_is_active(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->status == StackStatusActive;
}

bool ts_stack_is_halted(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->status == StackStatusHalted;
}

bool ts_stack_is_paused(const Stack *self, StackVersion version) {
  return array_get(&self->heads, version)->status == StackStatusPaused;
}

Subtree ts_stack_resume(Stack *self, StackVersion version) {
  StackHead *head = array_get(&self->heads, version);
  ts_assert(head->status == StackStatusPaused);
  Subtree result = head->lookahead_when_paused;
  head->status = StackStatusActive;
  head->lookahead_when_paused = NULL_SUBTREE;
  return result;
}

void ts_stack_clear(Stack *self) {
  stack_node_retain(self->base_node);
  for (uint32_t i = 0; i < self->heads.size; i++) {
    stack_head_delete(array_get(&self->heads, i), &self->node_pool, self->subtree_pool);
  }
  array_clear(&self->heads);
  array_push(&self->heads, ((StackHead) {
    .node = self->base_node,
    .status = StackStatusActive,
    .last_external_token = NULL_SUBTREE,
    .lookahead_when_paused = NULL_SUBTREE,
  }));
}

bool ts_stack_print_dot_graph(Stack *self, const TSLanguage *language, FILE *f) {
  array_reserve(&self->iterators, 32);
  if (!f) f = stderr;

  fprintf(f, "digraph stack {\n");
  fprintf(f, "rankdir=\"RL\";\n");
  fprintf(f, "edge [arrowhead=none]\n");

  Array(StackNode *) visited_nodes = array_new();

  array_clear(&self->iterators);
  for (uint32_t i = 0; i < self->heads.size; i++) {
    StackHead *head = array_get(&self->heads, i);
    if (head->status == StackStatusHalted) continue;

    fprintf(f, "node_head_%u [shape=none, label=\"\"]\n", i);
    fprintf(f, "node_head_%u -> node_%p [", i, (void *)head->node);

    if (head->status == StackStatusPaused) {
      fprintf(f, "color=red ");
    }
    fprintf(f,
      "label=%u, fontcolor=blue, weight=10000, labeltooltip=\"node_count: %u\nerror_cost: %u",
      i,
      ts_stack_node_count_since_error(self, i),
      ts_stack_error_cost(self, i)
    );

    if (head->summary) {
      fprintf(f, "\nsummary:");
      for (uint32_t j = 0; j < head->summary->size; j++) fprintf(f, " %u", array_get(head->summary, j)->state);
    }

    if (head->last_external_token.ptr) {
      const ExternalScannerState *state = &head->last_external_token.ptr->external_scanner_state;
      const char *data = ts_external_scanner_state_data(state);
      fprintf(f, "\nexternal_scanner_state:");
      for (uint32_t j = 0; j < state->length; j++) fprintf(f, " %2X", data[j]);
    }

    fprintf(f, "\"]\n");
    array_push(&self->iterators, ((StackIterator) {
      .node = head->node
    }));
  }

  bool all_iterators_done = false;
  while (!all_iterators_done) {
    all_iterators_done = true;

    for (uint32_t i = 0; i < self->iterators.size; i++) {
      StackIterator iterator = *array_get(&self->iterators, i);
      StackNode *node = iterator.node;

      for (uint32_t j = 0; j < visited_nodes.size; j++) {
        if (*array_get(&visited_nodes, j) == node) {
          node = NULL;
          break;
        }
      }

      if (!node) continue;
      all_iterators_done = false;

      fprintf(f, "node_%p [", (void *)node);
      if (node->state == ERROR_STATE) {
        fprintf(f, "label=\"?\"");
      } else if (
        node->link_count == 1 &&
        node->links[0].subtree.ptr &&
        ts_subtree_extra(node->links[0].subtree)
      ) {
        fprintf(f, "shape=point margin=0 label=\"\"");
      } else {
        fprintf(f, "label=\"%d\"", node->state);
      }

      fprintf(
        f,
        " tooltip=\"position: %u,%u\nnode_count:%u\nerror_cost: %u\ndynamic_precedence: %d\"];\n",
        node->position.extent.row + 1,
        node->position.extent.column,
        node->node_count,
        node->error_cost,
        node->dynamic_precedence
      );

      for (int j = 0; j < node->link_count; j++) {
        StackLink link = node->links[j];
        fprintf(f, "node_%p -> node_%p [", (void *)node, (void *)link.node);
        if (link.is_pending) fprintf(f, "style=dashed ");
        if (link.subtree.ptr && ts_subtree_extra(link.subtree)) fprintf(f, "fontcolor=gray ");

        if (!link.subtree.ptr) {
          fprintf(f, "color=red");
        } else {
          fprintf(f, "label=\"");
          bool quoted = ts_subtree_visible(link.subtree) && !ts_subtree_named(link.subtree);
          if (quoted) fprintf(f, "'");
          ts_language_write_symbol_as_dot_string(language, f, ts_subtree_symbol(link.subtree));
          if (quoted) fprintf(f, "'");
          fprintf(f, "\"");
          fprintf(
            f,
            "labeltooltip=\"error_cost: %u\ndynamic_precedence: %" PRId32 "\"",
            ts_subtree_error_cost(link.subtree),
            ts_subtree_dynamic_precedence(link.subtree)
          );
        }

        fprintf(f, "];\n");

        StackIterator *next_iterator;
        if (j == 0) {
          next_iterator = array_get(&self->iterators, i);
        } else {
          array_push(&self->iterators, iterator);
          next_iterator = array_back(&self->iterators);
        }
        next_iterator->node = link.node;
      }

      array_push(&visited_nodes, node);
    }
  }

  fprintf(f, "}\n");

  array_delete(&visited_nodes);
  return true;
}

#undef forceinline
