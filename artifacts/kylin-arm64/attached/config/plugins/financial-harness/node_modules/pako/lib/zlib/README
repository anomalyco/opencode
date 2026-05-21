Content of this folder follows zlib C sources as close as possible.
That's intended to simplify maintainability and guarantee equal API
and result.

Key differences:

- Everything is in JavaScript.
- No platform-dependent blocks.
- Some things like crc32 rewritten to keep size small and make JIT
  work better.
- Some code is different due missed features in JS (macros, pointers,
  structures, header files)
- Specific API methods are not implemented (see notes in root readme)

This port is based on zlib 1.2.8.

This port is under zlib license (see below) with contribution and addition of javascript
port under expat license (see LICENSE at root of project)

Copyright:
(C) 1995-2013 Jean-loup Gailly and Mark Adler
(C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin


From zlib's README
=============================================================================

Acknowledgments:

  The deflate format used by zlib was defined by Phil Katz.  The deflate and
  zlib specifications were written by L.  Peter Deutsch.  Thanks to all the
  people who reported problems and suggested various improvements in zlib; they
  are too numerous to cite here.

Copyright notice:

 (C) 1995-2013 Jean-loup Gailly and Mark Adler

Copyright (c) <''year''> <''copyright holders''>

This software is provided 'as-is', without any express or implied
warranty. In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.


  Jean-loup Gailly        Mark Adler
  jloup@gzip.org          madler@alumni.caltech.edu
