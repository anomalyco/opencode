import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { collectStream } from "@opencode/util/process"
import type { Driver } from "./driver.js"
import { Failed, NotFound, WrongKind, type FileInfo, type Files, type FileType, type FilesImpl } from "./files.js"

/**
 * Files derived from spawning processes: one process per intent, "$1" is
 * always the target path. Scripts report classification through an exit-code
 * protocol (44/45/46) so failures never require parsing localized error text;
 * LC_ALL=C pins the one stderr match that remains. Requires GNU coreutils and
 * findutils in the target image — BSD and busybox userlands will not work.
 * Malformed output from these scripts is our own bug and dies as a defect.
 */

const MAX_DATA_BYTES = 64 * 1024 * 1024
const MAX_ERROR_BYTES = 64 * 1024
const NOT_FOUND = 44
const WRONG_KIND = 45
const FAILED = 46
const TAB = "\t"
// Kind, size and mtime first, as the read and list scripts expect, then the rest of stat(2): device, inode, raw mode
// (hex), links, owner, group, device major and minor (hex), I/O block size, blocks, and access, change and birth times.
const STAT_FORMAT = [
  "%F",
  "%s",
  "%Y",
  "%d",
  "%i",
  "%f",
  "%h",
  "%u",
  "%g",
  "%t",
  "%T",
  "%o",
  "%b",
  "%X",
  "%Z",
  "%W",
].join(TAB)
// Exits NOT_FOUND unless "$1" names something, a dangling symlink included.
const exists = `[ -e "$1" ] || [ -L "$1" ] || exit ${NOT_FOUND}`

const loadMetadata = (flags = "") => `
metadata=$(stat ${flags} -c '${STAT_FORMAT}' -- "$1" 2>&1) || {
  case "$metadata" in
    *'No such file or directory'*|*'Not a directory'*) exit ${NOT_FOUND} ;;
    *) printf '%s' "$metadata" >&2; exit ${FAILED} ;;
  esac
}
`

const statScript = `
${loadMetadata()}
printf '%s\n' "$metadata"
`

const readScript = `
${loadMetadata("-L")}
kind=\${metadata%%${TAB}*}
if [ "$kind" != 'regular file' ] && [ "$kind" != 'regular empty file' ]; then
  printf '%s' "$kind" >&2
  exit ${WRONG_KIND}
fi
printf '%s\n' "$metadata"
if [ "$2" = range ]; then
  dd if="$1" iflag=skip_bytes,count_bytes skip="$3" count="$4" status=none
else
  cat -- "$1"
fi
`

const listScript = `
${loadMetadata("-L")}
kind=\${metadata%%${TAB}*}
if [ "$kind" != directory ]; then
  printf '%s' "$kind" >&2
  exit ${WRONG_KIND}
fi
find -H "$1" -mindepth 1 -maxdepth 1 -printf '%y\\0%f\\0'
`

const moveScript = `
${loadMetadata()}
mv -- "$1" "$2"
`

interface Result {
  readonly exitCode: number
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
}

export const execDefaults = (spawner: ChildProcessSpawner["Service"]): FilesImpl => {
  const run = (
    path: string,
    script: string,
    args: ReadonlyArray<string> = [],
    stdin?: Uint8Array,
  ): Effect.Effect<Result, Failed> =>
    Effect.scoped(
      Effect.gen(function* () {
        const command = ChildProcess.make("sh", ["-c", script, "sh", path, ...args], {
          env: { LC_ALL: "C" },
          extendEnv: true,
          stdin: stdin === undefined ? undefined : Stream.make(stdin),
        })
        const handle = yield* spawner.spawn(command).pipe(Effect.mapError((cause) => new Failed({ path, cause })))
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectStream(handle.stdout, MAX_DATA_BYTES),
            collectStream(handle.stderr, MAX_ERROR_BYTES),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.mapError((cause) => new Failed({ path, cause })))
        if (stdout.truncated || stderr.truncated) {
          return yield* new Failed({ path, cause: new Error("Process output exceeded its collection limit") })
        }
        return { exitCode, stdout: stdout.buffer, stderr: stderr.buffer }
      }),
    )

  const classify = <A>(
    path: string,
    result: Result,
    success: (stdout: Uint8Array) => A,
  ): Effect.Effect<A, NotFound | WrongKind | Failed> => {
    if (result.exitCode === 0) return Effect.sync(() => success(result.stdout))
    if (result.exitCode === NOT_FOUND) return Effect.fail(new NotFound({ path }))
    if (result.exitCode === WRONG_KIND) {
      return Effect.fail(new WrongKind({ path, actual: parseType(new TextDecoder().decode(result.stderr)) }))
    }
    return Effect.fail(processFailure(path, result))
  }

  const complete = (path: string, result: Result) =>
    result.exitCode === 0 ? Effect.void : Effect.fail(processFailure(path, result))

  // A script with no output that may report NOT_FOUND.
  const plain = (path: string, script: string, args: ReadonlyArray<string>) =>
    run(path, script, args).pipe(Effect.flatMap((result) => classifyPlain(path, result, () => undefined)))

  return {
    stat: (path) => run(path, statScript).pipe(Effect.flatMap((result) => classifyPlain(path, result, parseInfo))),
    read: (path, range) =>
      run(
        path,
        readScript,
        range === undefined ? ["whole"] : ["range", String(range.offset), String(range.length)],
      ).pipe(
        Effect.flatMap((result) =>
          classify(path, result, (stdout) => {
            const newline = stdout.indexOf(10)
            if (newline < 0) throw new Error("Missing read metadata header")
            return {
              info: parseInfo(stdout.slice(0, newline)),
              bytes: stdout.slice(newline + 1),
            }
          }),
        ),
      ),
    write: (path, bytes) =>
      run(path, `mkdir -p "$(dirname "$1")" && cat > "$1"`, [], bytes).pipe(
        Effect.flatMap((result) => complete(path, result)),
      ),
    list: (path) => run(path, listScript).pipe(Effect.flatMap((result) => classify(path, result, parseList))),
    remove: (path) => run(path, `rm -rf -- "$1"`).pipe(Effect.flatMap((result) => complete(path, result))),
    move: (from, to) =>
      run(from, moveScript, [to]).pipe(Effect.flatMap((result) => classifyPlain(from, result, () => undefined))),
    mkdir: (path) => run(path, `mkdir -p -- "$1"`).pipe(Effect.flatMap((result) => complete(path, result))),
    append: (path, bytes) =>
      run(path, `cat >> "$1"`, [], bytes).pipe(Effect.flatMap((result) => complete(path, result))),
    writeAt: (path, bytes, offset) =>
      run(path, `dd of="$1" oflag=seek_bytes seek="$2" conv=notrunc status=none`, [String(offset)], bytes).pipe(
        Effect.flatMap((result) => complete(path, result)),
      ),
    truncate: (path, length) =>
      plain(path, `[ -e "$1" ] || exit ${NOT_FOUND}; truncate -s "$2" -- "$1"`, [String(length)]),
    chmod: (path, mode) =>
      plain(path, `[ -e "$1" ] || exit ${NOT_FOUND}; chmod "$2" -- "$1"`, [(mode & 0o7777).toString(8)]),
    chown: (path, uid, gid, follow) =>
      plain(
        path,
        `${follow ? `[ -e "$1" ] || exit ${NOT_FOUND}` : exists}; chown ${follow ? "" : "-h"} "$2:$3" -- "$1"`,
        [String(uid), String(gid)],
      ),
    utimes: (path, atimeMs, mtimeMs, follow) =>
      // -c never creates the file; one touch per time, as -a and -m take a single -d.
      plain(
        path,
        `${follow ? `[ -e "$1" ] || exit ${NOT_FOUND}` : exists}
touch -c ${follow ? "" : "-h"} -a -d "@$2" -- "$1" && touch -c ${follow ? "" : "-h"} -m -d "@$3" -- "$1"`,
        [String(atimeMs / 1_000), String(mtimeMs / 1_000)],
      ),
    symlink: (target, path) =>
      run(path, `ln -s -- "$2" "$1"`, [target]).pipe(Effect.flatMap((result) => complete(path, result))),
    readlink: (path) =>
      run(
        path,
        `if [ -L "$1" ]; then readlink -- "$1"; elif [ -e "$1" ]; then stat -c '%F' -- "$1" >&2; exit ${WRONG_KIND}; else exit ${NOT_FOUND}; fi`,
      ).pipe(Effect.flatMap((result) => classify(path, result, (stdout) => trimNewline(stdout)))),
    realpath: (path) =>
      run(path, `[ -e "$1" ] || exit ${NOT_FOUND}; realpath -e -- "$1"`).pipe(
        Effect.flatMap((result) => classifyPlain(path, result, (stdout) => trimNewline(stdout))),
      ),
    link: (existing, path) => plain(existing, `[ -e "$1" ] || exit ${NOT_FOUND}; ln -- "$1" "$2"`, [path]),
    statfs: (path) =>
      run(
        path,
        `[ -e "$1" ] || exit ${NOT_FOUND}; stat -f -c '${["%t", "%S", "%b", "%f", "%a", "%c", "%d"].join(TAB)}' -- "$1"`,
      ).pipe(Effect.flatMap((result) => classifyPlain(path, result, parseFilesystem))),
  }
}

/** `classify` for scripts whose protocol never reports WrongKind. */
const classifyPlain = <A>(
  path: string,
  result: Result,
  success: (stdout: Uint8Array) => A,
): Effect.Effect<A, NotFound | Failed> => {
  if (result.exitCode === 0) return Effect.sync(() => success(result.stdout))
  if (result.exitCode === NOT_FOUND) return Effect.fail(new NotFound({ path }))
  return Effect.fail(processFailure(path, result))
}

const processFailure = (path: string, result: Result) =>
  new Failed({
    path,
    cause: new Error(new TextDecoder().decode(result.stderr).trim() || `Process exited with code ${result.exitCode}`),
  })

const parseInfo = (bytes: Uint8Array): FileInfo => {
  const [
    rawType,
    rawSize,
    rawMtime,
    dev,
    ino,
    mode,
    nlink,
    uid,
    gid,
    major,
    minor,
    blksize,
    blocks,
    atime,
    ctime,
    birth,
  ] = new TextDecoder().decode(bytes).trim().split(TAB)
  const size = Number(rawSize)
  const mtimeMs = Number(rawMtime) * 1_000
  if (!rawType || !Number.isFinite(size) || !Number.isFinite(mtimeMs)) throw new Error("Invalid stat output")
  const majorNumber = Number.parseInt(major ?? "0", 16)
  const minorNumber = Number.parseInt(minor ?? "0", 16)
  return {
    type: parseType(rawType),
    size,
    mtimeMs,
    dev: Number(dev),
    ino: Number(ino),
    mode: Number.parseInt(mode ?? "0", 16),
    nlink: Number(nlink),
    uid: Number(uid),
    gid: Number(gid),
    // glibc's makedev, the encoding Node reports as rdev on Linux.
    rdev: ((majorNumber & 0xfff) << 8) | (minorNumber & 0xff) | ((minorNumber & ~0xff) << 12),
    blksize: Number(blksize),
    blocks: Number(blocks),
    atimeMs: Number(atime) * 1_000,
    ctimeMs: Number(ctime) * 1_000,
    // GNU stat prints 0 when the filesystem doesn't record birth times; Node reports the change time's epoch then too.
    birthtimeMs: Number(birth) * 1_000,
  }
}

const parseFilesystem = (bytes: Uint8Array) => {
  const [type, bsize, blocks, bfree, bavail, files, ffree] = new TextDecoder().decode(bytes).trim().split(TAB)
  return {
    type: Number.parseInt(type ?? "0", 16),
    bsize: Number(bsize),
    blocks: Number(blocks),
    bfree: Number(bfree),
    bavail: Number(bavail),
    files: Number(files),
    ffree: Number(ffree),
  }
}

const trimNewline = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\n$/, "")

const parseType = (value: string): FileType => {
  if (value === "regular file" || value === "regular empty file" || value === "f") return "file"
  if (value === "directory" || value === "d") return "directory"
  if (value === "symbolic link" || value === "l") return "symlink"
  return "other"
}

const parseList = (bytes: Uint8Array) => {
  const fields = new TextDecoder().decode(bytes).split("\0")
  fields.pop()
  if (fields.length % 2 !== 0) throw new Error("Invalid find output")
  return Array.from({ length: fields.length / 2 }, (_, index) => ({
    name: fields[index * 2 + 1],
    type: parseType(fields[index * 2]),
  }))
}

export const makeFiles = (driver: Driver): Files => ({
  ...execDefaults(driver.spawner),
  ...driver.overrides,
})

export * as EnvironmentExecDefaults from "./exec-defaults.js"
