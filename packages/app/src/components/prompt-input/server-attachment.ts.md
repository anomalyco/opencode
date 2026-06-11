# External tests for server-attachment.ts

**Arquivo:** `packages/app/src/components/prompt-input/server-attachment.ts`

## Checklist

- [ ] @opencode-ai/core/util/path
- [ ] @opencode-ai/sdk/v2

## @opencode-ai/core/util/path

**Consultas usadas no Horsebox:** `getFilename`, `@opencode-ai/core/util/path getFilename`, `opencode-ai/core/util/path getFilename`, `path getFilename`

**Arquivos de teste encontrados:** 48

### ../../.sbomtest/repos/f3c62de455-express/test/req.path.js

#### should return the parsed pathname

```ts
it('should return the parsed pathname', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.path);
      });

      request(app)
      .get('/login?redirect=/post/1/comments')
      .expect('/login', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

#### should error missing path

```ts
it('should error missing path', function (done) {
      var app = createApp();

      request(app)
      .get('/')
      .expect(500, /path.*required/, done);
    }
```

#### should error for non-string path

```ts
it('should error for non-string path', function (done) {
      var app = createApp(42)

      request(app)
      .get('/')
      .expect(500, /TypeError: path must be a string to res.sendFile/, done)
    }
```

#### should error for non-absolute path

```ts
it('should error for non-absolute path', function (done) {
      var app = createApp('name.txt')

      request(app)
        .get('/')
        .expect(500, /TypeError: path must be absolute/, done)
    }
```

#### should transfer a file

```ts
it('should transfer a file', function (done) {
      var app = createApp(path.resolve(fixtures, 'name.txt'));

      request(app)
      .get('/')
      .expect(200, 'tobi', done);
    }
```

#### should transfer a file with special characters in string

```ts
it('should transfer a file with special characters in string', function (done) {
      var app = createApp(path.resolve(fixtures, '% of dogs.txt'));

      request(app)
      .get('/')
      .expect(200, '20%', done);
    }
```

#### should include ETag

```ts
it('should include ETag', function (done) {
      var app = createApp(path.resolve(fixtures, 'name.txt'));

      request(app)
      .get('/')
      .expect('ETag', /^(?:W\/)?"[^"]+"$/)
      .expect(200, 'tobi', done);
    });

    it('should 304 when ETag matches', function (done) {
      var app = createApp(path.resolve(fixtures, 'name.txt'));

      request(app)
      .get('/')
      .expect('ETag', /^(?:W\/)?"[^"]+"$/)
      .expect(200, 'tobi', function (err, res) {
        if (err) return done(err);
        var etag = res.headers.etag;
        request(app)
        .get('/')
        .set('If-None-Match', etag)
        .expect(304, done);
      });
    }
```

#### should disable the ETag function if requested

```ts
it('should disable the ETag function if requested', function (done) {
      var app = createApp(path.resolve(fixtures, 'name.txt')).disable('etag');

      request(app)
      .get('/')
      .expect(handleHeaders)
      .expect(200, done);

      function handleHeaders (res) {
        assert(res.headers.etag === undefined);
      }
    }
```

#### should 404 for directory

```ts
it('should 404 for directory', function (done) {
      var app = createApp(path.resolve(fixtures, 'blog'));

      request(app)
      .get('/')
      .expect(404, done);
    }
```

#### should 404 when not found

```ts
it('should 404 when not found', function (done) {
      var app = createApp(path.resolve(fixtures, 'does-no-exist'));

      app.use(function (req, res) {
        res.statusCode = 200;
        res.send('no!');
      });

      request(app)
      .get('/')
      .expect(404, done);
    }
```

#### should send cache-control by default

```ts
it('should send cache-control by default', function (done) {
      var app = createApp(path.resolve(__dirname, 'fixtures/name.txt'))

      request(app)
        .get('/')
        .expect('Cache-Control', 'public, max-age=0')
        .expect(200, done)
    }
```

#### should not serve dotfiles by default

```ts
it('should not serve dotfiles by default', function (done) {
      var app = createApp(path.resolve(__dirname, 'fixtures/.name'))

      request(app)
        .get('/')
        .expect(404, done)
    }
```

#### should not override manual content-types

```ts
it('should not override manual content-types', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.contentType('application/x-bogus');
        res.sendFile(path.resolve(fixtures, 'name.txt'));
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/x-bogus')
      .end(done);
    }
```

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

#### should invoke the callback when complete

```ts
it('should invoke the callback when complete', function (done) {
      var cb = after(2, done);
      var app = createApp(path.resolve(fixtures, 'name.txt'), cb);

      request(app)
      .get('/')
      .expect(200, cb);
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

#### should invoke the callback without error when HEAD

```ts
it('should invoke the callback without error when HEAD', function (done) {
      var app = express();
      var cb = after(2, done);

      app.use(function (req, res) {
        res.sendFile(path.resolve(fixtures, 'name.txt'), cb);
      });

      request(app)
      .head('/')
      .expect(200, cb);
    }
```

#### should invoke the callback on 404

```ts
it('should invoke the callback on 404', function(done){
      var app = express();

      app.use(function (req, res) {
        res.sendFile(path.resolve(fixtures, 'does-not-exist'), function (err) {
          res.send(err ? 'got ' + err.status + ' error' : 'no error')
        });
      });

      request(app)
        .get('/')
        .expect(200, 'got 404 error', done)
    }
```

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

#### should pass options to send module

```ts
it('should pass options to send module', function (done) {
      request(createApp(path.resolve(fixtures, 'name.txt'), { start: 0, end: 1 }))
      .get('/')
      .expect(200, 'to', done)
    }
```

#### should advertise byte range accepted

```ts
it('should advertise byte range accepted', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'nums.txt'), {
              acceptRanges: true
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Accept-Ranges', 'bytes')
            .expect('123456789')
            .end(done)
        }
```

#### should respond to range request

```ts
it('should respond to range request', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'nums.txt'), {
              acceptRanges: true
            })
          })

          request(app)
            .get('/')
            .set('Range', 'bytes=0-4')
            .expect(206, '12345', done)
        }
```

#### should not advertise accept-ranges

```ts
it('should not advertise accept-ranges', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'nums.txt'), {
              acceptRanges: false
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Accept-Ranges'))
            .end(done)
        }
```

#### should not honor range requests

```ts
it('should not honor range requests', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'nums.txt'), {
              acceptRanges: false
            })
          })

          request(app)
            .get('/')
            .set('Range', 'bytes=0-4')
            .expect(200, '123456789', done)
        }
```

#### should send cache-control header

```ts
it('should send cache-control header', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              cacheControl: true
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=0')
            .end(done)
        }
```

#### should not send cache-control header

```ts
it('should not send cache-control header', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              cacheControl: false
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Cache-Control'))
            .end(done)
        }
```

#### should allow dotfiles

```ts
it('should allow dotfiles', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, '.name'), {
              dotfiles: 'allow'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldHaveBody(Buffer.from('tobi')))
            .end(done)
        }
```

#### should deny dotfiles

```ts
it('should deny dotfiles', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, '.name'), {
              dotfiles: 'deny'
            })
          })

          request(app)
            .get('/')
            .expect(403)
            .expect(/Forbidden/)
            .end(done)
        }
```

#### should ignore dotfiles

```ts
it('should ignore dotfiles', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, '.name'), {
              dotfiles: 'ignore'
            })
          })

          request(app)
            .get('/')
            .expect(404)
            .expect(/Not Found/)
            .end(done)
        }
```

#### should set headers on response

```ts
it('should set headers on response', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            headers: {
              'X-Foo': 'Bar',
              'X-Bar': 'Foo'
            }
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('X-Foo', 'Bar')
          .expect('X-Bar', 'Foo')
          .end(done)
      }
```

#### should use last header when duplicated

```ts
it('should use last header when duplicated', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            headers: {
              'X-Foo': 'Bar',
              'x-foo': 'bar'
            }
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('X-Foo', 'bar')
          .end(done)
      }
```

#### should override Content-Type

```ts
it('should override Content-Type', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            headers: {
              'Content-Type': 'text/x-custom'
            }
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Content-Type', 'text/x-custom')
          .end(done)
      }
```

#### should not set headers on 404

```ts
it('should not set headers on 404', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'does-not-exist'), {
            headers: {
              'X-Foo': 'Bar'
            }
          })
        })

        request(app)
          .get('/')
          .expect(404)
          .expect(utils.shouldNotHaveHeader('X-Foo'))
          .end(done)
      }
```

#### should send cache-control header with immutable

```ts
it('should send cache-control header with immutable', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              immutable: true
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=0, immutable')
            .end(done)
        }
```

#### should not send cache-control header with immutable

```ts
it('should not send cache-control header with immutable', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              immutable: false
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=0')
            .end(done)
        }
```

#### should send last-modified header

```ts
it('should send last-modified header', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: true
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldHaveHeader('Last-Modified'))
            .end(done)
        }
```

#### should conditionally respond with if-modified-since

```ts
it('should conditionally respond with if-modified-since', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: true
            })
          })

          request(app)
            .get('/')
            .set('If-Modified-Since', (new Date(Date.now() + 99999).toUTCString()))
            .expect(304, done)
        }
```

#### should not have last-modified header

```ts
it('should not have last-modified header', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: false
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Last-Modified'))
            .end(done)
        }
```

#### should not honor if-modified-since

```ts
it('should not honor if-modified-since', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              lastModified: false
            })
          })

          request(app)
            .get('/')
            .set('If-Modified-Since', (new Date(Date.now() + 99999).toUTCString()))
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Last-Modified'))
            .end(done)
        }
```

#### should set cache-control max-age to milliseconds

```ts
it('should set cache-control max-age to milliseconds', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            maxAge: 20000
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Cache-Control', 'public, max-age=20')
          .end(done)
      }
```

#### should cap cache-control max-age to 1 year

```ts
it('should cap cache-control max-age to 1 year', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            maxAge: 99999999999
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Cache-Control', 'public, max-age=31536000')
          .end(done)
      }
```

#### should min cache-control max-age to 0

```ts
it('should min cache-control max-age to 0', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            maxAge: -20000
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Cache-Control', 'public, max-age=0')
          .end(done)
      }
```

#### should floor cache-control max-age

```ts
it('should floor cache-control max-age', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, 'user.html'), {
            maxAge: 21911.23
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Cache-Control', 'public, max-age=21')
          .end(done)
      }
```

#### should not send cache-control

```ts
it('should not send cache-control', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              cacheControl: false,
              maxAge: 20000
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect(utils.shouldNotHaveHeader('Cache-Control'))
            .end(done)
        }
```

#### should accept plain number as milliseconds

```ts
it('should accept plain number as milliseconds', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              maxAge: '20000'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=20')
            .end(done)
        }
```

#### should accept suffix "s" for seconds

```ts
it('should accept suffix "s" for seconds', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              maxAge: '20s'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=20')
            .end(done)
        }
```

#### should accept suffix "m" for minutes

```ts
it('should accept suffix "m" for minutes', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              maxAge: '20m'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=1200')
            .end(done)
        }
```

#### should accept suffix "d" for days

```ts
it('should accept suffix "d" for days', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, 'user.html'), {
              maxAge: '20d'
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Cache-Control', 'public, max-age=1728000')
            .end(done)
        }
```

#### should allow relative path

```ts
it('should allow relative path', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile('name.txt', {
            root: fixtures
          })
        })

        request(app)
          .get('/')
          .expect(200, 'tobi', done)
      }
```

#### should reject up outside root

```ts
it('should reject up outside root', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile('..' + path.sep + path.relative(path.dirname(fixtures), path.join(fixtures, 'name.txt')), {
            root: fixtures
          })
        })

        request(app)
          .get('/')
          .expect(403, done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.render.js

#### should support absolute paths

```ts
it('should support absolute paths', function(done){
      var app = createApp();

      app.locals.user = { name: 'tobi' };

      app.use(function(req, res){
        res.render(path.join(__dirname, 'fixtures', 'user.tmpl'))
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should support absolute paths with "view engine"

```ts
it('should support absolute paths with "view engine"', function(done){
      var app = createApp();

      app.locals.user = { name: 'tobi' };
      app.set('view engine', 'tmpl');

      app.use(function(req, res){
        res.render(path.join(__dirname, 'fixtures', 'user'))
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should error without "view engine" set and file extension to a non-engine module

```ts
it('should error without "view engine" set and file extension to a non-engine module', function (done) {
      var app = createApp()

      app.locals.user = { name: 'tobi' }

      app.use(function (req, res) {
        res.render(path.join(__dirname, 'fixtures', 'broken.send'))
      })

      request(app)
      .get('/')
      .expect(500, /does not provide a view engine/, done)
    }
```

#### should error without "view engine" set and no file extension

```ts
it('should error without "view engine" set and no file extension', function (done) {
      var app = createApp();

      app.locals.user = { name: 'tobi' };

      app.use(function(req, res){
        res.render(path.join(__dirname, 'fixtures', 'user'))
      });

      request(app)
      .get('/')
      .expect(500, /No default engine was specified/, done);
    }
```

#### should expose app.locals

```ts
it('should expose app.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };

      app.use(function(req, res){
        res.render('user.tmpl');
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should expose app.locals with `name` property

```ts
it('should expose app.locals with `name` property', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.name = 'tobi';

      app.use(function(req, res){
        res.render('name.tmpl');
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should support index.<engine>

```ts
it('should support index.<engine>', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.set('view engine', 'tmpl');

      app.use(function(req, res){
        res.render('blog/post');
      });

      request(app)
      .get('/')
      .expect('<h1>blog post</h1>', done);
    }
```

#### should next(err)

```ts
it('should next(err)', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures'))

        app.use(function(req, res){
          res.render('user.tmpl');
        });

        app.use(function(err, req, res, next){
          res.status(500).send('got error: ' + err.name)
        });

        request(app)
        .get('/')
        .expect(500, 'got error: RenderError', done)
      }
```

#### should render the template

```ts
it('should render the template', function(done){
        var app = createApp();

        app.set('view engine', 'tmpl');
        app.set('views', path.join(__dirname, 'fixtures'))

        app.use(function(req, res){
          res.render('email');
        });

        request(app)
        .get('/')
        .expect('<p>This is an email</p>', done);
      }
```

#### should lookup the file in the path

```ts
it('should lookup the file in the path', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures', 'default_layout'))

        app.use(function(req, res){
          res.render('user.tmpl', { user: { name: 'tobi' } });
        });

        request(app)
        .get('/')
        .expect('<p>tobi</p>', done);
      }
```

#### should lookup the file in the path

```ts
it('should lookup the file in the path', function(done){
          var app = createApp();
          var views = [
            path.join(__dirname, 'fixtures', 'local_layout'),
            path.join(__dirname, 'fixtures', 'default_layout')
          ]

          app.set('views', views);

          app.use(function(req, res){
            res.render('user.tmpl', { user: { name: 'tobi' } });
          });

          request(app)
          .get('/')
          .expect('<span>tobi</span>', done);
        }
```

#### should lookup in later paths until found

```ts
it('should lookup in later paths until found', function(done){
          var app = createApp();
          var views = [
            path.join(__dirname, 'fixtures', 'local_layout'),
            path.join(__dirname, 'fixtures', 'default_layout')
          ]

          app.set('views', views);

          app.use(function(req, res){
            res.render('name.tmpl', { name: 'tobi' });
          });

          request(app)
          .get('/')
          .expect('<p>tobi</p>', done);
        }
```

#### should render the template

```ts
it('should render the template', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      var user = { name: 'tobi' };

      app.use(function(req, res){
        res.render('user.tmpl', { user: user });
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should expose res.locals

```ts
it('should expose res.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      app.use(function(req, res){
        res.locals.user = { name: 'tobi' };
        res.render('user.tmpl');
      });

      request(app)
      .get('/')
      .expect('<p>tobi</p>', done);
    }
```

#### should give precedence to res.locals over app.locals

```ts
it('should give precedence to res.locals over app.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };

      app.use(function(req, res){
        res.locals.user = { name: 'jane' };
        res.render('user.tmpl', {});
      });

      request(app)
      .get('/')
      .expect('<p>jane</p>', done);
    }
```

#### should give precedence to res.render() locals over res.locals

```ts
it('should give precedence to res.render() locals over res.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      var jane = { name: 'jane' };

      app.use(function(req, res){
        res.locals.user = { name: 'tobi' };
        res.render('user.tmpl', { user: jane });
      });

      request(app)
      .get('/')
      .expect('<p>jane</p>', done);
    }
```

#### should give precedence to res.render() locals over app.locals

```ts
it('should give precedence to res.render() locals over app.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };
      var jane = { name: 'jane' };

      app.use(function(req, res){
        res.render('user.tmpl', { user: jane });
      });

      request(app)
      .get('/')
      .expect('<p>jane</p>', done);
    }
```

#### should pass the resulting string

```ts
it('should pass the resulting string', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      app.use(function(req, res){
        var tobi = { name: 'tobi' };
        res.render('user.tmpl', { user: tobi }, function (err, html) {
          html = html.replace('tobi', 'loki');
          res.end(html);
        });
      });

      request(app)
      .get('/')
      .expect('<p>loki</p>', done);
    }
```

#### should pass the resulting string

```ts
it('should pass the resulting string', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      app.use(function(req, res){
        res.locals.user = { name: 'tobi' };
        res.render('user.tmpl', function (err, html) {
          html = html.replace('tobi', 'loki');
          res.end(html);
        });
      });

      request(app)
      .get('/')
      .expect('<p>loki</p>', done);
    }
```

#### should pass it to the callback

```ts
it('should pass it to the callback', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures'))

        app.use(function(req, res){
          res.render('user.tmpl', function (err) {
            if (err) {
              res.status(500).send('got error: ' + err.name)
            }
          });
        });

        request(app)
        .get('/')
        .expect(500, 'got error: RenderError', done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.render.js

#### should support absolute paths

```ts
it('should support absolute paths', function(done){
      var app = createApp();

      app.locals.user = { name: 'tobi' };

      app.render(path.join(__dirname, 'fixtures', 'user.tmpl'), function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should support absolute paths with "view engine"

```ts
it('should support absolute paths with "view engine"', function(done){
      var app = createApp();

      app.set('view engine', 'tmpl');
      app.locals.user = { name: 'tobi' };

      app.render(path.join(__dirname, 'fixtures', 'user'), function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should expose app.locals

```ts
it('should expose app.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };

      app.render('user.tmpl', function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should support index.<engine>

```ts
it('should support index.<engine>', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.set('view engine', 'tmpl');

      app.render('blog/post', function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<h1>blog post</h1>')
        done();
      })
    }
```

#### should handle render error throws

```ts
it('should handle render error throws', function(done){
      var app = express();

      function View(name, options){
        this.name = name;
        this.path = 'fale';
      }

      View.prototype.render = function(options, fn){
        throw new Error('err!');
      };

      app.set('view', View);

      app.render('something', function(err, str){
        assert.ok(err)
        assert.strictEqual(err.message, 'err!')
        done();
      })
    }
```

#### should provide a helpful error

```ts
it('should provide a helpful error', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures'))
        app.render('rawr.tmpl', function (err) {
          assert.ok(err)
          assert.equal(err.message, 'Failed to lookup view "rawr.tmpl" in views directory "' + path.join(__dirname, 'fixtures') + '"')
          done();
        });
      }
```

#### should invoke the callback

```ts
it('should invoke the callback', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures'))

        app.render('user.tmpl', function (err) {
          assert.ok(err)
          assert.equal(err.name, 'RenderError')
          done()
        })
      }
```

#### should render the template

```ts
it('should render the template', function(done){
        var app = createApp();

        app.set('views', path.join(__dirname, 'fixtures'))

        app.render('email.tmpl', function (err, str) {
          if (err) return done(err);
          assert.strictEqual(str, '<p>This is an email</p>')
          done();
        })
      }
```

#### should render the template

```ts
it('should render the template', function(done){
        var app = createApp();

        app.set('view engine', 'tmpl');
        app.set('views', path.join(__dirname, 'fixtures'))

        app.render('email', function(err, str){
          if (err) return done(err);
          assert.strictEqual(str, '<p>This is an email</p>')
          done();
        })
      }
```

#### should lookup the file in the path

```ts
it('should lookup the file in the path', function(done){
        var app = createApp();

        app.set('views',  path.join(__dirname, 'fixtures', 'default_layout'))
        app.locals.user = { name: 'tobi' };

        app.render('user.tmpl', function (err, str) {
          if (err) return done(err);
          assert.strictEqual(str, '<p>tobi</p>')
          done();
        })
      }
```

#### should lookup the file in the path

```ts
it('should lookup the file in the path', function(done){
          var app = createApp();
          var views = [
            path.join(__dirname, 'fixtures', 'local_layout'),
            path.join(__dirname, 'fixtures', 'default_layout')
          ]

          app.set('views', views);
          app.locals.user = { name: 'tobi' };

          app.render('user.tmpl', function (err, str) {
            if (err) return done(err);
            assert.strictEqual(str, '<span>tobi</span>')
            done();
          })
        }
```

#### should lookup in later paths until found

```ts
it('should lookup in later paths until found', function(done){
          var app = createApp();
          var views = [
            path.join(__dirname, 'fixtures', 'local_layout'),
            path.join(__dirname, 'fixtures', 'default_layout')
          ]

          app.set('views', views);
          app.locals.name = 'tobi';

          app.render('name.tmpl', function (err, str) {
            if (err) return done(err);
            assert.strictEqual(str, '<p>tobi</p>')
            done();
          })
        }
```

#### should error if file does not exist

```ts
it('should error if file does not exist', function(done){
          var app = createApp();
          var views = [
            path.join(__dirname, 'fixtures', 'local_layout'),
            path.join(__dirname, 'fixtures', 'default_layout')
          ]

          app.set('views', views);
          app.locals.name = 'tobi';

          app.render('pet.tmpl', function (err, str) {
            assert.ok(err)
            assert.equal(err.message, 'Failed to lookup view "pet.tmpl" in views directories "' + views[0] + '" or "' + views[1] + '"')
            done();
          })
        }
```

#### should create an instance of it

```ts
it('should create an instance of it', function(done){
        var app = express();

        function View(name, options){
          this.name = name;
          this.path = 'path is required by application.js as a signal of success even though it is not used there.';
        }

        View.prototype.render = function(options, fn){
          fn(null, 'abstract engine');
        };

        app.set('view', View);

        app.render('something', function(err, str){
          if (err) return done(err);
          assert.strictEqual(str, 'abstract engine')
          done();
        })
      }
```

#### should always lookup view without cache

```ts
it('should always lookup view without cache', function(done){
        var app = express();
        var count = 0;

        function View(name, options){
          this.name = name;
          this.path = 'fake';
          count++;
        }

        View.prototype.render = function(options, fn){
          fn(null, 'abstract engine');
        };

        app.set('view cache', false);
        app.set('view', View);

        app.render('something', function(err, str){
          if (err) return done(err);
          assert.strictEqual(count, 1)
          assert.strictEqual(str, 'abstract engine')
          app.render('something', function(err, str){
            if (err) return done(err);
            assert.strictEqual(count, 2)
            assert.strictEqual(str, 'abstract engine')
            done();
          })
        })
      }
```

#### should cache with "view cache" setting

```ts
it('should cache with "view cache" setting', function(done){
        var app = express();
        var count = 0;

        function View(name, options){
          this.name = name;
          this.path = 'fake';
          count++;
        }

        View.prototype.render = function(options, fn){
          fn(null, 'abstract engine');
        };

        app.set('view cache', true);
        app.set('view', View);

        app.render('something', function(err, str){
          if (err) return done(err);
          assert.strictEqual(count, 1)
          assert.strictEqual(str, 'abstract engine')
          app.render('something', function(err, str){
            if (err) return done(err);
            assert.strictEqual(count, 1)
            assert.strictEqual(str, 'abstract engine')
            done();
          })
        })
      }
```

#### should render the template

```ts
it('should render the template', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))

      var user = { name: 'tobi' };

      app.render('user.tmpl', { user: user }, function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should expose app.locals

```ts
it('should expose app.locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };

      app.render('user.tmpl', {}, function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should give precedence to app.render() locals

```ts
it('should give precedence to app.render() locals', function(done){
      var app = createApp();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' };
      var jane = { name: 'jane' };

      app.render('user.tmpl', { user: jane }, function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>jane</p>')
        done();
      })
    }
```

#### should accept null or undefined options

```ts
it('should accept null or undefined options', function (done) {
      var app = createApp()

      app.set('views', path.join(__dirname, 'fixtures'))
      app.locals.user = { name: 'tobi' }

      app.render('user.tmpl', null, function (err, str) {
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')

        app.render('user.tmpl', undefined, function (err2, str2) {
          if (err2) return done(err2);
          assert.strictEqual(str2, '<p>tobi</p>')
          done()
        })
      })
    }
```

#### should cache with cache option

```ts
it('should cache with cache option', function(done){
        var app = express();
        var count = 0;

        function View(name, options){
          this.name = name;
          this.path = 'fake';
          count++;
        }

        View.prototype.render = function(options, fn){
          fn(null, 'abstract engine');
        };

        app.set('view cache', false);
        app.set('view', View);

        app.render('something', {cache: true}, function(err, str){
          if (err) return done(err);
          assert.strictEqual(count, 1)
          assert.strictEqual(str, 'abstract engine')
          app.render('something', {cache: true}, function(err, str){
            if (err) return done(err);
            assert.strictEqual(count, 1)
            assert.strictEqual(str, 'abstract engine')
            done();
          })
        })
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.download.js

#### should allow relative path

```ts
it('should allow relative path', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('name.txt', {
            root: FIXTURES_PATH
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Content-Disposition', 'attachment; filename="name.txt"')
          .expect(utils.shouldHaveBody(Buffer.from('tobi')))
          .end(done)
      }
```

#### should allow up within root

```ts
it('should allow up within root', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('fake/../name.txt', {
            root: FIXTURES_PATH
          })
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Content-Disposition', 'attachment; filename="name.txt"')
          .expect(utils.shouldHaveBody(Buffer.from('tobi')))
          .end(done)
      }
```

#### should reject up outside root

```ts
it('should reject up outside root', function (done) {
        var app = express()

        app.use(function (req, res) {
          var p = '..' + path.sep +
            path.relative(path.dirname(FIXTURES_PATH), path.join(FIXTURES_PATH, 'name.txt'))

          res.download(p, {
            root: FIXTURES_PATH
          })
        })

        request(app)
          .get('/')
          .expect(403)
          .expect(utils.shouldNotHaveHeader('Content-Disposition'))
          .end(done)
      }
```

#### should reject reading outside root

```ts
it('should reject reading outside root', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('../name.txt', {
            root: FIXTURES_PATH
          })
        })

        request(app)
          .get('/')
          .expect(403)
          .expect(utils.shouldNotHaveHeader('Content-Disposition'))
          .end(done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.engine.js

#### should map a template engine

```ts
it('should map a template engine', function(done){
      var app = express();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.engine('.html', render);
      app.locals.user = { name: 'tobi' };

      app.render('user.html', function(err, str){
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should work without leading "."

```ts
it('should work without leading "."', function(done){
      var app = express();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.engine('html', render);
      app.locals.user = { name: 'tobi' };

      app.render('user.html', function(err, str){
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should work "view engine" setting

```ts
it('should work "view engine" setting', function(done){
      var app = express();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.engine('html', render);
      app.set('view engine', 'html');
      app.locals.user = { name: 'tobi' };

      app.render('user', function(err, str){
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

#### should work "view engine" with leading "."

```ts
it('should work "view engine" with leading "."', function(done){
      var app = express();

      app.set('views', path.join(__dirname, 'fixtures'))
      app.engine('.html', render);
      app.set('view engine', '.html');
      app.locals.user = { name: 'tobi' };

      app.render('user', function(err, str){
        if (err) return done(err);
        assert.strictEqual(str, '<p>tobi</p>')
        done();
      })
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.route.js

#### should be the executed Route

```ts
it('should be the executed Route', function(done){
      var app = express();

      app.get('/user/:id{/:op}', function(req, res, next){
        res.header('path-1', req.route.path)
        next();
      });

      app.get('/user/:id/edit', function(req, res){
        res.header('path-2', req.route.path)
        res.end();
      });

      request(app)
        .get('/user/12/edit')
        .expect('path-1', '/user/:id{/:op}')
        .expect('path-2', '/user/:id/edit')
        .expect(200, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.clearCookie.js

#### should set a cookie passed expiry

```ts
it('should set a cookie passed expiry', function(done){
      var app = express();

      app.use(function(req, res){
        res.clearCookie('sid').end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
      .expect(200, done)
    }
```

#### should set the given params

```ts
it('should set the given params', function(done){
      var app = express();

      app.use(function(req, res){
        res.clearCookie('sid', { path: '/admin' }).end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'sid=; Path=/admin; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
      .expect(200, done)
    }
```

#### should ignore maxAge

```ts
it('should ignore maxAge', function(done){
      var app = express();

      app.use(function(req, res){
        res.clearCookie('sid', { path: '/admin', maxAge: 1000 }).end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'sid=; Path=/admin; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
      .expect(200, done)
    }
```

#### should ignore user supplied expires param

```ts
it('should ignore user supplied expires param', function(done){
      var app = express();

      app.use(function(req, res){
        res.clearCookie('sid', { path: '/admin', expires: new Date() }).end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'sid=; Path=/admin; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
      .expect(200, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.cookie.js

#### should generate a JSON cookie

```ts
it('should generate a JSON cookie', function(done){
      var app = express();

      app.use(function(req, res){
        res.cookie('user', { name: 'tobi' }).end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'user=j%3A%7B%22name%22%3A%22tobi%22%7D; Path=/')
      .expect(200, done)
    }
```

#### should set a cookie

```ts
it('should set a cookie', function(done){
      var app = express();

      app.use(function(req, res){
        res.cookie('name', 'tobi').end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'name=tobi; Path=/')
      .expect(200, done)
    }
```

#### should allow multiple calls

```ts
it('should allow multiple calls', function(done){
      var app = express();

      app.use(function(req, res){
        res.cookie('name', 'tobi');
        res.cookie('age', 1);
        res.cookie('gender', '?');
        res.end();
      });

      request(app)
        .get('/')
        .expect('Set-Cookie', 'name=tobi; Path=/,age=1; Path=/,gender=%3F; Path=/')
        .expect(200, done)
    }
```

#### should set params

```ts
it('should set params', function(done){
      var app = express();

      app.use(function(req, res){
        res.cookie('name', 'tobi', { httpOnly: true, secure: true });
        res.end();
      });

      request(app)
      .get('/')
      .expect('Set-Cookie', 'name=tobi; Path=/; HttpOnly; Secure')
      .expect(200, done)
    }
```

#### should set partitioned

```ts
it('should set partitioned', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { partitioned: true });
          res.end();
        });

        request(app)
          .get('/')
          .expect('Set-Cookie', 'name=tobi; Path=/; Partitioned')
          .expect(200, done)
      }
```

#### should set relative expires

```ts
it('should set relative expires', function(done){
        var app = express();

        app.use(function(req, res){
          res.cookie('name', 'tobi', { maxAge: 1000 });
          res.end();
        });

        request(app)
          .get('/')
          .expect('Set-Cookie', /name=tobi; Max-Age=1; Path=\/; Expires=/)
          .expect(200, done)
      }
```

#### should not throw on null

```ts
it('should not throw on null', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { maxAge: null })
          res.end()
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Set-Cookie', 'name=tobi; Path=/')
          .end(done)
      }
```

#### should not throw on undefined

```ts
it('should not throw on undefined', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { maxAge: undefined })
          res.end()
        })

        request(app)
          .get('/')
          .expect(200)
          .expect('Set-Cookie', 'name=tobi; Path=/')
          .end(done)
      }
```

#### should generate a signed JSON cookie

```ts
it('should generate a signed JSON cookie', function(done){
        var app = express();

        app.use(cookieParser('foo bar baz'));

        app.use(function(req, res){
          res.cookie('user', { name: 'tobi' }, { signed: true }).end();
        });

        request(app)
          .get('/')
          .expect('Set-Cookie', 'user=s%3Aj%3A%7B%22name%22%3A%22tobi%22%7D.K20xcwmDS%2BPb1rsD95o5Jm5SqWs1KteqdnynnB7jkTE; Path=/')
          .expect(200, done)
      }
```

#### should set a signed cookie

```ts
it('should set a signed cookie', function(done){
        var app = express();

        app.use(cookieParser('foo bar baz'));

        app.use(function(req, res){
          res.cookie('name', 'tobi', { signed: true }).end();
        });

        request(app)
        .get('/')
        .expect('Set-Cookie', 'name=s%3Atobi.xJjV2iZ6EI7C8E5kzwbfA9PVLl1ZR07UTnuTgQQ4EnQ; Path=/')
        .expect(200, done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.js

#### should return the mounted path

```ts
it('should return the mounted path', function(){
    var admin = express();
    var app = express();
    var blog = express();
    var fallback = express();

    app.use('/blog', blog);
    app.use(fallback);
    blog.use('/admin', admin);

    assert.strictEqual(admin.mountpath, '/admin')
    assert.strictEqual(app.mountpath, '/')
    assert.strictEqual(blog.mountpath, '/blog')
    assert.strictEqual(fallback.mountpath, '/')
  }
```

#### should return the canonical

```ts
it('should return the canonical', function(){
    var app = express()
      , blog = express()
      , blogAdmin = express();

    app.use('/blog', blog);
    blog.use('/admin', blogAdmin);

    assert.strictEqual(app.path(), '')
    assert.strictEqual(blog.path(), '/blog')
    assert.strictEqual(blogAdmin.path(), '/blog/admin')
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### Decode named parameters, not splats.

```ts
test('Decode named parameters, not splats.', function(assert) {
    assert.expect(2);
    location.replace('http://example.com#decode/a%2Fb/c%2Fd/e');
    Backbone.history.checkUrl();
    assert.strictEqual(router.named, 'a/b');
    assert.strictEqual(router.path, 'c/d/e');
  }
```

#### #1185 - Use pathname when hashChange is not wanted.

```ts
test('#1185 - Use pathname when hashChange is not wanted.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    location.replace('http://example.com/path/name#hash');
    Backbone.history = _.extend(new Backbone.History, {location: location});
    Backbone.history.start({hashChange: false});
    var fragment = Backbone.history.getFragment();
    assert.strictEqual(fragment, location.pathname.replace(/^\//, ''));
  }
```

#### #1206 - Strip leading slash before location.assign.

```ts
test('#1206 - Strip leading slash before location.assign.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    location.replace('http://example.com/root/');
    Backbone.history = _.extend(new Backbone.History, {location: location});
    Backbone.history.start({hashChange: false, root: '/root/'});
    location.assign = function(pathname) {
      assert.strictEqual(pathname, '/root/fragment');
    };
    Backbone.history.navigate('/fragment');
  }
```

#### #2656 - No trailing slash on root.

```ts
test('#2656 - No trailing slash on root.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {
      location: location,
      history: {
        pushState: function(state, title, url) {
          assert.strictEqual(url, '/root');
        }
      }
    });
    location.replace('http://example.com/root/path');
    Backbone.history.start({pushState: true, hashChange: false, root: 'root'});
    Backbone.history.navigate('');
  }
```

#### #2656 - No trailing slash on root.

```ts
test('#2656 - No trailing slash on root.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {
      location: location,
      history: {
        pushState: function(state, title, url) {
          assert.strictEqual(url, '/');
        }
      }
    });
    location.replace('http://example.com/path');
    Backbone.history.start({pushState: true, hashChange: false});
    Backbone.history.navigate('');
  }
```

#### #2656 - No trailing slash on root.

```ts
test('#2656 - No trailing slash on root.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {
      location: location,
      history: {
        pushState: function(state, title, url) {
          assert.strictEqual(url, '/root?x=1');
        }
      }
    });
    location.replace('http://example.com/root/path');
    Backbone.history.start({pushState: true, hashChange: false, root: 'root'});
    Backbone.history.navigate('?x=1');
  }
```

#### #2765 - Fragment matching sans query/hash.

```ts
test('#2765 - Fragment matching sans query/hash.', function(assert) {
    assert.expect(2);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {
      location: location,
      history: {
        pushState: function(state, title, url) {
          assert.strictEqual(url, '/path?query#hash');
        }
      }
    });

    var MyRouter = Backbone.Router.extend({
      routes: {
        path: function() { assert.ok(true); }
      }
    });
    var myRouter = new MyRouter;

    location.replace('http://example.com/');
    Backbone.history.start({pushState: true, hashChange: false});
    Backbone.history.navigate('path?query#hash', true);
  }
```

#### Do not decode the search params.

```ts
test('Do not decode the search params.', function(assert) {
    assert.expect(1);
    var MyRouter = Backbone.Router.extend({
      routes: {
        path: function(params) {
          assert.strictEqual(params, 'x=y%3Fz');
        }
      }
    });
    var myRouter = new MyRouter;
    Backbone.history.navigate('path?x=y%3Fz', true);
  }
```

#### Navigate to a hash url.

```ts
test('Navigate to a hash url.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    Backbone.history.start({pushState: true});
    var MyRouter = Backbone.Router.extend({
      routes: {
        path: function(params) {
          assert.strictEqual(params, 'x=y');
        }
      }
    });
    var myRouter = new MyRouter;
    location.replace('http://example.com/path?x=y#hash');
    Backbone.history.checkUrl();
  }
```

#### #navigate to a hash url.

```ts
test('#navigate to a hash url.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    Backbone.history.start({pushState: true});
    var MyRouter = Backbone.Router.extend({
      routes: {
        path: function(params) {
          assert.strictEqual(params, 'x=y');
        }
      }
    });
    var myRouter = new MyRouter;
    Backbone.history.navigate('path?x=y#hash', true);
  }
```

#### unicode pathname

```ts
test('unicode pathname', function(assert) {
    assert.expect(1);
    location.replace('http://example.com/myyjä');
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var MyRouter = Backbone.Router.extend({
      routes: {
        myyjä: function() {
          assert.ok(true);
        }
      }
    });
    new MyRouter;
    Backbone.history.start({pushState: true});
  }
```

#### unicode pathname with % in a parameter

```ts
test('unicode pathname with % in a parameter', function(assert) {
    assert.expect(1);
    location.replace('http://example.com/myyjä/foo%20%25%3F%2f%40%25%20bar');
    location.pathname = '/myyj%C3%A4/foo%20%25%3F%2f%40%25%20bar';
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var MyRouter = Backbone.Router.extend({
      routes: {
        'myyjä/:query': function(query) {
          assert.strictEqual(query, 'foo %?/@% bar');
        }
      }
    });
    new MyRouter;
    Backbone.history.start({pushState: true});
  }
```

#### Paths that don\'t match the root should not match no root

```ts
test('Paths that don\'t match the root should not match no root', function(assert) {
    assert.expect(0);
    location.replace('http://example.com/foo');
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var MyRouter = Backbone.Router.extend({
      routes: {
        foo: function() {
          assert.ok(false, 'should not match unless root matches');
        }
      }
    });
    var myRouter = new MyRouter;
    Backbone.history.start({root: 'root', pushState: true});
  }
```

#### Paths that don\'t match the root should not match roots of the same length

```ts
test('Paths that don\'t match the root should not match roots of the same length', function(assert) {
    assert.expect(0);
    location.replace('http://example.com/xxxx/foo');
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var MyRouter = Backbone.Router.extend({
      routes: {
        foo: function() {
          assert.ok(false, 'should not match unless root matches');
        }
      }
    });
    var myRouter = new MyRouter;
    Backbone.history.start({root: 'root', pushState: true});
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.static.js

#### should require root path

```ts
it('should require root path', function () {
      assert.throws(express.static.bind(), /root path required/)
    }
```

#### should require root path to be string

```ts
it('should require root path to be string', function () {
      assert.throws(express.static.bind(null, 42), /root path.*string/)
    }
```

#### should support urlencoded pathnames

```ts
it('should support urlencoded pathnames', function (done) {
      request(this.app)
        .get('/%25%20of%20dogs.txt')
        .expect(200, '20%', done)
    }
```

#### should be served with "."

```ts
it('should be served with "."', function (done) {
      var dest = relative.split(path.sep).join('/')
      request(this.app)
        .get('/' + dest + '/todo.txt')
        .expect(200, '- groceries', done)
    }
```

#### should not allow root path disclosure

```ts
it('should not allow root path disclosure', function (done) {
      request(this.app)
        .get('/users/../../fixtures/todo.txt')
        .expect(403, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.use.js

#### should strip path from req.url

```ts
it('should strip path from req.url', function (done) {
      var app = express();

      app.use('/foo', function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url);
      });

      request(app)
      .get('/foo/bar')
      .expect(200, 'saw GET /bar', done);
    }
```

#### should invoke middleware for all requests starting with path

```ts
it('should invoke middleware for all requests starting with path', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use('/foo', function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url);
      });

      request(app)
      .get('/')
      .expect(404, cb);

      request(app)
      .post('/foo')
      .expect(200, 'saw POST /', cb);

      request(app)
      .post('/foo/bar')
      .expect(200, 'saw POST /bar', cb);
    }
```

#### should work if path has trailing slash

```ts
it('should work if path has trailing slash', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use('/foo/', function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url);
      });

      request(app)
      .get('/')
      .expect(404, cb);

      request(app)
      .post('/foo')
      .expect(200, 'saw POST /', cb);

      request(app)
      .post('/foo/bar')
      .expect(200, 'saw POST /bar', cb);
    }
```

#### should support array of paths

```ts
it('should support array of paths', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(['/foo/', '/bar'], function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url + ' through ' + req.originalUrl);
      });

      request(app)
      .get('/')
      .expect(404, cb);

      request(app)
      .get('/foo')
      .expect(200, 'saw GET / through /foo', cb);

      request(app)
      .get('/bar')
      .expect(200, 'saw GET / through /bar', cb);
    }
```

#### should support array of paths with middleware array

```ts
it('should support array of paths with middleware array', function (done) {
      var app = express();
      var cb = after(2, done);

      function fn1(req, res, next) {
        res.setHeader('x-fn-1', 'hit');
        next();
      }

      function fn2(req, res, next) {
        res.setHeader('x-fn-2', 'hit');
        next();
      }

      function fn3(req, res, next) {
        res.setHeader('x-fn-3', 'hit');
        res.send('saw ' + req.method + ' ' + req.url + ' through ' + req.originalUrl);
      }

      app.use(['/foo/', '/bar'], [[fn1], fn2], [fn3]);

      request(app)
      .get('/foo')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, 'saw GET / through /foo', cb);

      request(app)
      .get('/bar')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, 'saw GET / through /bar', cb);
    }
```

#### should support regexp path

```ts
it('should support regexp path', function (done) {
      var app = express();
      var cb = after(4, done);

      app.use(/^\/[a-z]oo/, function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url + ' through ' + req.originalUrl);
      });

      request(app)
      .get('/')
      .expect(404, cb);

      request(app)
      .get('/foo')
      .expect(200, 'saw GET / through /foo', cb);

      request(app)
      .get('/zoo/bear')
      .expect(200, 'saw GET /bear through /zoo/bear', cb);

      request(app)
      .get('/get/zoo')
      .expect(404, cb);
    }
```

#### should support empty string path

```ts
it('should support empty string path', function (done) {
      var app = express();

      app.use('', function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url + ' through ' + req.originalUrl);
      });

      request(app)
      .get('/')
      .expect(200, 'saw GET / through /', done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should support loading ' + basename + ' with the Require.js "shim" configuration option

```ts
test('should support loading ' + basename + ' with the Require.js "shim" configuration option', function(assert) {
      assert.expect(1);

      if (amd && lodashStable.includes(ui.loaderPath, 'requirejs')) {
        assert.strictEqual((shimmedModule || {}).moduleName, 'shimmed');
      } else {
        skipAssert(assert);
      }
    }
```

#### should avoid non-native built-ins

```ts
test('should avoid non-native built-ins', function(assert) {
      assert.expect(6);

      function message(lodashMethod, nativeMethod) {
        return '`' + lodashMethod + '` should avoid overwritten native `' + nativeMethod + '`';
      }

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var object = { 'a': 1 },
          otherObject = { 'b': 2 },
          largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(object));

      if (lodashBizarro) {
        try {
          var actual = lodashBizarro.create(Foo.prototype);
        } catch (e) {
          actual = null;
        }
        var label = message('_.create', 'Object.create');
        assert.ok(actual instanceof Foo, label);

        try {
          actual = [
            lodashBizarro.difference([object, otherObject], largeArray),
            lodashBizarro.intersection(largeArray, [object]),
            lodashBizarro.uniq(largeArray)
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.difference`, `_.intersection`, and `_.uniq', 'Map');
        assert.deepEqual(actual, [[otherObject], [object], [object]], label);

        try {
          if (Symbol) {
            object[symbol] = {};
          }
          actual = [
            lodashBizarro.clone(object),
            lodashBizarro.cloneDeep(object)
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.clone` and `_.cloneDeep', 'Object.getOwnPropertySymbols');
        assert.deepEqual(actual, [object, object], label);

        try {
          // Avoid buggy symbol detection in Babel's `_typeof` helper.
          var symObject = setProperty(Object(symbol), 'constructor', Object);
          actual = [
            Symbol ? lodashBizarro.clone(symObject) : {},
            Symbol ? lodashBizarro.isEqual(symObject, Object(symbol)) : false,
            Symbol ? lodashBizarro.toString(symObject) : ''
          ];
        } catch (e) {
          actual = null;
        }
        label = message('_.clone`, `_.isEqual`, and `_.toString', 'Symbol');
        assert.deepEqual(actual, [{}, false, ''], label);

        try {
          var map = new lodashBizarro.memoize.Cache;
          actual = map.set('a', 1).get('a');
        } catch (e) {
          actual = null;
        }
        label = message('_.memoize.Cache', 'Map');
        assert.deepEqual(actual, 1, label);

        try {
          map = new (Map || Object);
          if (Symbol && Symbol.iterator) {
            map[Symbol.iterator] = null;
          }
          actual = lodashBizarro.toArray(map);
        } catch (e) {
          actual = null;
        }
        label = message('_.toArray', 'Map');
        assert.deepEqual(actual, [], label);
      }
      else {
        skipAssert(assert, 6);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('isIndex');

  (function() {
    var func = _._isIndex;

    QUnit.test('should return `true` for indexes', function(assert) {
      assert.expect(1);

      if (func) {
        var values = [[0], ['0'], ['1'], [3, 4], [MAX_SAFE_INTEGER - 1]],
            expected = lodashStable.map(values, stubTrue);

        var actual = lodashStable.map(values, function(args) {
          return func.apply(undefined, args);
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return `false` for non-indexes', function(assert) {
      assert.expect(1);

      if (func) {
        var values = [['1abc'], ['07'], ['0001'], [-1], [3, 3], [1.1], [MAX_SAFE_INTEGER]],
            expected = lodashStable.map(values, stubFalse);

        var actual = lodashStable.map(values, function(args) {
          return func.apply(undefined, args);
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('isIterateeCall');

  (function() {
    var array = [1],
        func = _._isIterateeCall,
        object =  { 'a': 1 };

    QUnit.test('should return `true` for iteratee calls', function(assert) {
      assert.expect(3);

      function Foo() {}
      Foo.prototype.a = 1;

      if (func) {
        assert.strictEqual(func(1, 0, array), true);
        assert.strictEqual(func(1, 'a', object), true);
        assert.strictEqual(func(1, 'a', new Foo), true);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should return `false` for non-iteratee calls', function(assert) {
      assert.expect(4);

      if (func) {
        assert.strictEqual(func(2, 0, array), false);
        assert.strictEqual(func(1, 1.1, array), false);
        assert.strictEqual(func(1, 0, { 'length': MAX_SAFE_INTEGER + 1 }), false);
        assert.strictEqual(func(1, 'b', object), false);
      }
      else {
        skipAssert(assert, 4);
      }
    });

    QUnit.test('should work with `NaN` values', function(assert) {
      assert.expect(2);

      if (func) {
        assert.strictEqual(func(NaN, 0, [NaN]), true);
        assert.strictEqual(func(NaN, 'a', { 'a': NaN }), true);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should not error when `index` is an object without a `toString` method', function(assert) {
      assert.expect(1);

      if (func) {
        try {
          var actual = func(1, { 'toString': null }, [1]);
        } catch (e) {
          var message = e.message;
        }
        assert.strictEqual(actual, false, message || '');
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('map caches');

  (function() {
    var keys = [null, undefined, false, true, 1, -Infinity, NaN, {}, 'a', symbol || noop];

    var pairs = lodashStable.map(keys, function(key, index) {
      var lastIndex = keys.length - 1;
      return [key, keys[lastIndex - index]];
    });

    function createCaches(pairs) {
      var largeStack = new mapCaches.Stack(pairs),
          length = pairs ? pairs.length : 0;

      lodashStable.times(LARGE_ARRAY_SIZE - length, function() {
        largeStack.set({}, {});
      });

      return {
        'hashes': new mapCaches.Hash(pairs),
        'list caches': new mapCaches.ListCache(pairs),
        'map caches': new mapCaches.MapCache(pairs),
        'stack caches': new mapCaches.Stack(pairs),
        'large stacks': largeStack
      };
    }

    lodashStable.forOwn(createCaches(pairs), function(cache, kind) {
      var isLarge = /^large/.test(kind);

      QUnit.test('should implement a `Map` interface for ' + kind, function(assert) {
        assert.expect(83);

        lodashStable.each(keys, function(key, index) {
          var value = pairs[index][1];

          assert.deepEqual(cache.get(key), value);
          assert.strictEqual(cache.has(key), true);
          assert.strictEqual(cache.delete(key), true);
          assert.strictEqual(cache.has(key), false);
          assert.strictEqual(cache.get(key), undefined);
          assert.strictEqual(cache.delete(key), false);
          assert.strictEqual(cache.set(key, value), cache);
          assert.strictEqual(cache.has(key), true);
        });

        assert.strictEqual(cache.size, isLarge ? LARGE_ARRAY_SIZE : keys.length);
        assert.strictEqual(cache.clear(), undefined);
        assert.ok(lodashStable.every(keys, function(key) {
          return !cache.has(key);
        }));
      });
    });

    lodashStable.forOwn(createCaches(), function(cache, kind) {
      QUnit.test('should support changing values of ' + kind, function(assert) {
        assert.expect(10);

        lodashStable.each(keys, function(key) {
          cache.set(key, 1).set(key, 2);
          assert.strictEqual(cache.get(key), 2);
        });
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash constructor');

  (function() {
    var values = empties.concat(true, 1, 'a'),
        expected = lodashStable.map(values, stubTrue);

    QUnit.test('should create a new instance when called without the `new` operator', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = lodashStable.map(values, function(value) {
          return _(value) instanceof _;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return the given `lodash` instances', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = lodashStable.map(values, function(value) {
          var wrapped = _(value);
          return _(wrapped) === wrapped;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should convert foreign wrapped values to `lodash` instances', function(assert) {
      assert.expect(1);

      if (!isNpm && lodashBizarro) {
        var actual = lodashStable.map(values, function(value) {
          var wrapped = _(lodashBizarro(value)),
              unwrapped = wrapped.value();

          return wrapped instanceof _ &&
            ((unwrapped === value) || (unwrapped !== unwrapped && value !== value));
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.add');

  (function() {
    QUnit.test('should add two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.add(6, 4), 10);
      assert.strictEqual(_.add(-6, 4), -2);
      assert.strictEqual(_.add(-6, -4), -10);
    });

    QUnit.test('should not coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.add('6', '4'), '64');
      assert.strictEqual(_.add('x', 'y'), 'xy');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.after');

  (function() {
    function after(n, times) {
      var count = 0;
      lodashStable.times(times, _.after(n, function() { count++; }));
      return count;
    }

    QUnit.test('should create a function that invokes `func` after `n` calls', function(assert) {
      assert.expect(4);

      assert.strictEqual(after(5, 5), 1, 'after(n) should invoke `func` after being called `n` times');
      assert.strictEqual(after(5, 4), 0, 'after(n) should not invoke `func` before being called `n` times');
      assert.strictEqual(after(0, 0), 0, 'after(0) should not invoke `func` immediately');
      assert.strictEqual(after(0, 1), 1, 'after(0) should invoke `func` when called once');
    });

    QUnit.test('should coerce `n` values of `NaN` to `0`', function(assert) {
      assert.expect(1);

      assert.strictEqual(after(NaN, 1), 1);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(2);

      var after = _.after(1, function(assert) { return ++this.count; }),
          object = { 'after': after, 'count': 0 };

      object.after();
      assert.strictEqual(object.after(), 2);
      assert.strictEqual(object.count, 2);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.ary');

  (function() {
    function fn(a, b, c) {
      return slice.call(arguments);
    }

    QUnit.test('should cap the number of arguments provided to `func`', function(assert) {
      assert.expect(2);

      var actual = lodashStable.map(['6', '8', '10'], _.ary(parseInt, 1));
      assert.deepEqual(actual, [6, 8, 10]);

      var capped = _.ary(fn, 2);
      assert.deepEqual(capped('a', 'b', 'c', 'd'), ['a', 'b']);
    });

    QUnit.test('should use `func.length` if `n` is not given', function(assert) {
      assert.expect(1);

      var capped = _.ary(fn);
      assert.deepEqual(capped('a', 'b', 'c', 'd'), ['a', 'b', 'c']);
    });

    QUnit.test('should treat a negative `n` as `0`', function(assert) {
      assert.expect(1);

      var capped = _.ary(fn, -1);

      try {
        var actual = capped('a');
      } catch (e) {}

      assert.deepEqual(actual, []);
    });

    QUnit.test('should coerce `n` to an integer', function(assert) {
      assert.expect(1);

      var values = ['1', 1.6, 'xyz'],
          expected = [['a'], ['a'], []];

      var actual = lodashStable.map(values, function(n) {
        var capped = _.ary(fn, n);
        return capped('a', 'b');
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should not force a minimum argument count', function(assert) {
      assert.expect(1);

      var args = ['a', 'b', 'c'],
          capped = _.ary(fn, 3);

      var expected = lodashStable.map(args, function(arg, index) {
        return args.slice(0, index);
      });

      var actual = lodashStable.map(expected, function(array) {
        return capped.apply(undefined, array);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(1);

      var capped = _.ary(function(a, b) { return this; }, 1),
          object = { 'capped': capped };

      assert.strictEqual(object.capped(), object);
    });

    QUnit.test('should use the existing `ary` if smaller', function(assert) {
      assert.expect(1);

      var capped = _.ary(_.ary(fn, 1), 2);
      assert.deepEqual(capped('a', 'b', 'c'), ['a']);
    });

    QUnit.test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var funcs = lodashStable.map([fn], _.ary),
          actual = funcs[0]('a', 'b', 'c');

      assert.deepEqual(actual, ['a', 'b', 'c']);
    });

    QUnit.test('should work when combined with other methods that use metadata', function(assert) {
      assert.expect(2);

      var array = ['a', 'b', 'c'],
          includes = _.curry(_.rearg(_.ary(_.includes, 2), 1, 0), 2);

      assert.strictEqual(includes('b')(array, 2), true);

      if (!isNpm) {
        includes = _(_.includes).ary(2).rearg(1, 0).curry(2).value();
        assert.strictEqual(includes('b')(array, 2), true);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignIn');

  (function() {
    QUnit.test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.extend, _.assignIn);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assign and lodash.assignIn');

  lodashStable.each(['assign', 'assignIn'], function(methodName) {
    var func = _[methodName];

    QUnit.test('`_.' + methodName + '` should assign source properties to `object`', function(assert) {
      assert.expect(1);

      assert.deepEqual(func({ 'a': 1 }, { 'b': 2 }), { 'a': 1, 'b': 2 });
    });

    QUnit.test('`_.' + methodName + '` should accept multiple sources', function(assert) {
      assert.expect(2);

      var expected = { 'a': 1, 'b': 2, 'c': 3 };
      assert.deepEqual(func({ 'a': 1 }, { 'b': 2 }, { 'c': 3 }), expected);
      assert.deepEqual(func({ 'a': 1 }, { 'b': 2, 'c': 2 }, { 'c': 3 }), expected);
    });

    QUnit.test('`_.' + methodName + '` should overwrite destination properties', function(assert) {
      assert.expect(1);

      var expected = { 'a': 3, 'b': 2, 'c': 1 };
      assert.deepEqual(func({ 'a': 1, 'b': 2 }, expected), expected);
    });

    QUnit.test('`_.' + methodName + '` should assign source properties with nullish values', function(assert) {
      assert.expect(1);

      var expected = { 'a': null, 'b': undefined, 'c': null };
      assert.deepEqual(func({ 'a': 1, 'b': 2 }, expected), expected);
    });

    QUnit.test('`_.' + methodName + '` should skip assignments if values are the same', function(assert) {
      assert.expect(1);

      var object = {};

      var descriptor = {
        'configurable': true,
        'enumerable': true,
        'set': function() { throw new Error; }
      };

      var source = {
        'a': 1,
        'b': undefined,
        'c': NaN,
        'd': undefined,
        'constructor': Object,
        'toString': lodashStable.constant('source')
      };

      defineProperty(object, 'a', lodashStable.assign({}, descriptor, {
        'get': stubOne
      }));

      defineProperty(object, 'b', lodashStable.assign({}, descriptor, {
        'get': noop
      }));

      defineProperty(object, 'c', lodashStable.assign({}, descriptor, {
        'get': stubNaN
      }));

      defineProperty(object, 'constructor', lodashStable.assign({}, descriptor, {
        'get': lodashStable.constant(Object)
      }));

      try {
        var actual = func(object, source);
      } catch (e) {}

      assert.deepEqual(actual, source);
    });

    QUnit.test('`_.' + methodName + '` should treat sparse array sources as dense', function(assert) {
      assert.expect(1);

      var array = [1];
      array[2] = 3;

      assert.deepEqual(func({}, array), { '0': 1, '1': undefined, '2': 3 });
    });

    QUnit.test('`_.' + methodName + '` should assign values of prototype objects', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype.a = 1;

      assert.deepEqual(func({}, Foo.prototype), { 'a': 1 });
    });

    QUnit.test('`_.' + methodName + '` should coerce string sources to objects', function(assert) {
      assert.expect(1);

      assert.deepEqual(func({}, 'a'), { '0': 'a' });
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignInWith');

  (function() {
    QUnit.test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.extendWith, _.assignInWith);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.assignWith and lodash.assignInWith');

  lodashStable.each(['assignWith', 'assignInWith'], function(methodName) {
    var func = _[methodName];

    QUnit.test('`_.' + methodName + '` should work with a `customizer` callback', function(assert) {
      assert.expect(1);

      var actual = func({ 'a': 1, 'b': 2 }, { 'a': 3, 'c': 3 }, function(a, b) {
        return a === undefined ? b : a;
      });

      assert.deepEqual(actual, { 'a': 1, 'b': 2, 'c': 3 });
    });

    QUnit.test('`_.' + methodName + '` should work with a `customizer` that returns `undefined`', function(assert) {
      assert.expect(1);

      var expected = { 'a': 1 };
      assert.deepEqual(func({}, expected, noop), expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.at');

  (function() {
    var array = ['a', 'b', 'c'],
        object = { 'a': [{ 'b': { 'c': 3 } }, 4] };

    QUnit.test('should return the elements corresponding to the specified keys', function(assert) {
      assert.expect(1);

      var actual = _.at(array, [0, 2]);
      assert.deepEqual(actual, ['a', 'c']);
    });

    QUnit.test('should return `undefined` for nonexistent keys', function(assert) {
      assert.expect(1);

      var actual = _.at(array, [2, 4, 0]);
      assert.deepEqual(actual, ['c', undefined, 'a']);
    });

    QUnit.test('should work with non-index keys on array values', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(empties, function(value) {
        return (value === 0) || lodashStable.isArray(value);
      }).concat(-1, 1.1);

      var array = lodashStable.transform(values, function(result, value) {
        result[value] = 1;
      }, []);

      var expected = lodashStable.map(values, stubOne),
          actual = _.at(array, values);

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should return an empty array when no keys are given', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.at(array), []);
      assert.deepEqual(_.at(array, [], []), []);
    });

    QUnit.test('should accept multiple key arguments', function(assert) {
      assert.expect(1);

      var actual = _.at(['a', 'b', 'c', 'd'], 3, 0, 2);
      assert.deepEqual(actual, ['d', 'a', 'c']);
    });

    QUnit.test('should work with a falsey `object` when keys are given', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(Array(4)));

      var actual = lodashStable.map(falsey, function(object) {
        try {
          return _.at(object, 0, 1, 'pop', 'push');
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should work with an `arguments` object for `object`', function(assert) {
      assert.expect(1);

      var actual = _.at(args, [2, 0]);
      assert.deepEqual(actual, [3, 1]);
    });

    QUnit.test('should work with `arguments` object as secondary arguments', function(assert) {
      assert.expect(1);

      var actual = _.at([1, 2, 3, 4, 5], args);
      assert.deepEqual(actual, [2, 3, 4]);
    });

    QUnit.test('should work with an object for `object`', function(assert) {
      assert.expect(1);

      var actual = _.at(object, ['a[0].b.c', 'a[1]']);
      assert.deepEqual(actual, [3, 4]);
    });

    QUnit.test('should pluck inherited property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var actual = _.at(new Foo, 'b');
      assert.deepEqual(actual, [2]);
    });

    QUnit.test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var largeArray = lodashStable.range(LARGE_ARRAY_SIZE),
            smallArray = array;

        lodashStable.each([[2], ['2'], [2, 1]], function(paths) {
          lodashStable.times(2, function(index) {
            var array = index ? largeArray : smallArray,
                wrapped = _(array).map(identity).at(paths);

            assert.deepEqual(wrapped.value(), _.at(_.map(array, identity), paths));
          });
        });
      }
      else {
        skipAssert(assert, 6);
      }
    });

    QUnit.test('should support shortcut fusion', function(assert) {
      assert.expect(8);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            count = 0,
            iteratee = function(value) { count++; return square(value); },
            lastIndex = LARGE_ARRAY_SIZE - 1;

        lodashStable.each([lastIndex, lastIndex + '', LARGE_ARRAY_SIZE, []], function(n, index) {
          count = 0;
          var actual = _(array).map(iteratee).at(n).value(),
              expected = index < 2 ? 1 : 0;

          assert.strictEqual(count, expected);

          expected = index == 3 ? [] : [index == 2 ? undefined : square(lastIndex)];
          assert.deepEqual(actual, expected);
        });
      }
      else {
        skipAssert(assert, 8);
      }
    });

    QUnit.test('work with an object for `object` when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var paths = ['a[0].b.c', 'a[1]'],
            actual = _(object).map(identity).at(paths).value();

        assert.deepEqual(actual, _.at(_.map(object, identity), paths));

        var indexObject = { '0': 1 };
        actual = _(indexObject).at(0).value();
        assert.deepEqual(actual, _.at(indexObject, 0));
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.attempt');

  (function() {
    QUnit.test('should return the result of `func`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.attempt(lodashStable.constant('x')), 'x');
    });

    QUnit.test('should provide additional arguments to `func`', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { return slice.call(arguments); }, 1, 2);
      assert.deepEqual(actual, [1, 2]);
    });

    QUnit.test('should return the caught error', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(errors, stubTrue);

      var actual = lodashStable.map(errors, function(error) {
        return _.attempt(function() { throw error; }) === error;
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should coerce errors to error objects', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { throw 'x'; });
      assert.ok(lodashStable.isEqual(actual, Error('x')));
    });

    QUnit.test('should preserve custom errors', function(assert) {
      assert.expect(1);

      var actual = _.attempt(function() { throw new CustomError('x'); });
      assert.ok(actual instanceof CustomError);
    });

    QUnit.test('should work with an error object from another realm', function(assert) {
      assert.expect(1);

      if (realm.errors) {
        var expected = lodashStable.map(realm.errors, stubTrue);

        var actual = lodashStable.map(realm.errors, function(error) {
          return _.attempt(function() { throw error; }) === error;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_(lodashStable.constant('x')).attempt(), 'x');
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(lodashStable.constant('x')).chain().attempt() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.before');

  (function() {
    function before(n, times) {
      var count = 0;
      lodashStable.times(times, _.before(n, function() { count++; }));
      return count;
    }

    QUnit.test('should create a function that invokes `func` after `n` calls', function(assert) {
      assert.expect(4);

      assert.strictEqual(before(5, 4), 4, 'before(n) should invoke `func` before being called `n` times');
      assert.strictEqual(before(5, 6), 4, 'before(n) should not invoke `func` after being called `n - 1` times');
      assert.strictEqual(before(0, 0), 0, 'before(0) should not invoke `func` immediately');
      assert.strictEqual(before(0, 1), 0, 'before(0) should not invoke `func` when called');
    });

    QUnit.test('should coerce `n` values of `NaN` to `0`', function(assert) {
      assert.expect(1);

      assert.strictEqual(before(NaN, 1), 0);
    });

    QUnit.test('should use `this` binding of function', function(assert) {
      assert.expect(2);

      var before = _.before(2, function(assert) { return ++this.count; }),
          object = { 'before': before, 'count': 0 };

      object.before();
      assert.strictEqual(object.before(), 1);
      assert.strictEqual(object.count, 1);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bind');

  (function() {
    function fn() {
      var result = [this];
      push.apply(result, arguments);
      return result;
    }

    QUnit.test('should bind a function to an object', function(assert) {
      assert.expect(1);

      var object = {},
          bound = _.bind(fn, object);

      assert.deepEqual(bound('a'), [object, 'a']);
    });

    QUnit.test('should accept a falsey `thisArg`', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(falsey.slice(1), function(value) { return value == null; }),
          expected = lodashStable.map(values, function(value) { return [value]; });

      var actual = lodashStable.map(values, function(value) {
        try {
          var bound = _.bind(fn, value);
          return bound();
        } catch (e) {}
      });

      assert.ok(lodashStable.every(actual, function(value, index) {
        return lodashStable.isEqual(value, expected[index]);
      }));
    });

    QUnit.test('should bind a function to nullish values', function(assert) {
      assert.expect(6);

      var bound = _.bind(fn, null),
          actual = bound('a');

      assert.ok((actual[0] === null) || (actual[0] && actual[0].Array));
      assert.strictEqual(actual[1], 'a');

      lodashStable.times(2, function(index) {
        bound = index ? _.bind(fn, undefined) : _.bind(fn);
        actual = bound('b');

        assert.ok((actual[0] === undefined) || (actual[0] && actual[0].Array));
        assert.strictEqual(actual[1], 'b');
      });
    });

    QUnit.test('should partially apply arguments ', function(assert) {
      assert.expect(4);

      var object = {},
          bound = _.bind(fn, object, 'a');

      assert.deepEqual(bound(), [object, 'a']);

      bound = _.bind(fn, object, 'a');
      assert.deepEqual(bound('b'), [object, 'a', 'b']);

      bound = _.bind(fn, object, 'a', 'b');
      assert.deepEqual(bound(), [object, 'a', 'b']);
      assert.deepEqual(bound('c', 'd'), [object, 'a', 'b', 'c', 'd']);
    });

    QUnit.test('should support placeholders', function(assert) {
      assert.expect(4);

      var object = {},
          ph = _.bind.placeholder,
          bound = _.bind(fn, object, ph, 'b', ph);

      assert.deepEqual(bound('a', 'c'), [object, 'a', 'b', 'c']);
      assert.deepEqual(bound('a'), [object, 'a', 'b', undefined]);
      assert.deepEqual(bound('a', 'c', 'd'), [object, 'a', 'b', 'c', 'd']);
      assert.deepEqual(bound(), [object, undefined, 'b', undefined]);
    });

    QUnit.test('should use `_.placeholder` when set', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var _ph = _.placeholder = {},
            ph = _.bind.placeholder,
            object = {},
            bound = _.bind(fn, object, _ph, 'b', ph);

        assert.deepEqual(bound('a', 'c'), [object, 'a', 'b', ph, 'c']);
        delete _.placeholder;
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should create a function with a `length` of `0`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) {},
          bound = _.bind(fn, {});

      assert.strictEqual(bound.length, 0);

      bound = _.bind(fn, {}, 1);
      assert.strictEqual(bound.length, 0);
    });

    QUnit.test('should ignore binding when called with the `new` operator', function(assert) {
      assert.expect(3);

      function Foo() {
        return this;
      }

      var bound = _.bind(Foo, { 'a': 1 }),
          newBound = new bound;

      assert.strictEqual(bound().a, 1);
      assert.strictEqual(newBound.a, undefined);
      assert.ok(newBound instanceof Foo);
    });

    QUnit.test('should handle a number of arguments when called with the `new` operator', function(assert) {
      assert.expect(1);

      function Foo() {
        return this;
      }

      function Bar() {}

      var thisArg = { 'a': 1 },
          boundFoo = _.bind(Foo, thisArg),
          boundBar = _.bind(Bar, thisArg),
          count = 9,
          expected = lodashStable.times(count, lodashStable.constant([undefined, undefined]));

      var actual = lodashStable.times(count, function(index) {
        try {
          switch (index) {
            case 0: return [new boundFoo().a, new boundBar().a];
            case 1: return [new boundFoo(1).a, new boundBar(1).a];
            case 2: return [new boundFoo(1, 2).a, new boundBar(1, 2).a];
            case 3: return [new boundFoo(1, 2, 3).a, new boundBar(1, 2, 3).a];
            case 4: return [new boundFoo(1, 2, 3, 4).a, new boundBar(1, 2, 3, 4).a];
            case 5: return [new boundFoo(1, 2, 3, 4, 5).a, new boundBar(1, 2, 3, 4, 5).a];
            case 6: return [new boundFoo(1, 2, 3, 4, 5, 6).a, new boundBar(1, 2, 3, 4, 5, 6).a];
            case 7: return [new boundFoo(1, 2, 3, 4, 5, 6, 7).a, new boundBar(1, 2, 3, 4, 5, 6, 7).a];
            case 8: return [new boundFoo(1, 2, 3, 4, 5, 6, 7, 8).a, new boundBar(1, 2, 3, 4, 5, 6, 7, 8).a];
          }
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should ensure `new bound` is an instance of `func`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var bound = _.bind(Foo),
          object = {};

      assert.ok(new bound instanceof Foo);
      assert.strictEqual(new bound(true), object);
    });

    QUnit.test('should append array arguments to partially applied arguments', function(assert) {
      assert.expect(1);

      var object = {},
          bound = _.bind(fn, object, 'a');

      assert.deepEqual(bound(['b'], 'c'), [object, 'a', ['b'], 'c']);
    });

    QUnit.test('should not rebind functions', function(assert) {
      assert.expect(3);

      var object1 = {},
          object2 = {},
          object3 = {};

      var bound1 = _.bind(fn, object1),
          bound2 = _.bind(bound1, object2, 'a'),
          bound3 = _.bind(bound1, object3, 'b');

      assert.deepEqual(bound1(), [object1]);
      assert.deepEqual(bound2(), [object1, 'a']);
      assert.deepEqual(bound3(), [object1, 'b']);
    });

    QUnit.test('should not error when instantiating bound built-ins', function(assert) {
      assert.expect(2);

      var Ctor = _.bind(Date, null),
          expected = new Date(2012, 4, 23, 0, 0, 0, 0);

      try {
        var actual = new Ctor(2012, 4, 23, 0, 0, 0, 0);
      } catch (e) {}

      assert.deepEqual(actual, expected);

      Ctor = _.bind(Date, null, 2012, 4, 23);

      try {
        actual = new Ctor(0, 0, 0, 0);
      } catch (e) {}

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should not error when calling bound class constructors with the `new` operator', function(assert) {
      assert.expect(1);

      var createCtor = lodashStable.attempt(Function, '"use strict";return class A{}');

      if (typeof createCtor == 'function') {
        var bound = _.bind(createCtor()),
            count = 8,
            expected = lodashStable.times(count, stubTrue);

        var actual = lodashStable.times(count, function(index) {
          try {
            switch (index) {
              case 0: return !!(new bound);
              case 1: return !!(new bound(1));
              case 2: return !!(new bound(1, 2));
              case 3: return !!(new bound(1, 2, 3));
              case 4: return !!(new bound(1, 2, 3, 4));
              case 5: return !!(new bound(1, 2, 3, 4, 5));
              case 6: return !!(new bound(1, 2, 3, 4, 5, 6));
              case 7: return !!(new bound(1, 2, 3, 4, 5, 6, 7));
            }
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var object = {},
            bound = _(fn).bind({}, 'a', 'b');

        assert.ok(bound instanceof _);

        var actual = bound.value()('c');
        assert.deepEqual(actual, [object, 'a', 'b', 'c']);
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bindAll');

  (function() {
    var args = toArgs(['a']);

    var source = {
      '_n0': -2,
      '_p0': -1,
      '_a': 1,
      '_b': 2,
      '_c': 3,
      '_d': 4,
      '-0': function() { return this._n0; },
      '0': function() { return this._p0; },
      'a': function() { return this._a; },
      'b': function() { return this._b; },
      'c': function() { return this._c; },
      'd': function() { return this._d; }
    };

    QUnit.test('should accept individual method names', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, 'a', 'b');

      var actual = lodashStable.map(['a', 'b', 'c'], function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1, 2, undefined]);
    });

    QUnit.test('should accept arrays of method names', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, ['a', 'b'], ['c']);

      var actual = lodashStable.map(['a', 'b', 'c', 'd'], function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1, 2, 3, undefined]);
    });

    QUnit.test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        var object = lodashStable.cloneDeep(source);
        _.bindAll(object, key);
        return object[lodashStable.toString(key)].call({});
      });

      assert.deepEqual(actual, [-2, -2, -1, -1]);
    });

    QUnit.test('should work with an array `object`', function(assert) {
      assert.expect(1);

      var array = ['push', 'pop'];
      _.bindAll(array);
      assert.strictEqual(array.pop, arrayProto.pop);
    });

    QUnit.test('should work with `arguments` objects as secondary arguments', function(assert) {
      assert.expect(1);

      var object = lodashStable.cloneDeep(source);
      _.bindAll(object, args);

      var actual = lodashStable.map(args, function(key) {
        return object[key].call({});
      });

      assert.deepEqual(actual, [1]);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.bindKey');

  (function() {
    QUnit.test('should work when the target function is overwritten', function(assert) {
      assert.expect(2);

      var object = {
        'user': 'fred',
        'greet': function(greeting) {
          return this.user + ' says: ' + greeting;
        }
      };

      var bound = _.bindKey(object, 'greet', 'hi');
      assert.strictEqual(bound(), 'fred says: hi');

      object.greet = function(greeting) {
        return this.user + ' says: ' + greeting + '!';
      };

      assert.strictEqual(bound(), 'fred says: hi!');
    });

    QUnit.test('should support placeholders', function(assert) {
      assert.expect(4);

      var object = {
        'fn': function() {
          return slice.call(arguments);
        }
      };

      var ph = _.bindKey.placeholder,
          bound = _.bindKey(object, 'fn', ph, 'b', ph);

      assert.deepEqual(bound('a', 'c'), ['a', 'b', 'c']);
      assert.deepEqual(bound('a'), ['a', 'b', undefined]);
      assert.deepEqual(bound('a', 'c', 'd'), ['a', 'b', 'c', 'd']);
      assert.deepEqual(bound(), [undefined, 'b', undefined]);
    });

    QUnit.test('should use `_.placeholder` when set', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var object = {
          'fn': function() {
            return slice.call(arguments);
          }
        };

        var _ph = _.placeholder = {},
            ph = _.bindKey.placeholder,
            bound = _.bindKey(object, 'fn', _ph, 'b', ph);

        assert.deepEqual(bound('a', 'c'), ['a', 'b', ph, 'c']);
        delete _.placeholder;
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should ensure `new bound` is an instance of `object[key]`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var object = { 'Foo': Foo },
          bound = _.bindKey(object, 'Foo');

      assert.ok(new bound instanceof Foo);
      assert.strictEqual(new bound(true), object);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('case methods');

  lodashStable.each(['camel', 'kebab', 'lower', 'snake', 'start', 'upper'], function(caseName) {
    var methodName = caseName + 'Case',
        func = _[methodName];

    var strings = [
      'foo bar', 'Foo bar', 'foo Bar', 'Foo Bar',
      'FOO BAR', 'fooBar', '--foo-bar--', '__foo_bar__'
    ];

    var converted = (function() {
      switch (caseName) {
        case 'camel': return 'fooBar';
        case 'kebab': return 'foo-bar';
        case 'lower': return 'foo bar';
        case 'snake': return 'foo_bar';
        case 'start': return 'Foo Bar';
        case 'upper': return 'FOO BAR';
      }
    }());

    QUnit.test('`_.' + methodName + '` should convert `string` to ' + caseName + ' case', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(strings, function(string) {
        var expected = (caseName == 'start' && string == 'FOO BAR') ? string : converted;
        return func(string) === expected;
      });

      assert.deepEqual(actual, lodashStable.map(strings, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should handle double-converting strings', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(strings, function(string) {
        var expected = (caseName == 'start' && string == 'FOO BAR') ? string : converted;
        return func(func(string)) === expected;
      });

      assert.deepEqual(actual, lodashStable.map(strings, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should deburr letters', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(burredLetters, function(burred, index) {
        var letter = deburredLetters[index].replace(/['\u2019]/g, '');
        if (caseName == 'start') {
          letter = letter == 'IJ' ? letter : lodashStable.capitalize(letter);
        } else if (caseName == 'upper') {
          letter = letter.toUpperCase();
        } else {
          letter = letter.toLowerCase();
        }
        return func(burred) === letter;
      });

      assert.deepEqual(actual, lodashStable.map(burredLetters, stubTrue));
    });

    QUnit.test('`_.' + methodName + '` should remove contraction apostrophes', function(assert) {
      assert.expect(2);

      var postfixes = ['d', 'll', 'm', 're', 's', 't', 've'];

      lodashStable.each(["'", '\u2019'], function(apos) {
        var actual = lodashStable.map(postfixes, function(postfix) {
          return func('a b' + apos + postfix +  ' c');
        });

        var expected = lodashStable.map(postfixes, function(postfix) {
          switch (caseName) {
            case 'camel': return 'aB'  + postfix + 'C';
            case 'kebab': return 'a-b' + postfix + '-c';
            case 'lower': return 'a b' + postfix + ' c';
            case 'snake': return 'a_b' + postfix + '_c';
            case 'start': return 'A B' + postfix + ' C';
            case 'upper': return 'A B' + postfix.toUpperCase() + ' C';
          }
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('`_.' + methodName + '` should remove Latin mathematical operators', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(['\xd7', '\xf7'], func);
      assert.deepEqual(actual, ['', '']);
    });

    QUnit.test('`_.' + methodName + '` should coerce `string` to a string', function(assert) {
      assert.expect(2);

      var string = 'foo bar';
      assert.strictEqual(func(Object(string)), converted);
      assert.strictEqual(func({ 'toString': lodashStable.constant(string) }), converted);
    });

    QUnit.test('`_.' + methodName + '` should return an unwrapped value implicitly when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_('foo bar')[methodName](), converted);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_('foo bar').chain()[methodName]() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  }
```

#### should not support deep paths

```ts
test('should not support deep paths', function(assert) {
      assert.expect(1);

      var actual = _.fromPairs([['a.b', 1]]);
      assert.deepEqual(actual, { 'a.b': 1 });
    }
```

#### `_.' + methodName + '` should check for own properties

```ts
test('`_.' + methodName + '` should check for own properties', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 };

      lodashStable.each(['a', ['a']], function(path) {
        assert.strictEqual(func(object, path), true);
      });
    }
```

#### `_.' + methodName + '` should support deep paths

```ts
test('`_.' + methodName + '` should support deep paths', function(assert) {
      assert.expect(4);

      var object = { 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(func(object, path), true);
      });

      lodashStable.each(['a.a', ['a', 'a']], function(path) {
        assert.strictEqual(func(object, path), false);
      });
    }
```

#### `_.' + methodName + '` should coerce `path` to a string

```ts
test('`_.' + methodName + '` should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var object = { 'null': 1 , 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}],
          expected = lodashStable.map(paths, stubTrue);

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          return func(object, index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should work with a non-string `path`

```ts
test('`_.' + methodName + '` should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        assert.strictEqual(func(array, path), true);
      });
    }
```

#### `_.' + methodName + '` should work with a symbol `path`

```ts
test('`_.' + methodName + '` should work with a symbol `path`', function(assert) {
      assert.expect(2);

      function Foo() {}

      if (Symbol) {
        Foo.prototype[symbol] = 1;

        var symbol2 = Symbol('b');
        defineProperty(Foo.prototype, symbol2, {
          'configurable': true,
          'enumerable': false,
          'writable': true,
          'value': 2
        });

        var object = isHas ? Foo.prototype : new Foo;
        assert.strictEqual(func(object, symbol), true);
        assert.strictEqual(func(object, symbol2), true);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### `_.' + methodName + '` should check for a key over a path

```ts
test('`_.' + methodName + '` should check for a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1 };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        assert.strictEqual(func(object, path), true);
      });
    }
```

#### `_.' + methodName + '` should return `true` for indexes of sparse values with deep paths

```ts
test('`_.' + methodName + '` should return `true` for indexes of sparse values with deep paths', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, lodashStable.constant([true, true]));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(['a[0]', ['a', '0']], function(path) {
          return func({ 'a': value }, path);
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `' + (isHas ? 'false' : 'true') + '` for inherited properties

```ts
test('`_.' + methodName + '` should return `' + (isHas ? 'false' : 'true') + '` for inherited properties', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.a = 1;

      lodashStable.each(['a', ['a']], function(path) {
        assert.strictEqual(func(new Foo, path), !isHas);
      });
    }
```

#### `_.' + methodName + '` should return `' + (isHas ? 'false' : 'true') + '` for nested inherited properties

```ts
test('`_.' + methodName + '` should return `' + (isHas ? 'false' : 'true') + '` for nested inherited properties', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.a = { 'b': 1 };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(func(new Foo, path), !isHas);
      });
    }
```

#### `_.' + methodName + '` should return `false` when `object` is nullish

```ts
test('`_.' + methodName + '` should return `false` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var actual = lodashStable.map(values, function(value) {
          return func(value, path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return `false` for deep paths when `object` is nullish

```ts
test('`_.' + methodName + '` should return `false` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var actual = lodashStable.map(values, function(value) {
          return func(value, path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return `false` for nullish values of nested objects

```ts
test('`_.' + methodName + '` should return `false` for nullish values of nested objects', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var actual = lodashStable.map(values, function(value, index) {
          var object = index ? { 'a': value } : {};
          return func(object, path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return `false` over sparse values of deep paths

```ts
test('`_.' + methodName + '` should return `false` over sparse values of deep paths', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, lodashStable.constant([false, false]));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(['a[0].b', ['a', '0', 'b']], function(path) {
          return func({ 'a': value }, path);
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### should support deep paths

```ts
test('should support deep paths', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': function(a, b) { return [a, b]; } } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var actual = _.invoke(object, path, 1, 2);
        assert.deepEqual(actual, [1, 2]);
      });
    }
```

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': function() { return this.c; }, 'c': 1 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.deepEqual(_.invoke(object, path), 1);
      });
    }
```

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': function() { return this.c; }, 'c': 1 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.deepEqual(_.invokeMap([object], path), [1]);
      });
    }
```

#### should detect methods masquerading as native (test in Node.js)

```ts
test('should detect methods masquerading as native (test in Node.js)', function(assert) {
      assert.expect(2);

      if (!amd && _._baseEach) {
        var path = require('path'),
            basePath = path.dirname(filePath),
            uid = 'e0gvgyrad1jor',
            coreKey = '__core-js_shared__',
            fakeSrcKey = 'Symbol(src)_1.' + uid;

        root[coreKey] = { 'keys': { 'IE_PROTO': 'Symbol(IE_PROTO)_3.' + uid } };
        emptyObject(require.cache);

        var baseIsNative = interopRequire(path.join(basePath, '_baseIsNative'));
        assert.strictEqual(baseIsNative(slice), true);

        slice[fakeSrcKey] = slice + '';
        assert.strictEqual(baseIsNative(slice), false);

        delete slice[fakeSrcKey];
        delete root[coreKey];
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should support deep paths for `_.matchesProperty` shorthands

```ts
test('should support deep paths for `_.matchesProperty` shorthands', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': { 'c': 1, 'd': 2 } } },
          matches = _.iteratee(['a.b', { 'c': 1 }]);

      assert.strictEqual(matches(object), true);
    }
```

#### should support deep paths for `_.property` shorthands

```ts
test('should support deep paths for `_.property` shorthands', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': 2 } },
          prop = _.iteratee('a.b');

      assert.strictEqual(prop(object), 2);
    }
```

#### `_.' + methodName + '` should coerce primitives to objects (test in IE 9)

```ts
test('`_.' + methodName + '` should coerce primitives to objects (test in IE 9)', function(assert) {
      assert.expect(2);

      var expected = lodashStable.map(primitives, function(value) {
        return typeof value == 'string' ? ['0'] : [];
      });

      var actual = lodashStable.map(primitives, func);
      assert.deepEqual(actual, expected);

      // IE 9 doesn't box numbers in for-in loops.
      numberProto.a = 1;
      assert.deepEqual(func(0), isKeys ? [] : ['a']);
      delete numberProto.a;
    });

    QUnit.test('`_.' + methodName + '` skips the `constructor` property on prototype objects', function(assert) {
      assert.expect(3);

      function Foo() {}
      Foo.prototype.a = 1;

      var expected = ['a'];
      assert.deepEqual(func(Foo.prototype), expected);

      Foo.prototype = { 'constructor': Foo, 'a': 1 };
      assert.deepEqual(func(Foo.prototype), expected);

      var Fake = { 'prototype': {} };
      Fake.prototype.constructor = Fake;
      assert.deepEqual(func(Fake.prototype), ['constructor']);
    });

    QUnit.test('`_.' + methodName + '` should return an empty array when `object` is nullish', function(assert) {
      var values = [, null, undefined],
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(value, index) {
        objectProto.a = 1;
        var result = index ? func(value) : func();
        delete objectProto.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.last');

  (function() {
    var array = [1, 2, 3, 4];

    QUnit.test('should return the last element', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.last(array), 4);
    });

    QUnit.test('should return `undefined` when querying empty arrays', function(assert) {
      assert.expect(1);

      var array = [];
      array['-1'] = 1;

      assert.strictEqual(_.last([]), undefined);
    });

    QUnit.test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.last);

      assert.deepEqual(actual, [3, 6, 9]);
    });

    QUnit.test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_(array).last(), 4);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).chain().last() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should not execute immediately when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(array).chain().last();
        assert.strictEqual(wrapped.__wrapped__, array);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should work in a lazy sequence', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var largeArray = lodashStable.range(LARGE_ARRAY_SIZE),
            smallArray = array;

        lodashStable.times(2, function(index) {
          var array = index ? largeArray : smallArray,
              wrapped = _(array).filter(isEven);

          assert.strictEqual(wrapped.last(), _.last(_.filter(array, isEven)));
        });
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lowerCase');

  (function() {
    QUnit.test('should lowercase as space-separated words', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.lowerCase('--Foo-Bar--'), 'foo bar');
      assert.strictEqual(_.lowerCase('fooBar'), 'foo bar');
      assert.strictEqual(_.lowerCase('__FOO_BAR__'), 'foo bar');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lowerFirst');

  (function() {
    QUnit.test('should lowercase only the first character', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.lowerFirst('fred'), 'fred');
      assert.strictEqual(_.lowerFirst('Fred'), 'fred');
      assert.strictEqual(_.lowerFirst('FRED'), 'fRED');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lt');

  (function() {
    QUnit.test('should return `true` if `value` is less than `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.lt(1, 3), true);
      assert.strictEqual(_.lt('abc', 'def'), true);
    });

    QUnit.test('should return `false` if `value` >= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.lt(3, 1), false);
      assert.strictEqual(_.lt(3, 3), false);
      assert.strictEqual(_.lt('def', 'abc'), false);
      assert.strictEqual(_.lt('def', 'def'), false);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.lte');

  (function() {
    QUnit.test('should return `true` if `value` is <= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.lte(1, 3), true);
      assert.strictEqual(_.lte(3, 3), true);
      assert.strictEqual(_.lte('abc', 'def'), true);
      assert.strictEqual(_.lte('def', 'def'), true);
    });

    QUnit.test('should return `false` if `value` > `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.lt(3, 1), false);
      assert.strictEqual(_.lt('def', 'abc'), false);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.findLastIndex and lodash.lastIndexOf');

  lodashStable.each(['findLastIndex', 'lastIndexOf'], function(methodName) {
    var array = [1, 2, 3, 1, 2, 3],
        func = _[methodName],
        resolve = methodName == 'findLastIndex' ? lodashStable.curry(lodashStable.eq) : identity;

    QUnit.test('`_.' + methodName + '` should return the index of the last matched value', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(3)), 5);
    });

    QUnit.test('`_.' + methodName + '` should work with a positive `fromIndex`', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(1), 2), 0);
    });

    QUnit.test('`_.' + methodName + '` should work with a `fromIndex` >= `length`', function(assert) {
      assert.expect(1);

      var values = [6, 8, Math.pow(2, 32), Infinity],
          expected = lodashStable.map(values, lodashStable.constant([-1, 3, -1]));

      var actual = lodashStable.map(values, function(fromIndex) {
        return [
          func(array, resolve(undefined), fromIndex),
          func(array, resolve(1), fromIndex),
          func(array, resolve(''), fromIndex)
        ];
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should work with a negative `fromIndex`', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(2), -3), 1);
    });

    QUnit.test('`_.' + methodName + '` should work with a negative `fromIndex` <= `-length`', function(assert) {
      assert.expect(1);

      var values = [-6, -8, -Infinity],
          expected = lodashStable.map(values, stubZero);

      var actual = lodashStable.map(values, function(fromIndex) {
        return func(array, resolve(1), fromIndex);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should treat falsey `fromIndex` values correctly', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? 5 : -1;
      });

      var actual = lodashStable.map(falsey, function(fromIndex) {
        return func(array, resolve(3), fromIndex);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should coerce `fromIndex` to an integer', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(2), 4.2), 4);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('indexOf methods');

  lodashStable.each(['indexOf', 'lastIndexOf', 'sortedIndexOf', 'sortedLastIndexOf'], function(methodName) {
    var func = _[methodName],
        isIndexOf = !/last/i.test(methodName),
        isSorted = /^sorted/.test(methodName);

    QUnit.test('`_.' + methodName + '` should accept a falsey `array`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(-1));

      var actual = lodashStable.map(falsey, function(array, index) {
        try {
          return index ? func(array) : func();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `-1` for an unmatched value', function(assert) {
      assert.expect(5);

      var array = [1, 2, 3],
          empty = [];

      assert.strictEqual(func(array, 4), -1);
      assert.strictEqual(func(array, 4, true), -1);
      assert.strictEqual(func(array, undefined, true), -1);

      assert.strictEqual(func(empty, undefined), -1);
      assert.strictEqual(func(empty, undefined, true), -1);
    });

    QUnit.test('`_.' + methodName + '` should not match values on empty arrays', function(assert) {
      assert.expect(2);

      var array = [];
      array[-1] = 0;

      assert.strictEqual(func(array, undefined), -1);
      assert.strictEqual(func(array, 0, true), -1);
    });

    QUnit.test('`_.' + methodName + '` should match `NaN`', function(assert) {
      assert.expect(3);

      var array = isSorted
        ? [1, 2, NaN, NaN]
        : [1, NaN, 3, NaN, 5, NaN];

      if (isSorted) {
        assert.strictEqual(func(array, NaN, true), isIndexOf ? 2 : 3);
        skipAssert(assert, 2);
      }
      else {
        assert.strictEqual(func(array, NaN), isIndexOf ? 1 : 5);
        assert.strictEqual(func(array, NaN, 2), isIndexOf ? 3 : 1);
        assert.strictEqual(func(array, NaN, -2), isIndexOf ? 5 : 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should match `-0` as `0`', function(assert) {
      assert.expect(2);

      assert.strictEqual(func([-0], 0), 0);
      assert.strictEqual(func([0], -0), 0);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.map');

  (function() {
    var array = [1, 2];

    QUnit.test('should map values in `collection` to a new array', function(assert) {
      assert.expect(2);

      var object = { 'a': 1, 'b': 2 },
          expected = ['1', '2'];

      assert.deepEqual(_.map(array, String), expected);
      assert.deepEqual(_.map(object, String), expected);
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': 'x' }, { 'a': 'y' }];
      assert.deepEqual(_.map(objects, 'a'), ['x', 'y']);
    });

    QUnit.test('should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var actual = _.map(new Foo, identity);
      assert.deepEqual(actual, [1]);
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(2);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([1, 2]));

      lodashStable.each([array, object], function(collection) {
        var actual = lodashStable.map(values, function(value, index) {
          return index ? _.map(collection, value) : _.map(collection);
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should accept a falsey `collection`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubArray);

      var actual = lodashStable.map(falsey, function(collection, index) {
        try {
          return index ? _.map(collection) : _.map();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.map(1), []);
    });

    QUnit.test('should treat a nodelist as an array-like object', function(assert) {
      assert.expect(1);

      if (document) {
        var actual = _.map(document.getElementsByTagName('body'), function(element) {
          return element.nodeName.toLowerCase();
        });

        assert.deepEqual(actual, ['body']);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should work with objects with non-number length properties', function(assert) {
      assert.expect(1);

      var value = { 'value': 'x' },
          object = { 'length': { 'value': 'x' } };

      assert.deepEqual(_.map(object, identity), [value]);
    });

    QUnit.test('should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).map(noop) instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });

    QUnit.test('should provide correct `predicate` arguments in a lazy sequence', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var args,
            array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            expected = [1, 0, _.map(array.slice(1), square)];

        _(array).slice(1).map(function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1, 0, array.slice(1)]);

        args = undefined;
        _(array).slice(1).map(square).map(function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square).map(function(value, index) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square).map(function(value) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1]);

        args = undefined;
        _(array).slice(1).map(square).map(function() {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);
      }
      else {
        skipAssert(assert, 5);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapKeys');

  (function() {
    var array = [1, 2],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('should map keys in `object` to a new object', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys(object, String);
      assert.deepEqual(actual, { '1': 1, '2': 2 });
    });

    QUnit.test('should treat arrays like objects', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys(array, String);
      assert.deepEqual(actual, { '1': 1, '2': 2 });
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var actual = _.mapKeys({ 'a': { 'b': 'c' } }, 'b');
      assert.deepEqual(actual, { 'c': { 'b': 'c' } });
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '1': 1, '2': 2 }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.mapKeys(object, value) : _.mapKeys(object);
      });

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapValues');

  (function() {
    var array = [1, 2],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('should map values in `object` to a new object', function(assert) {
      assert.expect(1);

      var actual = _.mapValues(object, String);
      assert.deepEqual(actual, { 'a': '1', 'b': '2' });
    });

    QUnit.test('should treat arrays like objects', function(assert) {
      assert.expect(1);

      var actual = _.mapValues(array, String);
      assert.deepEqual(actual, { '0': '1', '1': '2' });
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var actual = _.mapValues({ 'a': { 'b': 2 } }, 'b');
      assert.deepEqual(actual, { 'a': 2 });
    });

    QUnit.test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([true, false]));

      var actual = lodashStable.map(values, function(value, index) {
        var result = index ? _.mapValues(object, value) : _.mapValues(object);
        return [lodashStable.isEqual(result, object), result === object];
      });

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mapKeys and lodash.mapValues');

  lodashStable.each(['mapKeys', 'mapValues'], function(methodName) {
    var func = _[methodName],
        object = { 'a': 1, 'b': 2 };

    QUnit.test('`_.' + methodName + '` should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 'a';
      }
      Foo.prototype.b = 'b';

      var actual = func(new Foo, function(value, key) { return key; });
      assert.deepEqual(actual, { 'a': 'a' });
    });

    QUnit.test('`_.' + methodName + '` should accept a falsey `object`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubObject);

      var actual = lodashStable.map(falsey, function(object, index) {
        try {
          return index ? func(object) : func();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(object)[methodName](noop) instanceof _);
      }
      else {
        skipAssert(assert);
      }
    });
  });

  QUnit.module('lodash.matches');

  (function() {
    QUnit.test('should not change behavior if `source` is modified', function(assert) {
      assert.expect(9);

      var sources = [
        { 'a': { 'b': 2, 'c': 3 } },
        { 'a': 1, 'b': 2 },
        { 'a': 1 }
      ];

      lodashStable.each(sources, function(source, index) {
        var object = lodashStable.cloneDeep(source),
            par = _.matches(source);

        assert.strictEqual(par(object), true);

        if (index) {
          source.a = 2;
          source.b = 1;
          source.c = 3;
        } else {
          source.a.b = 1;
          source.a.c = 2;
          source.a.d = 3;
        }
        assert.strictEqual(par(object), true);
        assert.strictEqual(par(source), false);
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('matches methods');

  lodashStable.each(['matches', 'isMatch'], function(methodName) {
    var isMatches = methodName == 'matches';

    function matches(source) {
      return isMatches ? _.matches(source) : function(object) {
        return _.isMatch(object, source);
      };
    }

    QUnit.test('`_.' + methodName + '` should perform a deep comparison between `source` and `object`', function(assert) {
      assert.expect(5);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          par = matches({ 'a': 1 });

      assert.strictEqual(par(object), true);

      par = matches({ 'b': 1 });
      assert.strictEqual(par(object), false);

      par = matches({ 'a': 1, 'c': 3 });
      assert.strictEqual(par(object), true);

      par = matches({ 'c': 3, 'd': 4 });
      assert.strictEqual(par(object), false);

      object = { 'a': { 'b': { 'c': 1, 'd': 2 }, 'e': 3 }, 'f': 4 };
      par = matches({ 'a': { 'b': { 'c': 1 } } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should match inherited string keyed `object` properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var object = { 'a': new Foo },
          par = matches({ 'a': { 'b': 2 } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should not match by inherited `source` properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 2 }],
          source = new Foo,
          actual = lodashStable.map(objects, matches(source)),
          expected = lodashStable.map(objects, stubTrue);

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should compare a variety of `source` property values', function(assert) {
      assert.expect(2);

      var object1 = { 'a': false, 'b': true, 'c': '3', 'd': 4, 'e': [5], 'f': { 'g': 6 } },
          object2 = { 'a': 0, 'b': 1, 'c': 3, 'd': '4', 'e': ['5'], 'f': { 'g': '6' } },
          par = matches(object1);

      assert.strictEqual(par(object1), true);
      assert.strictEqual(par(object2), false);
    });

    QUnit.test('`_.' + methodName + '` should match `-0` as `0`', function(assert) {
      assert.expect(2);

      var object1 = { 'a': -0 },
          object2 = { 'a': 0 },
          par = matches(object1);

      assert.strictEqual(par(object2), true);

      par = matches(object2);
      assert.strictEqual(par(object1), true);
    });

    QUnit.test('`_.' + methodName + '` should compare functions by reference', function(assert) {
      assert.expect(3);

      var object1 = { 'a': lodashStable.noop },
          object2 = { 'a': noop },
          object3 = { 'a': {} },
          par = matches(object1);

      assert.strictEqual(par(object1), true);
      assert.strictEqual(par(object2), false);
      assert.strictEqual(par(object3), false);
    });

    QUnit.test('`_.' + methodName + '` should work with a function for `object`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = { 'b': 2, 'c': 3 };

      var par = matches({ 'a': { 'b': 2 } });
      assert.strictEqual(par(Foo), true);
    });

    QUnit.test('`_.' + methodName + '` should work with a function for `source`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = 1;
      Foo.b = function() {};
      Foo.c = 3;

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': Foo.b, 'c': 3 }],
          actual = lodashStable.map(objects, matches(Foo));

      assert.deepEqual(actual, [false, true]);
    });

    QUnit.test('`_.' + methodName + '` should work with a non-plain `object`', function(assert) {
      assert.expect(1);

      function Foo(object) { lodashStable.assign(this, object); }

      var object = new Foo({ 'a': new Foo({ 'b': 2, 'c': 3 }) }),
          par = matches({ 'a': { 'b': 2 } });

      assert.strictEqual(par(object), true);
    });

    QUnit.test('`_.' + methodName + '` should partial match arrays', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': ['b'] }, { 'a': ['c', 'd'] }],
          actual = lodashStable.filter(objects, matches({ 'a': ['d'] }));

      assert.deepEqual(actual, [objects[1]]);

      actual = lodashStable.filter(objects, matches({ 'a': ['b', 'd'] }));
      assert.deepEqual(actual, []);

      actual = lodashStable.filter(objects, matches({ 'a': ['d', 'b'] }));
      assert.deepEqual(actual, []);
    });

    QUnit.test('`_.' + methodName + '` should partial match arrays with duplicate values', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1, 2] }, { 'a': [2, 2] }],
          actual = lodashStable.filter(objects, matches({ 'a': [2, 2] }));

      assert.deepEqual(actual, [objects[1]]);
    });

    QUnit.test('should partial match arrays of objects', function(assert) {
      assert.expect(1);

      var objects = [
        { 'a': [{ 'b': 1, 'c': 2 }, { 'b': 4, 'c': 5, 'd': 6 }] },
        { 'a': [{ 'b': 1, 'c': 2 }, { 'b': 4, 'c': 6, 'd': 7 }] }
      ];

      var actual = lodashStable.filter(objects, matches({ 'a': [{ 'b': 1 }, { 'b': 4, 'c': 5 }] }));
      assert.deepEqual(actual, [objects[0]]);
    });

    QUnit.test('`_.' + methodName + '` should partial match maps', function(assert) {
      assert.expect(3);

      if (Map) {
        var objects = [{ 'a': new Map }, { 'a': new Map }];
        objects[0].a.set('a', 1);
        objects[1].a.set('a', 1);
        objects[1].a.set('b', 2);

        var map = new Map;
        map.set('b', 2);
        var actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, [objects[1]]);

        map.delete('b');
        actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, objects);

        map.set('c', 3);
        actual = lodashStable.filter(objects, matches({ 'a': map }));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should partial match sets', function(assert) {
      assert.expect(3);

      if (Set) {
        var objects = [{ 'a': new Set }, { 'a': new Set }];
        objects[0].a.add(1);
        objects[1].a.add(1);
        objects[1].a.add(2);

        var set = new Set;
        set.add(2);
        var actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, [objects[1]]);

        set.delete(2);
        actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, objects);

        set.add(3);
        actual = lodashStable.filter(objects, matches({ 'a': set }));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('`_.' + methodName + '` should match `undefined` values', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 1 }, { 'a': 1, 'b': undefined }],
          actual = lodashStable.map(objects, matches({ 'b': undefined })),
          expected = [false, false, true];

      assert.deepEqual(actual, expected);

      actual = lodashStable.map(objects, matches({ 'a': 1, 'b': undefined }));

      assert.deepEqual(actual, expected);

      objects = [{ 'a': { 'b': 2 } }, { 'a': { 'b': 2, 'c': 3 } }, { 'a': { 'b': 2, 'c': undefined } }];
      actual = lodashStable.map(objects, matches({ 'a': { 'c': undefined } }));

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should match `undefined` values on primitives', function(assert) {
      assert.expect(3);

      numberProto.a = 1;
      numberProto.b = undefined;

      try {
        var par = matches({ 'b': undefined });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      try {
        par = matches({ 'a': 1, 'b': undefined });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      numberProto.a = { 'b': 1, 'c': undefined };
      try {
        par = matches({ 'a': { 'c': undefined } });
        assert.strictEqual(par(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      delete numberProto.a;
      delete numberProto.b;
    });

    QUnit.test('`_.' + methodName + '` should return `false` when `object` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse),
          par = matches({ 'a': 1 });

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing an empty `source`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1 },
          expected = lodashStable.map(empties, stubTrue);

      var actual = lodashStable.map(empties, function(value) {
        var par = matches(value);
        return par(object);
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing an empty `source` to a nullish `object`', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubTrue),
          par = matches({});

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('`_.' + methodName + '` should return `true` when comparing a `source` of empty arrays and objects', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1], 'b': { 'c': 1 } }, { 'a': [2, 3], 'b': { 'd': 2 } }],
          actual = lodashStable.filter(objects, matches({ 'a': [], 'b': {} }));

      assert.deepEqual(actual, objects);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.matchesProperty');

  (function() {
    QUnit.test('should create a function that performs a deep comparison between a property value and `srcValue`', function(assert) {
      assert.expect(6);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          matches = _.matchesProperty('a', 1);

      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches(object), true);

      matches = _.matchesProperty('b', 3);
      assert.strictEqual(matches(object), false);

      matches = _.matchesProperty('a', { 'a': 1, 'c': 3 });
      assert.strictEqual(matches({ 'a': object }), true);

      matches = _.matchesProperty('a', { 'c': 3, 'd': 4 });
      assert.strictEqual(matches(object), false);

      object = { 'a': { 'b': { 'c': 1, 'd': 2 }, 'e': 3 }, 'f': 4 };
      matches = _.matchesProperty('a', { 'b': { 'c': 1 } });

      assert.strictEqual(matches(object), true);
    });

    QUnit.test('should support deep paths', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var matches = _.matchesProperty(path, 2);
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        var matches = _.matchesProperty(path, 2);
        assert.strictEqual(matches(array), true);
      });
    });

    QUnit.test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object1 = { '-0': 'a' },
          object2 = { '0': 'b' },
          pairs = [[object1, object2], [object1, object2], [object2, object1], [object2, object1]],
          props = [-0, Object(-0), 0, Object(0)],
          values = ['a', 'a', 'b', 'b'],
          expected = lodashStable.map(props, lodashStable.constant([true, false]));

      var actual = lodashStable.map(props, function(key, index) {
        var matches = _.matchesProperty(key, values[index]),
            pair = pairs[index];

        return [matches(pair[0]), matches(pair[1])];
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}],
          expected = lodashStable.map(paths, stubTrue);

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var matches = _.matchesProperty(index ? [path] : path, object[path]);
          return matches(object);
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should match a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var matches = _.matchesProperty(path, 1);
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should return `false` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var matches = _.matchesProperty(path, 1);

        var actual = lodashStable.map(values, function(value, index) {
          try {
            return index ? matches(value) : matches();
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should return `false` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var matches = _.matchesProperty(path, 1);

        var actual = lodashStable.map(values, function(value, index) {
          try {
            return index ? matches(value) : matches();
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      });
    });

    QUnit.test('should return `false` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var object = {};

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        var matches = _.matchesProperty(path, 1);
        assert.strictEqual(matches(object), false);
      });
    });

    QUnit.test('should match inherited string keyed `srcValue` properties', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.b = 2;

      var object = { 'a': new Foo };

      lodashStable.each(['a', ['a']], function(path) {
        var matches = _.matchesProperty(path, { 'b': 2 });
        assert.strictEqual(matches(object), true);
      });
    });

    QUnit.test('should not match by inherited `srcValue` properties', function(assert) {
      assert.expect(2);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': 2 } }],
          expected = lodashStable.map(objects, stubTrue);

      lodashStable.each(['a', ['a']], function(path) {
        assert.deepEqual(lodashStable.map(objects, _.matchesProperty(path, new Foo)), expected);
      });
    });

    QUnit.test('should compare a variety of values', function(assert) {
      assert.expect(2);

      var object1 = { 'a': false, 'b': true, 'c': '3', 'd': 4, 'e': [5], 'f': { 'g': 6 } },
          object2 = { 'a': 0, 'b': 1, 'c': 3, 'd': '4', 'e': ['5'], 'f': { 'g': '6' } },
          matches = _.matchesProperty('a', object1);

      assert.strictEqual(matches({ 'a': object1 }), true);
      assert.strictEqual(matches({ 'a': object2 }), false);
    });

    QUnit.test('should match `-0` as `0`', function(assert) {
      assert.expect(2);

      var matches = _.matchesProperty('a', -0);
      assert.strictEqual(matches({ 'a': 0 }), true);

      matches = _.matchesProperty('a', 0);
      assert.strictEqual(matches({ 'a': -0 }), true);
    });

    QUnit.test('should compare functions by reference', function(assert) {
      assert.expect(3);

      var object1 = { 'a': lodashStable.noop },
          object2 = { 'a': noop },
          object3 = { 'a': {} },
          matches = _.matchesProperty('a', object1);

      assert.strictEqual(matches({ 'a': object1 }), true);
      assert.strictEqual(matches({ 'a': object2 }), false);
      assert.strictEqual(matches({ 'a': object3 }), false);
    });

    QUnit.test('should work with a function for `srcValue`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = 1;
      Foo.b = function() {};
      Foo.c = 3;

      var objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': Foo.b, 'c': 3 } }],
          actual = lodashStable.map(objects, _.matchesProperty('a', Foo));

      assert.deepEqual(actual, [false, true]);
    });

    QUnit.test('should work with a non-plain `srcValue`', function(assert) {
      assert.expect(1);

      function Foo(object) { lodashStable.assign(this, object); }

      var object = new Foo({ 'a': new Foo({ 'b': 1, 'c': 2 }) }),
          matches = _.matchesProperty('a', { 'b': 1 });

      assert.strictEqual(matches(object), true);
    });

    QUnit.test('should partial match arrays', function(assert) {
      assert.expect(3);

      var objects = [{ 'a': ['b'] }, { 'a': ['c', 'd'] }],
          actual = lodashStable.filter(objects, _.matchesProperty('a', ['d']));

      assert.deepEqual(actual, [objects[1]]);

      actual = lodashStable.filter(objects, _.matchesProperty('a', ['b', 'd']));
      assert.deepEqual(actual, []);

      actual = lodashStable.filter(objects, _.matchesProperty('a', ['d', 'b']));
      assert.deepEqual(actual, []);
    });

    QUnit.test('should partial match arrays with duplicate values', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1, 2] }, { 'a': [2, 2] }],
          actual = lodashStable.filter(objects, _.matchesProperty('a', [2, 2]));

      assert.deepEqual(actual, [objects[1]]);
    });

    QUnit.test('should partial match arrays of objects', function(assert) {
      assert.expect(1);

      var objects = [
        { 'a': [{ 'a': 1, 'b': 2 }, { 'a': 4, 'b': 5, 'c': 6 }] },
        { 'a': [{ 'a': 1, 'b': 2 }, { 'a': 4, 'b': 6, 'c': 7 }] }
      ];

      var actual = lodashStable.filter(objects, _.matchesProperty('a', [{ 'a': 1 }, { 'a': 4, 'b': 5 }]));
      assert.deepEqual(actual, [objects[0]]);
    });
    QUnit.test('should partial match maps', function(assert) {
      assert.expect(3);

      if (Map) {
        var objects = [{ 'a': new Map }, { 'a': new Map }];
        objects[0].a.set('a', 1);
        objects[1].a.set('a', 1);
        objects[1].a.set('b', 2);

        var map = new Map;
        map.set('b', 2);
        var actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, [objects[1]]);

        map.delete('b');
        actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, objects);

        map.set('c', 3);
        actual = lodashStable.filter(objects, _.matchesProperty('a', map));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should partial match sets', function(assert) {
      assert.expect(3);

      if (Set) {
        var objects = [{ 'a': new Set }, { 'a': new Set }];
        objects[0].a.add(1);
        objects[1].a.add(1);
        objects[1].a.add(2);

        var set = new Set;
        set.add(2);
        var actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, [objects[1]]);

        set.delete(2);
        actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, objects);

        set.add(3);
        actual = lodashStable.filter(objects, _.matchesProperty('a', set));

        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should match `undefined` values', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'a': 1, 'b': 1 }, { 'a': 1, 'b': undefined }],
          actual = lodashStable.map(objects, _.matchesProperty('b', undefined)),
          expected = [false, false, true];

      assert.deepEqual(actual, expected);

      objects = [{ 'a': { 'a': 1 } }, { 'a': { 'a': 1, 'b': 1 } }, { 'a': { 'a': 1, 'b': undefined } }];
      actual = lodashStable.map(objects, _.matchesProperty('a', { 'b': undefined }));

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should match `undefined` values of nested objects', function(assert) {
      assert.expect(4);

      var object = { 'a': { 'b': undefined } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var matches = _.matchesProperty(path, undefined);
        assert.strictEqual(matches(object), true);
      });

      lodashStable.each(['a.a', ['a', 'a']], function(path) {
        var matches = _.matchesProperty(path, undefined);
        assert.strictEqual(matches(object), false);
      });
    });

    QUnit.test('should match `undefined` values on primitives', function(assert) {
      assert.expect(2);

      numberProto.a = 1;
      numberProto.b = undefined;

      try {
        var matches = _.matchesProperty('b', undefined);
        assert.strictEqual(matches(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      numberProto.a = { 'b': 1, 'c': undefined };
      try {
        matches = _.matchesProperty('a', { 'c': undefined });
        assert.strictEqual(matches(1), true);
      } catch (e) {
        assert.ok(false, e.message);
      }
      delete numberProto.a;
      delete numberProto.b;
    });

    QUnit.test('should return `true` when comparing a `srcValue` of empty arrays and objects', function(assert) {
      assert.expect(1);

      var objects = [{ 'a': [1], 'b': { 'c': 1 } }, { 'a': [2, 3], 'b': { 'd': 2 } }],
          matches = _.matchesProperty('a', { 'a': [], 'b': {} });

      var actual = lodashStable.filter(objects, function(object) {
        return matches({ 'a': object });
      });

      assert.deepEqual(actual, objects);
    });

    QUnit.test('should not change behavior if `srcValue` is modified', function(assert) {
      assert.expect(9);

      lodashStable.each([{ 'a': { 'b': 2, 'c': 3 } }, { 'a': 1, 'b': 2 }, { 'a': 1 }], function(source, index) {
        var object = lodashStable.cloneDeep(source),
            matches = _.matchesProperty('a', source);

        assert.strictEqual(matches({ 'a': object }), true);

        if (index) {
          source.a = 2;
          source.b = 1;
          source.c = 3;
        } else {
          source.a.b = 1;
          source.a.c = 2;
          source.a.d = 3;
        }
        assert.strictEqual(matches({ 'a': object }), true);
        assert.strictEqual(matches({ 'a': source }), false);
      });
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.max');

  (function() {
    QUnit.test('should return the largest value from a collection', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.max([1, 2, 3]), 3);
    });

    QUnit.test('should return `undefined` for empty collections', function(assert) {
      assert.expect(1);

      var values = falsey.concat([[]]),
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? _.max(value) : _.max();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should work with non-numeric collection values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.max(['a', 'b']), 'b');
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.mean');

  (function() {
    QUnit.test('should return the mean of an array of numbers', function(assert) {
      assert.expect(1);

      var array = [4, 2, 8, 6];
      assert.strictEqual(_.mean(array), 5);
    });

    QUnit.test('should return `NaN` when passing empty `array` values', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubNaN),
          actual = lodashStable.map(empties, _.mean);

      assert.deepEqual(actual, expected);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.meanBy');

  (function() {
    var objects = [{ 'a': 2 }, { 'a': 3 }, { 'a': 1 }];

    QUnit.test('should work with an `iteratee`', function(assert) {
      assert.expect(1);

      var actual = _.meanBy(objects, function(object) {
        return object.a;
      });

      assert.deepEqual(actual, 2);
    });

    QUnit.test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.meanBy(objects, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [{ 'a': 2 }]);
    });

    QUnit.test('should work with `_.property` shorthands', function(assert) {
      assert.expect(2);

      var arrays = [[2], [3], [1]];
      assert.strictEqual(_.meanBy(arrays, 0), 2);
      assert.strictEqual(_.meanBy(objects, 'a'), 2);
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.memoize');

  (function() {
    function CustomCache() {
      this.clear();
    }

    CustomCache.prototype = {
      'clear': function() {
        this.__data__ = [];
        return this;
      },
      'get': function(key) {
        var entry = lodashStable.find(this.__data__, ['key', key]);
        return entry && entry.value;
      },
      'has': function(key) {
        return lodashStable.some(this.__data__, ['key', key]);
      },
      'set': function(key, value) {
        this.__data__.push({ 'key': key, 'value': value });
        return this;
      }
    };

    function ImmutableCache() {
      this.__data__ = [];
    }

    ImmutableCache.prototype = lodashStable.create(CustomCache.prototype, {
      'constructor': ImmutableCache,
      'clear': function() {
        return new ImmutableCache;
      },
      'set': function(key, value) {
        var result = new ImmutableCache;
        result.__data__ = this.__data__.concat({ 'key': key, 'value': value });
        return result;
      }
    });

    QUnit.test('should memoize results based on the first argument given', function(assert) {
      assert.expect(2);

      var memoized = _.memoize(function(a, b, c) {
        return a + b + c;
      });

      assert.strictEqual(memoized(1, 2, 3), 6);
      assert.strictEqual(memoized(1, 3, 5), 6);
    });

    QUnit.test('should support a `resolver`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) { return a + b + c; },
          memoized = _.memoize(fn, fn);

      assert.strictEqual(memoized(1, 2, 3), 6);
      assert.strictEqual(memoized(1, 3, 5), 9);
    });

    QUnit.test('should use `this` binding of function for `resolver`', function(assert) {
      assert.expect(2);

      var fn = function(a, b, c) { return a + this.b + this.c; },
          memoized = _.memoize(fn, fn);

      var object = { 'memoized': memoized, 'b': 2, 'c': 3 };
      assert.strictEqual(object.memoized(1), 6);

      object.b = 3;
      object.c = 5;
      assert.strictEqual(object.memoized(1), 9);
    });

    QUnit.test('should throw a TypeError if `resolve` is truthy and not a function', function(assert) {
      assert.expect(1);

      assert.raises(function() { _.memoize(noop, true); }, TypeError);
    });

    QUnit.test('should not error if `resolver` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(resolver, index) {
        try {
          return _.isFunction(index ? _.memoize(noop, resolver) : _.memoize(noop));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    });

    QUnit.test('should check cache for own properties', function(assert) {
      assert.expect(1);

      var props = [
        'constructor',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString',
        'toString',
        'valueOf'
      ];

      var memoized = _.memoize(identity);

      var actual = lodashStable.map(props, function(value) {
        return memoized(value);
      });

      assert.deepEqual(actual, props);
    });

    QUnit.test('should cache the `__proto__` key', function(assert) {
      assert.expect(8);

      var array = [],
          key = '__proto__';

      lodashStable.times(2, function(index) {
        var count = 0,
            resolver = index ? identity : undefined;

        var memoized = _.memoize(function() {
          count++;
          return array;
        }, resolver);

        var cache = memoized.cache;

        memoized(key);
        memoized(key);

        assert.strictEqual(count, 1);
        assert.strictEqual(cache.get(key), array);
        assert.notOk(cache.__data__ instanceof Array);
        assert.strictEqual(cache.delete(key), true);
      });
    });

    QUnit.test('should allow `_.memoize.Cache` to be customized', function(assert) {
      assert.expect(4);

      var oldCache = _.memoize.Cache;
      _.memoize.Cache = CustomCache;

      var memoized = _.memoize(function(object) {
        return object.id;
      });

      var cache = memoized.cache,
          key1 = { 'id': 'a' },
          key2 = { 'id': 'b' };

      assert.strictEqual(memoized(key1), 'a');
      assert.strictEqual(cache.has(key1), true);

      assert.strictEqual(memoized(key2), 'b');
      assert.strictEqual(cache.has(key2), true);

      _.memoize.Cache = oldCache;
    });

    QUnit.test('should works with an immutable `_.memoize.Cache` ', function(assert) {
      assert.expect(2);

      var oldCache = _.memoize.Cache;
      _.memoize.Cache = ImmutableCache;

      var memoized = _.memoize(function(object) {
        return object.id;
      });

      var key1 = { 'id': 'a' },
          key2 = { 'id': 'b' };

      memoized(key1);
      memoized(key2);

      var cache = memoized.cache;
      assert.strictEqual(cache.has(key1), true);
      assert.strictEqual(cache.has(key2), true);

      _.memoize.Cache = oldCache;
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('memoizeCapped');

  (function() {
    var func = _._memoizeCapped;

    QUnit.test('should enforce a max cache size of `MAX_MEMOIZE_SIZE`', function(assert) {
      assert.expect(2);

      if (func) {
        var memoized = func(identity),
            cache = memoized.cache;

        lodashStable.times(MAX_MEMOIZE_SIZE, memoized);
        assert.strictEqual(cache.size, MAX_MEMOIZE_SIZE);

        memoized(MAX_MEMOIZE_SIZE);
        assert.strictEqual(cache.size, 1);
      }
      else {
        skipAssert(assert, 2);
      }
    });
  }());

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.merge');

  (function() {
    QUnit.test('should merge `source` into `object`', function(assert) {
      assert.expect(1);

      var names = {
        'characters': [
          { 'name': 'barney' },
          { 'name': 'fred' }
        ]
      };

      var ages = {
        'characters': [
          { 'age': 36 },
          { 'age': 40 }
        ]
      };

      var heights = {
        'characters': [
          { 'height': '5\'4"' }
```

#### should create a function that calls a method of a given object

```ts
test('should create a function that calls a method of a given object', function(assert) {
      assert.expect(4);

      var object = { 'a': stubOne };

      lodashStable.each(['a', ['a']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method.length, 1);
        assert.strictEqual(method(object), 1);
      });
    }
```

#### should work with deep property values

```ts
test('should work with deep property values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': stubTwo } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(object), 2);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = lodashStable.times(3, _.constant);

      lodashStable.each([1, [1]], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(array), 1);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': stubOne, 'undefined': stubTwo, 'fn': stubThree, '[object Object]': stubFour },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var method = _.method(index ? [path] : path);
          return method(object);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work with inherited property values

```ts
test('should work with inherited property values', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.a = stubOne;

      lodashStable.each(['a', ['a']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(new Foo), 1);
      });
    }
```

#### should use a key over a path

```ts
test('should use a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': stubOne, 'a': { 'b': stubTwo } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(object), 1);
      });
    }
```

#### should return `undefined` when `object` is nullish

```ts
test('should return `undefined` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var method = _.method(path);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? method(value) : method();
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` for deep paths when `object` is nullish

```ts
test('should return `undefined` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var method = _.method(path);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? method(value) : method();
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` if parts of `path` are missing

```ts
test('should return `undefined` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var object = {};

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(object), undefined);
      });
    }
```

#### should apply partial arguments to function

```ts
test('should apply partial arguments to function', function(assert) {
      assert.expect(2);

      var object = {
        'fn': function() {
          return slice.call(arguments);
        }
      };

      lodashStable.each(['fn', ['fn']], function(path) {
        var method = _.method(path, 1, 2, 3);
        assert.deepEqual(method(object), [1, 2, 3]);
      });
    }
```

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': function() { return this.c; }, 'c': 1 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var method = _.method(path);
        assert.strictEqual(method(object), 1);
      });
    }
```

#### should create a function that calls a method of a given key

```ts
test('should create a function that calls a method of a given key', function(assert) {
      assert.expect(4);

      var object = { 'a': stubOne };

      lodashStable.each(['a', ['a']], function(path) {
        var methodOf = _.methodOf(object);
        assert.strictEqual(methodOf.length, 1);
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should work with deep property values

```ts
test('should work with deep property values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': stubTwo } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var methodOf = _.methodOf(object);
        assert.strictEqual(methodOf(path), 2);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = lodashStable.times(3, _.constant);

      lodashStable.each([1, [1]], function(path) {
        var methodOf = _.methodOf(array);
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': stubOne, 'undefined': stubTwo, 'fn': stubThree, '[object Object]': stubFour },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var methodOf = _.methodOf(object);
          return methodOf(index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should work with inherited property values

```ts
test('should work with inherited property values', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.a = stubOne;

      lodashStable.each(['a', ['a']], function(path) {
        var methodOf = _.methodOf(new Foo);
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should use a key over a path

```ts
test('should use a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': stubOne, 'a': { 'b': stubTwo } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var methodOf = _.methodOf(object);
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should return `undefined` when `object` is nullish

```ts
test('should return `undefined` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var actual = lodashStable.map(values, function(value, index) {
          var methodOf = index ? _.methodOf() : _.methodOf(value);
          return methodOf(path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` for deep paths when `object` is nullish

```ts
test('should return `undefined` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var actual = lodashStable.map(values, function(value, index) {
          var methodOf = index ? _.methodOf() : _.methodOf(value);
          return methodOf(path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` if parts of `path` are missing

```ts
test('should return `undefined` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var object = {},
          methodOf = _.methodOf(object);

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        assert.strictEqual(methodOf(path), undefined);
      });
    }
```

#### should apply partial arguments to function

```ts
test('should apply partial arguments to function', function(assert) {
      assert.expect(2);

      var object = {
        'fn': function() {
          return slice.call(arguments);
        }
      };

      var methodOf = _.methodOf(object, 1, 2, 3);

      lodashStable.each(['fn', ['fn']], function(path) {
        assert.deepEqual(methodOf(path), [1, 2, 3]);
      });
    }
```

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': function() { return this.c; }, 'c': 1 } },
          methodOf = _.methodOf(object);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(methodOf(path), 1);
      });
    }
```

#### should work with a `root` of `this`

```ts
test('should work with a `root` of `this`', function(assert) {
      assert.expect(2);

      if (!coverage && !document && !isModularize && realm.object) {
        var fs = require('fs'),
            vm = require('vm'),
            expected = {},
            context = vm.createContext({ '_': expected, 'console': console }),
            source = fs.readFileSync(filePath, 'utf8');

        vm.runInContext(source + '\nthis.lodash = this._.noConflict()', context);

        assert.strictEqual(context._, expected);
        assert.ok(context.lodash);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should flatten `paths`

```ts
test('should flatten `paths`', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.omit(object, 'a', 'c'), { 'b': 2, 'd': 4 });
      assert.deepEqual(_.omit(object, ['a', 'd'], 'c'), { 'b': 2 });
    }
```

#### should support deep paths

```ts
test('should support deep paths', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.omit(nested, 'b.c'), { 'a': 1, 'b': { 'd': 3} });
    }
```

#### should support path arrays

```ts
test('should support path arrays', function(assert) {
      assert.expect(1);

      var object = { 'a.b': 1, 'a': { 'b': 2 } },
          actual = _.omit(object, [['a.b']]);

      assert.deepEqual(actual, { 'a': { 'b': 2 } });
    }
```

#### should omit a key over a path

```ts
test('should omit a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        assert.deepEqual(_.omit(object, path), { 'a': { 'b': 2 } });
      });
    }
```

#### should coerce `paths` to strings

```ts
test('should coerce `paths` to strings', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.omit({ '0': 'a' }, 0), {});
    }
```

#### should work with `arguments` object `paths`

```ts
test('should work with `arguments` object `paths`', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.omit(object, args), { 'b': 2, 'd': 4 });
    }
```

#### should not mutate `object`

```ts
test('should not mutate `object`', function(assert) {
      assert.expect(4);

      lodashStable.each(['a', ['a'], 'a.b', ['a.b']], function(path) {
        var object = { 'a': { 'b': 2 } };
        _.omit(object, path);
        assert.deepEqual(object, { 'a': { 'b': 2 } });
      });
    }
```

#### should flatten `paths`

```ts
test('should flatten `paths`', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.pick(object, 'a', 'c'), { 'a': 1, 'c': 3 });
      assert.deepEqual(_.pick(object, ['a', 'd'], 'c'), { 'a': 1, 'c': 3, 'd': 4 });
    }
```

#### should support deep paths

```ts
test('should support deep paths', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.pick(nested, 'b.c'), { 'b': { 'c': 2 } });
    }
```

#### should support path arrays

```ts
test('should support path arrays', function(assert) {
      assert.expect(1);

      var object = { 'a.b': 1, 'a': { 'b': 2 } },
          actual = _.pick(object, [['a.b']]);

      assert.deepEqual(actual, { 'a.b': 1 });
    }
```

#### should pick a key over a path

```ts
test('should pick a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        assert.deepEqual(_.pick(object, path), { 'a.b': 1 });
      });
    }
```

#### should coerce `paths` to strings

```ts
test('should coerce `paths` to strings', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.pick({ '0': 'a', '1': 'b' }, 0), { '0': 'a' });
    }
```

#### should not treat keys with dots as deep paths

```ts
test('should not treat keys with dots as deep paths', function(assert) {
      assert.expect(1);

      var object = { 'a.b.c': 1 },
          actual = _.pickBy(object, stubTrue);

      assert.deepEqual(actual, { 'a.b.c': 1 });
    }
```

#### should create a function that plucks a property value of a given object

```ts
test('should create a function that plucks a property value of a given object', function(assert) {
      assert.expect(4);

      var object = { 'a': 1 };

      lodashStable.each(['a', ['a']], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop.length, 1);
        assert.strictEqual(prop(object), 1);
      });
    }
```

#### should pluck deep property values

```ts
test('should pluck deep property values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(object), 2);
      });
    }
```

#### should pluck inherited property values

```ts
test('should pluck inherited property values', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.prototype.a = 1;

      lodashStable.each(['a', ['a']], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(new Foo), 1);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3];

      lodashStable.each([1, [1]], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(array), 2);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var prop = _.property(index ? [path] : path);
          return prop(object);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should pluck a key over a path

```ts
test('should pluck a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(object), 1);
      });
    }
```

#### should return `undefined` when `object` is nullish

```ts
test('should return `undefined` when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        var prop = _.property(path);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? prop(value) : prop();
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` for deep paths when `object` is nullish

```ts
test('should return `undefined` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, noop);

      lodashStable.each(['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']], function(path) {
        var prop = _.property(path);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? prop(value) : prop();
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should return `undefined` if parts of `path` are missing

```ts
test('should return `undefined` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var object = {};

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        var prop = _.property(path);
        assert.strictEqual(prop(object), undefined);
      });
    }
```

#### should create a function that plucks a property value of a given key

```ts
test('should create a function that plucks a property value of a given key', function(assert) {
      assert.expect(3);

      var object = { 'a': 1 },
          propOf = _.propertyOf(object);

      assert.strictEqual(propOf.length, 1);
      lodashStable.each(['a', ['a']], function(path) {
        assert.strictEqual(propOf(path), 1);
      });
    }
```

#### should pluck deep property values

```ts
test('should pluck deep property values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2 } },
          propOf = _.propertyOf(object);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(propOf(path), 2);
      });
    }
```

#### should pluck inherited property values

```ts
test('should pluck inherited property values', function(assert) {
      assert.expect(2);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var propOf = _.propertyOf(new Foo);

      lodashStable.each(['b', ['b']], function(path) {
        assert.strictEqual(propOf(path), 2);
      });
    }
```

#### should work with a non-string `path`

```ts
test('should work with a non-string `path`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          propOf = _.propertyOf(array);

      lodashStable.each([1, [1]], function(path) {
        assert.strictEqual(propOf(path), 2);
      });
    }
```

#### should coerce `path` to a string

```ts
test('should coerce `path` to a string', function(assert) {
      assert.expect(2);

      function fn() {}
      fn.toString = lodashStable.constant('fn');

      var expected = [1, 2, 3, 4],
          object = { 'null': 1, 'undefined': 2, 'fn': 3, '[object Object]': 4 },
          paths = [null, undefined, fn, {}];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(paths, function(path) {
          var propOf = _.propertyOf(object);
          return propOf(index ? [path] : path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should pluck a key over a path

```ts
test('should pluck a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } },
          propOf = _.propertyOf(object);

      lodashStable.each(['a.b', ['a.b']], function(path) {
        assert.strictEqual(propOf(path), 1);
      });
    }
```

#### should return `undefined` if parts of `path` are missing

```ts
test('should return `undefined` if parts of `path` are missing', function(assert) {
      assert.expect(4);

      var propOf = _.propertyOf({});

      lodashStable.each(['a', 'a[1].b.c', ['a'], ['a', '1', 'b', 'c']], function(path) {
        assert.strictEqual(propOf(path), undefined);
      });
    }
```

#### should work with non-index paths

```ts
test('should work with non-index paths', function(assert) {
      assert.expect(2);

      var values = lodashStable.reject(empties, function(value) {
        return (value === 0) || lodashStable.isArray(value);
      }).concat(-1, 1.1);

      var array = lodashStable.transform(values, function(result, value) {
        result[value] = 1;
      }, []);

      var expected = lodashStable.map(values, stubOne),
          actual = _.pullAt(array, values);

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(values, noop);
      actual = lodashStable.at(array, values);

      assert.deepEqual(actual, expected);
    }
```

#### should support deep paths

```ts
test('should support deep paths', function(assert) {
      assert.expect(3);

      var array = [];
      array.a = { 'b': 2 };

      var actual = _.pullAt(array, 'a.b');

      assert.deepEqual(actual, [2]);
      assert.deepEqual(array.a, {});

      try {
        actual = _.pullAt(array, 'a.b.c');
      } catch (e) {}

      assert.deepEqual(actual, [undefined]);
    }
```

#### should invoke nested function values

```ts
test('should invoke nested function values', function(assert) {
      assert.expect(2);

      var value = { 'a': lodashStable.constant({ 'b': stubB }) };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(_.result(value, path), 'b');
      });
    }
```

#### `_.' + methodName + '` should get string keyed property values

```ts
test('`_.' + methodName + '` should get string keyed property values', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 };

      lodashStable.each(['a', ['a']], function(path) {
        assert.strictEqual(func(object, path), 1);
      });
    }
```

#### `_.' + methodName + '` should get deep property values

```ts
test('`_.' + methodName + '` should get deep property values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(func(object, path), 2);
      });
    }
```

#### `_.' + methodName + '` should get a key over a path

```ts
test('`_.' + methodName + '` should get a key over a path', function(assert) {
      assert.expect(2);

      var object = { 'a.b': 1, 'a': { 'b': 2 } };

      lodashStable.each(['a.b', ['a.b']], function(path) {
        assert.strictEqual(func(object, path), 1);
      });
    }
```

#### `_.' + methodName + '` should not coerce array paths to strings

```ts
test('`_.' + methodName + '` should not coerce array paths to strings', function(assert) {
      assert.expect(1);

      var object = { 'a,b,c': 3, 'a': { 'b': { 'c': 4 } } };
      assert.strictEqual(func(object, ['a', 'b', 'c']), 4);
    }
```

#### `_.' + methodName + '` should handle empty paths

```ts
test('`_.' + methodName + '` should handle empty paths', function(assert) {
      assert.expect(4);

      lodashStable.each([['', ''], [[], ['']]], function(pair) {
        assert.strictEqual(func({}, pair[0]), undefined);
        assert.strictEqual(func({ '': 3 }, pair[1]), 3);
      });
    }
```

#### `_.' + methodName + '` should handle complex paths

```ts
test('`_.' + methodName + '` should handle complex paths', function(assert) {
      assert.expect(2);

      var object = { 'a': { '-1.23': { '["b"]': { 'c': { "['d']": { '\ne\n': { 'f': { 'g': 8 } } } } } } } };

      var paths = [
        'a[-1.23]["[\\"b\\"]"].c[\'[\\\'d\\\']\'][\ne\n][f].g',
        ['a', '-1.23', '["b"]', 'c', "['d']", '\ne\n', 'f', 'g']
      ];

      lodashStable.each(paths, function(path) {
        assert.strictEqual(func(object, path), 8);
      });
    }
```

#### `_.' + methodName + '` should return `undefined` when `object` is nullish

```ts
test('`_.' + methodName + '` should return `undefined` when `object` is nullish', function(assert) {
      assert.expect(4);

      lodashStable.each(['constructor', ['constructor']], function(path) {
        assert.strictEqual(func(null, path), undefined);
        assert.strictEqual(func(undefined, path), undefined);
      });
    }
```

#### `_.' + methodName + '` should return `undefined` for deep paths when `object` is nullish

```ts
test('`_.' + methodName + '` should return `undefined` for deep paths when `object` is nullish', function(assert) {
      assert.expect(2);

      var values = [null, undefined],
          expected = lodashStable.map(values, noop),
          paths = ['constructor.prototype.valueOf', ['constructor', 'prototype', 'valueOf']];

      lodashStable.each(paths, function(path) {
        var actual = lodashStable.map(values, function(value) {
          return func(value, path);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return `undefined` if parts of `path` are missing

```ts
test('`_.' + methodName + '` should return `undefined` if parts of `path` are missing', function(assert) {
      assert.expect(2);

      var object = { 'a': [, null] };

      lodashStable.each(['a[1].b.c', ['a', '1', 'b', 'c']], function(path) {
        assert.strictEqual(func(object, path), undefined);
      });
    }
```

#### `_.' + methodName + '` should be able to return `null` values

```ts
test('`_.' + methodName + '` should be able to return `null` values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': null } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(func(object, path), null);
      });
    }
```

#### `_.' + methodName + '` should follow `path` over non-plain objects

```ts
test('`_.' + methodName + '` should follow `path` over non-plain objects', function(assert) {
      assert.expect(2);

      var paths = ['a.b', ['a', 'b']];

      lodashStable.each(paths, function(path) {
        numberProto.a = { 'b': 2 };
        assert.strictEqual(func(0, path), 2);
        delete numberProto.a;
      });
    }
```

#### `_.' + methodName + '` should return the default value for `undefined` values

```ts
test('`_.' + methodName + '` should return the default value for `undefined` values', function(assert) {
      assert.expect(2);

      var object = { 'a': {} },
          values = empties.concat(true, new Date, 1, /x/, 'a'),
          expected = lodashStable.map(values, function(value) { return [value, value]; });

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var actual = lodashStable.map(values, function(value) {
          return [func(object, path, value), func(null, path, value)];
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return the default value when `path` is empty

```ts
test('`_.' + methodName + '` should return the default value when `path` is empty', function(assert) {
      assert.expect(1);

      assert.strictEqual(func({}, [], 'a'), 'a');
    }
```

#### `_.' + methodName + '` should set property values

```ts
test('`_.' + methodName + '` should set property values', function(assert) {
      assert.expect(4);

      lodashStable.each(['a', ['a']], function(path) {
        var object = { 'a': oldValue },
            actual = func(object, path, updater);

        assert.strictEqual(actual, object);
        assert.strictEqual(object.a, value);
      });
    }
```

#### `_.' + methodName + '` should set deep property values

```ts
test('`_.' + methodName + '` should set deep property values', function(assert) {
      assert.expect(4);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var object = { 'a': { 'b': oldValue } },
            actual = func(object, path, updater);

        assert.strictEqual(actual, object);
        assert.strictEqual(object.a.b, value);
      });
    }
```

#### `_.' + methodName + '` should set a key over a path

```ts
test('`_.' + methodName + '` should set a key over a path', function(assert) {
      assert.expect(4);

      lodashStable.each(['a.b', ['a.b']], function(path) {
        var object = { 'a.b': oldValue },
            actual = func(object, path, updater);

        assert.strictEqual(actual, object);
        assert.deepEqual(object, { 'a.b': value });
      });
    }
```

#### `_.' + methodName + '` should not coerce array paths to strings

```ts
test('`_.' + methodName + '` should not coerce array paths to strings', function(assert) {
      assert.expect(1);

      var object = { 'a,b,c': 1, 'a': { 'b': { 'c': 1 } } };

      func(object, ['a', 'b', 'c'], updater);
      assert.strictEqual(object.a.b.c, value);
    }
```

#### `_.' + methodName + '` should handle empty paths

```ts
test('`_.' + methodName + '` should handle empty paths', function(assert) {
      assert.expect(4);

      lodashStable.each([['', ''], [[], ['']]], function(pair, index) {
        var object = {};

        func(object, pair[0], updater);
        assert.deepEqual(object, index ? {} : { '': value });

        func(object, pair[1], updater);
        assert.deepEqual(object, { '': value });
      });
    }
```

#### `_.' + methodName + '` should handle complex paths

```ts
test('`_.' + methodName + '` should handle complex paths', function(assert) {
      assert.expect(2);

      var object = { 'a': { '1.23': { '["b"]': { 'c': { "['d']": { '\ne\n': { 'f': { 'g': oldValue } } } } } } } };

      var paths = [
        'a[-1.23]["[\\"b\\"]"].c[\'[\\\'d\\\']\'][\ne\n][f].g',
        ['a', '-1.23', '["b"]', 'c', "['d']", '\ne\n', 'f', 'g']
      ];

      lodashStable.each(paths, function(path) {
        func(object, path, updater);
        assert.strictEqual(object.a[-1.23]['["b"]'].c["['d']"]['\ne\n'].f.g, value);
        object.a[-1.23]['["b"]'].c["['d']"]['\ne\n'].f.g = oldValue;
      });
    }
```

#### `_.' + methodName + '` should create parts of `path` that are missing

```ts
test('`_.' + methodName + '` should create parts of `path` that are missing', function(assert) {
      assert.expect(6);

      var object = {};

      lodashStable.each(['a[1].b.c', ['a', '1', 'b', 'c']], function(path) {
        var actual = func(object, path, updater);

        assert.strictEqual(actual, object);
        assert.deepEqual(actual, { 'a': [undefined, { 'b': { 'c': value } }] });
        assert.notOk('0' in object.a);

        delete object.a;
      });
    }
```

#### `_.' + methodName + '` should overwrite primitives in the path

```ts
test('`_.' + methodName + '` should overwrite primitives in the path', function(assert) {
      assert.expect(2);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var object = { 'a': '' };

        func(object, path, updater);
        assert.deepEqual(object, { 'a': { 'b': 2 } });
      });;
    }
```

#### should convert a string to a path

```ts
test('should convert a string to a path', function(assert) {
      assert.expect(2);

      assert.deepEqual(_.toPath('a.b.c'), ['a', 'b', 'c']);
      assert.deepEqual(_.toPath('a[0].b.c'), ['a', '0', 'b', 'c']);
    }
```

#### should coerce array elements to strings

```ts
test('should coerce array elements to strings', function(assert) {
      assert.expect(4);

      var array = ['a', 'b', 'c'];

      lodashStable.each([array, lodashStable.map(array, Object)], function(value) {
        var actual = _.toPath(value);
        assert.deepEqual(actual, array);
        assert.notStrictEqual(actual, array);
      });
    }
```

#### should return new path array

```ts
test('should return new path array', function(assert) {
      assert.expect(1);

      assert.notStrictEqual(_.toPath('a.b.c'), _.toPath('a.b.c'));
    }
```

#### should not coerce symbols to strings

```ts
test('should not coerce symbols to strings', function(assert) {
      assert.expect(4);

      if (Symbol) {
        var object = Object(symbol);
        lodashStable.each([symbol, object, [symbol], [object]], function(value) {
          var actual = _.toPath(value);
          assert.ok(lodashStable.isSymbol(actual[0]));
        });
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should handle complex paths

```ts
test('should handle complex paths', function(assert) {
      assert.expect(1);

      var actual = _.toPath('a[-1.23]["[\\"b\\"]"].c[\'[\\\'d\\\']\'][\ne\n][f].g');
      assert.deepEqual(actual, ['a', '-1.23', '["b"]', 'c', "['d']", '\ne\n', 'f', 'g']);
    }
```

#### should handle consecutive empty brackets and dots

```ts
test('should handle consecutive empty brackets and dots', function(assert) {
      assert.expect(12);

      var expected = ['', 'a'];
      assert.deepEqual(_.toPath('.a'), expected);
      assert.deepEqual(_.toPath('[].a'), expected);

      expected = ['', '', 'a'];
      assert.deepEqual(_.toPath('..a'), expected);
      assert.deepEqual(_.toPath('[][].a'), expected);

      expected = ['a', '', 'b'];
      assert.deepEqual(_.toPath('a..b'), expected);
      assert.deepEqual(_.toPath('a[].b'), expected);

      expected = ['a', '', '', 'b'];
      assert.deepEqual(_.toPath('a...b'), expected);
      assert.deepEqual(_.toPath('a[][].b'), expected);

      expected = ['a', ''];
      assert.deepEqual(_.toPath('a.'), expected);
      assert.deepEqual(_.toPath('a[]'), expected);

      expected = ['a', '', ''];
      assert.deepEqual(_.toPath('a..'), expected);
      assert.deepEqual(_.toPath('a[][]'), expected);
    }
```

#### should unset property values

```ts
test('should unset property values', function(assert) {
      assert.expect(4);

      lodashStable.each(['a', ['a']], function(path) {
        var object = { 'a': 1, 'c': 2 };
        assert.strictEqual(_.unset(object, path), true);
        assert.deepEqual(object, { 'c': 2 });
      });
    }
```

#### should unset deep property values

```ts
test('should unset deep property values', function(assert) {
      assert.expect(4);

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        var object = { 'a': { 'b': null } };
        assert.strictEqual(_.unset(object, path), true);
        assert.deepEqual(object, { 'a': {} });
      });
    }
```

#### should handle complex paths

```ts
test('should handle complex paths', function(assert) {
      assert.expect(4);

      var paths = [
        'a[-1.23]["[\\"b\\"]"].c[\'[\\\'d\\\']\'][\ne\n][f].g',
        ['a', '-1.23', '["b"]', 'c', "['d']", '\ne\n', 'f', 'g']
      ];

      lodashStable.each(paths, function(path) {
        var object = { 'a': { '-1.23': { '["b"]': { 'c': { "['d']": { '\ne\n': { 'f': { 'g': 8 } } } } } } } };
        assert.strictEqual(_.unset(object, path), true);
        assert.notOk('g' in object.a[-1.23]['["b"]'].c["['d']"]['\ne\n'].f);
      });
    }
```

#### should return `true` for nonexistent paths

```ts
test('should return `true` for nonexistent paths', function(assert) {
      assert.expect(5);

      var object = { 'a': { 'b': { 'c': null } } };

      lodashStable.each(['z', 'a.z', 'a.b.z', 'a.b.c.z'], function(path) {
        assert.strictEqual(_.unset(object, path), true);
      });

      assert.deepEqual(object, { 'a': { 'b': { 'c': null } } });
    }
```

#### should block constructor.prototype paths from primitives but follow regular non-plain paths

```ts
test('should block constructor.prototype paths from primitives but follow regular non-plain paths', function(assert) {
      assert.expect(8);

      var object = { 'a': '' },
          paths = ['constructor.prototype.a', ['constructor', 'prototype', 'a']];

      lodashStable.each(paths, function(path) {
        numberProto.a = 1;

        var actual = _.unset(0, path);
        assert.strictEqual(actual, false);
        assert.ok('a' in numberProto);

        delete numberProto.a;
      });

      lodashStable.each(['a.replace.b', ['a', 'replace', 'b']], function(path) {
        stringProto.replace.b = 1;

        var actual = _.unset(object, path);
        assert.strictEqual(actual, true);
        assert.notOk('a' in stringProto.replace);

        delete stringProto.replace.b;
      });
    }
```

#### Security: _.unset should protect built-in prototype methods on primitive types

```ts
test('Security: _.unset should protect built-in prototype methods on primitive types', function(assert) {
      assert.expect(11);

      // Number.prototype built-ins
      assert.strictEqual(typeof numberProto.toFixed, 'function', 'Number.prototype.toFixed should exist before unset');

      assert.strictEqual(_.unset(0, 'constructor.prototype.toFixed'), false, 'should return false for built-in Number.prototype.toFixed');
      assert.strictEqual(_.unset(0, ['constructor', 'prototype', 'toFixed']), false, 'should return false for built-in Number.prototype.toFixed (array path)');
      assert.strictEqual(_.unset(0, ['constructor', ['prototype'], 'toFixed']), false, 'should return false for built-in Number.prototype.toFixed (array path)');

      assert.strictEqual(typeof numberProto.toFixed, 'function', 'Number.prototype.toFixed should still exist after unset attempts');

      // String.prototype built-ins
      assert.strictEqual(typeof stringProto.toLowerCase, 'function', 'String.prototype.toLowerCase should exist before unset');

      assert.strictEqual(_.unset('', 'constructor.prototype.toLowerCase'), false, 'should return false for built-in String.prototype.toLowerCase');

      assert.strictEqual(typeof stringProto.toLowerCase, 'function', 'String.prototype.toLowerCase should still exist after unset attempts');

      // Boolean.prototype built-ins
      assert.strictEqual(typeof booleanProto.valueOf, 'function', 'Boolean.prototype.valueOf should exist before unset');

      assert.strictEqual(_.unset(true, 'constructor.prototype.valueOf'), false, 'should return false for built-in Boolean.prototype.valueOf');

      assert.strictEqual(typeof booleanProto.valueOf, 'function', 'Boolean.prototype.valueOf should still exist after unset attempts');
    }
```

#### `_.' + methodName + '` should invoke `updater` with the value on `path` of `object`

```ts
test('`_.' + methodName + '` should invoke `updater` with the value on `path` of `object`', function(assert) {
      assert.expect(4);

      var object = { 'a': [{ 'b': { 'c': oldValue } }] },
          expected = oldValue + 1;

      lodashStable.each(['a[0].b.c', ['a', '0', 'b', 'c']], function(path) {
        func(object, path, function(n) {
          assert.strictEqual(n, oldValue);
          return ++n;
        });

        assert.strictEqual(object.a[0].b.c, expected);
        object.a[0].b.c = oldValue;
      });
    }
```

#### `_.' + methodName + '` should ' + (isDeep ? '' : 'not ') + 'support deep paths

```ts
test('`_.' + methodName + '` should ' + (isDeep ? '' : 'not ') + 'support deep paths', function(assert) {
      assert.expect(2);

      lodashStable.each(['a.b.c', ['a', 'b', 'c']], function(path, index) {
        var expected = isDeep ? ({ 'a': { 'b': { 'c': 1 } } }) : (index ? { 'a,b,c': 1 } : { 'a.b.c': 1 });
        assert.deepEqual(func([path], [1]), expected);
      });
    }
```

## @opencode-ai/sdk/v2

**Consultas usadas no Horsebox:** `FileSystemBinaryContent`, `@opencode-ai/sdk/v2 FileSystemBinaryContent`, `opencode-ai/sdk/v2 FileSystemBinaryContent`, `v2 FileSystemBinaryContent`, `FileSystemTextContent`, `@opencode-ai/sdk/v2 FileSystemTextContent`, `opencode-ai/sdk/v2 FileSystemTextContent`, `v2 FileSystemTextContent`

**Arquivos de teste encontrados:** 6

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/multi-router.js

#### should respond with APIv2 root handler

```ts
it('should respond with APIv2 root handler', function(done){
      request(app)
      .get('/api/v2/')
      .expect(200, 'Hello from APIv2 root route.', done)
    }
```

#### should respond with users from APIv2

```ts
it('should respond with users from APIv2', function(done){
      request(app)
      .get('/api/v2/users')
      .expect(200, 'List of APIv2 users.', done)
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

#### #3711 - set's `update` event returns one merged model

```ts
test("#3711 - set's `update` event returns one merged model", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var model2Update = new Backbone.Model({id: 2, title: 'Second Post V2'});
    var collection = new Backbone.Collection([model, model2]);
    collection.on('update', function(context, options) {
      var mergedModels = options.changes.merged;
      assert.ok(mergedModels.length === 1);
      assert.strictEqual(mergedModels[0].get('title'), model2Update.get('title'));
    });
    collection.set([model2Update]);
  }
```

#### #3711 - set's `update` event returns multiple merged models

```ts
test("#3711 - set's `update` event returns multiple merged models", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var modelUpdate = new Backbone.Model({id: 1, title: 'First Post V2'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var model2Update = new Backbone.Model({id: 2, title: 'Second Post V2'});
    var collection = new Backbone.Collection([model, model2]);
    collection.on('update', function(context, options) {
      var mergedModels = options.changes.merged;
      assert.ok(mergedModels.length === 2);
      assert.strictEqual(mergedModels[0].get('title'), model2Update.get('title'));
      assert.strictEqual(mergedModels[1].get('title'), modelUpdate.get('title'));
    });
    collection.set([model2Update, modelUpdate]);
  }
```

