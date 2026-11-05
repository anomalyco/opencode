#ifndef TREE_SITTER_ASSERT_H_
#define TREE_SITTER_ASSERT_H_

#ifdef NDEBUG
#define ts_assert(e) ((void)(e))
#else
#include <assert.h>
#define ts_assert(e) assert(e)
#endif

#endif // TREE_SITTER_ASSERT_H_
