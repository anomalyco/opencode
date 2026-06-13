---
description: use whenever you are styling a ui with css
---

you are very good at writing clean maintainable css using modern techniques

css is structured like this

```css
[data-page="home"] {
  [data-component="header"] {
    [data-slot="logo"] {
    }
  }
}
```

top level pages are scoped using `data-page`

pages can break down into components using `data-component`

components can break down into slots using `data-slot`

structure things so that this hierarchy is followed IN YOUR CSS - you should rarely need to
nest components inside other components. you should NEVER nest components inside
slots. you should NEVER nest slots inside other slots.

**IMPORTANT: This hierarchy rule applies to CSS structure, NOT JSX/DOM structure.**

The hierarchy in css file does NOT have to match the hierarchy in the dom - you
can put components or slots at the same level in CSS even if one goes inside another in the DOM.

Your JSX can nest however makes semantic sense - components can be inside slots,
slots can contain components, etc. The DOM structure should be whatever makes the most
semantic and functional sense.

It is more important to follow the pages -> components -> slots structure IN YOUR CSS,
while keeping your JSX/DOM structure logical and semantic.

use data attributes to represent different states of the component

```css
[data-component="modal"] {
  opacity: 0;

  &[data-state="open"] {
    opacity: 1;
  }
}
```

this will allow jsx to control the styling

avoid selectors that just target an element type like `> span` you should assign
it a slot name. it's ok to do this sometimes where it makes sense semantically
like targeting `li` elements in a list

in terms of file structure `./src/style/` contains all universal styling rules.
these should not contain anything specific to a page

`./src/style/token` contains all the tokens used in the project

`./src/style/component` is for reusable components like buttons or inputs

page specific styles should go next to the page they are styling so
`./src/routes/about.tsx` should have its styles in `./src/routes/about.css`

`about.css` should be scoped using `data-page="about"`

## Example of correct implementation

JSX can nest however makes sense semantically:

```jsx
<div data-slot="left">
  <div data-component="title">Section Title</div>
  <div data-slot="content">Content here</div>
</div>
```

CSS maintains clean hierarchy regardless of DOM nesting:

```css
[data-page="home"] {
  [data-component="screenshots"] {
    [data-slot="left"] {
      /* styles */
    }
    [data-slot="content"] {
      /* styles */
    }
  }

  [data-component="title"] {
    /* can be at same level even though nested in DOM */
  }
}
```

## Reusable Components

If a component is reused across multiple sections of the same page, define it at the page level:

```jsx
<!-- Used in multiple places on the same page -->
<section data-component="install">
  <div data-component="method">
    <h3 data-component="title">npm</h3>
  </div>
  <div data-component="method">
    <h3 data-component="title">bun</h3>
  </div>
</section>

<section data-component="screenshots">
  <div data-slot="left">
    <div data-component="title">Screenshot Title</div>
  </div>
</section>
```

```css
[data-page="home"] {
  /* Reusable title component defined at page level since it's used in multiple components */
  [data-component="title"] {
    text-transform: uppercase;
    font-weight: 400;
  }

  [data-component="install"] {
    /* install-specific styles */
  }

  [data-component="screenshots"] {
    /* screenshots-specific styles */
  }
}
```

This is correct because the `title` component has consistent styling and behavior across the page.

## Key Clarifications

1. **JSX Nesting is Flexible**: Components can be nested inside slots, slots can contain components - whatever makes semantic sense
2. **CSS Hierarchy is Strict**: Follow pages → components → slots structure in CSS
3. **Reusable Components**: Define at the appropriate level where they're shared (page level if used across the page, component level if only used within that component)
4. **DOM vs CSS Structure**: These don't need to match - optimize each for its purpose

See ./src/routes/index.css and ./src/routes/index.tsx for a complete example.
