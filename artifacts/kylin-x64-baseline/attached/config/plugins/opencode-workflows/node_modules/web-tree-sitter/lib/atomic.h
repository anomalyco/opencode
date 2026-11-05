#ifndef TREE_SITTER_ATOMIC_H_
#define TREE_SITTER_ATOMIC_H_

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#ifdef __TINYC__

static inline size_t atomic_load(const volatile size_t *p) {
  return *p;
}

static inline uint32_t atomic_inc(volatile uint32_t *p) {
  *p += 1;
  return *p;
}

static inline uint32_t atomic_dec(volatile uint32_t *p) {
  *p-= 1;
  return *p;
}

#elif defined(_WIN32)

#include <windows.h>

static inline size_t atomic_load(const volatile size_t *p) {
  return *p;
}

static inline uint32_t atomic_inc(volatile uint32_t *p) {
  return InterlockedIncrement((long volatile *)p);
}

static inline uint32_t atomic_dec(volatile uint32_t *p) {
  return InterlockedDecrement((long volatile *)p);
}

#else

static inline size_t atomic_load(const volatile size_t *p) {
#ifdef __ATOMIC_RELAXED
  return __atomic_load_n(p, __ATOMIC_RELAXED);
#else
  return __sync_fetch_and_add((volatile size_t *)p, 0);
#endif
}

static inline uint32_t atomic_inc(volatile uint32_t *p) {
  #ifdef __ATOMIC_RELAXED
    return __atomic_add_fetch(p, 1U, __ATOMIC_SEQ_CST);
  #else
    return __sync_add_and_fetch(p, 1U);
  #endif
}

static inline uint32_t atomic_dec(volatile uint32_t *p) {
  #ifdef __ATOMIC_RELAXED
    return __atomic_sub_fetch(p, 1U, __ATOMIC_SEQ_CST);
  #else
    return __sync_sub_and_fetch(p, 1U);
  #endif
}

#endif

#endif  // TREE_SITTER_ATOMIC_H_
