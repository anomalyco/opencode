# find-babel-config
[![npm][npm-version-image]][npm-url] [![Build Status][ci-image]][ci-url] [![Coverage Status][coverage-image]][coverage-url]

Helper function to retrieve the closest Babel configuration from a specific directory.

## Installation

```sh
npm install --save find-babel-config
```

## Usage

### Async

```js
// directory can be an absolute or relative path
// If it's a relative path, it is relative to the current working directory (process.cwd())
const directory = 'src';
findBabelConfig(directory).then(({ file, config }) => {
    if (file) {
        // file is the file in which the config is found
        console.log(file);
        // config is a JS plain object with the babel config
        console.log(config);
    }
});
```

### Sync

```js
// directory can be an absolute or relative path
// If it's a relative path, it is relative to the current working directory (process.cwd())
const directory = 'src';
const { file, config } = findBabelConfig.sync(directory);
// if file === null, the config wasn't found. (Also config === null)
if (file) {
    // file is the file in which the config is found
    console.log(file);
    // config is a JS plain object with the babel config
    console.log(config);
}
```

A second parameter can be given to `findBabelConfig`, it specifies the `depth` of search. By default, this value is `Infinity` but you can set the value you want: `findBabelConfig('src', 10)`.

## License

MIT, see [LICENSE.md](/LICENSE.md) for details.

[ci-image]: https://circleci.com/gh/tleunen/find-babel-config.svg?style=shield
[ci-url]: https://circleci.com/gh/tleunen/find-babel-config
[coverage-image]: https://codecov.io/gh/tleunen/find-babel-config/branch/master/graph/badge.svg
[coverage-url]: https://codecov.io/gh/tleunen/find-babel-config
[npm-version-image]: https://img.shields.io/npm/v/find-babel-config.svg
[npm-url]: https://www.npmjs.com/package/find-babel-config
