// SEA filesystem prelude imports, isolated so vite.node.config stays declarative.
// The generated single-file bundle inlines these imports at the top of its prelude.
export const seaFsPreludeImports = [
  'import { chmodSync as __ocChmod, existsSync as __ocExists, lstatSync as __ocLstat, mkdirSync as __ocMkdir, renameSync as __ocRename, rmSync as __ocRm, writeFileSync as __ocWrite } from "node:fs"',
  'import { tmpdir as __ocTmpdir } from "node:os"',
  'import __ocPath from "node:path"',
  'import { getAssetKeys as __ocAssetKeys, getRawAsset as __ocRawAsset, isSea as __ocIsSea } from "node:sea"',
  'import { fileURLToPath as __ocFileURLToPath } from "node:url"',
].join("\n")
