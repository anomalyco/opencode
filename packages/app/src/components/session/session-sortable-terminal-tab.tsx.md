# External tests for session-sortable-terminal-tab.tsx

**Arquivo:** `packages/app/src/components/session/session-sortable-terminal-tab.tsx`

## Checklist

- [ ] solid-js
- [ ] solid-js/store
- [ ] @thisbeyond/solid-dnd
- [ ] @opencode-ai/ui/icon-button
- [ ] @opencode-ai/ui/tabs
- [ ] @opencode-ai/ui/dropdown-menu
- [ ] @opencode-ai/ui/icon
- [ ] @/context/terminal-title
- [ ] @/context/terminal
- [ ] @/context/language
- [ ] @/pages/session/helpers

## solid-js

**Consultas usadas no Horsebox:** `JSX`, `solid-js JSX`, `Show`, `solid-js Show`, `createEffect`, `solid-js createEffect`, `onCleanup`, `solid-js onCleanup`

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

## solid-js/store

**Consultas usadas no Horsebox:** `createStore`, `solid-js/store createStore`, `store createStore`

**Arquivos de teste encontrados:** 82

### ../../.sbomtest/repos/f3c62de455-express/test/express.raw.js

#### should persist store

```ts
it('should persist store', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/octet-stream')
        .send('the user is tobi')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .expect({ buf: '746865207573657220697320746f6269' })
        .end(done)
    }
```

#### should persist store when unmatched content-type

```ts
it('should persist store when unmatched content-type', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/fizzbuzz')
        .send('buzz')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

#### should persist store when inflated

```ts
it('should persist store when inflated', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200)
      test.expect('x-store-foo', 'bar')
      test.expect({ buf: '6e616d653de8aeba' })
      test.end(done)
    }
```

#### should persist store when inflate error

```ts
it('should persist store when inflate error', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad6080000', 'hex'))
      test.expect(400)
      test.expect('x-store-foo', 'bar')
      test.end(done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/octet-stream')
        .send('the user is ' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.text.js

#### should persist store

```ts
it('should persist store', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send('user is tobi')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .expect('"user is tobi"')
        .end(done)
    }
```

#### should persist store when unmatched content-type

```ts
it('should persist store when unmatched content-type', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/fizzbuzz')
        .send('buzz')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

#### should persist store when inflated

```ts
it('should persist store when inflated', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
      test.expect(200)
      test.expect('x-store-foo', 'bar')
      test.expect('"name is 论"')
      test.end(done)
    }
```

#### should persist store when inflate error

```ts
it('should persist store when inflate error', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b0000', 'hex'))
      test.expect(400)
      test.expect('x-store-foo', 'bar')
      test.end(done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send('user is ' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.json.js

#### should persist store

```ts
it('should persist store', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user":"tobi"}')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .expect('{"user":"tobi"}')
        .end(done)
    }
```

#### should persist store when unmatched content-type

```ts
it('should persist store when unmatched content-type', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/fizzbuzz')
        .send('buzz')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .expect('')
        .end(done)
    }
```

#### should persist store when inflated

```ts
it('should persist store when inflated', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
      test.expect(200)
      test.expect('x-store-foo', 'bar')
      test.expect('{"name":"论"}')
      test.end(done)
    }
```

#### should persist store when inflate error

```ts
it('should persist store when inflate error', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bab56cc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
      test.expect(400)
      test.expect('x-store-foo', 'bar')
      test.end(done)
    }
```

#### should persist store when parse error

```ts
it('should persist store when parse error', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user":')
        .expect(400)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user":"' + Buffer.alloc(1024 * 100, '.').toString() + '"}')
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.download.js

#### should persist store

```ts
it('should persist store', function (done) {
        var app = express()
        var cb = after(2, done)
        var store = { foo: 'bar' }

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage()
          req.asyncLocalStorage.run(store, next)
        })

        app.use(function (req, res) {
          res.download('test/fixtures/name.txt', function (err) {
            if (err) return cb(err)

            var local = req.asyncLocalStorage.getStore()

            assert.strictEqual(local.foo, 'bar')
            cb()
          })
        })

        request(app)
          .get('/')
          .expect('Content-Type', 'text/plain; charset=utf-8')
          .expect('Content-Disposition', 'attachment; filename="name.txt"')
          .expect(200, 'tobi', cb)
      }
```

#### should persist store on error

```ts
it('should persist store on error', function (done) {
        var app = express()
        var store = { foo: 'bar' }

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage()
          req.asyncLocalStorage.run(store, next)
        })

        app.use(function (req, res) {
          res.download('test/fixtures/does-not-exist', function (err) {
            var local = req.asyncLocalStorage.getStore()

            if (local) {
              res.setHeader('x-store-foo', String(local.foo))
            }

            res.send(err ? 'got ' + err.status + ' error' : 'no error')
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('x-store-foo', 'bar')
          .expect('got 404 error')
          .end(done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.urlencoded.js

#### should persist store

```ts
it('should persist store', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('user=tobi')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .expect('{"user":"tobi"}')
        .end(done)
    }
```

#### should persist store when unmatched content-type

```ts
it('should persist store when unmatched content-type', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/fizzbuzz')
        .send('buzz')
        .expect(200)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

#### should persist store when inflated

```ts
it('should persist store when inflated', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200)
      test.expect('x-store-foo', 'bar')
      test.expect('{"name":"论"}')
      test.end(done)
    }
```

#### should persist store when inflate error

```ts
it('should persist store when inflate error', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad6080000', 'hex'))
      test.expect(400)
      test.expect('x-store-foo', 'bar')
      test.end(done)
    }
```

#### should persist store when limit exceeded

```ts
it('should persist store when limit exceeded', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('user=' + Buffer.alloc(1024 * 100, '.').toString())
        .expect(413)
        .expect('x-store-foo', 'bar')
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

#### should persist store

```ts
it('should persist store', function (done) {
        var app = express()
        var cb = after(2, done)
        var store = { foo: 'bar' }

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage()
          req.asyncLocalStorage.run(store, next)
        })

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'name.txt'), function (err) {
            if (err) return cb(err)

            var local = req.asyncLocalStorage.getStore()

            assert.strictEqual(local.foo, 'bar')
            cb()
          })
        })

        request(app)
          .get('/')
          .expect('Content-Type', 'text/plain; charset=utf-8')
          .expect(200, 'tobi', cb)
      }
```

#### should persist store on error

```ts
it('should persist store on error', function (done) {
        var app = express()
        var store = { foo: 'bar' }

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage()
          req.asyncLocalStorage.run(store, next)
        })

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'does-not-exist'), function (err) {
            var local = req.asyncLocalStorage.getStore()

            if (local) {
              res.setHeader('x-store-foo', String(local.foo))
            }

            res.send(err ? 'got ' + err.status + ' error' : 'no error')
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('x-store-foo', 'bar')
          .expect('got 404 error')
          .end(done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should restore `_` only if `lodash` is the current `_` value

```ts
test('should restore `_` only if `lodash` is the current `_` value', function(assert) {
      assert.expect(2);

      if (!isModularize) {
        var object = root._ = {};
        assert.strictEqual(_.noConflict(), oldDash);
        assert.strictEqual(root._, object);
        root._ = oldDash;
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

## @thisbeyond/solid-dnd

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/icon-button

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/tabs

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/dropdown-menu

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/icon

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/terminal-title

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/terminal

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/language

**Consultas usadas no Horsebox:** `useLanguage`, `@/context/language useLanguage`, `/context/language useLanguage`, `language useLanguage`

**Arquivos de teste encontrados:** 13

### ../../.sbomtest/repos/f3c62de455-express/test/req.acceptsLanguages.js

#### should return language if accepted

```ts
it('should return language if accepted', function (done) {
      var app = express();

      app.get('/', function (req, res) {
        res.send({
          'en-us': req.acceptsLanguages('en-us'),
          en: req.acceptsLanguages('en')
        })
      })

      request(app)
        .get('/')
        .set('Accept-Language', 'en;q=.5, en-us')
        .expect(200, { 'en-us': 'en-us', en: 'en' }, done)
    }
```

#### should be false if language not accepted

```ts
it('should be false if language not accepted', function(done){
      var app = express();

      app.get('/', function (req, res) {
        res.send({
          es: req.acceptsLanguages('es')
        })
      })

      request(app)
        .get('/')
        .set('Accept-Language', 'en;q=.5, en-us')
        .expect(200, { es: false }, done)
    }
```

#### should always return language

```ts
it('should always return language', function (done) {
        var app = express();

        app.get('/', function (req, res) {
          res.send({
            en: req.acceptsLanguages('en'),
            es: req.acceptsLanguages('es'),
            jp: req.acceptsLanguages('jp')
          })
        })

        request(app)
          .get('/')
          .expect(200, { en: 'en', es: 'es', jp: 'jp' }, done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.vary.js

#### should set the values

```ts
it('should set the values', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.vary(['Accept', 'Accept-Language', 'Accept-Encoding']);
        res.end();
      });

      request(app)
      .get('/')
      .expect('Vary', 'Accept, Accept-Language, Accept-Encoding')
      .expect(200, done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.set.js

#### should set multiple response header fields

```ts
it('should set multiple response header fields', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Set-Cookie', ["type=ninja", "language=javascript"]);
        res.send(res.get('Set-Cookie'));
      });

      request(app)
      .get('/')
      .expect('["type=ninja","language=javascript"]', done);
    }
```

## @/pages/session/helpers

**Consultas usadas no Horsebox:** `focusTerminalById`, `@/pages/session/helpers focusTerminalById`, `/pages/session/helpers focusTerminalById`, `helpers focusTerminalById`

**Arquivos de teste encontrados:** 2

Horsebox encontrou arquivos candidatos, mas nenhum bloco `test()` / `it()` relevante foi extraído.

