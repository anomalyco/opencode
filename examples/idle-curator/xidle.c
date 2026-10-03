#include <X11/Xlib.h>
#include <X11/extensions/scrnsaver.h>
#include <stdio.h>
int main(void) {
  Display *d = XOpenDisplay(NULL);
  if (!d) return 1;
  XScreenSaverInfo *info = XScreenSaverAllocInfo();
  if (!info) return 1;
  XScreenSaverQueryInfo(d, DefaultRootWindow(d), info);
  printf("%lu\n", info->idle);
  return 0;
}
