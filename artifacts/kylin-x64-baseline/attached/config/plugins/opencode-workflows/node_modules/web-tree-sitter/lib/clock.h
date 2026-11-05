#ifndef TREE_SITTER_CLOCK_H_
#define TREE_SITTER_CLOCK_H_

#include <stdbool.h>
#include <stdint.h>

typedef uint64_t TSDuration;

#ifdef _WIN32

// Windows:
// * Represent a time as a performance counter value.
// * Represent a duration as a number of performance counter ticks.

#include <windows.h>
typedef uint64_t TSClock;

static inline TSDuration duration_from_micros(uint64_t micros) {
  LARGE_INTEGER frequency;
  QueryPerformanceFrequency(&frequency);
  return micros * (uint64_t)frequency.QuadPart / 1000000;
}

static inline uint64_t duration_to_micros(TSDuration self) {
  LARGE_INTEGER frequency;
  QueryPerformanceFrequency(&frequency);
  return self * 1000000 / (uint64_t)frequency.QuadPart;
}

static inline TSClock clock_null(void) {
  return 0;
}

static inline TSClock clock_now(void) {
  LARGE_INTEGER result;
  QueryPerformanceCounter(&result);
  return (uint64_t)result.QuadPart;
}

static inline TSClock clock_after(TSClock base, TSDuration duration) {
  return base + duration;
}

static inline bool clock_is_null(TSClock self) {
  return !self;
}

static inline bool clock_is_gt(TSClock self, TSClock other) {
  return self > other;
}

#elif defined(CLOCK_MONOTONIC)

// POSIX with monotonic clock support (Linux, macOS)
// * Represent a time as a monotonic (seconds, nanoseconds) pair.
// * Represent a duration as a number of microseconds.
//
// On these platforms, parse timeouts will correspond accurately to
// real time, regardless of what other processes are running.

#include <time.h>
typedef struct timespec TSClock;

static inline TSDuration duration_from_micros(uint64_t micros) {
  return micros;
}

static inline uint64_t duration_to_micros(TSDuration self) {
  return self;
}

static inline TSClock clock_now(void) {
  TSClock result;
  clock_gettime(CLOCK_MONOTONIC, &result);
  return result;
}

static inline TSClock clock_null(void) {
  return (TSClock) {0, 0};
}

static inline TSClock clock_after(TSClock base, TSDuration duration) {
  TSClock result = base;
  result.tv_sec += duration / 1000000;
  result.tv_nsec += (duration % 1000000) * 1000;
  if (result.tv_nsec >= 1000000000) {
    result.tv_nsec -= 1000000000;
    ++(result.tv_sec);
  }
  return result;
}

static inline bool clock_is_null(TSClock self) {
  return !self.tv_sec && !self.tv_nsec;
}

static inline bool clock_is_gt(TSClock self, TSClock other) {
  if (self.tv_sec > other.tv_sec) return true;
  if (self.tv_sec < other.tv_sec) return false;
  return self.tv_nsec > other.tv_nsec;
}

#else

// POSIX without monotonic clock support
// * Represent a time as a process clock value.
// * Represent a duration as a number of process clock ticks.
//
// On these platforms, parse timeouts may be affected by other processes,
// which is not ideal, but is better than using a non-monotonic time API
// like `gettimeofday`.

#include <time.h>
typedef uint64_t TSClock;

static inline TSDuration duration_from_micros(uint64_t micros) {
  return micros * (uint64_t)CLOCKS_PER_SEC / 1000000;
}

static inline uint64_t duration_to_micros(TSDuration self) {
  return self * 1000000 / (uint64_t)CLOCKS_PER_SEC;
}

static inline TSClock clock_null(void) {
  return 0;
}

static inline TSClock clock_now(void) {
  return (uint64_t)clock();
}

static inline TSClock clock_after(TSClock base, TSDuration duration) {
  return base + duration;
}

static inline bool clock_is_null(TSClock self) {
  return !self;
}

static inline bool clock_is_gt(TSClock self, TSClock other) {
  return self > other;
}

#endif

#endif  // TREE_SITTER_CLOCK_H_
