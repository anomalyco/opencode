import { escape, unescape } from 'minimatch';
import { Glob } from './glob.js';
import { hasMagic } from './has-magic.js';
export function globStreamSync(pattern, options = {}) {
    return new Glob(pattern, options).streamSync();
}
export function globStream(pattern, options = {}) {
    return new Glob(pattern, options).stream();
}
export function globSync(pattern, options = {}) {
    return new Glob(pattern, options).walkSync();
}
export async function glob(pattern, options = {}) {
    return new Glob(pattern, options).walk();
}
export function globIterateSync(pattern, options = {}) {
    return new Glob(pattern, options).iterateSync();
}
export function globIterate(pattern, options = {}) {
    return new Glob(pattern, options).iterate();
}
// aliases: glob.sync.stream() glob.stream.sync() glob.sync() etc
export const streamSync = globStreamSync;
export const stream = Object.assign(globStream, { sync: globStreamSync });
export const iterateSync = globIterateSync;
export const iterate = Object.assign(globIterate, {
    sync: globIterateSync,
});
export const sync = Object.assign(globSync, {
    stream: globStreamSync,
    iterate: globIterateSync,
});
/* c8 ignore start */
export { escape, unescape } from 'minimatch';
export { Glob } from './glob.js';
export { hasMagic } from './has-magic.js';
/* c8 ignore stop */
export default Object.assign(glob, {
    glob,
    globSync,
    sync,
    globStream,
    stream,
    globStreamSync,
    streamSync,
    globIterate,
    iterate,
    globIterateSync,
    iterateSync,
    Glob,
    hasMagic,
    escape,
    unescape,
});
//# sourceMappingURL=index.js.map