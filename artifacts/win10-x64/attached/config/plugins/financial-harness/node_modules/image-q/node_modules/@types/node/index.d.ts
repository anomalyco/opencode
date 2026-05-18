// Type definitions for non-npm package Node.js 16.9
// Project: https://nodejs.org/
// Definitions by: Microsoft TypeScript <https://github.com/Microsoft>
//                 DefinitelyTyped <https://github.com/DefinitelyTyped>
//                 Alberto Schiabel <https://github.com/jkomyno>
//                 Alvis HT Tang <https://github.com/alvis>
//                 Andrew Makarov <https://github.com/r3nya>
//                 Benjamin Toueg <https://github.com/btoueg>
//                 Chigozirim C. <https://github.com/smac89>
//                 David Junger <https://github.com/touffy>
//                 Deividas Bakanas <https://github.com/DeividasBakanas>
//                 Eugene Y. Q. Shen <https://github.com/eyqs>
//                 Hannes Magnusson <https://github.com/Hannes-Magnusson-CK>
//                 Huw <https://github.com/hoo29>
//                 Kelvin Jin <https://github.com/kjin>
//                 Klaus Meinhardt <https://github.com/ajafff>
//                 Lishude <https://github.com/islishude>
//                 Mariusz Wiktorczyk <https://github.com/mwiktorczyk>
//                 Mohsen Azimi <https://github.com/mohsen1>
//                 Nicolas Even <https://github.com/n-e>
//                 Nikita Galkin <https://github.com/galkin>
//                 Parambir Singh <https://github.com/parambirs>
//                 Sebastian Silbermann <https://github.com/eps1lon>
//                 Simon Schick <https://github.com/SimonSchick>
//                 Thomas den Hollander <https://github.com/ThomasdenH>
//                 Wilco Bakker <https://github.com/WilcoBakker>
//                 wwwy3y3 <https://github.com/wwwy3y3>
//                 Samuel Ainsworth <https://github.com/samuela>
//                 Kyle Uehlein <https://github.com/kuehlein>
//                 Thanik Bhongbhibhat <https://github.com/bhongy>
//                 Marcin Kopacz <https://github.com/chyzwar>
//                 Trivikram Kamat <https://github.com/trivikr>
//                 Minh Son Nguyen <https://github.com/nguymin4>
//                 Junxiao Shi <https://github.com/yoursunny>
//                 Ilia Baryshnikov <https://github.com/qwelias>
//                 ExE Boss <https://github.com/ExE-Boss>
//                 Surasak Chaisurin <https://github.com/Ryan-Willpower>
//                 Piotr Błażejewicz <https://github.com/peterblazejewicz>
//                 Anna Henningsen <https://github.com/addaleax>
//                 Jason Kwok <https://github.com/JasonHK>
//                 Victor Perin <https://github.com/victorperin>
//                 Yongsheng Zhang <https://github.com/ZYSzys>
//                 NodeJS Contributors <https://github.com/NodeJS>
//                 Linus Unnebäck <https://github.com/LinusU>
//                 wafuwafu13 <https://github.com/wafuwafu13>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/**
 * License for programmatically and manually incorporated
 * documentation aka. `JSDoc` from https://github.com/nodejs/node/tree/master/doc
 *
 * Copyright Node.js contributors. All rights reserved.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

// NOTE: These definitions support NodeJS and TypeScript 3.7+.

// Reference required types from the default lib:
/// <reference lib="es2020" />
/// <reference lib="esnext.asynciterable" />
/// <reference lib="esnext.intl" />
/// <reference lib="esnext.bigint" />

// Base definitions for all NodeJS modules that are not specific to any version of TypeScript:
/// <reference path="assert.d.ts" />
/// <reference path="assert/strict.d.ts" />
/// <reference path="globals.d.ts" />
/// <reference path="async_hooks.d.ts" />
/// <reference path="buffer.d.ts" />
/// <reference path="child_process.d.ts" />
/// <reference path="cluster.d.ts" />
/// <reference path="console.d.ts" />
/// <reference path="constants.d.ts" />
/// <reference path="crypto.d.ts" />
/// <reference path="dgram.d.ts" />
/// <reference path="diagnostics_channel.d.ts" />
/// <reference path="dns.d.ts" />
/// <reference path="dns/promises.d.ts" />
/// <reference path="dns/promises.d.ts" />
/// <reference path="domain.d.ts" />
/// <reference path="events.d.ts" />
/// <reference path="fs.d.ts" />
/// <reference path="fs/promises.d.ts" />
/// <reference path="http.d.ts" />
/// <reference path="http2.d.ts" />
/// <reference path="https.d.ts" />
/// <reference path="inspector.d.ts" />
/// <reference path="module.d.ts" />
/// <reference path="net.d.ts" />
/// <reference path="os.d.ts" />
/// <reference path="path.d.ts" />
/// <reference path="perf_hooks.d.ts" />
/// <reference path="process.d.ts" />
/// <reference path="punycode.d.ts" />
/// <reference path="querystring.d.ts" />
/// <reference path="readline.d.ts" />
/// <reference path="repl.d.ts" />
/// <reference path="stream.d.ts" />
/// <reference path="stream/promises.d.ts" />
/// <reference path="stream/consumers.d.ts" />
/// <reference path="stream/web.d.ts" />
/// <reference path="string_decoder.d.ts" />
/// <reference path="timers.d.ts" />
/// <reference path="timers/promises.d.ts" />
/// <reference path="tls.d.ts" />
/// <reference path="trace_events.d.ts" />
/// <reference path="tty.d.ts" />
/// <reference path="url.d.ts" />
/// <reference path="util.d.ts" />
/// <reference path="v8.d.ts" />
/// <reference path="vm.d.ts" />
/// <reference path="wasi.d.ts" />
/// <reference path="worker_threads.d.ts" />
/// <reference path="zlib.d.ts" />

/// <reference path="globals.global.d.ts" />
