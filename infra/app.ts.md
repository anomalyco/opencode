# External tests for app.ts

**Arquivo:** `infra/app.ts`

## Checklist

- [ ] ./stage

## ./stage

**Consultas usadas no Horsebox:** `domain`, `./stage domain`, `stage domain`

**Arquivos de teste encontrados:** 6

### ../../.sbomtest/repos/f3c62de455-express/test/res.location.js

#### should not touch already-encoded sequences in "url"

```ts
it('should not touch already-encoded sequences in "url"', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com?q=%A710',
        'https://google.com?q=%A710',
        'google.com',
        done
      );
    }
```

#### should consistently handle relative urls

```ts
it('should consistently handle relative urls', function (done) {
      var app = createRedirectServerForDomain(null);
      testRequestedRedirect(
        app,
        '/foo/bar',
        '/foo/bar',
        null,
        done
      );
    }
```

#### should not encode urls in such a way that they can bypass redirect allow lists

```ts
it('should not encode urls in such a way that they can bypass redirect allow lists', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com',
        'http://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should not be case sensitive

```ts
it('should not be case sensitive', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'HTTP://google.com\\@apple.com',
        'HTTP://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should work with https

```ts
it('should work with https', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com\\@apple.com',
        'https://google.com\\@apple.com',
        'google.com',
        done
      );
    }
```

#### should correctly encode schemaless paths

```ts
it('should correctly encode schemaless paths', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        '//google.com\\@apple.com/',
        '//google.com\\@apple.com/',
        'google.com',
        done
      );
    }
```

#### should keep backslashes in the path

```ts
it('should keep backslashes in the path', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com/foo\\bar\\baz',
        'https://google.com/foo\\bar\\baz',
        'google.com',
        done
      );
    }
```

#### should escape header splitting for old node versions

```ts
it('should escape header splitting for old node versions', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com/%0d%0afoo:%20bar',
        'http://google.com\\@apple.com/%0d%0afoo:%20bar',
        'google.com',
        done
      );
    }
```

#### should encode unicode correctly

```ts
it('should encode unicode correctly', function (done) {
      var app = createRedirectServerForDomain(null);
      testRequestedRedirect(
        app,
        '/%e2%98%83',
        '/%e2%98%83',
        null,
        done
      );
    }
```

#### should encode unicode correctly even with a bad host

```ts
it('should encode unicode correctly even with a bad host', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'http://google.com\\@apple.com/%e2%98%83',
        'http://google.com\\@apple.com/%e2%98%83',
        'google.com',
        done
      );
    }
```

#### should work correctly despite using deprecated url.parse

```ts
it('should work correctly despite using deprecated url.parse', function (done) {
      var app = createRedirectServerForDomain('google.com');
      testRequestedRedirect(
        app,
        'https://google.com\'.bb.com/1.html',
        'https://google.com\'.bb.com/1.html',
        'google.com',
        done
      );
    }
```

#### should encode file uri path

```ts
it('should encode file uri path', function (done) {
      var app = createRedirectServerForDomain('');
      testRequestedRedirect(
        app,
        'file:///etc\\passwd',
        'file:///etc\\passwd',
        '',
        done
      );
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.subdomains.js

#### should return an array

```ts
it('should return an array', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', 'tobi.ferrets.example.com')
        .expect(200, ['ferrets', 'tobi'], done);
      }
```

#### should work with IPv4 address

```ts
it('should work with IPv4 address', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', '127.0.0.1')
        .expect(200, [], done);
      }
```

#### should work with IPv6 address

```ts
it('should work with IPv6 address', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', '[::1]')
        .expect(200, [], done);
      }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
        var app = express();

        app.use(function(req, res){
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('Host', 'example.com')
        .expect(200, [], done);
      }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
        var app = express();

        app.use(function(req, res){
          req.headers.host = null;
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .expect(200, [], done);
      }
```

#### should return an array

```ts
it('should return an array', function (done) {
        var app = express();

        app.set('trust proxy', true);
        app.use(function (req, res) {
          res.send(req.subdomains);
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Host', 'tobi.ferrets.example.com')
        .expect(200, ['ferrets', 'tobi'], done);
      }
```

#### should return an array with the whole domain

```ts
it('should return an array with the whole domain', function(done){
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'tobi.ferrets.sub.example.com')
          .expect(200, ['com', 'example', 'sub', 'ferrets', 'tobi'], done);
        }
```

#### should return an array with the whole IPv4

```ts
it('should return an array with the whole IPv4', function (done) {
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', '127.0.0.1')
          .expect(200, ['127.0.0.1'], done);
        }
```

#### should return an array with the whole IPv6

```ts
it('should return an array with the whole IPv6', function (done) {
          var app = express();
          app.set('subdomain offset', 0);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', '[::1]')
          .expect(200, ['[::1]'], done);
        }
```

#### should return an array

```ts
it('should return an array', function(done){
          var app = express();
          app.set('subdomain offset', 3);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'tobi.ferrets.sub.example.com')
          .expect(200, ['ferrets', 'tobi'], done);
        }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
          var app = express();
          app.set('subdomain offset', 3);

          app.use(function(req, res){
            res.send(req.subdomains);
          });

          request(app)
          .get('/')
          .set('Host', 'sub.example.com')
          .expect(200, [], done);
        }
```

