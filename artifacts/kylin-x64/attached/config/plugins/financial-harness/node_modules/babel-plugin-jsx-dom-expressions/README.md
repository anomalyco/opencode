# Babel Plugin JSX DOM Expressions

[![Build Status](https://github.com/ryansolid/dom-expressions/workflows/DOMExpressions%20CI/badge.svg)](https://github.com/ryansolid/dom-expressions/actions/workflows/main-ci.yml)
[![NPM Version](https://img.shields.io/npm/v/babel-plugin-jsx-dom-expressions.svg?style=flat)](https://www.npmjs.com/package/babel-plugin-jsx-dom-expressions)
![](https://img.shields.io/npm/dt/babel-plugin-jsx-dom-expressions.svg?style=flat)
[![Gitter](https://img.shields.io/gitter/room/dom-expressions/community)](https://gitter.im/dom-expressions/community)

This package is a JSX compiler built for [DOM Expressions](https://github.com/ryansolid/dom-expressions) to provide a general JSX to DOM transformation for reactive libraries that do fine grained change detection. This package aims to convert JSX statements to native DOM statements and wrap JSX expressions with functions that can be implemented with the library of your choice. Sort of like a JSX to Hyperscript for fine change detection.

## Features

This plugin treats all lowercase tags as html elements and mixed cased tags as Custom Functions. This enables breaking up your view into components. This library supports Web Component Custom Elements spec. Support for common camelcase event handlers like React, dom safe attributes like class and for, a simple ref property, and parsing of objects for style, and classList properties.

In general JSX Attribute Expressions are treated as attributes by default, with exception custom elements that will to properties and special fields like `class` and `style`. Plain string attributes will be treated as attributes.

This library uses a heuristic whether to dynamic wrap expressions based on if they contain function calls or property access. Simple literals and variable expressions won't be wrapped. If you ever want to ensure it is not wrapped you can start the expression with `/*@once*/` comment.

## Example

```jsx
const view = ({ item }) => {
  const itemId = item.id;
  return <tr class={itemId === selected() ? "danger" : ""}>
    <td class="col-md-1">{itemId}</td>
    <td class="col-md-4">
      <a onclick={e => select(item, e)}>{item.label}</a>
    </td>
    <td class="col-md-1">
      <a onclick={e => del(item, e)}>
        <span class="glyphicon glyphicon-remove" aria-hidden="true"></span>
      </a>
    </td>
    <td class="col-md-6"></td>
  </tr>;
};
```

Compiles to:

```jsx
import { template as _$template } from "dom";
import { delegateEvents as _$delegateEvents } from "dom";
import { className as _$className } from "dom";
import { effect as _$effect } from "dom";
import { insert as _$insert } from "dom";

const _tmpl$ = /*#__PURE__*/_$template(`<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`, 16);
const view = ({
  item
}) => {
  const itemId = item.id;
  return (() => {
    const _el$ = _tmpl$.cloneNode(true),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.nextSibling,
      _el$4 = _el$3.firstChild,
      _el$5 = _el$3.nextSibling,
      _el$6 = _el$5.firstChild;
    _$insert(_el$2, itemId);
    _el$4.$$click = e => select(item, e);
    _$insert(_el$4, () => item.label);
    _el$6.$$click = e => del(item, e);
    _$effect(() => _$className(_el$, itemId === selected() ? "danger" : ""));
    return _el$;
  })();
};
_$delegateEvents(["click"]);
```

The use of cloneNode improves repeat insert performance and precompilation reduces the number of references to the minimal traversal path. This is a basic example which doesn't leverage event delegation or any of the more advanced features described below.

## Example Implementations

- [Solid](https://github.com/ryansolid/solid): A declarative JavaScript library for building user interfaces.
- [ko-jsx](https://github.com/ryansolid/ko-jsx): Knockout JS with JSX rendering.
- [mobx-jsx](https://github.com/ryansolid/mobx-jsx): Ever wondered how much more performant MobX is without React? A lot.

## Plugin Options

### moduleName

- Type: `string`
- Required: Yes

The name of the runtime module to import the methods from.

### generate

- Type: `'dom' | 'ssr'`
- Default: `'dom'`

The output mode of the compiler. Can be "dom"(default), "ssr". "dom" is standard output. "ssr" is for server side rendering of strings.

### hydratable

- Type: `boolean`
- Default: `false`

Indicate whether the output should contain hydratable markers.

### delegateEvents

- Type: `boolean`
- Default: `true`

Boolean to indicate whether to enable automatic event delegation on camelCase.

### wrapConditionals

- Type: `boolean`
- Default: `true`

Boolean indicates whether smart conditional detection should be used. This optimizes simple boolean expressions and ternaries in JSX.

### contextToCustomElements

- Type: `boolean`
- Default: `false`

Boolean indicates whether to set current render context on Custom Elements and slots. Useful for seemless Context API with Web Components.

### builtIns

- Type: `boolean`
- Default: `string[]`

Array of Component exports from module, that aren't included by default with the library. This plugin will automatically import them if it comes across them in the JSX.

### effectWrapper

- Type: `string`
- Default: `effect`

This plugin leverages a heuristic for reactive wrapping and lazy evaluation of JSX expressions. This option indicates the reactive wrapper function name (`effect`), defaults to `effect`.

### staticMarker

- Type: `string`
- Default: `@once`

Comment decorator string indicates the static expression, used to tell the compiler not to wrap them by `effect` function, defaults to `@once`.

### memoWrapper

- Type: `string`
- Default: `memo`

Memos let you efficiently use a derived value in many reactive computations. This option indicates the memo function name, defaults to `memo`.

### validate

- Type: `boolean`
- Default: `true`

Checks for properly formed HTML by checking for elements that would not be allowed in certain parent elements. This validation isn't complete but includes places where browser would "correct" it and break the DOM walks.

### omitNestedClosingTags

- Type: `boolean`
- Default: `false`

Removes unnecessary closing tags from the template output. This may not work in all browser-like environments the same. The solution has been tested again Chrome/Edge/Firefox/Safari.

### omitLastClosingTag

- Type: `boolean`
- Default: `true`

Removes tags from the template output if they have no closing parents and are the last element. This may not work in all browser-like environments the same. The solution has been tested again Chrome/Edge/Firefox/Safari.

### omitQuotes

- Type: `boolean`
- Default: `true`

Removes quotes for html attributes when possible from the template output. This may not work in all browser-like environments the same. The solution has been tested again Chrome/Edge/Firefox/Safari.

### requireImportSource

- Type: `string | false`
- Default: `false`

When set to a string value, this option restricts JSX transformation to only files that contain a specific JSX import source pragma comment. The plugin will only transform JSX in files that include a comment with `@jsxImportSource` followed by the specified value. If the comment is missing or specifies a different import source, the transformation is skipped for that file.

Example usage:
```jsx
// In babel configuration:
{
  plugins: [
    ["jsx-dom-expressions", {
      requireImportSource: "r-dom"
    }]
  ]
}

// In your component file:
/** @jsxImportSource r-dom */
const template = <div>Hello</div>;
```

### inlineStyles

- Type: `boolean`
- Default: `true`

Style attributes in templates are inlined when possible: value is a string, `Record<string, string>`, etc. Inlining styles may not be desired when using strong CSP configurations. Disabling `inlineStyles` will cause all of the style definitions to be set at runtime.

## Special Binding

### ref

This binding will assign the variable you pass to it with the DOM element or if a function will call it with the element.

```jsx
const Child = props => <div ref={props.ref} />;

const Parent = () => {
  let ref;
  return <Child ref={ref} />;
};
```

### on(eventName)

These will be treated as event handlers expecting a function. The compiler will delegate events where possible (Events that bubble or can be composed) else it will fall back to Level 1 spec "on_____" events.

If you wish to make it into a Bound Event, you can bind a value to your delegated event by passing an array handler instead and the second argument will be passed to your event handler as the first argument (the event will be second).

```jsx
function handler(itemId, e) {/*...*/}

<ul>
  {list().map(item => (
    <li onClick={[handler, item.id]} />
  ))}
</ul>
```

This delegation solution works with Web Components and the Shadow DOM as well if the events are composed. That limits the list to custom events and most UA UI events like onClick, onKeyUp, onKeyDown, onDblClick, onInput, onMouseDown, onMouseUp, etc..
Important:

- To allow for casing to work all custom events should follow the all lowercase convention of native events. If you want to use different event convention (or use Level 3 Events "addEventListener") use the "on" binding.

- Event delegates aren't cleaned up automatically off Document. If you will be completely unmounting the library and wish to remove the handlers from the current page use `clearDelegatedEvents`.

### on:/oncapture:

To bypass event delegation and use normal Level 3 "addEventListener" events.

```jsx
<div on:Weird-Event={e => alert(e.detail)} />
```

To use capture event:
```jsx
<div oncapture:Weird-Event={e => alert(e.detail)} />
```

### classList

This takes an object and assigns all the keys as classes which are truthy.

```jsx
<div classList={{ selected: isSelected(), editing: isEditing() }} />
```

### ... (spreads)

Spreads let you pass multiple props at once:

```jsx
<div {...props} />
```

Keep in mind given the independent nature of binding updates there is no guarantee of order using spreads at this time. It's under consideration.

## Components

Components are just Capital Cased tags. Instead of wrapping with computation dynamic props will just be getter accessors. \* Remember property access triggers so don't destructure outside of computations unless you intend the content to be static.

```jsx
const MyComp = props => {
  const staticProp = props.other;
  return (
    <>
      <div>{props.param}</div>
      <div>{staticProp}</div>
    </>
  );
};

<MyComp param={dynamic()} other={static} />;
```

Components may have children. This is available as props.children. It may be a node, a function, or a string, or an array of the aforementioned. Non-expression children like DOM nodes are set to evaluate lazily (upon access by default).

## Fragments

This plugin also supports JSX Fragments with `<></>` notation. These will be compiled to arrays. The fragment syntax provides the convenience of being able to use the template syntax to wrap expressions.

## Acknowledgements

The concept of using JSX to DOM instead of html strings and context based binding usually found in these libraries was inspired greatly by [Surplus](https://github.com/adamhaile/surplus).
