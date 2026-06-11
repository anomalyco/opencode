# External tests for drag-overlay.tsx

**Arquivo:** `packages/app/src/components/prompt-input/drag-overlay.tsx`

## Checklist

- [ ] solid-js
- [ ] @opencode-ai/ui/icon

## solid-js

**Consultas usadas no Horsebox:** `Component`, `solid-js Component`, `Show`, `solid-js Show`

**Arquivos de teste encontrados:** 3

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### #2255 - Extend routes by making routes a function.

```ts
test('#2255 - Extend routes by making routes a function.', function(assert) {
    assert.expect(1);
    var RouterBase = Backbone.Router.extend({
      routes: function() {
        return {
          home: 'root',
          index: 'index.html'
        };
      }
    });

    var RouterExtended = RouterBase.extend({
      routes: function() {
        var _super = RouterExtended.__super__.routes;
        return _.extend(_super(), {show: 'show', search: 'search'});
      }
    });

    var myRouter = new RouterExtended();
    assert.deepEqual({home: 'root', index: 'index.html', show: 'show', search: 'search'}, myRouter.routes);
  }
```

## @opencode-ai/ui/icon

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

