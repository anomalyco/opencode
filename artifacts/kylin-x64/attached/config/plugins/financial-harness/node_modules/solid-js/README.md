<p>
  <img src="https://assets.solidjs.com/banner?project=Library&type=core" alt="SolidJS" />
</p>

[![Build Status](https://img.shields.io/github/actions/workflow/status/solidjs/solid/main-ci.yml?branch=main&logo=github&style=for-the-badge)](https://github.com/solidjs/solid/actions/workflows/main-ci.yml)
[![Coverage Status](https://img.shields.io/coveralls/github/solidjs/solid.svg?style=for-the-badge)](https://coveralls.io/github/solidjs/solid?branch=main)

[![NPM Version](https://img.shields.io/npm/v/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![](https://img.shields.io/npm/dm/solid-js.svg?style=for-the-badge)](https://www.npmjs.com/package/solid-js)
[![Discord](https://img.shields.io/discord/722131463138705510?style=for-the-badge)](https://discord.com/invite/solidjs)
[![Subreddit subscribers](https://img.shields.io/reddit/subreddit-subscribers/solidjs?style=for-the-badge)](https://www.reddit.com/r/solidjs/)

**[Website](https://www.solidjs.com/) • [API Docs](https://docs.solidjs.com/) • [Features Tutorial](https://www.solidjs.com/tutorial/introduction_basics) • [Playground](https://playground.solidjs.com/?version=1.3.13#NobwRAdghgtgpmAXGGUCWEwBowBcCeADgsrgM4Ae2YZA9gK4BOAxiWGjIbY7gAQi9GcCABM4jXgF9eAM0a0YvADo1aAGzQiAtACsyAegDucAEYqA3EogcuPfr2ZCouOAGU0Ac2hqps+YpU6DW09CysrGXoIZlw0WgheAGEGCBdGAAoASn4rXgd4sj5gZhTcLF4yOFxkqNwAXV4AXgcnF3cvKDV0gAZMywT8iELeDEc4eFSm3iymgD4KqprU9JLamYBqXgBGPvCBoVwmBPTcvN4AHhN6XFx43gJiRpUrm-iVXnjEjWYAa0aQUZCCa4SSzU5nfirZaZSTgi76F63CBgga7CCwiBWISicTpGaNebnJZpXj6WblES0Zj0YEAOg8VQAompxsJcAAhfAASREJzAUEIhBUmTRYEkdSAA) • [Discord](https://discord.com/invite/solidjs)**

Solid is a declarative JavaScript library for creating user interfaces. Instead of using a Virtual DOM, it compiles its templates to real DOM nodes and updates them with fine-grained reactions. Declare your state and use it throughout your app, and when a piece of state changes, only the code that depends on it will rerun. Check out our [intro video](https://www.youtube.com/watch?v=cELFZQAMdhQ) or read on!

## Key Features

- Fine-grained updates to the real DOM
- Declarative data: model your state as a system with reactive primitives
- Render-once mental model: your components are regular JavaScript functions that run once to set up your view
- Automatic dependency tracking: accessing your reactive state subscribes to it
- [Small](https://dev.to/this-is-learning/javascript-framework-todomvc-size-comparison-504f) and [fast](https://krausest.github.io/js-framework-benchmark/current.html)
- Simple: learn a few powerful concepts that can be reused, combined, and built on top of
- Provides modern framework features like JSX, fragments, Context, Portals, Suspense, streaming SSR, progressive hydration, Error Boundaries and concurrent rendering.
- Naturally debuggable: A `<div>` is a real div, so you can use your browser's devtools to inspect the rendering
- [Web component friendly](https://github.com/solidjs/solid/tree/main/packages/solid-element#readme) and can author custom elements
- Isomorphic: render your components on the client and the server
- Universal: write [custom renderers](https://github.com/solidjs/solid/releases/tag/v1.2.0) to use Solid anywhere
- A growing community and ecosystem with active core team support

<details>

<summary>Quick Start</summary>

You can get started with a simple app by running the following in your terminal:

```sh
> npx degit solidjs/templates/js my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

Or for TypeScript:

```sh
> npx degit solidjs/templates/ts my-app
> cd my-app
> npm i # or yarn or pnpm
> npm run dev # or yarn or pnpm
```

This will create a minimal, client-rendered application powered by [Vite](https://vitejs.dev/).

Or you can install the dependencies in your own setup. To use Solid with JSX (_recommended_), run:

```sh
> npm i -D babel-preset-solid
> npm i solid-js
```

The easiest way to get set up is to add `babel-preset-solid` to your `.babelrc`, babel config for webpack, or rollup configuration:

```js
"presets": ["solid"]
```

For TypeScript to work, remember to set your `.tsconfig` to handle Solid's JSX:

```js
"compilerOptions": {
  "jsx": "preserve",
  "jsxImportSource": "solid-js",
}
```

</details>

## Why Solid?

### Performant

Meticulously engineered for performance and with half a decade of research behind it, Solid's performance is almost indistinguishable from optimized vanilla JavaScript (See Solid on the [JS Framework Benchmark](https://krausest.github.io/js-framework-benchmark/current.html)). Solid is [small](https://bundlephobia.com/package/solid-js@1.3.15) and completely tree-shakable, and [fast](https://levelup.gitconnected.com/how-we-wrote-the-fastest-javascript-ui-framework-again-db097ddd99b6) when rendering on the server, too. Whether you're writing a fully client-rendered SPA or a server-rendered app, your users see it faster than ever. ([Read more about Solid's performance](https://dev.to/ryansolid/thinking-granular-how-is-solidjs-so-performant-4g37) from the library's creator.)

### Powerful

Solid is fully-featured with everything you can expect from a modern framework. Performant state management is built-in with Context and Stores: you don't have to reach for a third party library to manage global state (if you don't want to). With Resources, you can use data loaded from the server like any other piece of state and build a responsive UI for it thanks to Suspense and concurrent rendering. And when you're ready to move to the server, Solid has full SSR and serverless support, with streaming and progressive hydration to get to interactive as quickly as possible. (Check out our full [interactive features walkthrough](https://www.solidjs.com/tutorial/introduction_basics).)

### Pragmatic

Do more with less: use simple, composable primitives without hidden rules and gotchas. In Solid, components are just functions - rendering is determined purely by how your state is used - so you're free to organize your code how you like and you don't have to learn a new rendering system. Solid encourages patterns like declarative code and read-write segregation that help keep your project maintainable, but isn't opinionated enough to get in your way.

### Productive

Solid is built on established tools like JSX and TypeScript and integrates with the Vite ecosystem. Solid's bare-metal, minimal abstractions give you direct access to the DOM, making it easy to use your favorite native JavaScript libraries like D3. And the Solid ecosystem is growing fast, with [custom primitives](https://github.com/solidjs-community/solid-primitives), [component libraries](https://github.com/hope-ui/hope-ui), and build-time utilities that let you [write Solid code in new ways](https://github.com/LXSMNSYC/solid-labels).

<details>
<summary>Show Me!</summary>

```jsx
import { render } from "solid-js/web";
import { createSignal } from "solid-js";

// A component is just a function that (optionally) accepts properties and returns a DOM node
const Counter = props => {
  // Create a piece of reactive state, giving us a accessor, count(), and a setter, setCount()
  const [count, setCount] = createSignal(props.startingCount || 1);

  // The increment function calls the setter
  const increment = () => setCount(count() + 1);

  console.log(
    "The body of the function runs once, like you'd expect from calling any other function, so you only ever see this console log once."
  );

  // JSX allows us to write HTML within our JavaScript function and include dynamic expressions using the { } syntax
  // The only part of this that will ever rerender is the count() text.
  return (
    <button type="button" onClick={increment}>
      Increment {count()}
    </button>
  );
};

// The render function mounts a component onto your page
render(() => <Counter startingCount={2} />, document.getElementById("app"));
```

See it in action in our interactive [Playground](https://playground.solidjs.com/?hash=-894962706&version=1.3.13)!

Solid compiles our JSX down to efficient real DOM expressions updates, still using the same reactive primitives (`createSignal`) at runtime but making sure there's as little rerendering as possible. Here's what that looks like in this example:

```js
import { render, createComponent, delegateEvents, insert, template } from "solid-js/web";
import { createSignal } from "solid-js";

const _tmpl$ = /*#__PURE__*/ template(`<button type="button">Increment </button>`, 2);

const Counter = props => {
  const [count, setCount] = createSignal(props.startingCount || 1);
  const increment = () => setCount(count() + 1);

  console.log("The body of the function runs once . . .");

  return (() => {
    //_el$ is a real DOM node!
    const _el$ = _tmpl$.cloneNode(true);
    _el$.firstChild;

    _el$.$$click = increment;

    //This inserts the count as a child of the button in a way that allows count to update without rerendering the whole button
    insert(_el$, count, null);

    return _el$;
  })();
};

render(
  () =>
    createComponent(Counter, {
      startingCount: 2
    }),
  document.getElementById("app")
);

delegateEvents(["click"]);
```

</details>

## More

Check out our official [documentation](https://www.solidjs.com/guide) or browse some [examples](https://github.com/solidjs/solid/blob/main/documentation/resources/examples.md)

## Browser Support

SolidJS Core is committed to supporting the last 2 years of modern browsers including Firefox, Safari, Chrome and Edge (for desktop and mobile devices). We do not support IE or similar sunset browsers. For server environments, we support Node LTS and the latest Deno and Cloudflare Worker runtimes.

<img src="https://saucelabs.github.io/images/opensauce/powered-by-saucelabs-badge-gray.svg?sanitize=true" alt="Testing Powered By SauceLabs" width="300"/>

## Community

Come chat with us on [Discord](https://discord.com/invite/solidjs)! Solid's creator and the rest of the core team are active there, and we're always looking for contributions.

### Contributors

<a href="https://github.com/solidjs/solid/graphs/contributors"><img src="https://opencollective.com/solid/contributors.svg?width=890&amp;button=false" style="max-width:100%;"></a>

### Open Collective

Support us with a donation and help us continue our activities. [[Contribute](https://opencollective.com/solid)]

<a href="https://opencollective.com/solid/backer/0/website" target="_blank"><img src="https://opencollective.com/solid/backer/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/1/website" target="_blank"><img src="https://opencollective.com/solid/backer/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/2/website" target="_blank"><img src="https://opencollective.com/solid/backer/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/3/website" target="_blank"><img src="https://opencollective.com/solid/backer/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/4/website" target="_blank"><img src="https://opencollective.com/solid/backer/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/5/website" target="_blank"><img src="https://opencollective.com/solid/backer/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/6/website" target="_blank"><img src="https://opencollective.com/solid/backer/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/7/website" target="_blank"><img src="https://opencollective.com/solid/backer/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/8/website" target="_blank"><img src="https://opencollective.com/solid/backer/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/9/website" target="_blank"><img src="https://opencollective.com/solid/backer/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/backer/10/website" target="_blank"><img src="https://opencollective.com/solid/backer/10/avatar.svg"></a>

### Sponsors

Become a sponsor and get your logo on our README on GitHub with a link to your site. [[Become a sponsor](https://opencollective.com/solid#sponsor)]

<a href="https://opencollective.com/solid/sponsor/0/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/0/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/1/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/1/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/2/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/2/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/3/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/3/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/4/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/4/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/5/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/5/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/6/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/6/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/7/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/7/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/8/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/8/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/9/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/9/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/10/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/10/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/11/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/11/avatar.svg"></a>
<a href="https://opencollective.com/solid/sponsor/12/website" target="_blank"><img src="https://opencollective.com/solid/sponsor/12/avatar.svg"></a>
