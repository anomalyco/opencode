# External tests for dialog-server-v2.tsx

**Arquivo:** `packages/app/src/components/settings-v2/dialog-server-v2.tsx`

## Checklist

- [ ] @opencode-ai/ui/v2/button-v2
- [ ] @opencode-ai/ui/v2/dialog-v2
- [ ] @opencode-ai/ui/v2/text-input-v2
- [ ] @opencode-ai/ui/context/dialog
- [ ] solid-js
- [ ] @/context/language
- [ ] @/context/server
- [ ] ../dialog-select-server

## @opencode-ai/ui/v2/button-v2

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/v2/dialog-v2

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/v2/text-input-v2

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/context/dialog

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## solid-js

**Consultas usadas no Horsebox:** `Component`, `solid-js Component`, `Show`, `solid-js Show`, `createEffect`, `solid-js createEffect`, `createSignal`, `solid-js createSignal`, `onCleanup`, `solid-js onCleanup`, `onMount`, `solid-js onMount`

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

## @/context/server

**Consultas usadas no Horsebox:** `ServerConnection`, `@/context/server ServerConnection`, `/context/server ServerConnection`, `server ServerConnection`

**Arquivos de teste encontrados:** 35

### ../../.sbomtest/repos/f3c62de455-express/test/app.listen.js

#### should wrap with an HTTP server

```ts
it('should wrap with an HTTP server', function(done){
    var app = express();

    var server = app.listen(0, function () {
      server.close(done)
    });
  }
```

#### should callback on HTTP server errors

```ts
it('should callback on HTTP server errors', function (done) {
    var app1 = express()
    var app2 = express()

    var server1 = app1.listen(0, function (err) {
      assert(!err)
      app2.listen(server1.address().port, function (err) {
        assert(err.code === 'EADDRINUSE')
        server1.close()
        done()
      })
    })
  }
```

#### accepts port + hostname + backlog + callback

```ts
it('accepts port + hostname + backlog + callback', function (done) {
    const app = express();
    const server = app.listen(0, '127.0.0.1', 5, function () {
      const { address, port } = server.address();
      assert.strictEqual(address, '127.0.0.1');
      assert(Number.isInteger(port) && port > 0);
      // backlog isn’t directly inspectable, but if no error was thrown
      // we know it was accepted.
      server.close(done);
    });
  }
```

#### accepts just a callback (no args)

```ts
it('accepts just a callback (no args)', function (done) {
    const app = express();
    // same as app.listen(0, done)
    const server = app.listen();
    server.close(done);
  }
```

#### server.address() gives a { address, port, family } object

```ts
it('server.address() gives a { address, port, family } object', function (done) {
    const app = express();
    const server = app.listen(0, () => {
      const addr = server.address();
      assert(addr && typeof addr === 'object');
      assert.strictEqual(typeof addr.address, 'string');
      assert(Number.isInteger(addr.port) && addr.port > 0);
      assert(typeof addr.family === 'string');
      server.close(done);
    });
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.ip.js

#### should return the remote address

```ts
it('should return the remote address', function(done){
          var app = express();

          app.use(function(req, res, next){
            res.send(req.ip);
          });

          var test = request(app).get('/')
          test.set('X-Forwarded-For', 'client, p1, p2')
          test.expect(200, getExpectedClientAddress(test._server), done);
        }
```

#### should return the remote address

```ts
it('should return the remote address', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res, next){
          res.send(req.ip);
        });

        var test = request(app).get('/')
        test.expect(200, getExpectedClientAddress(test._server), done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

#### should not error if the client aborts

```ts
it('should not error if the client aborts', function (done) {
      var app = express();
      var cb = after(2, done)
      var error = null

      app.use(function (req, res) {
        setImmediate(function () {
          res.sendFile(path.resolve(fixtures, 'name.txt'));
          setTimeout(function () {
            cb(error)
          }, 10)
        })
        test.req.abort()
      });

      app.use(function (err, req, res, next) {
        error = err
        next(err)
      });

      var server = app.listen()
      var test = request(server).get('/')
      test.end(function (err) {
        assert.ok(err)
        server.close(cb)
      })
    }
```

#### should invoke the callback when client aborts

```ts
it('should invoke the callback when client aborts', function (done) {
      var cb = after(2, done)
      var app = express();

      app.use(function (req, res) {
        setImmediate(function () {
          res.sendFile(path.resolve(fixtures, 'name.txt'), function (err) {
            assert.ok(err)
            assert.strictEqual(err.code, 'ECONNABORTED')
            cb()
          });
        });
        test.req.abort()
      });

      var server = app.listen()
      var test = request(server).get('/')
      test.end(function (err) {
        assert.ok(err)
        server.close(cb)
      })
    }
```

#### should invoke the callback when client already aborted

```ts
it('should invoke the callback when client already aborted', function (done) {
      var cb = after(2, done)
      var app = express();

      app.use(function (req, res) {
        onFinished(res, function () {
          res.sendFile(path.resolve(fixtures, 'name.txt'), function (err) {
            assert.ok(err)
            assert.strictEqual(err.code, 'ECONNABORTED')
            cb()
          });
        });
        test.req.abort()
      });

      var server = app.listen()
      var test = request(server).get('/')
      test.end(function (err) {
        assert.ok(err)
        server.close(cb)
      })
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.text.js

#### should change default charset

```ts
it('should change default charset', function (done) {
      var server = createApp({ defaultCharset: 'koi8-r' })
      var test = request(server).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320cec5d4', 'hex'))
      test.expect(200, '"name is нет"', done)
    }
```

#### should honor content-type charset

```ts
it('should honor content-type charset', function (done) {
      var server = createApp({ defaultCharset: 'koi8-r' })
      var test = request(server).post('/')
      test.set('Content-Type', 'text/plain; charset=utf-8')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

## ../dialog-select-server

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

