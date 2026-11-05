# babel-plugin-module-resolver
[![Maintenance Status][status-image]][status-url] [![NPM version][npm-image]][npm-url] [![Build Status Linux][circleci-image]][circleci-url] [![Build Status Windows][appveyor-image]][appveyor-url] [![Coverage Status][coverage-image]][coverage-url]

A [Babel](http://babeljs.io) plugin to add a new resolver for your modules when compiling your code using Babel. This plugin allows you to add new "root" directories that contain your modules. It also allows you to setup a custom alias for directories, specific files, or even other npm modules.

## Description

This plugin can simplify the require/import paths in your project. For example, instead of using complex relative paths like `../../../../utils/my-utils`, you can write `utils/my-utils`. It will allow you to work faster since you won't need to calculate how many levels of directory you have to go up before accessing the file.

```js
// Use this:
import MyUtilFn from 'utils/MyUtilFn';
// Instead of that:
import MyUtilFn from '../../../../utils/MyUtilFn';

// And it also work with require calls
// Use this:
const MyUtilFn = require('utils/MyUtilFn');
// Instead of that:
const MyUtilFn = require('../../../../utils/MyUtilFn');
```

## Getting started

Install the plugin

```
npm install --save-dev babel-plugin-module-resolver
```
or
```
yarn add --dev babel-plugin-module-resolver
```

Specify the plugin in your `.babelrc` with the custom root or alias. Here's an example:
```json
{
  "plugins": [
    ["module-resolver", {
      "root": ["./src"],
      "alias": {
        "test": "./test",
        "underscore": "lodash"
      }
    }]
  ]
}
```

**.babelrc.js version**
Specify the plugin in your `.babelrc.js` file with the custom root or alias. Here's an example:
```

const plugins = [
  [
    require.resolve('babel-plugin-module-resolver'),
    {
      root: ["./src/"],
      alias: {
        "test": "./test"
      }
    }

  ]

];

```
Good example: // https://gist.github.com/nodkz/41e189ff22325a27fe6a5ca81df2cb91


## Documentation

babel-plugin-module-resolver can be configured and controlled easily, check the [documentation](DOCS.md) for more details

Are you a plugin author (e.g. IDE integration)? We have [documented the exposed functions](DOCS.md#for-plugin-authors) for use in your plugins!

## ESLint plugin

If you're using ESLint, you should use [eslint-plugin-import][eslint-plugin-import], and [eslint-import-resolver-babel-module][eslint-import-resolver-babel-module] to remove falsy unresolved modules. If you want to have warnings when aliased modules are being imported by their relative paths, you can use [eslint-plugin-module-resolver](https://github.com/HeroProtagonist/eslint-plugin-module-resolver).

## Editors autocompletion

- Atom: Uses [atom-autocomplete-modules][atom-autocomplete-modules] and enable the `babel-plugin-module-resolver` option.
- VS Code: Configure the [path mapping](https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping) in `jsconfig.json` (`tsconfig.json` for TypeScript), e.g.:

```js
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "*": ["src/*"],
      "test/*": ["test/*"],
      "underscore": ["lodash"]
    }
  }
}
```

- IntelliJ/WebStorm: You can mark your module directories as "resources root" e.g if you have `../../../utils/MyUtilFn` you can mark
  `../../../utils` as "resources root". This has the problem that your alias also has to be named `utils`. The second option is to add
  a `webpack.config.js` to your project and use it under File->Settings->Languages&Frameworks->JavaScript->Webpack. This will trick webstorm
  into resolving the paths and you can use any alias you want e.g.:

```js
var path = require('path');

module.exports = {
  resolve: {
    extensions: ['.js', '.json', '.vue'],
    alias: {
      utils: path.resolve(__dirname, '../../../utils/MyUtilFn'),
    },
  },
};
```


## License

MIT, see [LICENSE.md](/LICENSE.md) for details.

## Who is using babel-plugin-module-resolver ?

- Algolia: [InstantSearch.js](https://github.com/algolia/instantsearch.js)
- Airbnb: [Lottie React Native](https://github.com/airbnb/lottie-react-native)
- AppDirect
- Callstack: [React Native Paper](https://github.com/callstack/react-native-paper)
- Codility
- Eleme: [Element](https://github.com/ElemeFE/element)
- Expo: [Expo SDK](https://github.com/expo/expo/tree/master/packages/babel-preset-expo)
- FormidableLabs: [Victory Native](https://github.com/FormidableLabs/victory-native)
- OpenCollective: [OpenCollective](https://github.com/opencollective/frontend)
- React Community: [React Native Maps](https://github.com/react-community/react-native-maps)
- Uber: [Seer](https://github.com/uber-web/Seer), [react-vis](https://github.com/uber/react-vis)
- Quasar Framework: [Quasar](https://github.com/quasarframework/quasar)
- Vuetify.js [Vuetify](https://github.com/vuetifyjs/vuetify)
- Zeit: [Next.js](https://github.com/zeit/next.js)
- Zenika: [Immutadot](https://github.com/Zenika/immutadot)

Are you also using it? Send a PR!

[status-image]: https://img.shields.io/badge/status-maintained-brightgreen.svg
[status-url]: https://github.com/tleunen/babel-plugin-module-resolver

[npm-image]: https://img.shields.io/npm/v/babel-plugin-module-resolver.svg
[npm-url]: https://www.npmjs.com/package/babel-plugin-module-resolver

[circleci-image]: https://img.shields.io/circleci/project/tleunen/babel-plugin-module-resolver/master.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSItMTQyLjUgLTE0Mi41IDI4NSAyODUiPjxjaXJjbGUgcj0iMTQxLjciIGZpbGw9IiNERDQ4MTQiLz48ZyBpZD0iYSIgZmlsbD0iI0ZGRiI%2BPGNpcmNsZSBjeD0iLTk2LjQiIHI9IjE4LjkiLz48cGF0aCBkPSJNLTQ1LjYgNjguNGMtMTYuNi0xMS0yOS0yOC0zNC00Ny44IDYtNSA5LjgtMTIuMyA5LjgtMjAuNnMtMy44LTE1LjctOS44LTIwLjZjNS0xOS44IDE3LjQtMzYuNyAzNC00Ny44bDEzLjggMjMuMkMtNDYtMzUuMi01NS4zLTE4LjctNTUuMyAwYzAgMTguNyA5LjMgMzUuMiAyMy41IDQ1LjJ6Ii8%2BPC9nPjx1c2UgeGxpbms6aHJlZj0iI2EiIHRyYW5zZm9ybT0icm90YXRlKDEyMCkiLz48dXNlIHhsaW5rOmhyZWY9IiNhIiB0cmFuc2Zvcm09InJvdGF0ZSgyNDApIi8%2BPC9zdmc%2B
[circleci-url]: https://circleci.com/gh/tleunen/babel-plugin-module-resolver

[appveyor-image]: https://img.shields.io/appveyor/ci/tleunen/babel-plugin-module-resolver/master.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48ZyBmaWxsPSIjMUJBMUUyIiB0cmFuc2Zvcm09InNjYWxlKDgpIj48cGF0aCBkPSJNMCAyLjI2NWw2LjUzOS0uODg4LjAwMyA2LjI4OC02LjUzNi4wMzd6Ii8%2BPHBhdGggZD0iTTYuNTM2IDguMzlsLjAwNSA2LjI5My02LjUzNi0uODk2di01LjQ0eiIvPjxwYXRoIGQ9Ik03LjMyOCAxLjI2MWw4LjY3LTEuMjYxdjcuNTg1bC04LjY3LjA2OXoiLz48cGF0aCBkPSJNMTYgOC40NDlsLS4wMDIgNy41NTEtOC42Ny0xLjIyLS4wMTItNi4zNDV6Ii8%2BPC9nPjwvc3ZnPg==
[appveyor-url]: https://ci.appveyor.com/project/tleunen/babel-plugin-module-resolver

[coverage-image]: https://codecov.io/gh/tleunen/babel-plugin-module-resolver/branch/master/graph/badge.svg
[coverage-url]: https://codecov.io/gh/tleunen/babel-plugin-module-resolver

[eslint-import-resolver-babel-module]: https://github.com/tleunen/eslint-import-resolver-babel-module
[eslint-plugin-import]: https://github.com/benmosher/eslint-plugin-import
[atom-autocomplete-modules]: https://github.com/nkt/atom-autocomplete-modules
