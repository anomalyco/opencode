// @ts-check
const fs = require('fs');
const path = require('path');

const distDir =
  process.env['DIST_PATH'] ?
    path.resolve(process.env['DIST_PATH'])
  : path.resolve(__dirname, '..', '..', 'dist');

async function* walk(dir) {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
  }
}

async function postprocess() {
  for await (const file of walk(distDir)) {
    if (!/(\.d)?[cm]?ts$/.test(file)) continue;

    const code = await fs.promises.readFile(file, 'utf8');

    // strip out lib="dom", types="node", and types="react" references; these
    // are needed at build time, but would pollute the user's TS environment
    const transformed = code.replace(
      /^ *\/\/\/ *<reference +(lib="dom"|types="(node|react)").*?\n/gm,
      // replace with same number of characters to avoid breaking source maps
      (match) => ' '.repeat(match.length - 1) + '\n',
    );

    if (transformed !== code) {
      console.error(`wrote ${path.relative(process.cwd(), file)}`);
      await fs.promises.writeFile(file, transformed, 'utf8');
    }
  }

  const newExports = {
    '.': {
      require: {
        types: './index.d.ts',
        default: './index.js',
      },
      types: './index.d.mts',
      default: './index.mjs',
    },
  };

  for (const entry of await fs.promises.readdir(distDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'src' && entry.name !== 'internal' && entry.name !== 'bin') {
      const subpath = './' + entry.name;
      newExports[subpath + '/*.mjs'] = {
        default: subpath + '/*.mjs',
      };
      newExports[subpath + '/*.js'] = {
        default: subpath + '/*.js',
      };
      newExports[subpath + '/*'] = {
        import: subpath + '/*.mjs',
        require: subpath + '/*.js',
      };
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      const { name, ext } = path.parse(entry.name);
      const subpathWithoutExt = './' + name;
      const subpath = './' + entry.name;
      newExports[subpathWithoutExt] ||= { import: undefined, require: undefined };
      const isModule = ext[1] === 'm';
      if (isModule) {
        newExports[subpathWithoutExt].import = subpath;
      } else {
        newExports[subpathWithoutExt].require = subpath;
      }
      newExports[subpath] = {
        default: subpath,
      };
    }
  }
  await fs.promises.writeFile(
    'dist/package.json',
    JSON.stringify(
      Object.assign(
        /** @type {Record<String, unknown>} */ (
          JSON.parse(await fs.promises.readFile('dist/package.json', 'utf-8'))
        ),
        {
          exports: newExports,
        },
      ),
      null,
      2,
    ),
  );
}
postprocess();
