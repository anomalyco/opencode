
// Determine endian and pointer size based on known defines.
// TS_BIG_ENDIAN and TS_PTR_SIZE can be set as -D compiler arguments
// to override this.

#if !defined(TS_BIG_ENDIAN)
#if (defined(__BYTE_ORDER__) && __BYTE_ORDER__ == __ORDER_BIG_ENDIAN__) \
  || (defined( __APPLE_CC__) && (defined(__ppc__) || defined(__ppc64__)))
#define TS_BIG_ENDIAN 1
#else
#define TS_BIG_ENDIAN 0
#endif
#endif

#if !defined(TS_PTR_SIZE)
#if UINTPTR_MAX == 0xFFFFFFFF
#define TS_PTR_SIZE 32
#else
#define TS_PTR_SIZE 64
#endif
#endif
