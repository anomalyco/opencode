# External tests for attachments.ts

**Arquivo:** `packages/app/src/components/prompt-input/attachments.ts`

## Checklist

- [ ] solid-js
- [ ] @solid-primitives/event-listener
- [ ] @/utils/toast
- [ ] @/context/prompt
- [ ] @/context/language
- [ ] @/utils/uuid
- [ ] ./editor-dom
- [ ] ./files
- [ ] ./paste

## solid-js

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @solid-primitives/event-listener

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/utils/toast

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/prompt

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

## @/utils/uuid

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## ./editor-dom

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## ./files

**Consultas usadas no Horsebox:** `attachmentMime`, `./files attachmentMime`, `files attachmentMime`

**Arquivos de teste encontrados:** 15

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/downloads.js

#### should have a link to amazing.txt

```ts
it('should have a link to amazing.txt', function(done){
      request(app)
      .get('/')
      .expect(/href="\/files\/amazing.txt"/, done)
    }
```

#### should have a download header

```ts
it('should have a download header', function (done) {
      request(app)
        .get('/files/notes/groceries.txt')
        .expect('Content-Disposition', 'attachment; filename="groceries.txt"')
        .expect(200, done)
    }
```

#### should have a download header

```ts
it('should have a download header', function(done){
      request(app)
      .get('/files/amazing.txt')
      .expect('Content-Disposition', 'attachment; filename="amazing.txt"')
      .expect(200, done)
    }
```

#### should respond with 404

```ts
it('should respond with 404', function(done){
      request(app)
      .get('/files/missing.txt')
      .expect(404, done)
    }
```

#### should respond with 403

```ts
it('should respond with 403', function (done) {
      request(app)
        .get('/files/../index.js')
        .expect(403, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.static.js

#### should serve static files

```ts
it('should serve static files', function (done) {
      request(this.app)
        .get('/todo.txt')
        .expect(200, '- groceries', done)
    }
```

#### should serve zero-length files

```ts
it('should serve zero-length files', function (done) {
      request(this.app)
        .get('/empty.txt')
        .expect(200, '', done)
    }
```

#### should ignore hidden files

```ts
it('should ignore hidden files', function (done) {
      request(this.app)
        .get('/.name')
        .expect(404, 'Not Found', done)
    }
```

#### should be served when dotfiles: "allow" is given

```ts
it('should be served when dotfiles: "allow" is given', function (done) {
      request(this.app)
        .get('/.name')
        .expect(200)
        .expect(utils.shouldHaveBody(Buffer.from('tobi')))
        .end(done)
    }
```

## ./paste

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

