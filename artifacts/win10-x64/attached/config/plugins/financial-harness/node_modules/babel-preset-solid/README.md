# babel-preset-solid
Babel preset to transform JSX into Solid runtime calls.

### Install

Via NPM

```javascript
npm install babel-preset-solid --save-dev
```

or Yarn

```javascript
yarn add babel-preset-solid --dev
```

### Usage

Make or update your .babelrc config file with the preset:

```javascript
{
  "presets": [
    "solid"
  ]
}
```

Via package.json

```javascript
   ...
   "babel": {
     "presets": [
       "es2015",
       "solid"
     ],
     "plugins": [
     ]
   },
   ...
```

### Usage for SSR code
When need to transform JSX code to be used on the server, pass the following options

```javascript
{
  "presets": [
    ["solid", { "generate": "ssr", "hydratable": true }]
  ]
}
```
And for the browser build pass the hydratable option as well:
```javascript
{
  "presets": [
    ["solid", { "generate": "dom", "hydratable": true }]
  ]
}
```
