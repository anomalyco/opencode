# External tests for build-request-parts.ts

**Arquivo:** `packages/app/src/components/prompt-input/build-request-parts.ts`

## Checklist

- [ ] @opencode-ai/core/util/path
- [ ] @opencode-ai/sdk/v2/client
- [ ] @/context/file
- [ ] @/context/file/path
- [ ] @/context/prompt
- [ ] @/utils/id
- [ ] @/utils/comment-note

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

## @opencode-ai/sdk/v2/client

**Consultas usadas no Horsebox:** `AgentPartInput`, `@opencode-ai/sdk/v2/client AgentPartInput`, `opencode-ai/sdk/v2/client AgentPartInput`, `client AgentPartInput`, `FilePartInput`, `@opencode-ai/sdk/v2/client FilePartInput`, `opencode-ai/sdk/v2/client FilePartInput`, `client FilePartInput`, `Part`, `@opencode-ai/sdk/v2/client Part`, `opencode-ai/sdk/v2/client Part`, `client Part`, `TextPartInput`, `@opencode-ai/sdk/v2/client TextPartInput`, `opencode-ai/sdk/v2/client TextPartInput`, `client TextPartInput`

**Arquivos de teste encontrados:** 20

### ../../.sbomtest/repos/f3c62de455-express/test/req.ip.js

#### should return the client addr

```ts
it('should return the client addr', function(done){
          var app = express();

          app.enable('trust proxy');

          app.use(function(req, res, next){
            res.send(req.ip);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect('client', done);
        }
```

#### should return the addr after trusted proxy based on count

```ts
it('should return the addr after trusted proxy based on count', function (done) {
          var app = express();

          app.set('trust proxy', 2);

          app.use(function(req, res, next){
            res.send(req.ip);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect('p1', done);
        }
```

#### should return the addr after trusted proxy, from sub app

```ts
it('should return the addr after trusted proxy, from sub app', function (done) {
          var app = express();
          var sub = express();

          app.set('trust proxy', 2);
          app.use(sub);

          sub.use(function (req, res, next) {
            res.send(req.ip);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect(200, 'p1', done);
        }
```

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

### ../../.sbomtest/repos/f3c62de455-express/test/req.ips.js

#### should return an array of the specified addresses

```ts
it('should return an array of the specified addresses', function(done){
          var app = express();

          app.enable('trust proxy');

          app.use(function(req, res, next){
            res.send(req.ips);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect('["client","p1","p2"]', done);
        }
```

#### should stop at first untrusted

```ts
it('should stop at first untrusted', function(done){
          var app = express();

          app.set('trust proxy', 2);

          app.use(function(req, res, next){
            res.send(req.ips);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect('["p1","p2"]', done);
        }
```

#### should return an empty array

```ts
it('should return an empty array', function(done){
          var app = express();

          app.use(function(req, res, next){
            res.send(req.ips);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect('[]', done);
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### routes (two part)

```ts
test('routes (two part)', function(assert) {
    assert.expect(2);
    location.replace('http://example.com#search/nyc/p10');
    Backbone.history.checkUrl();
    assert.equal(router.query, 'nyc');
    assert.equal(router.page, '10');
  }
```

#### routes (complex)

```ts
test('routes (complex)', function(assert) {
    assert.expect(3);
    location.replace('http://example.com#one/two/three/complex-part/four/five/six/seven');
    Backbone.history.checkUrl();
    assert.equal(router.first, 'one/two/three');
    assert.equal(router.part, 'part');
    assert.equal(router.rest, 'four/five/six/seven');
  }
```

#### #967 - Route callback gets passed encoded values.

```ts
test('#967 - Route callback gets passed encoded values.', function(assert) {
    assert.expect(3);
    var route = 'has%2Fslash/complex-has%23hash/has%20space';
    Backbone.history.navigate(route, {trigger: true});
    assert.strictEqual(router.first, 'has/slash');
    assert.strictEqual(router.part, 'has#hash');
    assert.strictEqual(router.rest, 'has space');
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.static.js

#### should respond with 206 "Partial Content"

```ts
it('should respond with 206 "Partial Content"', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=0-4')
        .expect(206, done)
    }
```

## @/context/file

**Consultas usadas no Horsebox:** `FileSelection`, `@/context/file FileSelection`, `/context/file FileSelection`, `file FileSelection`

**Arquivos de teste encontrados:** 30

### ../../.sbomtest/repos/f3c62de455-express/test/res.type.js

#### should set the Content-Type based on a filename

```ts
it('should set the Content-Type based on a filename', function(done){
      var app = express();

      app.use(function(req, res){
        res.type('foo.js').end('var name = "tj";');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .end(done)
    }
```

#### should handle file extension with dots

```ts
it('should handle file extension with dots', function(done){
        var app = express();

        app.use(function(req, res){
          res.type('.json').end('{"test": true}');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(done);
      }
```

#### should handle multiple file extensions

```ts
it('should handle multiple file extensions', function(done){
        var app = express();

        app.use(function(req, res){
          res.type('file.tar.gz').end('compressed');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/gzip')
        .end(done);
      }
```

#### should handle uppercase extensions

```ts
it('should handle uppercase extensions', function(done){
        var app = express();

        app.use(function(req, res){
          res.type('FILE.JSON').end('{"test": true}');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(done);
      }
```

#### should handle extension with special characters

```ts
it('should handle extension with special characters', function(done){
        var app = express();

        app.use(function(req, res){
          res.type('file@test.json').end('{"test": true}');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .end(done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.render.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/app.render.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.location.js

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

#### should get called when sending file

```ts
it('should get called when sending file', function (done) {
      request(this.app)
        .get('/nums.txt')
        .expect('x-custom', 'set')
        .expect(200, done)
    }
```

#### should load the file when on trailing slash

```ts
it('should load the file when on trailing slash', function (done) {
      request(this.app)
        .get('/todo.txt')
        .expect(200, '- groceries', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

#### should error for non-string path

```ts
it('should error for non-string path', function (done) {
      var app = createApp(42)

      request(app)
      .get('/')
      .expect(500, /TypeError: path must be a string to res.sendFile/, done)
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

#### should allow up within root

```ts
it('should allow up within root', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile('fake/../name.txt', {
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

#### should reject reading outside root

```ts
it('should reject reading outside root', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.sendFile('../name.txt', {
            root: fixtures
          })
        })

        request(app)
          .get('/')
          .expect(403, done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

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

## @/context/file/path

**Consultas usadas no Horsebox:** `encodeFilePath`, `@/context/file/path encodeFilePath`, `/context/file/path encodeFilePath`, `path encodeFilePath`

**Arquivos de teste encontrados:** 49

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.attachment.js

#### should add the filename param

```ts
it('should add the filename param', function(done){
      var app = express();

      app.use(function(req, res){
        res.attachment('/path/to/image.png');
        res.send('foo');
      });

      request(app)
      .get('/')
      .expect('Content-Disposition', 'attachment; filename="image.png"', done);
    }
```

#### should set the Content-Type

```ts
it('should set the Content-Type', function(done){
      var app = express();

      app.use(function(req, res){
        res.attachment('/path/to/image.png');
        res.send(Buffer.alloc(4, '.'))
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'image/png', done);
    }
```

## @/context/prompt

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/utils/id

**Consultas usadas no Horsebox:** `ascending`, `@/utils/id ascending`, `/utils/id ascending`, `id ascending`, `Identifier`, `@/utils/id Identifier`, `/utils/id Identifier`, `id Identifier`

**Arquivos de teste encontrados:** 74

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

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

#### `_.cloneDeepWith` should provide `stack` to `customizer`

```ts
test('`_.cloneDeepWith` should provide `stack` to `customizer`', function(assert) {
      assert.expect(1);

      var actual;

      _.cloneDeepWith({ 'a': 1 }, function() {
        actual = _.last(arguments);
      });

      assert.ok(isNpm
        ? actual.constructor.name == 'Stack'
        : actual instanceof mapCaches.Stack
      );
    }
```

#### `_.' + methodName + '` should not clone ' + key, function(assert) {
          assert.expect(3);

          if (value) {
            var object = { 'a': value, 'b': { 'c': value } },
                actual = func(object),
                expected = value === Foo ? { 'c': Foo.c } : {};

            assert.deepEqual(actual, object);
            assert.notStrictEqual(actual, object);
            assert.deepEqual(func(value), expected);
          }
          else {
            skipAssert(assert, 3);
          }
        });
      });
    });

    lodashStable.each(['cloneWith

```ts
test('`_.' + methodName + '` should not clone ' + key, function(assert) {
          assert.expect(3);

          if (value) {
            var object = { 'a': value, 'b': { 'c': value } },
                actual = func(object),
                expected = value === Foo ? { 'c': Foo.c } : {};

            assert.deepEqual(actual, object);
            assert.notStrictEqual(actual, object);
            assert.deepEqual(func(value), expected);
          }
          else {
            skipAssert(assert, 3);
          }
        });
      });
    });

    lodashStable.each(['cloneWith', 'cloneDeepWith'], function(methodName) {
      var func = _[methodName],
          isDeep = methodName == 'cloneDeepWith';

      QUnit.test('`_.' + methodName + '` should provide correct `customizer` arguments', function(assert) {
        assert.expect(1);

        var argsList = [],
            object = new Foo;

        func(object, function() {
          var length = arguments.length,
              args = slice.call(arguments, 0, length - (length > 1 ? 1 : 0));

          argsList.push(args);
        });

        assert.deepEqual(argsList, isDeep ? [[object], [1, 'a', object]] : [[object]]);
      });

      QUnit.test('`_.' + methodName + '` should handle cloning when `customizer` returns `undefined`', function(assert) {
        assert.expect(1);

        var actual = func({ 'a': { 'b': 'c' } }, noop);
        assert.deepEqual(actual, { 'a': { 'b': 'c' } });
      });

      lodashStable.forOwn(uncloneable, function(value, key) {
        QUnit.test('`_.' + methodName + '` should work with a `customizer` callback and ' + key, function(assert) {
          assert.expect(3);

          var customizer = function(value) {
            return lodashStable.isPlainObject(value) ? undefined : value;
          };

          var actual = func(value, customizer);
          assert.strictEqual(actual, value);

          var object = { 'a': value, 'b': { 'c': value } };
          actual = func(object, customizer);

          assert.deepEqual(actual, object);
          assert.notStrictEqual(actual, object);
        });
      });
    }
```

#### should work in a lazy sequence with a custom `_.iteratee`

```ts
test('should work in a lazy sequence with a custom `_.iteratee`', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var iteratee = _.iteratee,
            pass = false;

        _.iteratee = identity;

        try {
          var actual = _(largeArray).slice(1).compact().value();
          pass = lodashStable.isEqual(actual, _.compact(_.slice(largeArray, 1)));
        } catch (e) {console.log(e);}

        assert.ok(pass);
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should provide arguments to functions

```ts
test('should provide arguments to functions', function(assert) {
      assert.expect(2);

      var args1,
          args2,
          expected = ['a', 'b', 'c'];

      var cond = _.cond([[
        function() { args1 || (args1 = slice.call(arguments)); return true; },
        function() { args2 || (args2 = slice.call(arguments)); }
      ]]);

      cond('a', 'b', 'c');

      assert.deepEqual(args1, expected);
      assert.deepEqual(args2, expected);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array = [4, 6, 6],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '4': 1, '6':  2 }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.countBy(array, value) : _.countBy(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should provide additional arguments after reaching the target arity

```ts
test('should provide additional arguments after reaching the target arity', function(assert) {
      assert.expect(3);

      var curried = _.curry(fn, 3);
      assert.deepEqual(curried(1)(2, 3, 4), [1, 2, 3, 4]);
      assert.deepEqual(curried(1, 2)(3, 4, 5), [1, 2, 3, 4, 5]);
      assert.deepEqual(curried(1, 2, 3, 4, 5, 6), [1, 2, 3, 4, 5, 6]);
    }
```

#### should provide additional arguments after reaching the target arity

```ts
test('should provide additional arguments after reaching the target arity', function(assert) {
      assert.expect(3);

      var curried = _.curryRight(fn, 3);
      assert.deepEqual(curried(4)(1, 2, 3), [1, 2, 3, 4]);
      assert.deepEqual(curried(4, 5)(1, 2, 3), [1, 2, 3, 4, 5]);
      assert.deepEqual(curried(1, 2, 3, 4, 5, 6), [1, 2, 3, 4, 5, 6]);
    }
```

#### subsequent debounced calls return the last `func` result

```ts
test('subsequent debounced calls return the last `func` result', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var debounced = _.debounce(identity, 32);
      debounced('a');

      setTimeout(function() {
        assert.notEqual(debounced('b'), 'b');
      }, 64);

      setTimeout(function() {
        assert.notEqual(debounced('c'), 'c');
        done();
      }, 128);
    }
```

#### subsequent leading debounced calls return the last `func` result

```ts
test('subsequent leading debounced calls return the last `func` result', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var debounced = _.debounce(identity, 32, { 'leading': true, 'trailing': false }),
          results = [debounced('a'), debounced('b')];

      assert.deepEqual(results, ['a', 'a']);

      setTimeout(function() {
        var results = [debounced('c'), debounced('d')];
        assert.deepEqual(results, ['c', 'c']);
        done();
      }, 64);
    }
```

#### should provide additional arguments to `func`

```ts
test('should provide additional arguments to `func`', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var args;

      _.defer(function() {
        args = slice.call(arguments);
      }, 1, 2);

      setTimeout(function() {
        assert.deepEqual(args, [1, 2]);
        done();
      }, 32);
    }
```

#### should be cancelable

```ts
test('should be cancelable', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var pass = true,
          timerId = _.defer(function() { pass = false; });

      clearTimeout(timerId);

      setTimeout(function() {
        assert.ok(pass);
        done();
      }, 32);
    }
```

#### should provide additional arguments to `func`

```ts
test('should provide additional arguments to `func`', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var args;

      _.delay(function() {
        args = slice.call(arguments);
      }, 32, 1, 2);

      setTimeout(function() {
        assert.deepEqual(args, [1, 2]);
        done();
      }, 64);
    }
```

#### should be cancelable

```ts
test('should be cancelable', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var pass = true,
          timerId = _.delay(function() { pass = false; }, 32);

      clearTimeout(timerId);

      setTimeout(function() {
        assert.ok(pass);
        done();
      }, 64);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.differenceBy([2.1, 1.2], [2.3, 3.4], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [2.3]);
    }
```

#### should divide two numbers

```ts
test('should divide two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.divide(6, 4), 1.5);
      assert.strictEqual(_.divide(-6, 4), -1.5);
      assert.strictEqual(_.divide(-6, -4), 1.5);
    }
```

#### should coerce arguments to numbers

```ts
test('should coerce arguments to numbers', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.divide('6', '4'), 1.5);
      assert.deepEqual(_.divide('x', 'y'), NaN);
    }
```

#### should provide correct `predicate` arguments

```ts
test('should provide correct `predicate` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.dropRightWhile(array, function() {
        args = slice.call(arguments);
      });

      assert.deepEqual(args, [4, 3, array]);
    }
```

#### should provide correct `predicate` arguments

```ts
test('should provide correct `predicate` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.dropWhile(array, function() {
        args = slice.call(arguments);
      });

      assert.deepEqual(args, [1, 0, array]);
    }
```

#### should return `true` if `predicate` returns truthy for all elements

```ts
test('should return `true` if `predicate` returns truthy for all elements', function(assert) {
      assert.expect(1);

      assert.strictEqual(lodashStable.every([true, 1, 'a'], identity), true);
    }
```

#### should return `true` for empty collections

```ts
test('should return `true` for empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubTrue);

      var actual = lodashStable.map(empties, function(value) {
        try {
          return _.every(value, identity);
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work with collections of `undefined` values (test in IE < 9)

```ts
test('should work with collections of `undefined` values (test in IE < 9)', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.every([undefined, undefined, undefined], identity), false);
    }
```

#### should use `_.identity` when `predicate` is nullish

```ts
test('should use `_.identity` when `predicate` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value, index) {
        var array = [0];
        return index ? _.every(array, value) : _.every(array);
      });

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(values, stubTrue);
      actual = lodashStable.map(values, function(value, index) {
        var array = [1];
        return index ? _.every(array, value) : _.every(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should provide correct `predicate` arguments for arrays

```ts
test('`_.' + methodName + '` should provide correct `predicate` arguments for arrays', function(assert) {
      assert.expect(1);

      var args,
          array = ['a'];

      func(array, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, ['a', 0, array]);
    }
```

#### `_.' + methodName + '` should provide correct `predicate` arguments for objects

```ts
test('`_.' + methodName + '` should provide correct `predicate` arguments for objects', function(assert) {
      assert.expect(1);

      var args,
          object = { 'a': 1 };

      func(object, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [1, 'a', object]);
    }
```

#### should flip arguments provided to `func`

```ts
test('should flip arguments provided to `func`', function(assert) {
      assert.expect(1);

      var flipped = _.flip(fn);
      assert.deepEqual(flipped('a', 'b', 'c', 'd'), ['d', 'c', 'b', 'a']);
    }
```

#### should use a default `depth` of `1`

```ts
test('should use a default `depth` of `1`', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.flatMapDepth(array, identity), [1, 2, [3, [4]], 5]);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([1, 2, [3, [4]], 5]));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.flatMapDepth(array, value) : _.flatMapDepth(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat a `depth` of < `1` as a shallow clone

```ts
test('should treat a `depth` of < `1` as a shallow clone', function(assert) {
      assert.expect(2);

      lodashStable.each([-1, 0], function(depth) {
        assert.deepEqual(_.flatMapDepth(array, identity, depth), [1, [2, [3, [4]], 5]]);
      });
    }
```

#### should coerce `depth` to an integer

```ts
test('should coerce `depth` to an integer', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.flatMapDepth(array, identity, 2.2), [1, 2, 3, [4], 5]);
    }
```

#### `_.' + methodName + '` should iterate over own string keyed properties of objects

```ts
test('`_.' + methodName + '` should iterate over own string keyed properties of objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = [1, 2];
      }
      Foo.prototype.b = [3, 4];

      var actual = func(new Foo, identity);
      assert.deepEqual(actual, [1, 2]);
    }
```

#### `_.' + methodName + '` should use `_.identity` when `iteratee` is nullish

```ts
test('`_.' + methodName + '` should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(2);

      var array = [[1, 2], [3, 4]],
          object = { 'a': [1, 2], 'b': [3, 4] },
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([1, 2, 3, 4]));

      lodashStable.each([array, object], function(collection) {
        var actual = lodashStable.map(values, function(value, index) {
          return index ? func(collection, value) : func(collection);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should work with objects with non-number length properties

```ts
test('`_.' + methodName + '` should work with objects with non-number length properties', function(assert) {
      assert.expect(1);

      var object = { 'length': [1, 2] };
      assert.deepEqual(func(object, identity), [1, 2]);
    }
```

#### `_.' + methodName + '` should return an identity function when no arguments are given

```ts
test('`_.' + methodName + '` should return an identity function when no arguments are given', function(assert) {
      assert.expect(6);

      _.times(2, function(index) {
        try {
          var combined = index ? func([]) : func();
          assert.strictEqual(combined('a'), 'a');
        } catch (e) {
          assert.ok(false, e.message);
        }
        assert.strictEqual(combined.length, 0);
        assert.notStrictEqual(combined, identity);
      });
    }
```

#### `_.' + methodName + '` should work with a curried function and `_.head`

```ts
test('`_.' + methodName + '` should work with a curried function and `_.head`', function(assert) {
      assert.expect(1);

      var curried = _.curry(identity);

      var combined = isFlow
        ? func(_.head, curried)
        : func(curried, _.head);

      assert.strictEqual(combined([1]), 1);
    }
```

#### `_.' + methodName + '` should provide correct iteratee arguments

```ts
test('`_.' + methodName + '` should provide correct iteratee arguments', function(assert) {
        assert.expect(1);

        if (func) {
          var args,
              expected = [1, 0, array];

          func(array, function() {
            args || (args = slice.call(arguments));
          });

          if (lodashStable.includes(rightMethods, methodName)) {
            expected[0] = 3;
            expected[1] = 2;
          }
          if (lodashStable.includes(objectMethods, methodName)) {
            expected[1] += '';
          }
          if (isBy) {
            expected.length = isOmitPick ? 2 : 1;
          }
          assert.deepEqual(args, expected);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` should provide correct `customizer` arguments

```ts
test('`_.' + methodName + '` should provide correct `customizer` arguments', function(assert) {
      assert.expect(3);

      var args,
          object = { 'a': 1 },
          source = { 'a': 2 },
          expected = lodashStable.map([1, 2, 'a', object, source], lodashStable.cloneDeep);

      func(object, source, function() {
        args || (args = lodashStable.map(slice.call(arguments, 0, 5), lodashStable.cloneDeep));
      });

      assert.deepEqual(args, expected, 'primitive values');

      var argsList = [],
          objectValue = [1, 2],
          sourceValue = { 'b': 2 };

      object = { 'a': objectValue };
      source = { 'a': sourceValue };
      expected = [lodashStable.map([objectValue, sourceValue, 'a', object, source], lodashStable.cloneDeep)];

      if (isMergeWith) {
        expected.push(lodashStable.map([undefined, 2, 'b', objectValue, sourceValue], lodashStable.cloneDeep));
      }
      func(object, source, function() {
        argsList.push(lodashStable.map(slice.call(arguments, 0, 5), lodashStable.cloneDeep));
      });

      assert.deepEqual(argsList, expected, 'object values');

      args = undefined;
      object = { 'a': 1 };
      source = { 'b': 2 };
      expected = lodashStable.map([undefined, 2, 'b', object, source], lodashStable.cloneDeep);

      func(object, source, function() {
        args || (args = lodashStable.map(slice.call(arguments, 0, 5), lodashStable.cloneDeep));
      });

      assert.deepEqual(args, expected, 'undefined properties');
    }
```

#### should return the function names of an object

```ts
test('should return the function names of an object', function(assert) {
      assert.expect(1);

      var object = { 'a': 'a', 'b': identity, 'c': /x/, 'd': noop },
          actual = _.functions(object).sort();

      assert.deepEqual(actual, ['b', 'd']);
    }
```

#### should not include inherited functions

```ts
test('should not include inherited functions', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = identity;
        this.b = 'b';
      }
      Foo.prototype.c = noop;

      assert.deepEqual(_.functions(new Foo), ['a']);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array = [6, 4, 6],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '4': [4], '6':  [6, 6] }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.groupBy(array, value) : _.groupBy(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return the first argument given

```ts
test('should return the first argument given', function(assert) {
      assert.expect(1);

      var object = { 'name': 'fred' };
      assert.strictEqual(_.identity(object), object);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.intersectionBy([2.1, 1.2], [2.3, 3.4], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [2.3]);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '1': ['a', 'c'], '2': ['b'] }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.invertBy(object, value) : _.invertBy(object);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat arrays with identical values but different non-index properties as equal

```ts
test('should treat arrays with identical values but different non-index properties as equal', function(assert) {
      assert.expect(3);

      var array1 = [1, 2, 3],
          array2 = [1, 2, 3];

      array1.every = array1.filter = array1.forEach =
      array1.indexOf = array1.lastIndexOf = array1.map =
      array1.some = array1.reduce = array1.reduceRight = null;

      array2.concat = array2.join = array2.pop =
      array2.reverse = array2.shift = array2.slice =
      array2.sort = array2.splice = array2.unshift = null;

      assert.strictEqual(_.isEqual(array1, array2), true);

      array1 = [1, 2, 3];
      array1.a = 1;

      array2 = [1, 2, 3];
      array2.b = 1;

      assert.strictEqual(_.isEqual(array1, array2), true);

      array1 = /c/.exec('abcde');
      array2 = ['c'];

      assert.strictEqual(_.isEqual(array1, array2), true);
    }
```

#### should avoid common type coercions

```ts
test('should avoid common type coercions', function(assert) {
      assert.expect(9);

      assert.strictEqual(_.isEqual(true, Object(false)), false);
      assert.strictEqual(_.isEqual(Object(false), Object(0)), false);
      assert.strictEqual(_.isEqual(false, Object('')), false);
      assert.strictEqual(_.isEqual(Object(36), Object('36')), false);
      assert.strictEqual(_.isEqual(0, ''), false);
      assert.strictEqual(_.isEqual(1, true), false);
      assert.strictEqual(_.isEqual(1337756400000, new Date(2012, 4, 23)), false);
      assert.strictEqual(_.isEqual('36', 36), false);
      assert.strictEqual(_.isEqual(36, '36'), false);
    }
```

#### should provide correct `customizer` arguments

```ts
test('should provide correct `customizer` arguments', function(assert) {
      assert.expect(1);

      var argsList = [],
          object1 = { 'a': [1, 2], 'b': null },
          object2 = { 'a': [1, 2], 'b': null };

      object1.b = object2;
      object2.b = object1;

      var expected = [
        [object1, object2],
        [object1.a, object2.a, 'a', object1, object2],
        [object1.a[0], object2.a[0], 0, object1.a, object2.a],
        [object1.a[1], object2.a[1], 1, object1.a, object2.a],
        [object1.b, object2.b, 'b', object1.b, object2.b]
      ];

      _.isEqualWith(object1, object2, function(assert) {
        var length = arguments.length,
            args = slice.call(arguments, 0, length - (length > 2 ? 1 : 0));

        argsList.push(args);
      });

      assert.deepEqual(argsList, expected);
    }
```

#### should provide correct `customizer` arguments

```ts
test('should provide correct `customizer` arguments', function(assert) {
      assert.expect(1);

      var argsList = [],
          object1 = { 'a': [1, 2], 'b': null },
          object2 = { 'a': [1, 2], 'b': null };

      object1.b = object2;
      object2.b = object1;

      var expected = [
        [object1.a, object2.a, 'a', object1, object2],
        [object1.a[0], object2.a[0], 0, object1.a, object2.a],
        [object1.a[1], object2.a[1], 1, object1.a, object2.a],
        [object1.b, object2.b, 'b', object1, object2],
        [object1.b.a, object2.b.a, 'a', object1.b, object2.b],
        [object1.b.a[0], object2.b.a[0], 0, object1.b.a, object2.b.a],
        [object1.b.a[1], object2.b.a[1], 1, object1.b.a, object2.b.a],
        [object1.b.b, object2.b.b, 'b', object1.b, object2.b]
      ];

      _.isMatchWith(object1, object2, function(assert) {
        argsList.push(slice.call(arguments, 0, -1));
      });

      assert.deepEqual(argsList, expected);
    }
```

#### should provide `stack` to `customizer`

```ts
test('should provide `stack` to `customizer`', function(assert) {
      assert.expect(1);

      var actual;

      _.isMatchWith({ 'a': 1 }, { 'a': 1 }, function() {
        actual = _.last(arguments);
      });

      assert.ok(isNpm
        ? actual.constructor.name == 'Stack'
        : actual instanceof mapCaches.Stack
      );
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

#### should provide arguments to `func`

```ts
test('should provide arguments to `func`', function(assert) {
      assert.expect(1);

      var fn = function() { return slice.call(arguments); },
          iteratee = _.iteratee(fn),
          actual = iteratee('a', 'b', 'c', 'd', 'e', 'f');

      assert.deepEqual(actual, ['a', 'b', 'c', 'd', 'e', 'f']);
    }
```

#### should return `_.identity` when `func` is nullish

```ts
test('should return `_.identity` when `func` is nullish', function(assert) {
      assert.expect(1);

      var object = {},
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([!isNpm && _.identity, object]));

      var actual = lodashStable.map(values, function(value, index) {
        var identity = index ? _.iteratee(value) : _.iteratee();
        return [!isNpm && identity, identity(object)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array = [4, 6, 6],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant({ '4': 4, '6': 6 }));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.keyBy(array, value) : _.keyBy(array);
      });

      assert.deepEqual(actual, expected);
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

#### should handle merging when `customizer` returns `undefined`

```ts
test('should handle merging when `customizer` returns `undefined`', function(assert) {
      assert.expect(2);

      var actual = _.mergeWith({ 'a': { 'b': [1, 1] } }, { 'a': { 'b': [0] } }, noop);
      assert.deepEqual(actual, { 'a': { 'b': [0, 1] } });

      actual = _.mergeWith([], [undefined], identity);
      assert.deepEqual(actual, [undefined]);
    }
```

#### should provide `stack` to `customizer`

```ts
test('should provide `stack` to `customizer`', function(assert) {
      assert.expect(4);

      var actual = [];

      _.mergeWith({}, { 'z': 1, 'a': { 'b': 2 } }, function() {
        actual.push(_.last(arguments));
      });

      assert.strictEqual(actual.length, 3);
      _.each(actual, function(a) {
        assert.ok(isNpm
          ? a.constructor.name == 'Stack'
          : a instanceof mapCaches.Stack
        );
      });
    }
```

#### should sort by a property in ascending order when its order is not specified

```ts
test('should sort by a property in ascending order when its order is not specified', function(assert) {
      assert.expect(2);

      var expected = [objects[2], objects[0], objects[3], objects[1]],
          actual = _.orderBy(objects, ['a', 'b']);

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(falsey, lodashStable.constant([objects[3], objects[1], objects[2], objects[0]]));

      actual = lodashStable.map(falsey, function(order, index) {
        return _.orderBy(objects, ['a', 'b'], index ? ['desc', order] : ['desc']);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should use `_.identity` when a predicate is nullish

```ts
test('should use `_.identity` when a predicate is nullish', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, undefined, null);
      assert.deepEqual(over('a', 'b'), ['a', 'b']);
    }
```

#### should not pass `undefined` if there are more transforms than arguments

```ts
test('should not pass `undefined` if there are more transforms than arguments', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, doubled, identity);
      assert.deepEqual(over(5), [10]);
    }
```

#### should provide the correct argument to each transform

```ts
test('should provide the correct argument to each transform', function(assert) {
      assert.expect(1);

      var argsList = [],
          transform = function() { argsList.push(slice.call(arguments)); },
          over = _.overArgs(noop, transform, transform, transform);

      over('a', 'b');
      assert.deepEqual(argsList, [['a'], ['b']]);
    }
```

#### should use `_.identity` when a predicate is nullish

```ts
test('should use `_.identity` when a predicate is nullish', function(assert) {
      assert.expect(1);

      var over = _.over(undefined, null);
      assert.deepEqual(over('a', 'b', 'c'), ['a', 'a']);
    }
```

#### should provide arguments to predicates

```ts
test('should provide arguments to predicates', function(assert) {
      assert.expect(1);

      var over = _.over(function() {
        return slice.call(arguments);
      });

      assert.deepEqual(over('a', 'b', 'c'), [['a', 'b', 'c']]);
    }
```

#### should use `_.identity` when a predicate is nullish

```ts
test('should use `_.identity` when a predicate is nullish', function(assert) {
      assert.expect(2);

      var over = _.overEvery(undefined, null);

      assert.strictEqual(over(true), true);
      assert.strictEqual(over(false), false);
    }
```

#### should provide arguments to predicates

```ts
test('should provide arguments to predicates', function(assert) {
      assert.expect(1);

      var args;

      var over = _.overEvery(function() {
        args = slice.call(arguments);
      });

      over('a', 'b', 'c');
      assert.deepEqual(args, ['a', 'b', 'c']);
    }
```

#### should use `_.identity` when a predicate is nullish

```ts
test('should use `_.identity` when a predicate is nullish', function(assert) {
      assert.expect(2);

      var over = _.overSome(undefined, null);

      assert.strictEqual(over(true), true);
      assert.strictEqual(over(false), false);
    }
```

#### should provide arguments to predicates

```ts
test('should provide arguments to predicates', function(assert) {
      assert.expect(1);

      var args;

      var over = _.overSome(function() {
        args = slice.call(arguments);
      });

      over('a', 'b', 'c');
      assert.deepEqual(args, ['a', 'b', 'c']);
    }
```

#### `_.' + methodName + '` partially applies arguments

```ts
test('`_.' + methodName + '` partially applies arguments', function(assert) {
      assert.expect(1);

      var par = func(identity, 'a');
      assert.strictEqual(par(), 'a');
    }
```

#### `_.' + methodName + '` works when there are no partially applied arguments and the created function is invoked with additional arguments

```ts
test('`_.' + methodName + '` works when there are no partially applied arguments and the created function is invoked with additional arguments', function(assert) {
      assert.expect(1);

      var par = func(identity);
      assert.strictEqual(par('a'), 'a');
    }
```

#### should split elements into two groups by `predicate`

```ts
test('should split elements into two groups by `predicate`', function(assert) {
      assert.expect(3);

      assert.deepEqual(_.partition([], identity), [[], []]);
      assert.deepEqual(_.partition(array, stubTrue), [array, []]);
      assert.deepEqual(_.partition(array, stubFalse), [[], array]);
    }
```

#### should use `_.identity` when `predicate` is nullish

```ts
test('should use `_.identity` when `predicate` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([[1, 1], [0]]));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.partition(array, value) : _.partition(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args,
          array = [{ 'x': 1 }, { 'x': 2 }, { 'x': 3 }, { 'x': 1 }];

      _.pullAllBy(array, [{ 'x': 1 }, { 'x': 3 }], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [{ 'x': 1 }]);
    }
```

#### should support not providing a `max`

```ts
test('should support not providing a `max`', function(assert) {
      assert.expect(1);

      var min = 0,
          max = 5;

      assert.ok(lodashStable.some(array, function() {
        var result = _.random(max);
        return result >= min && result <= max;
      }));
    }
```

#### should support providing a `floating`

```ts
test('should support providing a `floating`', function(assert) {
      assert.expect(3);

      var actual = _.random(true);
      assert.ok(actual % 1 && actual >= 0 && actual <= 1);

      actual = _.random(2, true);
      assert.ok(actual % 1 && actual >= 0 && actual <= 2);

      actual = _.random(2, 4, true);
      assert.ok(actual % 1 && actual >= 2 && actual <= 4);
    }
```

#### should reorder arguments provided to `func`

```ts
test('should reorder arguments provided to `func`', function(assert) {
      assert.expect(1);

      var rearged = _.rearg(fn, [2, 0, 1]);
      assert.deepEqual(rearged('b', 'c', 'a'), ['a', 'b', 'c']);
    }
```

#### should provide correct `iteratee` arguments when iterating an array

```ts
test('should provide correct `iteratee` arguments when iterating an array', function(assert) {
      assert.expect(2);

      var args;

      _.reduce(array, function() {
        args || (args = slice.call(arguments));
      }, 0);

      assert.deepEqual(args, [0, 1, 0, array]);

      args = undefined;
      _.reduce(array, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [1, 2, 1, array]);
    }
```

#### should provide correct `iteratee` arguments when iterating an object

```ts
test('should provide correct `iteratee` arguments when iterating an object', function(assert) {
      assert.expect(2);

      var args,
          object = { 'a': 1, 'b': 2 },
          firstKey = _.head(_.keys(object));

      var expected = firstKey == 'a'
        ? [0, 1, 'a', object]
        : [0, 2, 'b', object];

      _.reduce(object, function() {
        args || (args = slice.call(arguments));
      }, 0);

      assert.deepEqual(args, expected);

      args = undefined;
      expected = firstKey == 'a'
        ? [1, 2, 'b', object]
        : [2, 1, 'a', object];

      _.reduce(object, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, expected);
    }
```

#### should provide correct `iteratee` arguments when iterating an array

```ts
test('should provide correct `iteratee` arguments when iterating an array', function(assert) {
      assert.expect(2);

      var args;

      _.reduceRight(array, function() {
        args || (args = slice.call(arguments));
      }, 0);

      assert.deepEqual(args, [0, 3, 2, array]);

      args = undefined;
      _.reduceRight(array, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [3, 2, 1, array]);
    }
```

#### should provide correct `iteratee` arguments when iterating an object

```ts
test('should provide correct `iteratee` arguments when iterating an object', function(assert) {
      assert.expect(2);

      var args,
          object = { 'a': 1, 'b': 2 },
          isFIFO = lodashStable.keys(object)[0] == 'a';

      var expected = isFIFO
        ? [0, 2, 'b', object]
        : [0, 1, 'a', object];

      _.reduceRight(object, function() {
        args || (args = slice.call(arguments));
      }, 0);

      assert.deepEqual(args, expected);

      args = undefined;
      expected = isFIFO
        ? [2, 1, 'a', object]
        : [1, 2, 'b', object];

      _.reduceRight(object, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, expected);
    }
```

#### `_.' + methodName + '` should provide correct `predicate` arguments in a lazy sequence

```ts
test('`_.' + methodName + '` should provide correct `predicate` arguments in a lazy sequence', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var args,
            array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            expected = [1, 0, lodashStable.map(array.slice(1), square)];

        _(array).slice(1)[methodName](function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1, 0, array.slice(1)]);

        args = undefined;
        _(array).slice(1).map(square)[methodName](function(value, index, array) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square)[methodName](function(value, index) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);

        args = undefined;
        _(array).slice(1).map(square)[methodName](function(value) {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, [1]);

        args = undefined;
        _(array).slice(1).map(square)[methodName](function() {
          args || (args = slice.call(arguments));
        }).value();

        assert.deepEqual(args, expected);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should provide correct `predicate` arguments

```ts
test('should provide correct `predicate` arguments', function(assert) {
      assert.expect(1);

      var argsList = [],
          array = [1, 2, 3],
          clone = array.slice();

      _.remove(array, function(n, index) {
        var args = slice.call(arguments);
        args[2] = args[2].slice();
        argsList.push(args);
        return isEven(index);
      });

      assert.deepEqual(argsList, [[1, 0, clone], [2, 1, clone], [3, 2, clone]]);
    }
```

#### should work in a hybrid sequence

```ts
test('should work in a hybrid sequence', function(assert) {
      assert.expect(8);

      if (!isNpm) {
        lodashStable.times(2, function(index) {
          var clone = (index ? largeArray : smallArray).slice();

          lodashStable.each(['map', 'filter'], function(methodName) {
            var array = clone.slice(),
                expected = clone.slice(1, -1).reverse(),
                actual = _(array)[methodName](identity).thru(_.compact).reverse().value();

            assert.deepEqual(actual, expected);

            array = clone.slice();
            actual = _(array).thru(_.compact)[methodName](identity).pull(1).push(3).reverse().value();

            assert.deepEqual(actual, [3].concat(expected.slice(0, -1)));
          });
        });
      }
      else {
        skipAssert(assert, 8);
      }
    }
```

#### should use a zeroed `_.uniqueId` counter

```ts
test('should use a zeroed `_.uniqueId` counter', function(assert) {
      assert.expect(3);

      if (!isModularize) {
        lodashStable.times(2, _.uniqueId);

        var oldId = Number(_.uniqueId()),
            lodash = _.runInContext();

        assert.ok(_.uniqueId() > oldId);

        var id = lodash.uniqueId();
        assert.strictEqual(id, '1');
        assert.ok(id < oldId);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### should return `true` if `predicate` returns truthy for any element

```ts
test('should return `true` if `predicate` returns truthy for any element', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.some([false, 1, ''], identity), true);
      assert.strictEqual(_.some([null, 'a', 0], identity), true);
    }
```

#### should return `false` for empty collections

```ts
test('should return `false` for empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubFalse);

      var actual = lodashStable.map(empties, function(value) {
        try {
          return _.some(value, identity);
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` if `predicate` returns falsey for all elements

```ts
test('should return `false` if `predicate` returns falsey for all elements', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.some([false, false, false], identity), false);
      assert.strictEqual(_.some([null, 0, ''], identity), false);
    }
```

#### should use `_.identity` when `predicate` is nullish

```ts
test('should use `_.identity` when `predicate` is nullish', function(assert) {
      assert.expect(2);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value, index) {
        var array = [0, 0];
        return index ? _.some(array, value) : _.some(array);
      });

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(values, stubTrue);
      actual = lodashStable.map(values, function(value, index) {
        var array = [0, 1];
        return index ? _.some(array, value) : _.some(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should sort in ascending order by `iteratee`

```ts
test('should sort in ascending order by `iteratee`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(_.sortBy(objects, function(object) {
        return object.b;
      }), 'b');

      assert.deepEqual(actual, [1, 2, 3, 4]);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array = [3, 2, 1],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([1, 2, 3]));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.sortBy(array, value) : _.sortBy(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should sort multiple properties in ascending order

```ts
test('`_.' + methodName + '` should sort multiple properties in ascending order', function(assert) {
      assert.expect(1);

      var actual = func(objects, ['a', 'b']);
      assert.deepEqual(actual, [objects[2], objects[0], objects[3], objects[1]]);
    }
```

#### `_.' + methodName + '` should provide correct `iteratee` arguments

```ts
test('`_.' + methodName + '` should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      func([30, 50], 40, function(assert) {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [40]);
    }
```

#### `_.' + methodName + '` should avoid calling iteratee when length is 0

```ts
test('`_.' + methodName + '` should avoid calling iteratee when length is 0', function(assert) {
      var objects = [],
          iteratee = function() {
            throw new Error;
          },
          actual = func(objects, { 'x': 50 }, iteratee);

      assert.strictEqual(actual, 0);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.sumBy(array, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [6]);
    }
```

#### should provide correct `predicate` arguments in a lazy sequence

```ts
test('should provide correct `predicate` arguments in a lazy sequence', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var args,
            array = lodashStable.range(LARGE_ARRAY_SIZE + 1);

        var expected = [
          square(LARGE_ARRAY_SIZE),
          LARGE_ARRAY_SIZE - 1,
          lodashStable.map(array.slice(1), square)
        ];

        _(array).slice(1).takeRightWhile(function(value, index, array) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, [LARGE_ARRAY_SIZE, LARGE_ARRAY_SIZE - 1, array.slice(1)]);

        _(array).slice(1).map(square).takeRightWhile(function(value, index, array) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);

        _(array).slice(1).map(square).takeRightWhile(function(value, index) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);

        _(array).slice(1).map(square).takeRightWhile(function(index) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, [square(LARGE_ARRAY_SIZE)]);

        _(array).slice(1).map(square).takeRightWhile(function() {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should provide correct `predicate` arguments in a lazy sequence

```ts
test('should provide correct `predicate` arguments in a lazy sequence', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var args,
            array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            expected = [1, 0, lodashStable.map(array.slice(1), square)];

        _(array).slice(1).takeWhile(function(value, index, array) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, [1, 0, array.slice(1)]);

        _(array).slice(1).map(square).takeWhile(function(value, index, array) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);

        _(array).slice(1).map(square).takeWhile(function(value, index) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);

        _(array).slice(1).map(square).takeWhile(function(value) {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, [1]);

        _(array).slice(1).map(square).takeWhile(function() {
          args = slice.call(arguments);
        }).value();

        assert.deepEqual(args, expected);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should support complex "interpolate" delimiters

```ts
test('should support complex "interpolate" delimiters', function(assert) {
      assert.expect(22);

      lodashStable.forOwn({
        '<%= a + b %>': '3',
        '<%= b - a %>': '1',
        '<%= a = b %>': '2',
        '<%= !a %>': 'false',
        '<%= ~a %>': '-2',
        '<%= a * b %>': '2',
        '<%= a / b %>': '0.5',
        '<%= a % b %>': '1',
        '<%= a >> b %>': '0',
        '<%= a << b %>': '4',
        '<%= a & b %>': '0',
        '<%= a ^ b %>': '3',
        '<%= a | b %>': '3',
        '<%= {}.toString.call(0) %>': numberTag,
        '<%= a.toFixed(2) %>': '1.00',
        '<%= obj["a"] %>': '1',
        '<%= delete a %>': 'true',
        '<%= "a" in obj %>': 'true',
        '<%= obj instanceof Object %>': 'true',
        '<%= new Boolean %>': 'false',
        '<%= typeof a %>': 'number',
        '<%= void a %>': ''
      },
      function(value, key) {
        var compiled = _.template(key),
            data = { 'a': 1, 'b': 2 };

        assert.strictEqual(compiled(data), value, key);
      });
    }
```

#### should forbid code injection through the "variable" options

```ts
test('should forbid code injection through the "variable" options', function(assert) {
      assert.expect(1);

      assert.raises(function() {
        _.template('', { 'variable': '){console.log(process.env)}; with(obj' });
      });
    }
```

#### should use a default `length` of `30`

```ts
test('should use a default `length` of `30`', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string), 'hi-diddly-ho there, neighbo...');
    }
```

#### should truncate string the given length

```ts
test('should truncate string the given length', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string, { 'length': 24 }), 'hi-diddly-ho there, n...');
    }
```

#### should support a `omission` option

```ts
test('should support a `omission` option', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.truncate(string, { 'omission': ' [...]' }), 'hi-diddly-ho there, neig [...]');
    }
```

#### should coerce nullish `omission` values to strings

```ts
test('should coerce nullish `omission` values to strings', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.truncate(string, { 'omission': null }), 'hi-diddly-ho there, neighbnull');
      assert.strictEqual(_.truncate(string, { 'omission': undefined }), 'hi-diddly-ho there, nundefined');
    }
```

#### should support a `separator` option

```ts
test('should support a `separator` option', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': ' ' }), 'hi-diddly-ho there,...');
      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': /,? +/ }), 'hi-diddly-ho there...');
      assert.strictEqual(_.truncate(string, { 'length': 24, 'separator': /,? +/g }), 'hi-diddly-ho there...');
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([string, string, string], _.truncate),
          truncated = 'hi-diddly-ho there, neighbo...';

      assert.deepEqual(actual, [truncated, truncated, truncated]);
    }
```

#### subsequent calls should return the result of the first call

```ts
test('subsequent calls should return the result of the first call', function(assert) {
      assert.expect(5);

      var done = assert.async();

      var throttled = _.throttle(identity, 32),
          results = [throttled('a'), throttled('b')];

      assert.deepEqual(results, ['a', 'a']);

      setTimeout(function() {
        var results = [throttled('c'), throttled('d')];
        assert.notEqual(results[0], 'a');
        assert.notStrictEqual(results[0], undefined);

        assert.notEqual(results[1], 'd');
        assert.notStrictEqual(results[1], undefined);
        done();
      }, 64);
    }
```

#### should support a `leading` option

```ts
test('should support a `leading` option', function(assert) {
      assert.expect(2);

      var withLeading = _.throttle(identity, 32, { 'leading': true });
      assert.strictEqual(withLeading('a'), 'a');

      var withoutLeading = _.throttle(identity, 32, { 'leading': false });
      assert.strictEqual(withoutLeading('a'), undefined);
    }
```

#### should coerce `n` to an integer

```ts
test('should coerce `n` to an integer', function(assert) {
      assert.expect(1);

      var actual = _.times(2.6, _.identity);
      assert.deepEqual(actual, [0, 1]);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.times(1, function(assert) {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [0]);
    }
```

#### should use `_.identity` when `iteratee` is nullish

```ts
test('should use `_.identity` when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([0, 1, 2]));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.times(3, value) : _.times(3);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return a valid length

```ts
test('should return a valid length', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.toLength(-1), 0);
      assert.strictEqual(_.toLength('1'), 1);
      assert.strictEqual(_.toLength(1.1), 1);
      assert.strictEqual(_.toLength(MAX_INTEGER), MAX_ARRAY_LENGTH);
    }
```

#### should return `value` if a valid length

```ts
test('should return `value` if a valid length', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.toLength(0), 0);
      assert.strictEqual(_.toLength(3), 3);
      assert.strictEqual(_.toLength(MAX_ARRAY_LENGTH), MAX_ARRAY_LENGTH);
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(2);

      var values = [0, '0', -0, '-0'],
          expected = [[0, Infinity], [0, Infinity], [-0, -Infinity], [-0, -Infinity]];

      lodashStable.times(2, function(index) {
        var others = lodashStable.map(values, index ? Object : identity);

        var actual = lodashStable.map(others, function(value) {
          var result = func(value);
          return [result, 1 / result];
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should convert string primitives and objects to numbers

```ts
test('`_.' + methodName + '` should convert string primitives and objects to numbers', function(assert) {
      assert.expect(1);

      var transforms = [identity, pad, positive, negative];

      var values = [
        '10', '1.234567890', (MAX_SAFE_INTEGER + ''),
        '1e+308', '1e308', '1E+308', '1E308',
        '5e-324', '5E-324',
        'Infinity', 'NaN'
      ];

      var expected = lodashStable.map(values, function(value) {
        var n = +value;
        if (!isToNumber) {
          if (!isToFinite && n == 1.234567890) {
            n = 1;
          }
          else if (n == Infinity) {
            n = MAX_INTEGER;
          }
          else if ((!isToFinite && n == Number.MIN_VALUE) || n !== n) {
            n = 0;
          }
          if (isToLength || isToSafeInteger) {
            n = Math.min(n, isToLength ? MAX_ARRAY_LENGTH : MAX_SAFE_INTEGER);
          }
        }
        var neg = isToLength ? 0 : -n;
        return [n, n, n, n, n, n, neg, neg];
      });

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert binary/octal strings to numbers

```ts
test('`_.' + methodName + '` should convert binary/octal strings to numbers', function(assert) {
      assert.expect(1);

      var numbers = [42, 5349, 1715004],
          transforms = [identity, pad],
          values = ['0b101010', '0o12345', '0x1a2b3c'];

      var expected = lodashStable.map(numbers, function(n) {
        return lodashStable.times(8, lodashStable.constant(n));
      });

      var actual = lodashStable.map(values, function(value) {
        var upper = value.toUpperCase();
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value))), func(mod(upper)), func(Object(mod(upper)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert invalid binary/octal strings to `' + (isToNumber ? 'NaN' : '0') + '`

```ts
test('`_.' + methodName + '` should convert invalid binary/octal strings to `' + (isToNumber ? 'NaN' : '0') + '`', function(assert) {
      assert.expect(1);

      var transforms = [identity, pad, positive, negative],
          values = ['0b', '0o', '0x', '0b1010102', '0o123458', '0x1a2b3x'];

      var expected = lodashStable.map(values, function(n) {
        return lodashStable.times(8, lodashStable.constant(isToNumber ? NaN : 0));
      });

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.flatMap(transforms, function(mod) {
          return [func(mod(value)), func(Object(mod(value)))];
        });
      });

      assert.deepEqual(actual, expected);
    }
```

#### should provide correct `iteratee` arguments when transforming an ' + key, function(assert) {
        assert.expect(2);

        var args;

        _.transform(object, function() {
          args || (args = slice.call(arguments));
        });

        var first = args[0];
        if (key == 'array') {
          assert.ok(first !== object && lodashStable.isArray(first));
          assert.deepEqual(args, [first, 1, 0, object]);
        } else {
          assert.ok(first !== object && lodashStable.isPlainObject(first));
          assert.deepEqual(args, [first, 1, 'a

```ts
test('should provide correct `iteratee` arguments when transforming an ' + key, function(assert) {
        assert.expect(2);

        var args;

        _.transform(object, function() {
          args || (args = slice.call(arguments));
        });

        var first = args[0];
        if (key == 'array') {
          assert.ok(first !== object && lodashStable.isArray(first));
          assert.deepEqual(args, [first, 1, 0, object]);
        } else {
          assert.ok(first !== object && lodashStable.isPlainObject(first));
          assert.deepEqual(args, [first, 1, 'a', object]);
        }
      });
    });

    QUnit.test('should create an object from the same realm as `object`', function(assert) {
      assert.expect(1);

      var objects = lodashStable.filter(realm, function(value) {
        return lodashStable.isObject(value) && !lodashStable.isElement(value);
      });

      var expected = lodashStable.map(objects, stubTrue);

      var actual = lodashStable.map(objects, function(object) {
        var Ctor = object.constructor,
            result = _.transform(object);

        if (result === object) {
          return false;
        }
        if (lodashStable.isTypedArray(object)) {
          return result instanceof Array;
        }
        return result instanceof Ctor || !(new Ctor instanceof Ctor);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should match side by side fitzpatrick modifiers separately

```ts
test('should match side by side fitzpatrick modifiers separately ', function(assert) {
      assert.expect(1);

      var string = fitzModifiers[0] + fitzModifiers[0];
      assert.deepEqual(_.toArray(string), [fitzModifiers[0], fitzModifiers[0]]);
    }
```

#### should cap the number of arguments provided to `func`

```ts
test('should cap the number of arguments provided to `func`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(['6', '8', '10'], _.unary(parseInt));
      assert.deepEqual(actual, [6, 8, 10]);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.unionBy([2.1], [1.2, 2.3], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [2.1]);
    }
```

#### `_.' + methodName + '` should provide correct `iteratee` arguments

```ts
test('`_.' + methodName + '` should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      func(objects, function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [objects[0]]);
    }
```

#### should generate unique ids

```ts
test('should generate unique ids', function(assert) {
      assert.expect(1);

      var actual = lodashStable.times(1000, function(assert) {
        return _.uniqueId();
      });

      assert.strictEqual(lodashStable.uniq(actual).length, actual.length);
    }
```

#### should return a string value when not providing a `prefix`

```ts
test('should return a string value when not providing a `prefix`', function(assert) {
      assert.expect(1);

      assert.strictEqual(typeof _.uniqueId(), 'string');
    }
```

#### should coerce the prefix argument to a string

```ts
test('should coerce the prefix argument to a string', function(assert) {
      assert.expect(1);

      var actual = [_.uniqueId(3), _.uniqueId(2), _.uniqueId(1)];
      assert.ok(/3\d+,2\d+,1\d+/.test(actual));
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.unzipWith([[1, 3, 5], [2, 4, 6]], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [1, 2]);
    }
```

#### should provide correct `wrapper` arguments

```ts
test('should provide correct `wrapper` arguments', function(assert) {
      assert.expect(1);

      var args;

      var wrapped = _.wrap(noop, function() {
        args || (args = slice.call(arguments));
      });

      wrapped(1, 2, 3);
      assert.deepEqual(args, [noop, 1, 2, 3]);
    }
```

#### should use `_.identity` when `wrapper` is nullish

```ts
test('should use `_.identity` when `wrapper` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubA);

      var actual = lodashStable.map(values, function(value, index) {
        var wrapped = index ? _.wrap('a', value) : _.wrap('a');
        return wrapped('b', 'c');
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should ignore individual secondary arguments

```ts
test('`_.' + methodName + '` should ignore individual secondary arguments', function(assert) {
      assert.expect(1);

      var array = [0];
      assert.deepEqual(func(array, 3, null, { '0': 1 }), array);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.xorBy([2.1, 1.2], [2.3, 3.4], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [2.3]);
    }
```

#### should provide correct `iteratee` arguments

```ts
test('should provide correct `iteratee` arguments', function(assert) {
      assert.expect(1);

      var args;

      _.zipWith([1, 2], [3, 4], [5, 6], function() {
        args || (args = slice.call(arguments));
      });

      assert.deepEqual(args, [1, 3, 5]);
    }
```

#### should work with `arguments` objects

```ts
test('should work with `arguments` objects', function(assert) {
      assert.expect(30);

      function message(methodName) {
        return '`_.' + methodName + '` should work with `arguments` objects';
      }

      assert.deepEqual(_.difference(args, [null]), [1, [3], 5], message('difference'));
      assert.deepEqual(_.difference(array, args), [2, 3, 4, 6], '_.difference should work with `arguments` objects as secondary arguments');

      assert.deepEqual(_.union(args, [null, 6]), [1, null, [3], 5, 6], message('union'));
      assert.deepEqual(_.union(array, args), array.concat([null, [3]]), '_.union should work with `arguments` objects as secondary arguments');

      assert.deepEqual(_.compact(args), [1, [3], 5], message('compact'));
      assert.deepEqual(_.drop(args, 3), [null, 5], message('drop'));
      assert.deepEqual(_.dropRight(args, 3), [1, null], message('dropRight'));
      assert.deepEqual(_.dropRightWhile(args,identity), [1, null, [3], null], message('dropRightWhile'));
      assert.deepEqual(_.dropWhile(args,identity), [null, [3], null, 5], message('dropWhile'));
      assert.deepEqual(_.findIndex(args, identity), 0, message('findIndex'));
      assert.deepEqual(_.findLastIndex(args, identity), 4, message('findLastIndex'));
      assert.deepEqual(_.flatten(args), [1, null, 3, null, 5], message('flatten'));
      assert.deepEqual(_.head(args), 1, message('head'));
      assert.deepEqual(_.indexOf(args, 5), 4, message('indexOf'));
      assert.deepEqual(_.initial(args), [1, null, [3], null], message('initial'));
      assert.deepEqual(_.intersection(args, [1]), [1], message('intersection'));
      assert.deepEqual(_.last(args), 5, message('last'));
      assert.deepEqual(_.lastIndexOf(args, 1), 0, message('lastIndexOf'));
      assert.deepEqual(_.sortedIndex(sortedArgs, 6), 3, message('sortedIndex'));
      assert.deepEqual(_.sortedIndexOf(sortedArgs, 5), 2, message('sortedIndexOf'));
      assert.deepEqual(_.sortedLastIndex(sortedArgs, 5), 3, message('sortedLastIndex'));
      assert.deepEqual(_.sortedLastIndexOf(sortedArgs, 1), 0, message('sortedLastIndexOf'));
      assert.deepEqual(_.tail(args, 4), [null, [3], null, 5], message('tail'));
      assert.deepEqual(_.take(args, 2), [1, null], message('take'));
      assert.deepEqual(_.takeRight(args, 1), [5], message('takeRight'));
      assert.deepEqual(_.takeRightWhile(args, identity), [5], message('takeRightWhile'));
      assert.deepEqual(_.takeWhile(args, identity), [1], message('takeWhile'));
      assert.deepEqual(_.uniq(args), [1, null, [3], 5], message('uniq'));
      assert.deepEqual(_.without(args, null), [1, [3], 5], message('without'));
      assert.deepEqual(_.zip(args, args), [[1, 1], [null, null], [[3], [3]], [null, null], [5, 5]], message('zip'));
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

#### new and sort

```ts
test('new and sort', function(assert) {
    assert.expect(6);
    var counter = 0;
    col.on('sort', function(){ counter++; });
    assert.deepEqual(col.pluck('label'), ['a', 'b', 'c', 'd']);
    col.comparator = function(m1, m2) {
      return m1.id > m2.id ? -1 : 1;
    };
    col.sort();
    assert.equal(counter, 1);
    assert.deepEqual(col.pluck('label'), ['a', 'b', 'c', 'd']);
    col.comparator = function(model) { return model.id; };
    col.sort();
    assert.equal(counter, 2);
    assert.deepEqual(col.pluck('label'), ['d', 'c', 'b', 'a']);
    assert.equal(col.length, 4);
  }
```

#### String comparator.

```ts
test('String comparator.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([
      {id: 3},
      {id: 1},
      {id: 2}
    ], {comparator: 'id'});
    assert.deepEqual(collection.pluck('id'), [1, 2, 3]);
  }
```

#### clone preserves model and comparator

```ts
test('clone preserves model and comparator', function(assert) {
    assert.expect(3);
    var Model = Backbone.Model.extend();
    var comparator = function(model){ return model.id; };

    var collection = new Backbone.Collection([{id: 1}], {
      model: Model,
      comparator: comparator
    }).clone();
    collection.add({id: 2});
    assert.ok(collection.at(0) instanceof Model);
    assert.ok(collection.at(1) instanceof Model);
    assert.strictEqual(collection.comparator, comparator);
  }
```

#### get

```ts
test('get', function(assert) {
    assert.expect(6);
    assert.equal(col.get(0), d);
    assert.equal(col.get(d.clone()), d);
    assert.equal(col.get(2), b);
    assert.equal(col.get({id: 1}), c);
    assert.equal(col.get(c.clone()), c);
    assert.equal(col.get(col.first().cid), col.first());
  }
```

#### get with non-default ids

```ts
test('get with non-default ids', function(assert) {
    assert.expect(5);
    var MongoModel = Backbone.Model.extend({idAttribute: '_id'});
    var model = new MongoModel({_id: 100});
    var collection = new Backbone.Collection([model], {model: MongoModel});
    assert.equal(collection.get(100), model);
    assert.equal(collection.get(model.cid), model);
    assert.equal(collection.get(model), model);
    assert.equal(collection.get(101), void 0);

    var collection2 = new Backbone.Collection();
    collection2.model = MongoModel;
    collection2.add(model.attributes);
    assert.equal(collection2.get(model.clone()), collection2.first());
  }
```

#### has

```ts
test('has', function(assert) {
    assert.expect(15);
    assert.ok(col.has(a));
    assert.ok(col.has(b));
    assert.ok(col.has(c));
    assert.ok(col.has(d));
    assert.ok(col.has(a.id));
    assert.ok(col.has(b.id));
    assert.ok(col.has(c.id));
    assert.ok(col.has(d.id));
    assert.ok(col.has(a.cid));
    assert.ok(col.has(b.cid));
    assert.ok(col.has(c.cid));
    assert.ok(col.has(d.cid));
    var outsider = new Backbone.Model({id: 4});
    assert.notOk(col.has(outsider));
    assert.notOk(col.has(outsider.id));
    assert.notOk(col.has(outsider.cid));
  }
```

#### update index when id changes

```ts
test('update index when id changes', function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection();
    collection.add([
      {id: 0, name: 'one'},
      {id: 1, name: 'two'}
    ]);
    var one = collection.get(0);
    assert.equal(one.get('name'), 'one');
    collection.on('change:name', function(model) { assert.ok(this.get(model)); });
    one.set({name: 'dalmatians', id: 101});
    assert.equal(collection.get(0), null);
    assert.equal(collection.get(101).get('name'), 'dalmatians');
  }
```

#### add

```ts
test('add', function(assert) {
    assert.expect(14);
    var added, opts, secondAdded;
    added = opts = secondAdded = null;
    e = new Backbone.Model({id: 10, label: 'e'});
    otherCol.add(e);
    otherCol.on('add', function() {
      secondAdded = true;
    });
    col.on('add', function(model, collection, options){
      added = model.get('label');
      opts = options;
    });
    col.add(e, {amazing: true});
    assert.equal(added, 'e');
    assert.equal(col.length, 5);
    assert.equal(col.last(), e);
    assert.equal(otherCol.length, 1);
    assert.equal(secondAdded, null);
    assert.ok(opts.amazing);

    var f = new Backbone.Model({id: 20, label: 'f'});
    var g = new Backbone.Model({id: 21, label: 'g'});
    var h = new Backbone.Model({id: 22, label: 'h'});
    var atCol = new Backbone.Collection([f, g, h]);
    assert.equal(atCol.length, 3);
    atCol.add(e, {at: 1});
    assert.equal(atCol.length, 4);
    assert.equal(atCol.at(1), e);
    assert.equal(atCol.last(), h);

    var coll = new Backbone.Collection(new Array(2));
    var addCount = 0;
    coll.on('add', function(){
      addCount += 1;
    });
    coll.add([undefined, f, g]);
    assert.equal(coll.length, 5);
    assert.equal(addCount, 3);
    coll.add(new Array(4));
    assert.equal(coll.length, 9);
    assert.equal(addCount, 7);
  }
```

#### add; at should have preference over comparator

```ts
test('add; at should have preference over comparator', function(assert) {
    assert.expect(1);
    var Col = Backbone.Collection.extend({
      comparator: function(m1, m2) {
        return m1.id > m2.id ? -1 : 1;
      }
    });

    var collection = new Col([{id: 2}, {id: 3}]);
    collection.add(new Backbone.Model({id: 1}), {at: 1});

    assert.equal(collection.pluck('id').join(' '), '3 1 2');
  }
```

#### add; at should add to the end if the index is out of bounds

```ts
test('add; at should add to the end if the index is out of bounds', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 2}, {id: 3}]);
    collection.add(new Backbone.Model({id: 1}), {at: 5});

    assert.equal(collection.pluck('id').join(' '), '2 3 1');
  }
```

#### can't add model to collection twice

```ts
test("can't add model to collection twice", function(assert) {
    var collection = new Backbone.Collection([{id: 1}, {id: 2}, {id: 1}, {id: 2}, {id: 3}]);
    assert.equal(collection.pluck('id').join(' '), '1 2 3');
  }
```

#### can't add different model with same id to collection twice

```ts
test("can't add different model with same id to collection twice", function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    collection.unshift({id: 101});
    collection.add({id: 101});
    assert.equal(collection.length, 1);
  }
```

#### merge in duplicate models with {merge: true}

```ts
test('merge in duplicate models with {merge: true}', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection;
    collection.add([{id: 1, name: 'Moe'}, {id: 2, name: 'Curly'}, {id: 3, name: 'Larry'}]);
    collection.add({id: 1, name: 'Moses'});
    assert.equal(collection.first().get('name'), 'Moe');
    collection.add({id: 1, name: 'Moses'}, {merge: true});
    assert.equal(collection.first().get('name'), 'Moses');
    collection.add({id: 1, name: 'Tim'}, {merge: true, silent: true});
    assert.equal(collection.first().get('name'), 'Tim');
  }
```

#### add model to multiple collections

```ts
test('add model to multiple collections', function(assert) {
    assert.expect(10);
    var counter = 0;
    var m = new Backbone.Model({id: 10, label: 'm'});
    m.on('add', function(model, collection) {
      counter++;
      assert.equal(m, model);
      if (counter > 1) {
        assert.equal(collection, col2);
      } else {
        assert.equal(collection, col1);
      }
    });
    var col1 = new Backbone.Collection([]);
    col1.on('add', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col1, collection);
    });
    var col2 = new Backbone.Collection([]);
    col2.on('add', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col2, collection);
    });
    col1.add(m);
    assert.equal(m.collection, col1);
    col2.add(m);
    assert.equal(m.collection, col1);
  }
```

#### add with parse and merge

```ts
test('add with parse and merge', function(assert) {
    var collection = new Backbone.Collection();
    collection.parse = function(attrs) {
      return _.map(attrs, function(model) {
        if (model.model) return model.model;
        return model;
      });
    };
    collection.add({id: 1});
    collection.add({model: {id: 1, name: 'Alf'}}, {parse: true, merge: true});
    assert.equal(collection.first().get('name'), 'Alf');
  }
```

#### comparator that depends on `this`

```ts
test('comparator that depends on `this`', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.negative = function(num) {
      return -num;
    };
    collection.comparator = function(model) {
      return this.negative(model.id);
    };
    collection.add([{id: 1}, {id: 2}, {id: 3}]);
    assert.deepEqual(collection.pluck('id'), [3, 2, 1]);
    collection.comparator = function(m1, m2) {
      return this.negative(m2.id) - this.negative(m1.id);
    };
    collection.sort();
    assert.deepEqual(collection.pluck('id'), [1, 2, 3]);
  }
```

#### remove

```ts
test('remove', function(assert) {
    assert.expect(12);
    var removed = null;
    var result = null;
    col.on('remove', function(model, collection, options) {
      removed = model.get('label');
      assert.equal(options.index, 3);
      assert.equal(collection.get(model), undefined, '#3693: model cannot be fetched from collection');
    });
    result = col.remove(d);
    assert.equal(removed, 'd');
    assert.strictEqual(result, d);
    //if we try to remove d again, it's not going to actually get removed
    result = col.remove(d);
    assert.strictEqual(result, undefined);
    assert.equal(col.length, 3);
    assert.equal(col.first(), a);
    col.off();
    result = col.remove([c, d]);
    assert.equal(result.length, 1, 'only returns removed models');
    assert.equal(result[0], c, 'only returns removed models');
    result = col.remove([c, b]);
    assert.equal(result.length, 1, 'only returns removed models');
    assert.equal(result[0], b, 'only returns removed models');
    result = col.remove([]);
    assert.deepEqual(result, [], 'returns empty array when nothing removed');
  });

  QUnit.test('add and remove return values', function(assert) {
    assert.expect(13);
    var Even = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.id % 2 !== 0) return 'odd';
      }
    });
    var collection = new Backbone.Collection;
    collection.model = Even;

    var list = collection.add([{id: 2}, {id: 4}], {validate: true});
    assert.equal(list.length, 2);
    assert.ok(list[0] instanceof Backbone.Model);
    assert.equal(list[1], collection.last());
    assert.equal(list[1].get('id'), 4);

    list = collection.add([{id: 3}, {id: 6}], {validate: true});
    assert.equal(collection.length, 3);
    assert.equal(list[0], false);
    assert.equal(list[1].get('id'), 6);

    var result = collection.add({id: 6});
    assert.equal(result.cid, list[1].cid);

    result = collection.remove({id: 6});
    assert.equal(collection.length, 2);
    assert.equal(result.id, 6);

    list = collection.remove([{id: 2}, {id: 8}]);
    assert.equal(collection.length, 1);
    assert.equal(list[0].get('id'), 2);
    assert.equal(list[1], null);
  });

  QUnit.test('shift and pop', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{a: 'a'}, {b: 'b'}, {c: 'c'}]);
    assert.equal(collection.shift().get('a'), 'a');
    assert.equal(collection.pop().get('c'), 'c');
  });

  QUnit.test('slice', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{a: 'a'}, {b: 'b'}, {c: 'c'}]);
    var array = collection.slice(1, 3);
    assert.equal(array.length, 2);
    assert.equal(array[0].get('b'), 'b');
  });

  QUnit.test('events are unbound on remove', function(assert) {
    assert.expect(3);
    var counter = 0;
    var dj = new Backbone.Model();
    var emcees = new Backbone.Collection([dj]);
    emcees.on('change', function(){ counter++; });
    dj.set({name: 'Kool'});
    assert.equal(counter, 1);
    emcees.reset([]);
    assert.equal(dj.collection, undefined);
    dj.set({name: 'Shadow'});
    assert.equal(counter, 1);
  });

  QUnit.test('remove in multiple collections', function(assert) {
    assert.expect(7);
    var modelData = {
      id: 5,
      title: 'Othello'
    };
    var passed = false;
    var m1 = new Backbone.Model(modelData);
    var m2 = new Backbone.Model(modelData);
    m2.on('remove', function() {
      passed = true;
    });
    var col1 = new Backbone.Collection([m1]);
    var col2 = new Backbone.Collection([m2]);
    assert.notEqual(m1, m2);
    assert.ok(col1.length === 1);
    assert.ok(col2.length === 1);
    col1.remove(m1);
    assert.equal(passed, false);
    assert.ok(col1.length === 0);
    col2.remove(m1);
    assert.ok(col2.length === 0);
    assert.equal(passed, true);
  });

  QUnit.test('remove same model in multiple collection', function(assert) {
    assert.expect(16);
    var counter = 0;
    var m = new Backbone.Model({id: 5, title: 'Othello'});
    m.on('remove', function(model, collection) {
      counter++;
      assert.equal(m, model);
      if (counter > 1) {
        assert.equal(collection, col1);
      } else {
        assert.equal(collection, col2);
      }
    });
    var col1 = new Backbone.Collection([m]);
    col1.on('remove', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col1, collection);
    });
    var col2 = new Backbone.Collection([m]);
    col2.on('remove', function(model, collection) {
      assert.equal(m, model);
      assert.equal(col2, collection);
    });
    assert.equal(col1, m.collection);
    col2.remove(m);
    assert.ok(col2.length === 0);
    assert.ok(col1.length === 1);
    assert.equal(counter, 1);
    assert.equal(col1, m.collection);
    col1.remove(m);
    assert.equal(null, m.collection);
    assert.ok(col1.length === 0);
    assert.equal(counter, 2);
  });

  QUnit.test('model destroy removes from all collections', function(assert) {
    assert.expect(3);
    var m = new Backbone.Model({id: 5, title: 'Othello'});
    m.sync = function(method, model, options) { options.success(); };
    var col1 = new Backbone.Collection([m]);
    var col2 = new Backbone.Collection([m]);
    m.destroy();
    assert.ok(col1.length === 0);
    assert.ok(col2.length === 0);
    assert.equal(undefined, m.collection);
  });

  QUnit.test('Collection: non-persisted model destroy removes from all collections', function(assert) {
    assert.expect(3);
    var m = new Backbone.Model({title: 'Othello'});
    m.sync = function(method, model, options) { throw 'should not be called'; };
    var col1 = new Backbone.Collection([m]);
    var col2 = new Backbone.Collection([m]);
    m.destroy();
    assert.ok(col1.length === 0);
    assert.ok(col2.length === 0);
    assert.equal(undefined, m.collection);
  });

  QUnit.test('fetch', function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    collection.fetch();
    assert.equal(this.syncArgs.method, 'read');
    assert.equal(this.syncArgs.model, collection);
    assert.equal(this.syncArgs.options.parse, true);

    collection.fetch({parse: false});
    assert.equal(this.syncArgs.options.parse, false);
  });

  QUnit.test('fetch with an error response triggers an error event', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection();
    collection.on('error', function() {
      assert.ok(true);
    });
    collection.sync = function(method, model, options) { options.error(); };
    collection.fetch();
  });

  QUnit.test('#3283 - fetch with an error response calls error with context', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection();
    var obj = {};
    var options = {
      context: obj,
      error: function() {
        assert.equal(this, obj);
      }
    };
    collection.sync = function(method, model, opts) {
      opts.error.call(opts.context);
    };
    collection.fetch(options);
  });

  QUnit.test('ensure fetch only parses once', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var counter = 0;
    collection.parse = function(models) {
      counter++;
      return models;
    };
    collection.url = '/test';
    collection.fetch();
    this.syncArgs.options.success([]);
    assert.equal(counter, 1);
  });

  QUnit.test('create', function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    var model = collection.create({label: 'f'}, {wait: true});
    assert.equal(this.syncArgs.method, 'create');
    assert.equal(this.syncArgs.model, model);
    assert.equal(model.get('label'), 'f');
    assert.equal(model.collection, collection);
  });

  QUnit.test('create with validate:true enforces validation', function(assert) {
    assert.expect(3);
    var ValidatingModel = Backbone.Model.extend({
      validate: function(attrs) {
        return 'fail';
      }
    });
    var ValidatingCollection = Backbone.Collection.extend({
      model: ValidatingModel
    });
    var collection = new ValidatingCollection();
    collection.on('invalid', function(coll, error, options) {
      assert.equal(error, 'fail');
      assert.equal(options.validationError, 'fail');
    });
    assert.equal(collection.create({foo: 'bar'}, {validate: true}), false);
  });

  QUnit.test('create will pass extra options to success callback', function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      sync: function(method, model, options) {
        _.extend(options, {specialSync: true});
        return Backbone.Model.prototype.sync.call(this, method, model, options);
      }
    });

    var Collection = Backbone.Collection.extend({
      model: Model,
      url: '/test'
    });

    var collection = new Collection;

    var success = function(model, response, options) {
      assert.ok(options.specialSync, 'Options were passed correctly to callback');
    };

    collection.create({}, {success: success});
    this.ajaxSettings.success();
  });

  QUnit.test('create with wait:true should not call collection.parse', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      url: '/test',
      parse: function() {
        assert.ok(false);
      }
    });

    var collection = new Collection;

    collection.create({}, {wait: true});
    this.ajaxSettings.success();
  });

  QUnit.test('a failing create returns model with errors', function(assert) {
    var ValidatingModel = Backbone.Model.extend({
      validate: function(attrs) {
        return 'fail';
      }
    });
    var ValidatingCollection = Backbone.Collection.extend({
      model: ValidatingModel
    });
    var collection = new ValidatingCollection();
    var m = collection.create({foo: 'bar'});
    assert.equal(m.validationError, 'fail');
    assert.equal(collection.length, 1);
  });

  QUnit.test('initialize', function(assert) {
    assert.expect(1);
    var Collection = Backbone.Collection.extend({
      initialize: function() {
        this.one = 1;
      }
    });
    var coll = new Collection;
    assert.equal(coll.one, 1);
  });

  QUnit.test('preinitialize', function(assert) {
    assert.expect(1);
    var Collection = Backbone.Collection.extend({
      preinitialize: function() {
        this.one = 1;
      }
    });
    var coll = new Collection;
    assert.equal(coll.one, 1);
  });

  QUnit.test('preinitialize occurs before the collection is set up', function(assert) {
    assert.expect(2);
    var Collection = Backbone.Collection.extend({
      preinitialize: function() {
        assert.notEqual(this.model, FooModel);
      }
    });
    var FooModel = Backbone.Model.extend({id: 'foo'});
    var coll = new Collection({}, {
      model: FooModel
    });
    assert.equal(coll.model, FooModel);
  });

  QUnit.test('toJSON', function(assert) {
    assert.expect(1);
    assert.equal(JSON.stringify(col), '[{"id":3,"label":"a"},{"id":2,"label":"b"},{"id":1,"label":"c"},{"id":0,"label":"d"}]');
  });

  QUnit.test('where and findWhere', function(assert) {
    assert.expect(8);
    var model = new Backbone.Model({a: 1});
    var coll = new Backbone.Collection([
      model,
      {a: 1},
      {a: 1, b: 2},
      {a: 2, b: 2},
      {a: 3}
    ]);
    assert.equal(coll.where({a: 1}).length, 3);
    assert.equal(coll.where({a: 2}).length, 1);
    assert.equal(coll.where({a: 3}).length, 1);
    assert.equal(coll.where({b: 1}).length, 0);
    assert.equal(coll.where({b: 2}).length, 2);
    assert.equal(coll.where({a: 1, b: 2}).length, 1);
    assert.equal(coll.findWhere({a: 1}), model);
    assert.equal(coll.findWhere({a: 4}), void 0);
  });

  QUnit.test('Underscore methods', function(assert) {
    assert.expect(21);
    assert.equal(col.map(function(model){ return model.get('label'); }).join(' '), 'a b c d');
    assert.equal(col.some(function(model){ return model.id === 100; }), false);
    assert.equal(col.some(function(model){ return model.id === 0; }), true);
    assert.equal(col.reduce(function(m1, m2) {return m1.id > m2.id ? m1 : m2;}).id, 3);
    assert.equal(col.reduceRight(function(m1, m2) {return m1.id > m2.id ? m1 : m2;}).id, 3);
    assert.equal(col.indexOf(b), 1);
    assert.equal(col.size(), 4);
    assert.equal(col.rest().length, 3);
    assert.ok(!_.includes(col.rest(), a));
    assert.ok(_.includes(col.rest(), d));
    assert.ok(!col.isEmpty());
    assert.ok(!_.includes(col.without(d), d));

    var wrapped = col.chain();
    assert.equal(wrapped.map('id').max().value(), 3);
    assert.equal(wrapped.map('id').min().value(), 0);
    assert.deepEqual(wrapped
      .filter(function(o){ return o.id % 2 === 0; })
      .map(function(o){ return o.id * 2; })
      .value(),
      [4, 0]);
    assert.deepEqual(col.difference([c, d]), [a, b]);
    assert.ok(col.includes(col.sample()));

    var first = col.first();
    assert.deepEqual(col.groupBy(function(model){ return model.id; })[first.id], [first]);
    assert.deepEqual(col.countBy(function(model){ return model.id; }), {0: 1, 1: 1, 2: 1, 3: 1});
    assert.deepEqual(col.sortBy(function(model){ return model.id; })[0], col.at(3));
    assert.ok(col.indexBy('id')[first.id] === first);
  });

  QUnit.test('Underscore methods with object-style and property-style iteratee', function(assert) {
    assert.expect(26);
    var model = new Backbone.Model({a: 4, b: 1, e: 3});
    var coll = new Backbone.Collection([
      {a: 1, b: 1},
      {a: 2, b: 1, c: 1},
      {a: 3, b: 1},
      model
    ]);
    assert.equal(coll.find({a: 0}), undefined);
    assert.deepEqual(coll.find({a: 4}), model);
    assert.equal(coll.find('d'), undefined);
    assert.deepEqual(coll.find('e'), model);
    assert.equal(coll.filter({a: 0}), false);
    assert.deepEqual(coll.filter({a: 4}), [model]);
    assert.equal(coll.some({a: 0}), false);
    assert.equal(coll.some({a: 1}), true);
    assert.equal(coll.reject({a: 0}).length, 4);
    assert.deepEqual(coll.reject({a: 4}), _.without(coll.models, model));
    assert.equal(coll.every({a: 0}), false);
    assert.equal(coll.every({b: 1}), true);
    assert.deepEqual(coll.partition({a: 0})[0], []);
    assert.deepEqual(coll.partition({a: 0})[1], coll.models);
    assert.deepEqual(coll.partition({a: 4})[0], [model]);
    assert.deepEqual(coll.partition({a: 4})[1], _.without(coll.models, model));
    assert.deepEqual(coll.map({a: 2}), [false, true, false, false]);
    assert.deepEqual(coll.map('a'), [1, 2, 3, 4]);
    assert.deepEqual(coll.sortBy('a')[3], model);
    assert.deepEqual(coll.sortBy('e')[0], model);
    assert.deepEqual(coll.countBy({a: 4}), {'false': 3, 'true': 1});
    assert.deepEqual(coll.countBy('d'), {'undefined': 4});
    assert.equal(coll.findIndex({b: 1}), 0);
    assert.equal(coll.findIndex({b: 9}), -1);
    assert.equal(coll.findLastIndex({b: 1}), 3);
    assert.equal(coll.findLastIndex({b: 9}), -1);
  });

  QUnit.test('reset', function(assert) {
    assert.expect(16);

    var resetCount = 0;
    var models = col.models;
    col.on('reset', function() { resetCount += 1; });
    col.reset([]);
    assert.equal(resetCount, 1);
    assert.equal(col.length, 0);
    assert.equal(col.last(), null);
    col.reset(models);
    assert.equal(resetCount, 2);
    assert.equal(col.length, 4);
    assert.equal(col.last(), d);
    col.reset(_.map(models, function(m){ return m.attributes; }));
    assert.equal(resetCount, 3);
    assert.equal(col.length, 4);
    assert.ok(col.last() !== d);
    assert.ok(_.isEqual(col.last().attributes, d.attributes));
    col.reset();
    assert.equal(col.length, 0);
    assert.equal(resetCount, 4);

    var f = new Backbone.Model({id: 20, label: 'f'});
    col.reset([undefined, f]);
    assert.equal(col.length, 2);
    assert.equal(resetCount, 5);

    col.reset(new Array(4));
    assert.equal(col.length, 4);
    assert.equal(resetCount, 6);
  });

  QUnit.test('reset with different values', function(assert) {
    var collection = new Backbone.Collection({id: 1});
    collection.reset({id: 1, a: 1});
    assert.equal(collection.get(1).get('a'), 1);
  });

  QUnit.test('same references in reset', function(assert) {
    var model = new Backbone.Model({id: 1});
    var collection = new Backbone.Collection({id: 1});
    collection.reset(model);
    assert.equal(collection.get(1), model);
  });

  QUnit.test('reset passes caller options', function(assert) {
    assert.expect(3);
    var Model = Backbone.Model.extend({
      initialize: function(attrs, options) {
        this.modelParameter = options.modelParameter;
      }
    });
    var collection = new (Backbone.Collection.extend({model: Model}))();
    collection.reset([{astring: 'green', anumber: 1}, {astring: 'blue', anumber: 2}], {modelParameter: 'model parameter'});
    assert.equal(collection.length, 2);
    collection.each(function(model) {
      assert.equal(model.modelParameter, 'model parameter');
    });
  });

  QUnit.test('reset does not alter options by reference', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([{id: 1}]);
    var origOpts = {};
    collection.on('reset', function(coll, opts){
      assert.equal(origOpts.previousModels, undefined);
      assert.equal(opts.previousModels[0].id, 1);
    });
    collection.reset([], origOpts);
  });

  QUnit.test('trigger custom events on models', function(assert) {
    assert.expect(1);
    var fired = null;
    a.on('custom', function() { fired = true; });
    a.trigger('custom');
    assert.equal(fired, true);
  });

  QUnit.test('add does not alter arguments', function(assert) {
    assert.expect(2);
    var attrs = {};
    var models = [attrs];
    new Backbone.Collection().add(models);
    assert.equal(models.length, 1);
    assert.ok(attrs === models[0]);
  });

  QUnit.test('#714: access `model.collection` in a brand new model.', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    var Model = Backbone.Model.extend({
      set: function(attrs) {
        assert.equal(attrs.prop, 'value');
        assert.equal(this.collection, collection);
        return this;
      }
    });
    collection.model = Model;
    collection.create({prop: 'value'});
  });

  QUnit.test('#574, remove its own reference to the .models array.', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection([
      {id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}
    ]);
    assert.equal(collection.length, 6);
    collection.remove(collection.models);
    assert.equal(collection.length, 0);
  });

  QUnit.test('#861, adding models to a collection which do not pass validation, with validate:true', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.id === 3) return "id can't be 3";
      }
    });

    var Collection = Backbone.Collection.extend({
      model: Model
    });

    var collection = new Collection;
    collection.on('invalid', function() { assert.ok(true); });

    collection.add([{id: 1}, {id: 2}, {id: 3}, {id: 4}, {id: 5}, {id: 6}], {validate: true});
    assert.deepEqual(collection.pluck('id'), [1, 2, 4, 5, 6]);
  });

  QUnit.test('Invalid models are discarded with validate:true.', function(assert) {
    assert.expect(5);
    var collection = new Backbone.Collection;
    collection.on('test', function() { assert.ok(true); });
    collection.model = Backbone.Model.extend({
      validate: function(attrs){ if (!attrs.valid) return 'invalid'; }
    });
    var model = new collection.model({id: 1, valid: true});
    collection.add([model, {id: 2}], {validate: true});
    model.trigger('test');
    assert.ok(collection.get(model.cid));
    assert.ok(collection.get(1));
    assert.ok(!collection.get(2));
    assert.equal(collection.length, 1);
  });

  QUnit.test('multiple copies of the same model', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection();
    var model = new Backbone.Model();
    collection.add([model, model]);
    assert.equal(collection.length, 1);
    collection.add([{id: 1}, {id: 1}]);
    assert.equal(collection.length, 2);
    assert.equal(collection.last().id, 1);
  });

  QUnit.test('#964 - collection.get return inconsistent', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection();
    assert.ok(collection.get(null) === undefined);
    assert.ok(collection.get() === undefined);
  });

  QUnit.test('#1112 - passing options.model sets collection.model', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({});
    var collection = new Backbone.Collection([{id: 1}], {model: Model});
    assert.ok(collection.model === Model);
    assert.ok(collection.at(0) instanceof Model);
  });

  QUnit.test('null and undefined are invalid ids.', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({id: 1});
    var collection = new Backbone.Collection([model]);
    model.set({id: null});
    assert.ok(!collection.get('null'));
    model.set({id: 1});
    model.set({id: undefined});
    assert.ok(!collection.get('undefined'));
  });

  QUnit.test('falsy comparator', function(assert) {
    assert.expect(4);
    var Col = Backbone.Collection.extend({
      comparator: function(model){ return model.id; }
    });
    var collection = new Col();
    var colFalse = new Col(null, {comparator: false});
    var colNull = new Col(null, {comparator: null});
    var colUndefined = new Col(null, {comparator: undefined});
    assert.ok(collection.comparator);
    assert.ok(!colFalse.comparator);
    assert.ok(!colNull.comparator);
    assert.ok(colUndefined.comparator);
  });

  QUnit.test('#1355 - `options` is passed to success callbacks', function(assert) {
    assert.expect(2);
    var m = new Backbone.Model({x: 1});
    var collection = new Backbone.Collection();
    var opts = {
      opts: true,
      success: function(coll, resp, options) {
        assert.ok(options.opts);
      }
    };
    collection.sync = m.sync = function( method, coll, options ){
      options.success({});
    };
    collection.fetch(opts);
    collection.create(m, opts);
  });

  QUnit.test("#1412 - Trigger 'request' and 'sync' events.", function(assert) {
    assert.expect(4);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    Backbone.ajax = function(settings){ settings.success(); };

    collection.on('request', function(obj, xhr, options) {
      assert.ok(obj === collection, "collection has correct 'request' event after fetching");
    });
    collection.on('sync', function(obj, response, options) {
      assert.ok(obj === collection, "collection has correct 'sync' event after fetching");
    });
    collection.fetch();
    collection.off();

    collection.on('request', function(obj, xhr, options) {
      assert.ok(obj === collection.get(1), "collection has correct 'request' event after one of its models save");
    });
    collection.on('sync', function(obj, response, options) {
      assert.ok(obj === collection.get(1), "collection has correct 'sync' event after one of its models save");
    });
    collection.create({id: 1});
    collection.off();
  });

  QUnit.test('#3283 - fetch, create calls success with context', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.url = '/test';
    Backbone.ajax = function(settings) {
      settings.success.call(settings.context);
    };
    var obj = {};
    var options = {
      context: obj,
      success: function() {
        assert.equal(this, obj);
      }
    };

    collection.fetch(options);
    collection.create({id: 1}, options);
  });

  QUnit.test('#1447 - create with wait adds model.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var model = new Backbone.Model;
    model.sync = function(method, m, options){ options.success(); };
    collection.on('add', function(){ assert.ok(true); });
    collection.create(model, {wait: true});
  });

  QUnit.test('#1448 - add sorts collection after merge.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([
      {id: 1, x: 1},
      {id: 2, x: 2}
    ]);
    collection.comparator = function(model){ return model.get('x'); };
    collection.add({id: 1, x: 3}, {merge: true});
    assert.deepEqual(collection.pluck('id'), [2, 1]);
  });

  QUnit.test('#1655 - groupBy can be used with a string argument.', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection([{x: 1}, {x: 2}]);
    var grouped = collection.groupBy('x');
    assert.strictEqual(_.keys(grouped).length, 2);
    assert.strictEqual(grouped[1][0].get('x'), 1);
    assert.strictEqual(grouped[2][0].get('x'), 2);
  });

  QUnit.test('#1655 - sortBy can be used with a string argument.', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{x: 3}, {x: 1}, {x: 2}]);
    var values = _.map(collection.sortBy('x'), function(model) {
      return model.get('x');
    });
    assert.deepEqual(values, [1, 2, 3]);
  });

  QUnit.test('#1604 - Removal during iteration.', function(assert) {
    assert.expect(0);
    var collection = new Backbone.Collection([{}, {}]);
    collection.on('add', function() {
      collection.at(0).destroy();
    });
    collection.add({}, {at: 0});
  });

  QUnit.test('#1638 - `sort` during `add` triggers correctly.', function(assert) {
    var collection = new Backbone.Collection;
    collection.comparator = function(model) { return model.get('x'); };
    var added = [];
    collection.on('add', function(model) {
      model.set({x: 3});
      collection.sort();
      added.push(model.id);
    });
    collection.add([{id: 1, x: 1}, {id: 2, x: 2}]);
    assert.deepEqual(added, [1, 2]);
  });

  QUnit.test('fetch parses models by default', function(assert) {
    assert.expect(1);
    var model = {};
    var Collection = Backbone.Collection.extend({
      url: 'test',
      model: Backbone.Model.extend({
        parse: function(resp) {
          assert.strictEqual(resp, model);
        }
      })
    });
    new Collection().fetch();
    this.ajaxSettings.success([model]);
  });

  QUnit.test("`sort` shouldn't always fire on `add`", function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}, {id: 3}], {
      comparator: 'id'
    });
    collection.sort = function(){ assert.ok(true); };
    collection.add([]);
    collection.add({id: 1});
    collection.add([{id: 2}, {id: 3}]);
    collection.add({id: 4});
  });

  QUnit.test('#1407 parse option on constructor parses collection and models', function(assert) {
    assert.expect(2);
    var model = {
      namespace: [{id: 1}, {id: 2}]
    };
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        parse: function(m) {
          m.name = 'test';
          return m;
        }
      }),
      parse: function(m) {
        return m.namespace;
      }
    });
    var collection = new Collection(model, {parse: true});

    assert.equal(collection.length, 2);
    assert.equal(collection.at(0).get('name'), 'test');
  });

  QUnit.test('#1407 parse option on reset parses collection and models', function(assert) {
    assert.expect(2);
    var model = {
      namespace: [{id: 1}, {id: 2}]
    };
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        parse: function(m) {
          m.name = 'test';
          return m;
        }
      }),
      parse: function(m) {
        return m.namespace;
      }
    });
    var collection = new Collection();
    collection.reset(model, {parse: true});

    assert.equal(collection.length, 2);
    assert.equal(collection.at(0).get('name'), 'test');
  });


  QUnit.test('Reset includes previous models in triggered event.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model();
    var collection = new Backbone.Collection([model]);
    collection.on('reset', function(coll, options) {
      assert.deepEqual(options.previousModels, [model]);
    });
    collection.reset([]);
  });

  QUnit.test('set', function(assert) {
    var m1 = new Backbone.Model();
    var m2 = new Backbone.Model({id: 2});
    var m3 = new Backbone.Model();
    var collection = new Backbone.Collection([m1, m2]);

    // Test add/change/remove events
    collection.on('add', function(model) {
      assert.strictEqual(model, m3);
    });
    collection.on('change', function(model) {
      assert.strictEqual(model, m2);
    });
    collection.on('remove', function(model) {
      assert.strictEqual(model, m1);
    });

    // remove: false doesn't remove any models
    collection.set([], {remove: false});
    assert.strictEqual(collection.length, 2);

    // add: false doesn't add any models
    collection.set([m1, m2, m3], {add: false});
    assert.strictEqual(collection.length, 2);

    // merge: false doesn't change any models
    collection.set([m1, {id: 2, a: 1}], {merge: false});
    assert.strictEqual(m2.get('a'), void 0);

    // add: false, remove: false only merges existing models
    collection.set([m1, {id: 2, a: 0}, m3, {id: 4}], {add: false, remove: false});
    assert.strictEqual(collection.length, 2);
    assert.strictEqual(m2.get('a'), 0);

    // default options add/remove/merge as appropriate
    collection.set([{id: 2, a: 1}, m3]);
    assert.strictEqual(collection.length, 2);
    assert.strictEqual(m2.get('a'), 1);

    // Test removing models not passing an argument
    collection.off('remove').on('remove', function(model) {
      assert.ok(model === m2 || model === m3);
    });
    collection.set([]);
    assert.strictEqual(collection.length, 0);

    // Test null models on set doesn't clear collection
    collection.off();
    collection.set([{id: 1}]);
    collection.set();
    assert.strictEqual(collection.length, 1);
  });

  QUnit.test('set with only cids', function(assert) {
    assert.expect(3);
    var m1 = new Backbone.Model;
    var m2 = new Backbone.Model;
    var collection = new Backbone.Collection;
    collection.set([m1, m2]);
    assert.equal(collection.length, 2);
    collection.set([m1]);
    assert.equal(collection.length, 1);
    collection.set([m1, m1, m1, m2, m2], {remove: false});
    assert.equal(collection.length, 2);
  });

  QUnit.test('set with only idAttribute', function(assert) {
    assert.expect(3);
    var m1 = {_id: 1};
    var m2 = {_id: 2};
    var Col = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        idAttribute: '_id'
      })
    });
    var collection = new Col;
    collection.set([m1, m2]);
    assert.equal(collection.length, 2);
    collection.set([m1]);
    assert.equal(collection.length, 1);
    collection.set([m1, m1, m1, m2, m2], {remove: false});
    assert.equal(collection.length, 2);
  });

  QUnit.test('set + merge with default values defined', function(assert) {
    var Model = Backbone.Model.extend({
      defaults: {
        key: 'value'
      }
    });
    var m = new Model({id: 1});
    var collection = new Backbone.Collection([m], {model: Model});
    assert.equal(collection.first().get('key'), 'value');

    collection.set({id: 1, key: 'other'});
    assert.equal(collection.first().get('key'), 'other');

    collection.set({id: 1, other: 'value'});
    assert.equal(collection.first().get('key'), 'other');
    assert.equal(collection.length, 1);
  });

  QUnit.test('merge without mutation', function(assert) {
    var Model = Backbone.Model.extend({
      initialize: function(attrs, options) {
        if (attrs.child) {
          this.set('child', new Model(attrs.child, options), options);
        }
      }
    });
    var Collection = Backbone.Collection.extend({model: Model});
    var data = [{id: 1, child: {id: 2}}];
    var collection = new Collection(data);
    assert.equal(collection.first().id, 1);
    collection.set(data);
    assert.equal(collection.first().id, 1);
    collection.set([{id: 2, child: {id: 2}}].concat(data));
    assert.deepEqual(collection.pluck('id'), [2, 1]);
  });

  QUnit.test('`set` and model level `parse`', function(assert) {
    var Model = Backbone.Model.extend({});
    var Collection = Backbone.Collection.extend({
      model: Model,
      parse: function(res) { return _.map(res.models, 'model'); }
    });
    var model = new Model({id: 1});
    var collection = new Collection(model);
    collection.set({models: [
      {model: {id: 1}},
      {model: {id: 2}}
    ]}, {parse: true});
    assert.equal(collection.first(), model);
  });

  QUnit.test('`set` data is only parsed once', function(assert) {
    var collection = new Backbone.Collection();
    collection.model = Backbone.Model.extend({
      parse: function(data) {
        assert.equal(data.parsed, void 0);
        data.parsed = true;
        return data;
      }
    });
    collection.set({}, {parse: true});
  });

  QUnit.test('`set` matches input order in the absence of a comparator', function(assert) {
    var one = new Backbone.Model({id: 1});
    var two = new Backbone.Model({id: 2});
    var three = new Backbone.Model({id: 3});
    var collection = new Backbone.Collection([one, two, three]);
    collection.set([{id: 3}, {id: 2}, {id: 1}]);
    assert.deepEqual(collection.models, [three, two, one]);
    collection.set([{id: 1}, {id: 2}]);
    assert.deepEqual(collection.models, [one, two]);
    collection.set([two, three, one]);
    assert.deepEqual(collection.models, [two, three, one]);
    collection.set([{id: 1}, {id: 2}], {remove: false});
    assert.deepEqual(collection.models, [two, three, one]);
    collection.set([{id: 1}, {id: 2}, {id: 3}], {merge: false});
    assert.deepEqual(collection.models, [one, two, three]);
    collection.set([three, two, one, {id: 4}], {add: false});
    assert.deepEqual(collection.models, [one, two, three]);
  });

  QUnit.test('#1894 - Push should not trigger a sort', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      comparator: 'id',
      sort: function() { assert.ok(false); }
    });
    new Collection().push({id: 1});
  });

  QUnit.test('#2428 - push duplicate models, return the correct one', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    var model1 = collection.push({id: 101});
    var model2 = collection.push({id: 101});
    assert.ok(model2.cid === model1.cid);
  });

  QUnit.test('`set` with non-normal id', function(assert) {
    var Collection = Backbone.Collection.extend({
      model: Backbone.Model.extend({idAttribute: '_id'})
    });
    var collection = new Collection({_id: 1});
    collection.set([{_id: 1, a: 1}], {add: false});
    assert.equal(collection.first().get('a'), 1);
  });

  QUnit.test('#1894 - `sort` can optionally be turned off', function(assert) {
    assert.expect(0);
    var Collection = Backbone.Collection.extend({
      comparator: 'id',
      sort: function() { assert.ok(false); }
    });
    new Collection().add({id: 1}, {sort: false});
  });

  QUnit.test('#1915 - `parse` data in the right order in `set`', function(assert) {
    var collection = new (Backbone.Collection.extend({
      parse: function(data) {
        assert.strictEqual(data.status, 'ok');
        return data.data;
      }
    }));
    var res = {status: 'ok', data: [{id: 1}]};
    collection.set(res, {parse: true});
  });

  QUnit.test('#1939 - `parse` is passed `options`', function(assert) {
    var done = assert.async();
    assert.expect(1);
    var collection = new (Backbone.Collection.extend({
      url: '/',
      parse: function(data, options) {
        assert.strictEqual(options.xhr.someHeader, 'headerValue');
        return data;
      }
    }));
    var ajax = Backbone.ajax;
    Backbone.ajax = function(params) {
      _.defer(params.success, []);
      return {someHeader: 'headerValue'};
    };
    collection.fetch({
      success: function() { done(); }
    });
    Backbone.ajax = ajax;
  });

  QUnit.test('fetch will pass extra options to success callback', function(assert) {
    assert.expect(1);
    var SpecialSyncCollection = Backbone.Collection.extend({
      url: '/test',
      sync: function(method, collection, options) {
        _.extend(options, {specialSync: true});
        return Backbone.Collection.prototype.sync.call(this, method, collection, options);
      }
    });

    var collection = new SpecialSyncCollection();

    var onSuccess = function(coll, resp, options) {
      assert.ok(options.specialSync, 'Options were passed correctly to callback');
    };

    collection.fetch({success: onSuccess});
    this.ajaxSettings.success();
  });

  QUnit.test('`add` only `sort`s when necessary', function(assert) {
    assert.expect(2);
    var collection = new (Backbone.Collection.extend({
      comparator: 'a'
    }))([{id: 1}, {id: 2}, {id: 3}]);
    collection.on('sort', function() { assert.ok(true); });
    collection.add({id: 4}); // do sort, new model
    collection.add({id: 1, a: 1}, {merge: true}); // do sort, comparator change
    collection.add({id: 1, b: 1}, {merge: true}); // don't sort, no comparator change
    collection.add({id: 1, a: 1}, {merge: true}); // don't sort, no comparator change
    collection.add(collection.models); // don't sort, nothing new
    collection.add(collection.models, {merge: true}); // don't sort
  });

  QUnit.test('`add` only `sort`s when necessary with comparator function', function(assert) {
    assert.expect(3);
    var collection = new (Backbone.Collection.extend({
      comparator: function(m1, m2) {
        return m1.get('a') > m2.get('a') ? 1 : (m1.get('a') < m2.get('a') ? -1 : 0);
      }
    }))([{id: 1}, {id: 2}, {id: 3}]);
    collection.on('sort', function() { assert.ok(true); });
    collection.add({id: 4}); // do sort, new model
    collection.add({id: 1, a: 1}, {merge: true}); // do sort, model change
    collection.add({id: 1, b: 1}, {merge: true}); // do sort, model change
    collection.add({id: 1, a: 1}, {merge: true}); // don't sort, no model change
    collection.add(collection.models); // don't sort, nothing new
    collection.add(collection.models, {merge: true}); // don't sort
  }
```

#### `add` overrides `set` flags

```ts
test('`add` overrides `set` flags', function(assert) {
    var collection = new Backbone.Collection();
    collection.once('add', function(model, coll, options) {
      coll.add({id: 2}, options);
    });
    collection.set({id: 1});
    assert.equal(collection.length, 2);
  }
```

#### #2612 - nested `parse` works with `Collection#set`

```ts
test('#2612 - nested `parse` works with `Collection#set`', function(assert) {

    var Job = Backbone.Model.extend({
      constructor: function() {
        this.items = new Items();
        Backbone.Model.apply(this, arguments);
      },
      parse: function(attrs) {
        this.items.set(attrs.items, {parse: true});
        return _.omit(attrs, 'items');
      }
    });

    var Item = Backbone.Model.extend({
      constructor: function() {
        this.subItems = new Backbone.Collection();
        Backbone.Model.apply(this, arguments);
      },
      parse: function(attrs) {
        this.subItems.set(attrs.subItems, {parse: true});
        return _.omit(attrs, 'subItems');
      }
    });

    var Items = Backbone.Collection.extend({
      model: Item
    });

    var data = {
      name: 'JobName',
      id: 1,
      items: [{
        id: 1,
        name: 'Sub1',
        subItems: [
          {id: 1, subName: 'One'},
          {id: 2, subName: 'Two'}
        ]
      }, {
        id: 2,
        name: 'Sub2',
        subItems: [
          {id: 3, subName: 'Three'},
          {id: 4, subName: 'Four'}
        ]
      }]
    };

    var newData = {
      name: 'NewJobName',
      id: 1,
      items: [{
        id: 1,
        name: 'NewSub1',
        subItems: [
          {id: 1, subName: 'NewOne'},
          {id: 2, subName: 'NewTwo'}
        ]
      }, {
        id: 2,
        name: 'NewSub2',
        subItems: [
          {id: 3, subName: 'NewThree'},
          {id: 4, subName: 'NewFour'}
        ]
      }]
    };

    var job = new Job(data, {parse: true});
    assert.equal(job.get('name'), 'JobName');
    assert.equal(job.items.at(0).get('name'), 'Sub1');
    assert.equal(job.items.length, 2);
    assert.equal(job.items.get(1).subItems.get(1).get('subName'), 'One');
    assert.equal(job.items.get(2).subItems.get(3).get('subName'), 'Three');
    job.set(job.parse(newData, {parse: true}));
    assert.equal(job.get('name'), 'NewJobName');
    assert.equal(job.items.at(0).get('name'), 'NewSub1');
    assert.equal(job.items.length, 2);
    assert.equal(job.items.get(1).subItems.get(1).get('subName'), 'NewOne');
    assert.equal(job.items.get(2).subItems.get(3).get('subName'), 'NewThree');
  }
```

#### _addReference binds all collection events & adds to the lookup hashes

```ts
test('_addReference binds all collection events & adds to the lookup hashes', function(assert) {
    assert.expect(8);

    var calls = {add: 0, remove: 0};

    var Collection = Backbone.Collection.extend({

      _addReference: function(model) {
        Backbone.Collection.prototype._addReference.apply(this, arguments);
        calls.add++;
        assert.equal(model, this._byId[model.id]);
        assert.equal(model, this._byId[model.cid]);
        assert.equal(model._events.all.length, 1);
      },

      _removeReference: function(model) {
        Backbone.Collection.prototype._removeReference.apply(this, arguments);
        calls.remove++;
        assert.equal(this._byId[model.id], void 0);
        assert.equal(this._byId[model.cid], void 0);
        assert.equal(model.collection, void 0);
      }

    });

    var collection = new Collection();
    var model = collection.add({id: 1});
    collection.remove(model);

    assert.equal(calls.add, 1);
    assert.equal(calls.remove, 1);
  }
```

#### Do not allow duplicate models to be `add`ed or `set`

```ts
test('Do not allow duplicate models to be `add`ed or `set`', function(assert) {
    var collection = new Backbone.Collection();

    collection.add([{id: 1}, {id: 1}]);
    assert.equal(collection.length, 1);
    assert.equal(collection.models.length, 1);

    collection.set([{id: 1}, {id: 1}]);
    assert.equal(collection.length, 1);
    assert.equal(collection.models.length, 1);
  }
```

#### #3020: #set with {add: false} should not throw.

```ts
test('#3020: #set with {add: false} should not throw.', function(assert) {
    assert.expect(2);
    var collection = new Backbone.Collection;
    collection.set([{id: 1}], {add: false});
    assert.strictEqual(collection.length, 0);
    assert.strictEqual(collection.models.length, 0);
  }
```

#### create with wait, model instance, #3028

```ts
test('create with wait, model instance, #3028', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection();
    var model = new Backbone.Model({id: 1});
    model.sync = function(){
      assert.equal(this.collection, collection);
    };
    collection.create(model, {wait: true});
  }
```

#### modelId

```ts
test('modelId', function(assert) {
    var Stooge = Backbone.Model.extend();
    var StoogeCollection = Backbone.Collection.extend({model: Stooge});

    // Default to using `Collection::model::idAttribute`.
    assert.equal(StoogeCollection.prototype.modelId({id: 1}), 1);
    Stooge.prototype.idAttribute = '_id';
    assert.equal(StoogeCollection.prototype.modelId({_id: 1}), 1);
  }
```

#### Polymorphic models work with "simple" constructors

```ts
test('Polymorphic models work with "simple" constructors', function(assert) {
    var A = Backbone.Model.extend();
    var B = Backbone.Model.extend();
    var C = Backbone.Collection.extend({
      model: function(attrs) {
        return attrs.type === 'a' ? new A(attrs) : new B(attrs);
      }
    });
    var collection = new C([{id: 1, type: 'a'}, {id: 2, type: 'b'}]);
    assert.equal(collection.length, 2);
    assert.ok(collection.at(0) instanceof A);
    assert.equal(collection.at(0).id, 1);
    assert.ok(collection.at(1) instanceof B);
    assert.equal(collection.at(1).id, 2);
  }
```

#### Polymorphic models work with "advanced" constructors

```ts
test('Polymorphic models work with "advanced" constructors', function(assert) {
    var A = Backbone.Model.extend({idAttribute: '_id'});
    var B = Backbone.Model.extend({idAttribute: '_id'});
    var C = Backbone.Collection.extend({
      model: Backbone.Model.extend({
        constructor: function(attrs) {
          return attrs.type === 'a' ? new A(attrs) : new B(attrs);
        },

        idAttribute: '_id'
      })
    });
    var collection = new C([{_id: 1, type: 'a'}, {_id: 2, type: 'b'}]);
    assert.equal(collection.length, 2);
    assert.ok(collection.at(0) instanceof A);
    assert.equal(collection.at(0), collection.get(1));
    assert.ok(collection.at(1) instanceof B);
    assert.equal(collection.at(1), collection.get(2));

    C = Backbone.Collection.extend({
      model: function(attrs) {
        return attrs.type === 'a' ? new A(attrs) : new B(attrs);
      },

      modelId: function(attrs) {
        return attrs.type + '-' + attrs.id;
      }
    });
    collection = new C([{id: 1, type: 'a'}, {id: 1, type: 'b'}]);
    assert.equal(collection.length, 2);
    assert.ok(collection.at(0) instanceof A);
    assert.equal(collection.at(0), collection.get('a-1'));
    assert.ok(collection.at(1) instanceof B);
    assert.equal(collection.at(1), collection.get('b-1'));
  }
```

#### Collection with polymorphic models receives default id from modelId

```ts
test('Collection with polymorphic models receives default id from modelId', function(assert) {
    assert.expect(6);
    // When the polymorphic models use 'id' for the idAttribute, all is fine.
    var C1 = Backbone.Collection.extend({
      model: function(attrs) {
        return new Backbone.Model(attrs);
      }
    });
    var c1 = new C1({id: 1});
    assert.equal(c1.get(1).id, 1);
    assert.equal(c1.modelId({id: 1}), 1);

    // If the polymorphic models define their own idAttribute,
    // the modelId method should be overridden, for the reason below.
    var M = Backbone.Model.extend({
      idAttribute: '_id'
    });
    var C2 = Backbone.Collection.extend({
      model: function(attrs) {
        return new M(attrs);
      }
    });
    var c2 = new C2({_id: 1});
    assert.equal(c2.get(1), void 0);
    assert.equal(c2.modelId(c2.at(0).attributes), void 0);
    var m = new M({_id: 2});
    c2.add(m);
    assert.equal(c2.get(2), void 0);
    assert.equal(c2.modelId(m.attributes), void 0);
  }
```

#### #3199 - Order changing should trigger a sort

```ts
test('#3199 - Order changing should trigger a sort', function(assert) {
    assert.expect(1);
    var one = new Backbone.Model({id: 1});
    var two = new Backbone.Model({id: 2});
    var three = new Backbone.Model({id: 3});
    var collection = new Backbone.Collection([one, two, three]);
    collection.on('sort', function() {
      assert.ok(true);
    });
    collection.set([{id: 3}, {id: 2}, {id: 1}]);
  }
```

#### #3199 - Adding a model should trigger a sort

```ts
test('#3199 - Adding a model should trigger a sort', function(assert) {
    assert.expect(1);
    var one = new Backbone.Model({id: 1});
    var two = new Backbone.Model({id: 2});
    var three = new Backbone.Model({id: 3});
    var collection = new Backbone.Collection([one, two, three]);
    collection.on('sort', function() {
      assert.ok(true);
    });
    collection.set([{id: 1}, {id: 2}, {id: 3}, {id: 0}]);
  }
```

#### #3199 - Order not changing should not trigger a sort

```ts
test('#3199 - Order not changing should not trigger a sort', function(assert) {
    assert.expect(0);
    var one = new Backbone.Model({id: 1});
    var two = new Backbone.Model({id: 2});
    var three = new Backbone.Model({id: 3});
    var collection = new Backbone.Collection([one, two, three]);
    collection.on('sort', function() {
      assert.ok(false);
    });
    collection.set([{id: 1}, {id: 2}, {id: 3}]);
  }
```

#### add supports negative indexes

```ts
test('add supports negative indexes', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}]);
    collection.add([{id: 2}, {id: 3}], {at: -1});
    collection.add([{id: 2.5}], {at: -2});
    collection.add([{id: 0.5}], {at: -6});
    assert.equal(collection.pluck('id').join(','), '0.5,1,2,2.5,3');
  }
```

#### #set accepts options.at as a string

```ts
test('#set accepts options.at as a string', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}]);
    collection.add([{id: 3}], {at: '1'});
    assert.deepEqual(collection.pluck('id'), [1, 3, 2]);
  }
```

#### adding multiple models triggers `update` event once

```ts
test('adding multiple models triggers `update` event once', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection;
    collection.on('update', function() { assert.ok(true); });
    collection.add([{id: 1}, {id: 2}, {id: 3}]);
  }
```

#### removing models triggers `update` event once

```ts
test('removing models triggers `update` event once', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}, {id: 3}]);
    collection.on('update', function() { assert.ok(true); });
    collection.remove([{id: 1}, {id: 2}]);
  }
```

#### remove does not trigger `update` when nothing removed

```ts
test('remove does not trigger `update` when nothing removed', function(assert) {
    assert.expect(0);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}]);
    collection.on('update', function() { assert.ok(false); });
    collection.remove([{id: 3}]);
  }
```

#### set triggers `set` event once

```ts
test('set triggers `set` event once', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}, {id: 2}]);
    collection.on('update', function() { assert.ok(true); });
    collection.set([{id: 1}, {id: 3}]);
  }
```

#### set does not trigger `update` event when nothing added nor removed

```ts
test('set does not trigger `update` event when nothing added nor removed', function(assert) {
    var collection = new Backbone.Collection([{id: 1}, {id: 2}]);
    collection.on('update', function(coll, options) {
      assert.equal(options.changes.added.length, 0);
      assert.equal(options.changes.removed.length, 0);
      assert.equal(options.changes.merged.length, 2);
    });
    collection.set([{id: 1}, {id: 2}]);
  }
```

#### #3610 - invoke collects arguments

```ts
test('#3610 - invoke collects arguments', function(assert) {
    assert.expect(3);
    var Model = Backbone.Model.extend({
      method: function(x, y, z) {
        assert.equal(x, 1);
        assert.equal(y, 2);
        assert.equal(z, 3);
      }
    });
    var Collection = Backbone.Collection.extend({
      model: Model
    });
    var collection = new Collection([{id: 1}]);
    collection.invoke('method', 1, 2, 3);
  }
```

#### #3662 - triggering change without model will not error

```ts
test('#3662 - triggering change without model will not error', function(assert) {
    assert.expect(1);
    var collection = new Backbone.Collection([{id: 1}]);
    var model = collection.first();
    collection.on('change', function(m) {
      assert.equal(m, undefined);
    });
    model.trigger('change');
  }
```

#### #3711 - remove's `update` event returns one removed model

```ts
test("#3711 - remove's `update` event returns one removed model", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var collection = new Backbone.Collection([model]);
    collection.on('update', function(context, options) {
      var changed = options.changes;
      assert.deepEqual(changed.added, []);
      assert.deepEqual(changed.merged, []);
      assert.strictEqual(changed.removed[0], model);
    });
    collection.remove(model);
  }
```

#### #3711 - remove's `update` event returns multiple removed models

```ts
test("#3711 - remove's `update` event returns multiple removed models", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var collection = new Backbone.Collection([model, model2]);
    collection.on('update', function(context, options) {
      var changed = options.changes;
      assert.deepEqual(changed.added, []);
      assert.deepEqual(changed.merged, []);
      assert.ok(changed.removed.length === 2);

      assert.ok(_.indexOf(changed.removed, model) > -1 && _.indexOf(changed.removed, model2) > -1);
    });
    collection.remove([model, model2]);
  }
```

#### #3711 - set's `update` event returns one added model

```ts
test("#3711 - set's `update` event returns one added model", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var collection = new Backbone.Collection();
    collection.on('update', function(context, options) {
      var addedModels = options.changes.added;
      assert.ok(addedModels.length === 1);
      assert.strictEqual(addedModels[0], model);
    });
    collection.set(model);
  }
```

#### #3711 - set's `update` event returns multiple added models

```ts
test("#3711 - set's `update` event returns multiple added models", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var collection = new Backbone.Collection();
    collection.on('update', function(context, options) {
      var addedModels = options.changes.added;
      assert.ok(addedModels.length === 2);
      assert.strictEqual(addedModels[0], model);
      assert.strictEqual(addedModels[1], model2);
    });
    collection.set([model, model2]);
  }
```

#### #3711 - set's `update` event returns one removed model

```ts
test("#3711 - set's `update` event returns one removed model", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var model3 = new Backbone.Model({id: 3, title: 'My Last Post'});
    var collection = new Backbone.Collection([model]);
    collection.on('update', function(context, options) {
      var changed = options.changes;
      assert.equal(changed.added.length, 2);
      assert.equal(changed.merged.length, 0);
      assert.ok(changed.removed.length === 1);
      assert.strictEqual(changed.removed[0], model);
    });
    collection.set([model2, model3]);
  }
```

#### #3711 - set's `update` event returns multiple removed models

```ts
test("#3711 - set's `update` event returns multiple removed models", function(assert) {
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var model2 = new Backbone.Model({id: 2, title: 'Second Post'});
    var model3 = new Backbone.Model({id: 3, title: 'My Last Post'});
    var collection = new Backbone.Collection([model, model2]);
    collection.on('update', function(context, options) {
      var removedModels = options.changes.removed;
      assert.ok(removedModels.length === 2);
      assert.strictEqual(removedModels[0], model);
      assert.strictEqual(removedModels[1], model2);
    });
    collection.set([model3]);
  }
```

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

#### #3711 - set's `update` event should not be triggered adding a model which already exists exactly alike

```ts
test("#3711 - set's `update` event should not be triggered adding a model which already exists exactly alike", function(assert) {
    var fired = false;
    var model = new Backbone.Model({id: 1, title: 'First Post'});
    var collection = new Backbone.Collection([model]);
    collection.on('update', function(context, options) {
      fired = true;
    });
    collection.set([model]);
    assert.equal(fired, false);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.param.js

#### should map the array

```ts
it('should map the array', function(done){
      var app = express();

      app.param(['id', 'uid'], function(req, res, next, id){
        id = Number(id);
        if (isNaN(id)) return next('route');
        req.params.id = id;
        next();
      });

      app.get('/post/:id', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      app.get('/user/:uid', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      request(app)
        .get('/user/123')
        .expect(200, 'number:123', function (err) {
          if (err) return done(err)
          request(app)
            .get('/post/123')
            .expect('number:123', done)
        })
    }
```

#### should map logic for a single param

```ts
it('should map logic for a single param', function(done){
      var app = express();

      app.param('id', function(req, res, next, id){
        id = Number(id);
        if (isNaN(id)) return next('route');
        req.params.id = id;
        next();
      });

      app.get('/user/:id', function(req, res){
        var id = req.params.id;
        res.send((typeof id) + ':' + id)
      });

      request(app)
        .get('/user/123')
        .expect(200, 'number:123', done)
    }
```

#### should not invoke without route handler

```ts
it('should not invoke without route handler', function(done) {
      var app = express();

      app.param('thing', function(req, res, next, thing) {
        req.thing = thing;
        next();
      });

      app.param('user', function(req, res, next, user) {
        next(new Error('invalid invocation'))
      });

      app.post('/:user', function (req, res) {
        res.send(req.params.user);
      });

      app.get('/:thing', function (req, res) {
        res.send(req.thing);
      });

      request(app)
      .get('/bob')
      .expect(200, 'bob', done);
    }
```

#### should catch thrown error

```ts
it('should catch thrown error', function(done){
      var app = express();

      app.param('id', function(req, res, next, id){
        throw new Error('err!');
      });

      app.get('/user/:id', function(req, res){
        var id = req.params.id;
        res.send('' + id);
      });

      request(app)
      .get('/user/123')
      .expect(500, done);
    }
```

#### should catch thrown secondary error

```ts
it('should catch thrown secondary error', function(done){
      var app = express();

      app.param('id', function(req, res, next, val){
        process.nextTick(next);
      });

      app.param('id', function(req, res, next, id){
        throw new Error('err!');
      });

      app.get('/user/:id', function(req, res){
        var id = req.params.id;
        res.send('' + id);
      });

      request(app)
      .get('/user/123')
      .expect(500, done);
    }
```

#### should defer to next route

```ts
it('should defer to next route', function(done){
      var app = express();

      app.param('id', function(req, res, next, id){
        next('route');
      });

      app.get('/user/:id', function(req, res){
        var id = req.params.id;
        res.send('' + id);
      });

      app.get('/:name/123', function(req, res){
        res.send('name');
      });

      request(app)
      .get('/user/123')
      .expect('name', done);
    }
```

#### should defer all the param routes

```ts
it('should defer all the param routes', function(done){
      var app = express();

      app.param('id', function(req, res, next, val){
        if (val === 'new') return next('route');
        return next();
      });

      app.all('/user/:id', function(req, res){
        res.send('all.id');
      });

      app.get('/user/:id', function(req, res){
        res.send('get.id');
      });

      app.get('/user/new', function(req, res){
        res.send('get.new');
      });

      request(app)
      .get('/user/new')
      .expect('get.new', done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/view.js

#### constructor

```ts
test('constructor', function(assert) {
    assert.expect(3);
    assert.equal(view.el.id, 'test-view');
    assert.equal(view.el.className, 'test-view');
    assert.equal(view.el.other, void 0);
  }
```

#### tagName can be provided as a string

```ts
test('tagName can be provided as a string', function(assert) {
    assert.expect(1);
    var View = Backbone.View.extend({
      tagName: 'span'
    });

    assert.equal(new View().el.tagName, 'SPAN');
  }
```

#### tagName can be provided as a function

```ts
test('tagName can be provided as a function', function(assert) {
    assert.expect(1);
    var View = Backbone.View.extend({
      tagName: function() {
        return 'p';
      }
    });

    assert.ok(new View().$el.is('p'));
  }
```

#### with className and id functions

```ts
test('with className and id functions', function(assert) {
    assert.expect(2);
    var View = Backbone.View.extend({
      className: function() {
        return 'className';
      },
      id: function() {
        return 'id';
      }
    });

    assert.strictEqual(new View().el.className, 'className');
    assert.strictEqual(new View().el.id, 'id');
  }
```

#### with attributes

```ts
test('with attributes', function(assert) {
    assert.expect(2);
    var View = Backbone.View.extend({
      attributes: {
        'id': 'id',
        'class': 'class'
      }
    });

    assert.strictEqual(new View().el.className, 'class');
    assert.strictEqual(new View().el.id, 'id');
  }
```

#### should default to className/id properties

```ts
test('should default to className/id properties', function(assert) {
    assert.expect(4);
    var View = Backbone.View.extend({
      className: 'backboneClass',
      id: 'backboneId',
      attributes: {
        'class': 'attributeClass',
        'id': 'attributeId'
      }
    });

    var myView = new View;
    assert.strictEqual(myView.el.className, 'backboneClass');
    assert.strictEqual(myView.el.id, 'backboneId');
    assert.strictEqual(myView.$el.attr('class'), 'backboneClass');
    assert.strictEqual(myView.$el.attr('id'), 'backboneId');
  }
```

#### #1048 - setElement uses provided object.

```ts
test('#1048 - setElement uses provided object.', function(assert) {
    assert.expect(2);
    var $el = $('body');

    var myView = new Backbone.View({el: $el});
    assert.ok(myView.$el === $el);

    myView.setElement($el = $($el));
    assert.ok(myView.$el === $el);
  }
```

#### #1172 - Clone attributes object

```ts
test('#1172 - Clone attributes object', function(assert) {
    assert.expect(2);
    var View = Backbone.View.extend({
      attributes: {foo: 'bar'}
    });

    var view1 = new View({id: 'foo'});
    assert.strictEqual(view1.el.id, 'foo');

    var view2 = new View();
    assert.ok(!view2.el.id);
  }
```

#### Provide function for el.

```ts
test('Provide function for el.', function(assert) {
    assert.expect(2);
    var View = Backbone.View.extend({
      el: function() {
        return '<p><a></a></p>';
      }
    });

    var myView = new View;
    assert.ok(myView.$el.is('p'));
    assert.ok(myView.$el.has('a'));
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### Object.prototype properties are overridden by attributes

```ts
test('Object.prototype properties are overridden by attributes', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model({hasOwnProperty: true});
    assert.equal(model.get('hasOwnProperty'), true);
  }
```

#### preinitialize occurs before the model is set up

```ts
test('preinitialize occurs before the model is set up', function(assert) {
    assert.expect(6);
    var Model = Backbone.Model.extend({

      preinitialize: function() {
        assert.equal(this.collection, undefined);
        assert.equal(this.cid, undefined);
        assert.equal(this.id, undefined);
      }
    });
    var model = new Model({id: 'foo'}, {collection: collection});
    assert.equal(model.collection, collection);
    assert.equal(model.id, 'foo');
    assert.notEqual(model.cid, undefined);
  }
```

#### url when using urlRoot, and uri encoding

```ts
test('url when using urlRoot, and uri encoding', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({
      urlRoot: '/collection'
    });
    var model = new Model();
    assert.equal(model.url(), '/collection');
    model.set({id: '+1+'});
    assert.equal(model.url(), '/collection/%2B1%2B');
  }
```

#### url when using urlRoot as a function to determine urlRoot at runtime

```ts
test('url when using urlRoot as a function to determine urlRoot at runtime', function(assert) {
    assert.expect(2);
    var Model = Backbone.Model.extend({
      urlRoot: function() {
        return '/nested/' + this.get('parentId') + '/collection';
      }
    });

    var model = new Model({parentId: 1});
    assert.equal(model.url(), '/nested/1/collection');
    model.set({id: 2});
    assert.equal(model.url(), '/nested/1/collection/2');
  }
```

#### isNew

```ts
test('isNew', function(assert) {
    assert.expect(6);
    var a = new Backbone.Model({foo: 1, bar: 2, baz: 3});
    assert.ok(a.isNew(), 'it should be new');
    a = new Backbone.Model({foo: 1, bar: 2, baz: 3, id: -5});
    assert.ok(!a.isNew(), 'any defined ID is legal, negative or positive');
    a = new Backbone.Model({foo: 1, bar: 2, baz: 3, id: 0});
    assert.ok(!a.isNew(), 'any defined ID is legal, including zero');
    assert.ok(new Backbone.Model().isNew(), 'is true when there is no id');
    assert.ok(!new Backbone.Model({id: 2}).isNew(), 'is false for a positive integer');
    assert.ok(!new Backbone.Model({id: -5}).isNew(), 'is false for a negative integer');
  }
```

#### #2030 - set with failed validate, followed by another set triggers change

```ts
test('#2030 - set with failed validate, followed by another set triggers change', function(assert) {
    var attr = 0, main = 0, error = 0;
    var Model = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.x > 1) {
          error++;
          return 'this is an error';
        }
      }
    });
    var model = new Model({x: 0});
    model.on('change:x', function() { attr++; });
    model.on('change', function() { main++; });
    model.set({x: 2}, {validate: true});
    model.set({x: 1}, {validate: true});
    assert.deepEqual([attr, main, error], [1, 1, 1]);
  }
```

#### set falsy values in the correct order

```ts
test('set falsy values in the correct order', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({result: 'result'});
    model.on('change', function() {
      assert.equal(model.changed.result, void 0);
      assert.equal(model.previous('result'), false);
    });
    model.set({result: void 0}, {silent: true});
    model.set({result: null}, {silent: true});
    model.set({result: false}, {silent: true});
    model.set({result: void 0});
  }
```

#### using a non-default id attribute.

```ts
test('using a non-default id attribute.', function(assert) {
    assert.expect(5);
    var MongoModel = Backbone.Model.extend({idAttribute: '_id'});
    var model = new MongoModel({id: 'eye-dee', _id: 25, title: 'Model'});
    assert.equal(model.get('id'), 'eye-dee');
    assert.equal(model.id, 25);
    assert.equal(model.isNew(), false);
    model.unset('_id');
    assert.equal(model.id, undefined);
    assert.equal(model.isNew(), true);
  }
```

#### setting an alternative cid prefix

```ts
test('setting an alternative cid prefix', function(assert) {
    assert.expect(4);
    var Model = Backbone.Model.extend({
      cidPrefix: 'm'
    });
    var model = new Model();

    assert.equal(model.cid.charAt(0), 'm');

    model = new Backbone.Model();
    assert.equal(model.cid.charAt(0), 'c');

    var Collection = Backbone.Collection.extend({
      model: Model
    });
    var col = new Collection([{id: 'c5'}, {id: 'c6'}, {id: 'c7'}]);

    assert.equal(col.get('c6').cid.charAt(0), 'm');
    col.set([{id: 'c6', value: 'test'}], {
      merge: true,
      add: true,
      remove: false
    });
    assert.ok(col.get('c6').has('value'));
  }
```

#### clear

```ts
test('clear', function(assert) {
    assert.expect(3);
    var changed;
    var model = new Backbone.Model({id: 1, name: 'Model'});
    model.on('change:name', function(){ changed = true; });
    model.on('change', function() {
      var changedAttrs = model.changedAttributes();
      assert.ok('name' in changedAttrs);
    });
    model.clear();
    assert.equal(changed, true);
    assert.equal(model.get('name'), undefined);
  }
```

#### change, hasChanged, changedAttributes, previous, previousAttributes

```ts
test('change, hasChanged, changedAttributes, previous, previousAttributes', function(assert) {
    assert.expect(9);
    var model = new Backbone.Model({name: 'Tim', age: 10});
    assert.deepEqual(model.changedAttributes(), false);
    model.on('change', function() {
      assert.ok(model.hasChanged('name'), 'name changed');
      assert.ok(!model.hasChanged('age'), 'age did not');
      assert.ok(_.isEqual(model.changedAttributes(), {name: 'Rob'}), 'changedAttributes returns the changed attrs');
      assert.equal(model.previous('name'), 'Tim');
      assert.ok(_.isEqual(model.previousAttributes(), {name: 'Tim', age: 10}), 'previousAttributes is correct');
    });
    assert.equal(model.hasChanged(), false);
    assert.equal(model.hasChanged(undefined), false);
    model.set({name: 'Rob'});
    assert.equal(model.get('name'), 'Rob');
  }
```

#### change after initialize

```ts
test('change after initialize', function(assert) {
    assert.expect(1);
    var changed = 0;
    var attrs = {id: 1, label: 'c'};
    var obj = new Backbone.Model(attrs);
    obj.on('change', function() { changed += 1; });
    obj.set(attrs);
    assert.equal(changed, 0);
  }
```

#### validate after save

```ts
test('validate after save', function(assert) {
    assert.expect(2);
    var lastError, model = new Backbone.Model();
    model.validate = function(attrs) {
      if (attrs.admin) return "Can't change admin status.";
    };
    model.sync = function(method, m, options) {
      options.success.call(this, {admin: true});
    };
    model.on('invalid', function(m, error) {
      lastError = error;
    });
    model.save(null);

    assert.equal(lastError, "Can't change admin status.");
    assert.equal(model.validationError, "Can't change admin status.");
  }
```

#### save, fetch, destroy triggers error event when an error occurs

```ts
test('save, fetch, destroy triggers error event when an error occurs', function(assert) {
    assert.expect(3);
    var model = new Backbone.Model();
    model.on('error', function() {
      assert.ok(true);
    });
    model.sync = function(method, m, options) {
      options.error();
    };
    model.save({data: 2, id: 1});
    model.fetch();
    model.destroy();
  }
```

#### #3283 - save, fetch, destroy calls success with context

```ts
test('#3283 - save, fetch, destroy calls success with context', function(assert) {
    assert.expect(3);
    var model = new Backbone.Model();
    var obj = {};
    var options = {
      context: obj,
      success: function() {
        assert.equal(this, obj);
      }
    };
    model.sync = function(method, m, opts) {
      opts.success.call(opts.context);
    };
    model.save({data: 2, id: 1}, options);
    model.fetch(options);
    model.destroy(options);
  }
```

#### #3283 - save, fetch, destroy calls error with context

```ts
test('#3283 - save, fetch, destroy calls error with context', function(assert) {
    assert.expect(3);
    var model = new Backbone.Model();
    var obj = {};
    var options = {
      context: obj,
      error: function() {
        assert.equal(this, obj);
      }
    };
    model.sync = function(method, m, opts) {
      opts.error.call(opts.context);
    };
    model.save({data: 2, id: 1}, options);
    model.fetch(options);
    model.destroy(options);
  }
```

#### save with PATCH

```ts
test('save with PATCH', function(assert) {
    doc.clear().set({id: 1, a: 1, b: 2, c: 3, d: 4});
    doc.save();
    assert.equal(this.syncArgs.method, 'update');
    assert.equal(this.syncArgs.options.attrs, undefined);

    doc.save({b: 2, d: 4}, {patch: true});
    assert.equal(this.syncArgs.method, 'patch');
    assert.equal(_.size(this.syncArgs.options.attrs), 2);
    assert.equal(this.syncArgs.options.attrs.d, 4);
    assert.equal(this.syncArgs.options.attrs.a, undefined);
    assert.equal(this.ajaxSettings.data, '{"b":2,"d":4}');
  }
```

#### save with wait and supplied id

```ts
test('save with wait and supplied id', function(assert) {
    var Model = Backbone.Model.extend({
      urlRoot: '/collection'
    });
    var model = new Model();
    model.save({id: 42}, {wait: true});
    assert.equal(this.ajaxSettings.url, '/collection/42');
  }
```

#### destroy will pass extra options to success callback

```ts
test('destroy will pass extra options to success callback', function(assert) {
    assert.expect(1);
    var SpecialSyncModel = Backbone.Model.extend({
      sync: function(method, m, options) {
        _.extend(options, {specialSync: true});
        return Backbone.Model.prototype.sync.call(this, method, m, options);
      },
      urlRoot: '/test'
    });

    var model = new SpecialSyncModel({id: 'id'});

    var onSuccess = function(m, response, options) {
      assert.ok(options.specialSync, 'Options were passed correctly to callback');
    };

    model.destroy({success: onSuccess});
    this.ajaxSettings.success();
  }
```

#### validate

```ts
test('validate', function(assert) {
    var lastError;
    var model = new Backbone.Model();
    model.validate = function(attrs) {
      if (attrs.admin !== this.get('admin')) return "Can't change admin status.";
    };
    model.on('invalid', function(m, error) {
      lastError = error;
    });
    var result = model.set({a: 100});
    assert.equal(result, model);
    assert.equal(model.get('a'), 100);
    assert.equal(lastError, undefined);
    result = model.set({admin: true});
    assert.equal(model.get('admin'), true);
    result = model.set({a: 200, admin: false}, {validate: true});
    assert.equal(lastError, "Can't change admin status.");
    assert.equal(result, false);
    assert.equal(model.get('a'), 100);
  }
```

#### validate on unset and clear

```ts
test('validate on unset and clear', function(assert) {
    assert.expect(6);
    var error;
    var model = new Backbone.Model({name: 'One'});
    model.validate = function(attrs) {
      if (!attrs.name) {
        error = true;
        return 'No thanks.';
      }
    };
    model.set({name: 'Two'});
    assert.equal(model.get('name'), 'Two');
    assert.equal(error, undefined);
    model.unset('name', {validate: true});
    assert.equal(error, true);
    assert.equal(model.get('name'), 'Two');
    model.clear({validate: true});
    assert.equal(model.get('name'), 'Two');
    delete model.validate;
    model.clear();
    assert.equal(model.get('name'), undefined);
  }
```

#### validate with error callback

```ts
test('validate with error callback', function(assert) {
    assert.expect(8);
    var lastError, boundError;
    var model = new Backbone.Model();
    model.validate = function(attrs) {
      if (attrs.admin) return "Can't change admin status.";
    };
    model.on('invalid', function(m, error) {
      boundError = true;
    });
    var result = model.set({a: 100}, {validate: true});
    assert.equal(result, model);
    assert.equal(model.get('a'), 100);
    assert.equal(model.validationError, null);
    assert.equal(boundError, undefined);
    result = model.set({a: 200, admin: true}, {validate: true});
    assert.equal(result, false);
    assert.equal(model.get('a'), 100);
    assert.equal(model.validationError, "Can't change admin status.");
    assert.equal(boundError, true);
  }
```

#### defaults always extend attrs (#459)

```ts
test('defaults always extend attrs (#459)', function(assert) {
    assert.expect(2);
    var Defaulted = Backbone.Model.extend({
      defaults: {one: 1},
      initialize: function(attrs, opts) {
        assert.equal(this.attributes.one, 1);
      }
    });
    var providedattrs = new Defaulted({});
    var emptyattrs = new Defaulted();
  }
```

#### Inherit class properties

```ts
test('Inherit class properties', function(assert) {
    assert.expect(6);
    var Parent = Backbone.Model.extend({
      instancePropSame: function() {},
      instancePropDiff: function() {}
    }, {
      classProp: function() {}
    });
    var Child = Parent.extend({
      instancePropDiff: function() {}
    });

    var adult = new Parent;
    var kid   = new Child;

    assert.equal(Child.classProp, Parent.classProp);
    assert.notEqual(Child.classProp, undefined);

    assert.equal(kid.instancePropSame, adult.instancePropSame);
    assert.notEqual(kid.instancePropSame, undefined);

    assert.notEqual(Child.prototype.instancePropDiff, Parent.prototype.instancePropDiff);
    assert.notEqual(Child.prototype.instancePropDiff, undefined);
  }
```

#### hasChanged works outside of change events, and true within

```ts
test('hasChanged works outside of change events, and true within', function(assert) {
    assert.expect(6);
    var model = new Backbone.Model({x: 1});
    model.on('change:x', function() {
      assert.ok(model.hasChanged('x'));
      assert.equal(model.get('x'), 1);
    });
    model.set({x: 2}, {silent: true});
    assert.ok(model.hasChanged());
    assert.equal(model.hasChanged('x'), true);
    model.set({x: 1});
    assert.ok(model.hasChanged());
    assert.equal(model.hasChanged('x'), true);
  }
```

#### save with `wait` succeeds without `validate`

```ts
test('save with `wait` succeeds without `validate`', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model();
    model.url = '/test';
    model.save({x: 1}, {wait: true});
    assert.ok(this.syncArgs.model === model);
  }
```

#### save without `wait` doesn't set invalid attributes

```ts
test("save without `wait` doesn't set invalid attributes", function(assert) {
    var model = new Backbone.Model();
    model.validate = function() { return 1; };
    model.save({a: 1});
    assert.equal(model.get('a'), void 0);
  }
```

#### save doesn't validate twice

```ts
test("save doesn't validate twice", function(assert) {
    var model = new Backbone.Model();
    var times = 0;
    model.sync = function() {};
    model.validate = function() { ++times; };
    model.save({});
    assert.equal(times, 1);
  }
```

#### a failed `save` with `wait` doesn't leave attributes behind

```ts
test("a failed `save` with `wait` doesn't leave attributes behind", function(assert) {
    assert.expect(1);
    var model = new Backbone.Model;
    model.url = '/test';
    model.save({x: 1}, {wait: true});
    assert.equal(model.get('x'), void 0);
  }
```

#### save with wait validates attributes

```ts
test('save with wait validates attributes', function(assert) {
    var model = new Backbone.Model();
    model.url = '/test';
    model.validate = function() { assert.ok(true); };
    model.save({x: 1}, {wait: true});
  }
```

#### #1355 - `options` is passed to success callbacks

```ts
test('#1355 - `options` is passed to success callbacks', function(assert) {
    assert.expect(3);
    var model = new Backbone.Model();
    var opts = {
      success: function( m, resp, options ) {
        assert.ok(options);
      }
    };
    model.sync = function(method, m, options) {
      options.success();
    };
    model.save({id: 1}, opts);
    model.fetch(opts);
    model.destroy(opts);
  }
```

#### #1412 - Trigger 'sync' event.

```ts
test("#1412 - Trigger 'sync' event.", function(assert) {
    assert.expect(3);
    var model = new Backbone.Model({id: 1});
    model.sync = function(method, m, options) { options.success(); };
    model.on('sync', function(){ assert.ok(true); });
    model.fetch();
    model.save();
    model.destroy();
  }
```

#### #1433 - Save: An invalid model cannot be persisted.

```ts
test('#1433 - Save: An invalid model cannot be persisted.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model;
    model.validate = function(){ return 'invalid'; };
    model.sync = function(){ assert.ok(false); };
    assert.strictEqual(model.save(), false);
  }
```

#### #1377 - Save without attrs triggers 'error'.

```ts
test("#1377 - Save without attrs triggers 'error'.", function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      url: '/test/',
      sync: function(method, m, options){ options.success(); },
      validate: function(){ return 'invalid'; }
    });
    var model = new Model({id: 1});
    model.on('invalid', function(){ assert.ok(true); });
    model.save();
  }
```

#### #1664 - multiple silent changes nested inside a change event

```ts
test('#1664 - multiple silent changes nested inside a change event', function(assert) {
    assert.expect(2);
    var changes = [];
    var model = new Backbone.Model();
    model.on('change', function() {
      model.set({a: 'c'}, {silent: true});
      model.set({b: 2}, {silent: true});
      model.unset('c', {silent: true});
    });
    model.on('change:a change:b change:c', function(m, val) { changes.push(val); });
    model.set({a: 'a', b: 1, c: 'item'});
    assert.deepEqual(changes, ['a', 1, 'item']);
    assert.deepEqual(model.attributes, {a: 'c', b: 2});
  }
```

#### isValid

```ts
test('isValid', function(assert) {
    var model = new Backbone.Model({valid: true});
    model.validate = function(attrs) {
      if (!attrs.valid) return 'invalid';
    };
    assert.equal(model.isValid(), true);
    assert.equal(model.set({valid: false}, {validate: true}), false);
    assert.equal(model.isValid(), true);
    model.set({valid: false});
    assert.equal(model.isValid(), false);
    assert.ok(!model.set('valid', false, {validate: true}));
  }
```

#### #1179 - isValid returns true in the absence of validate.

```ts
test('#1179 - isValid returns true in the absence of validate.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model();
    model.validate = null;
    assert.ok(model.isValid());
  }
```

#### #1961 - Creating a model with {validate:true} will call validate and use the error callback

```ts
test('#1961 - Creating a model with {validate:true} will call validate and use the error callback', function(assert) {
    var Model = Backbone.Model.extend({
      validate: function(attrs) {
        if (attrs.id === 1) return "This shouldn't happen";
      }
    });
    var model = new Model({id: 1}, {validate: true});
    assert.equal(model.validationError, "This shouldn't happen");
  }
```

#### #3778 - id will only be updated if it is set

```ts
test('#3778 - id will only be updated if it is set', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({id: 1});
    model.id = 2;
    model.set({foo: 'bar'});
    assert.equal(model.id, 2);
    model.set({id: 3});
    assert.equal(model.id, 3);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/sync.js

#### update

```ts
test('update', function(assert) {
    assert.expect(7);
    library.first().save({id: '1-the-tempest', author: 'William Shakespeare'});
    assert.equal(this.ajaxSettings.url, '/library/1-the-tempest');
    assert.equal(this.ajaxSettings.type, 'PUT');
    assert.equal(this.ajaxSettings.dataType, 'json');
    var data = JSON.parse(this.ajaxSettings.data);
    assert.equal(data.id, '1-the-tempest');
    assert.equal(data.title, 'The Tempest');
    assert.equal(data.author, 'William Shakespeare');
    assert.equal(data.length, 123);
  }
```

#### update with emulateHTTP and emulateJSON

```ts
test('update with emulateHTTP and emulateJSON', function(assert) {
    assert.expect(7);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'}, {
      emulateHTTP: true,
      emulateJSON: true
    });
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'POST');
    assert.equal(this.ajaxSettings.dataType, 'json');
    assert.equal(this.ajaxSettings.data._method, 'PUT');
    var data = JSON.parse(this.ajaxSettings.data.model);
    assert.equal(data.id, '2-the-tempest');
    assert.equal(data.author, 'Tim Shakespeare');
    assert.equal(data.length, 123);
  }
```

#### update with just emulateHTTP

```ts
test('update with just emulateHTTP', function(assert) {
    assert.expect(6);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'}, {
      emulateHTTP: true
    });
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'POST');
    assert.equal(this.ajaxSettings.contentType, 'application/json');
    var data = JSON.parse(this.ajaxSettings.data);
    assert.equal(data.id, '2-the-tempest');
    assert.equal(data.author, 'Tim Shakespeare');
    assert.equal(data.length, 123);
  }
```

#### update with just emulateJSON

```ts
test('update with just emulateJSON', function(assert) {
    assert.expect(6);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'}, {
      emulateJSON: true
    });
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'PUT');
    assert.equal(this.ajaxSettings.contentType, 'application/x-www-form-urlencoded');
    var data = JSON.parse(this.ajaxSettings.data.model);
    assert.equal(data.id, '2-the-tempest');
    assert.equal(data.author, 'Tim Shakespeare');
    assert.equal(data.length, 123);
  }
```

#### read model

```ts
test('read model', function(assert) {
    assert.expect(3);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'});
    library.first().fetch();
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'GET');
    assert.ok(_.isEmpty(this.ajaxSettings.data));
  }
```

#### destroy

```ts
test('destroy', function(assert) {
    assert.expect(3);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'});
    library.first().destroy({wait: true});
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'DELETE');
    assert.equal(this.ajaxSettings.data, null);
  }
```

#### destroy with emulateHTTP

```ts
test('destroy with emulateHTTP', function(assert) {
    assert.expect(3);
    library.first().save({id: '2-the-tempest', author: 'Tim Shakespeare'});
    library.first().destroy({
      emulateHTTP: true,
      emulateJSON: true
    });
    assert.equal(this.ajaxSettings.url, '/library/2-the-tempest');
    assert.equal(this.ajaxSettings.type, 'POST');
    assert.equal(JSON.stringify(this.ajaxSettings.data), '{"_method":"DELETE"}');
  }
```

#### Call provided error callback on error.

```ts
test('Call provided error callback on error.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model;
    model.url = '/test';
    Backbone.sync('read', model, {
      error: function() { assert.ok(true); }
    });
    this.ajaxSettings.error();
  }
```

#### #1756 - Call user provided beforeSend function.

```ts
test('#1756 - Call user provided beforeSend function.', function(assert) {
    assert.expect(4);
    Backbone.emulateHTTP = true;
    var model = new Backbone.Model;
    model.url = '/test';
    var xhr = {
      setRequestHeader: function(header, value) {
        assert.strictEqual(header, 'X-HTTP-Method-Override');
        assert.strictEqual(value, 'DELETE');
      }
    };
    model.sync('delete', model, {
      beforeSend: function(_xhr) {
        assert.ok(_xhr === xhr);
        return false;
      }
    });
    assert.strictEqual(this.ajaxSettings.beforeSend(xhr), false);
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.router.js

#### should restore req.params after leaving router

```ts
it('should restore req.params after leaving router', function (done) {
    var app = express();
    var router = new express.Router();

    function handler1(req, res, next) {
      res.setHeader('x-user-id', String(req.params.id));
      next()
    }

    function handler2(req, res) {
      res.send(req.params.id);
    }

    router.use(function (req, res, next) {
      res.setHeader('x-router', String(req.params.id));
      next();
    });

    app.get('/user/:id', handler1, router, handler2);

    request(app)
      .get('/user/1')
      .expect('x-router', 'undefined')
      .expect('x-user-id', '1')
      .expect(200, '1', done);
  }
```

#### should populate req.params with the captures

```ts
it('should populate req.params with the captures', function (done) {
      var app = express();

      app.get(/^\/user\/([0-9]+)\/(view|edit)?$/, function (req, res) {
        var id = req.params[0]
          , op = req.params[1];
        res.end(op + 'ing user ' + id);
      });

      request(app)
        .get('/user/10/edit')
        .expect('editing user 10', done);
    }
```

#### should populate req.params with named captures

```ts
it('should populate req.params with named captures', function (done) {
        var app = express();
        var re = new RegExp('^/user/(?<userId>[0-9]+)/(view|edit)?$');

        app.get(re, function (req, res) {
          var id = req.params.userId
            , op = req.params[0];
          res.end(op + 'ing user ' + id);
        });

        request(app)
          .get('/user/10/edit')
          .expect('editing user 10', done);
      }
```

#### should match identical casing

```ts
it('should match identical casing', function (done) {
        var app = express();

        app.enable('case sensitive routing');

        app.get('/uSer', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/uSer')
          .expect('tj', done);
      }
```

#### should merge numeric indices req.params

```ts
it('should merge numeric indices req.params', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/^\/(.*)\.(.*)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use(/^\/user\/id:(\d+)/, router);

      request(app)
        .get('/user/id:10/profile.json')
        .expect(200, '[["0","10"],["1","profile"],["2","json"]]', done);
    }
```

#### should merge numeric indices req.params when more in parent

```ts
it('should merge numeric indices req.params when more in parent', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/(.*)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use(/^\/user\/id:(\d+)\/name:(\w+)/, router);

      request(app)
        .get('/user/id:10/name:tj/profile')
        .expect(200, '[["0","10"],["1","tj"],["2","profile"]]', done);
    }
```

#### should merge numeric indices req.params when parent has same number

```ts
it('should merge numeric indices req.params when parent has same number', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/name:(\w+)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use(/\/user\/id:(\d+)/, router);

      request(app)
        .get('/user/id:10/name:tj')
        .expect(200, '[["0","10"],["1","tj"]]', done);
    }
```

#### should ignore invalid incoming req.params

```ts
it('should ignore invalid incoming req.params', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get('/:name', function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use('/user/', function (req, res, next) {
        req.params = 3; // wat?
        router(req, res, next);
      });

      request(app)
        .get('/user/tj')
        .expect(200, '[["name","tj"]]', done);
    }
```

#### should restore req.params

```ts
it('should restore req.params', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/user:(\w+)\//, function (req, res, next) {
        next();
      });

      app.use(/\/user\/id:(\d+)/, function (req, res, next) {
        router(req, res, function (err) {
          var keys = Object.keys(req.params).sort();
          res.send(keys.map(function (k) { return [k, req.params[k]] }));
        });
      });

      request(app)
        .get('/user/id:42/user:tj/profile')
        .expect(200, '[["0","42"]]', done);
    }
```

#### should pass-though middleware

```ts
it('should pass-though middleware', function (done) {
        var app = express();

        app.enable('strict routing');

        app.use(function (req, res, next) {
          res.setHeader('x-middleware', 'true');
          next();
        });

        app.get('/user/', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user/')
          .expect('x-middleware', 'true')
          .expect(200, 'tj', done);
      }
```

#### should pass-though mounted middleware

```ts
it('should pass-though mounted middleware', function (done) {
        var app = express();

        app.enable('strict routing');

        app.use('/user/', function (req, res, next) {
          res.setHeader('x-middleware', 'true');
          next();
        });

        app.get('/user/test/', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user/test/')
          .expect('x-middleware', 'true')
          .expect(200, 'tj', done);
      }
```

#### should match middleware when omitting the trailing slash

```ts
it('should match middleware when omitting the trailing slash', function (done) {
        var app = express();

        app.enable('strict routing');

        app.use('/user/', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user')
          .expect(200, 'tj', done);
      }
```

#### should match middleware

```ts
it('should match middleware', function (done) {
        var app = express();

        app.enable('strict routing');

        app.use('/user', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user')
          .expect(200, 'tj', done);
      }
```

#### should match middleware when adding the trailing slash

```ts
it('should match middleware when adding the trailing slash', function (done) {
        var app = express();

        app.enable('strict routing');

        app.use('/user', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user/')
          .expect(200, 'tj', done);
      }
```

#### should work inside literal parenthesis

```ts
it('should work inside literal parenthesis', function (done) {
      var app = express();

      app.get('/:user\\(:op\\)', function (req, res) {
        res.end(req.params.op + 'ing ' + req.params.user);
      });

      request(app)
        .get('/tj(edit)')
        .expect('editing tj', done);
    }
```

#### should ignore resolved promise

```ts
it('should ignore resolved promise', function (done) {
      var app = express()
      var router = new express.Router()

      router.use(function createError(req, res, next) {
        res.send('saw GET /foo')
        return Promise.resolve('foo')
      })

      router.use(function () {
        done(new Error('Unexpected middleware invoke'))
      })

      app.use(router)

      request(app)
        .get('/foo')
        .expect(200, 'saw GET /foo', done)
    }
```

#### should ignore resolved promise

```ts
it('should ignore resolved promise', function (done) {
        var app = express()
        var router = new express.Router()

        router.use(function createError(req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        router.use(function handleError(err, req, res, next) {
          res.send('saw ' + err.name + ': ' + err.message)
          return Promise.resolve('foo')
        })

        router.use(function () {
          done(new Error('Unexpected middleware invoke'))
        })

        app.use(router)

        request(app)
          .get('/foo')
          .expect(200, 'saw Error: boom!', done)
      }
```

#### should allow rewriting of the url

```ts
it('should allow rewriting of the url', function (done) {
    var app = express();

    app.get('/account/edit', function (req, res, next) {
      req.user = { id: 12 }; // faux authenticated user
      req.url = '/user/' + req.user.id + '/edit';
      next();
    });

    app.get('/user/:id/edit', function (req, res) {
      res.send('editing user ' + req.params.id);
    });

    request(app)
      .get('/account/edit')
      .expect('editing user 12', done);
  }
```

#### should run in order added

```ts
it('should run in order added', function (done) {
    var app = express();
    var path = [];

    app.get('/*path', function (req, res, next) {
      path.push(0);
      next();
    });

    app.get('/user/:id', function (req, res, next) {
      path.push(1);
      next();
    });

    app.use(function (req, res, next) {
      path.push(2);
      next();
    });

    app.all('/user/:id', function (req, res, next) {
      path.push(3);
      next();
    });

    app.get('/*splat', function (req, res, next) {
      path.push(4);
      next();
    });

    app.use(function (req, res, next) {
      path.push(5);
      res.end(path.join(','))
    });

    request(app)
      .get('/user/1')
      .expect(200, '0,1,2,3,4,5', done);
  }
```

#### should not use disposed router/middleware

```ts
it('should not use disposed router/middleware', function (done) {
    // more context: https://github.com/expressjs/express/issues/5743#issuecomment-2277148412

    var app = express();
    var router = new express.Router();

    router.use(function (req, res, next) {
      res.setHeader('old', 'foo');
      next();
    });

    app.use(function (req, res, next) {
      return router.handle(req, res, next);
    });

    app.get('/', function (req, res, next) {
      res.send('yee');
      next();
    });

    request(app)
      .get('/')
      .expect('old', 'foo')
      .expect(function (res) {
        if (typeof res.headers['new'] !== 'undefined') {
          throw new Error('`new` header should not be present');
        }
      })
      .expect(200, 'yee', function (err, res) {
        if (err) return done(err);

        router = new express.Router();

        router.use(function (req, res, next) {
          res.setHeader('new', 'bar');
          next();
        });

        request(app)
          .get('/')
          .expect('new', 'bar')
          .expect(function (res) {
            if (typeof res.headers['old'] !== 'undefined') {
              throw new Error('`old` header should not be present');
            }
          })
          .expect(200, 'yee', done);
      });
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/route-separation.js

#### should edit a user

```ts
it('should edit a user', function (done) {
      request(app)
      .put('/user/0/edit')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ user: { name: 'TJ', email: 'tj-invalid@vision-media.ca' } })
      .expect(302, function (err) {
        if (err) return done(err)
        request(app)
        .get('/user/0')
        .expect(200, /tj-invalid@vision-media\.ca/, done)
      })
    }
```

#### should edit a user

```ts
it('should edit a user', function (done) {
      request(app)
      .post('/user/1/edit?_method=PUT')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send({ user: { name: 'Tobi', email: 'tobi-invalid@vision-media.ca' } })
      .expect(302, function (err) {
        if (err) return done(err)
        request(app)
        .get('/user/1')
        .expect(200, /tobi-invalid@vision-media\.ca/, done)
      })
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/Router.js

#### should not stack overflow with a large sync middleware stack

```ts
it('should not stack overflow with a large sync middleware stack', function (done) {
    this.timeout(5000) // long-running test

    var router = new Router()

    router.use(function (req, res, next) {
      req.counter = 0
      next()
    })

    for (var i = 0; i < 6000; i++) {
      router.use(function (req, res, next) {
        req.counter++
        next()
      })
    }

    router.use(function (req, res) {
      assert.strictEqual(req.counter, 6000)
      res.end()
    })

    router.handle({ url: '/', method: 'GET' }, { end: done }, function (err) {
      assert(!err, err);
    })
  }
```

#### should skip non error middleware

```ts
it('should skip non error middleware', function (done) {
      var router = new Router();

      router.get('/foo', function (req, res, next) {
        next(new Error('foo'));
      });

      router.get('/bar', function (req, res, next) {
        next(new Error('bar'));
      });

      router.use(function (req, res, next) {
        assert(false);
      });

      router.use(function (err, req, res, next) {
        assert.equal(err.message, 'foo');
        done();
      });

      router.handle({ url: '/foo', method: 'GET' }, {}, done);
    }
```

#### should handle throwing inside routes with params

```ts
it('should handle throwing inside routes with params', function (done) {
      var router = new Router();

      router.get('/foo/:id', function () {
        throw new Error('foo');
      });

      router.use(function (req, res, next) {
        assert(false);
      });

      router.use(function (err, req, res, next) {
        assert.equal(err.message, 'foo');
        done();
      });

      router.handle({ url: '/foo/2', method: 'GET' }, {}, function () { });
    }
```

#### should handle throwing inside error handlers

```ts
it('should handle throwing inside error handlers', function (done) {
      var router = new Router();

      router.use(function (req, res, next) {
        throw new Error('boom!');
      });

      router.use(function (err, req, res, next) {
        throw new Error('oops');
      });

      router.use(function (err, req, res, next) {
        assert.equal(err.message, 'oops');
        done();
      });

      router.handle({ url: '/', method: 'GET' }, {}, done);
    }
```

#### should require middleware

```ts
it('should require middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/') }, /argument handler is required/)
    }
```

#### should reject string as middleware

```ts
it('should reject string as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', 'foo') }, /argument handler must be a function/)
    }
```

#### should reject number as middleware

```ts
it('should reject number as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', 42) }, /argument handler must be a function/)
    }
```

#### should reject null as middleware

```ts
it('should reject null as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', null) }, /argument handler must be a function/)
    }
```

#### should reject Date as middleware

```ts
it('should reject Date as middleware', function () {
      var router = new Router()
      assert.throws(function () { router.use('/', new Date()) }, /argument handler must be a function/)
    }
```

#### should accept array of middleware

```ts
it('should accept array of middleware', function (done) {
      var count = 0;
      var router = new Router();

      function fn1(req, res, next) {
        assert.equal(++count, 1);
        next();
      }

      function fn2(req, res, next) {
        assert.equal(++count, 2);
        next();
      }

      router.use([fn1, fn2], function (req, res) {
        assert.equal(++count, 3);
        done();
      });

      router.handle({ url: '/foo', method: 'GET' }, {}, function () { });
    }
```

#### should require function

```ts
it('should require function', function () {
      var router = new Router();
      assert.throws(router.param.bind(router, 'id'), /argument fn is required/);
    }
```

#### should reject non-function

```ts
it('should reject non-function', function () {
      var router = new Router();
      assert.throws(router.param.bind(router, 'id', 42), /argument fn must be a function/);
    }
```

#### should call param function when routing VERBS

```ts
it('should call param function when routing VERBS', function (done) {
      var router = new Router();

      router.param('id', function (req, res, next, id) {
        assert.equal(id, '123');
        next();
      });

      router.get('/foo/:id/bar', function (req, res, next) {
        assert.equal(req.params.id, '123');
        next();
      });

      router.handle({ url: '/foo/123/bar', method: 'get' }, {}, done);
    }
```

#### should call param function when routing middleware

```ts
it('should call param function when routing middleware', function (done) {
      var router = new Router();

      router.param('id', function (req, res, next, id) {
        assert.equal(id, '123');
        next();
      });

      router.use('/foo/:id/bar', function (req, res, next) {
        assert.equal(req.params.id, '123');
        assert.equal(req.url, '/baz');
        next();
      });

      router.handle({ url: '/foo/123/bar/baz', method: 'get' }, {}, done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

#### should not override previous Content-Types

```ts
it('should not override previous Content-Types', function(done){
      var app = express();

      app.get('/', function(req, res){
        res.type('application/vnd.example+json');
        res.json({ hello: 'world' });
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/vnd.example+json; charset=utf-8')
      .expect(200, '{"hello":"world"}', done);
    }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json replacer', function(key, val){
          return key[0] === '_'
            ? undefined
            : val;
        });

        app.use(function(req, res){
          res.json({ name: 'tobi', _id: 12345 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/collections.js

#### each

```ts
test('each', function(assert) {
    _.each([1, 2, 3], function(num, i) {
      assert.equal(num, i + 1, 'each iterators provide value and iteration count');
    });

    var answers = [];
    _.each([1, 2, 3], function(num){ answers.push(num * this.multiplier); }, {multiplier: 5});
    assert.deepEqual(answers, [5, 10, 15], 'context object property accessed');

    answers = [];
    _.each([1, 2, 3], function(num){ answers.push(num); });
    assert.deepEqual(answers, [1, 2, 3], 'can iterate a simple array');

    answers = [];
    var obj = {one: 1, two: 2, three: 3};
    obj.constructor.prototype.four = 4;
    _.each(obj, function(value, key){ answers.push(key); });
    assert.deepEqual(answers, ['one', 'two', 'three'], 'iterating over objects works, and ignores the object prototype.');
    delete obj.constructor.prototype.four;

    // ensure the each function is JITed
    _(1000).times(function() { _.each([], function(){}); });
    var count = 0;
    obj = {1: 'foo', 2: 'bar', 3: 'baz'};
    _.each(obj, function(){ count++; });
    assert.equal(count, 3, 'the fun should be called only 3 times');

    var answer = null;
    _.each([1, 2, 3], function(num, index, arr){ if (_.include(arr, num)) answer = true; });
    assert.ok(answer, 'can reference the original collection from inside the iterator');

    answers = 0;
    _.each(null, function(){ ++answers; });
    assert.equal(answers, 0, 'handles a null properly');

    _.each(false, function(){});

    var a = [1, 2, 3];
    assert.strictEqual(_.each(a, function(){}), a);
    assert.strictEqual(_.each(null, function(){}), null);
  }
```

#### map

```ts
test('map', function(assert) {
    var doubled = _.map([1, 2, 3], function(num){ return num * 2; });
    assert.deepEqual(doubled, [2, 4, 6], 'doubled numbers');

    var tripled = _.map([1, 2, 3], function(num){ return num * this.multiplier; }, {multiplier: 3});
    assert.deepEqual(tripled, [3, 6, 9], 'tripled numbers with context');

    doubled = _([1, 2, 3]).map(function(num){ return num * 2; });
    assert.deepEqual(doubled, [2, 4, 6], 'OO-style doubled numbers');

    var ids = _.map({length: 2, 0: {id: '1'}, 1: {id: '2'}}, function(n){
      return n.id;
    });
    assert.deepEqual(ids, ['1', '2'], 'Can use collection methods on Array-likes.');

    assert.deepEqual(_.map(null, _.noop), [], 'handles a null properly');

    assert.deepEqual(_.map([1], function() {
      return this.length;
    }, [5]), [1], 'called with context');

    // Passing a property name like _.pluck.
    var people = [{name: 'moe', age: 30}, {name: 'curly', age: 50}];
    assert.deepEqual(_.map(people, 'name'), ['moe', 'curly'], 'predicate string map to object properties');
  }
```

#### reduce

```ts
test('reduce', function(assert) {
    var sum = _.reduce([1, 2, 3], function(memo, num){ return memo + num; }, 0);
    assert.equal(sum, 6, 'can sum up an array');

    var context = {multiplier: 3};
    sum = _.reduce([1, 2, 3], function(memo, num){ return memo + num * this.multiplier; }, 0, context);
    assert.equal(sum, 18, 'can reduce with a context object');

    sum = _([1, 2, 3]).reduce(function(memo, num){ return memo + num; }, 0);
    assert.equal(sum, 6, 'OO-style reduce');

    sum = _.reduce([1, 2, 3], function(memo, num){ return memo + num; });
    assert.equal(sum, 6, 'default initial value');

    var prod = _.reduce([1, 2, 3, 4], function(memo, num){ return memo * num; });
    assert.equal(prod, 24, 'can reduce via multiplication');

    assert.strictEqual(_.reduce(null, _.noop, 138), 138, 'handles a null (with initial value) properly');
    assert.equal(_.reduce([], _.noop, void 0), void 0, 'undefined can be passed as a special case');
    assert.equal(_.reduce([_], _.noop), _, 'collection of length one with no initial value returns the first item');
    assert.equal(_.reduce([], _.noop), void 0, 'returns undefined when collection is empty and no initial value');
  }
```

#### reduceRight

```ts
test('reduceRight', function(assert) {
    var list = _.reduceRight(['foo', 'bar', 'baz'], function(memo, str){ return memo + str; }, '');
    assert.equal(list, 'bazbarfoo', 'can perform right folds');

    list = _.reduceRight(['foo', 'bar', 'baz'], function(memo, str){ return memo + str; });
    assert.equal(list, 'bazbarfoo', 'default initial value');

    var sum = _.reduceRight({a: 1, b: 2, c: 3}, function(memo, num){ return memo + num; });
    assert.equal(sum, 6, 'default initial value on object');

    assert.strictEqual(_.reduceRight(null, _.noop, 138), 138, 'handles a null (with initial value) properly');
    assert.equal(_.reduceRight([_], _.noop), _, 'collection of length one with no initial value returns the first item');

    assert.equal(_.reduceRight([], _.noop, void 0), void 0, 'undefined can be passed as a special case');
    assert.equal(_.reduceRight([], _.noop), void 0, 'returns undefined when collection is empty and no initial value');

    // Assert that the correct arguments are being passed.

    var args,
        init = {},
        object = {a: 1, b: 2},
        lastKey = _.keys(object).pop();

    var expected = lastKey === 'a'
      ? [init, 1, 'a', object]
      : [init, 2, 'b', object];

    _.reduceRight(object, function() {
      if (!args) args = _.toArray(arguments);
    }, init);

    assert.deepEqual(args, expected);

    // And again, with numeric keys.

    object = {2: 'a', 1: 'b'};
    lastKey = _.keys(object).pop();
    args = null;

    expected = lastKey === '2'
      ? [init, 'a', '2', object]
      : [init, 'b', '1', object];

    _.reduceRight(object, function() {
      if (!args) args = _.toArray(arguments);
    }, init);

    assert.deepEqual(args, expected);
  }
```

#### find

```ts
test('find', function(assert) {
    var array = [1, 2, 3, 4];
    assert.strictEqual(_.find(array, function(n) { return n > 2; }), 3, 'should return first found `value`');
    assert.strictEqual(_.find(array, function() { return false; }), void 0, 'should return `undefined` if `value` is not found');

    array.dontmatch = 55;
    assert.strictEqual(_.find(array, function(x) { return x === 55; }), void 0, 'iterates array-likes correctly');

    // Matching an object like _.findWhere.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}, {a: 2, b: 4}];
    assert.deepEqual(_.find(list, {a: 1}), {a: 1, b: 2}, 'can be used as findWhere');
    assert.deepEqual(_.find(list, {b: 4}), {a: 1, b: 4});
    assert.notOk(_.find(list, {c: 1}), 'undefined when not found');
    assert.notOk(_.find([], {c: 1}), 'undefined when searching empty list');

    var result = _.find([1, 2, 3], function(num){ return num * 2 === 4; });
    assert.equal(result, 2, 'found the first "2" and broke the loop');

    var obj = {
      a: {x: 1, z: 3},
      b: {x: 2, z: 2},
      c: {x: 3, z: 4},
      d: {x: 4, z: 1}
    };

    assert.deepEqual(_.find(obj, {x: 2}), {x: 2, z: 2}, 'works on objects');
    assert.deepEqual(_.find(obj, {x: 2, z: 1}), void 0);
    assert.deepEqual(_.find(obj, function(x) {
      return x.x === 4;
    }), {x: 4, z: 1});

    _.findIndex([{a: 1}], function(a, key, o) {
      assert.equal(key, 0);
      assert.deepEqual(o, [{a: 1}]);
      assert.strictEqual(this, _, 'called with context');
    }, _);
  }
```

#### every

```ts
test('every', function(assert) {
    assert.ok(_.every([], _.identity), 'the empty set');
    assert.ok(_.every([true, true, true], _.identity), 'every true values');
    assert.notOk(_.every([true, false, true], _.identity), 'one false value');
    assert.ok(_.every([0, 10, 28], function(num){ return num % 2 === 0; }), 'even numbers');
    assert.notOk(_.every([0, 11, 28], function(num){ return num % 2 === 0; }), 'an odd number');
    assert.strictEqual(_.every([1], _.identity), true, 'cast to boolean - true');
    assert.strictEqual(_.every([0], _.identity), false, 'cast to boolean - false');
    assert.notOk(_.every([void 0, void 0, void 0], _.identity), 'works with arrays of undefined');

    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.notOk(_.every(list, {a: 1, b: 2}), 'Can be called with object');
    assert.ok(_.every(list, 'a'), 'String mapped to object property');

    list = [{a: 1, b: 2}, {a: 2, b: 2, c: true}];
    assert.ok(_.every(list, {b: 2}), 'Can be called with object');
    assert.notOk(_.every(list, 'c'), 'String mapped to object property');

    assert.ok(_.every({a: 1, b: 2, c: 3, d: 4}, _.isNumber), 'takes objects');
    assert.notOk(_.every({a: 1, b: 2, c: 3, d: 4}, _.isObject), 'takes objects');
    assert.ok(_.every(['a', 'b', 'c', 'd'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
    assert.notOk(_.every(['a', 'b', 'c', 'd', 'f'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
  }
```

#### some

```ts
test('some', function(assert) {
    assert.notOk(_.some([]), 'the empty set');
    assert.notOk(_.some([false, false, false]), 'all false values');
    assert.ok(_.some([false, false, true]), 'one true value');
    assert.ok(_.some([null, 0, 'yes', false]), 'a string');
    assert.notOk(_.some([null, 0, '', false]), 'falsy values');
    assert.notOk(_.some([1, 11, 29], function(num){ return num % 2 === 0; }), 'all odd numbers');
    assert.ok(_.some([1, 10, 29], function(num){ return num % 2 === 0; }), 'an even number');
    assert.strictEqual(_.some([1], _.identity), true, 'cast to boolean - true');
    assert.strictEqual(_.some([0], _.identity), false, 'cast to boolean - false');
    assert.ok(_.some([false, false, true]));

    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.notOk(_.some(list, {a: 5, b: 2}), 'Can be called with object');
    assert.ok(_.some(list, 'a'), 'String mapped to object property');

    list = [{a: 1, b: 2}, {a: 2, b: 2, c: true}];
    assert.ok(_.some(list, {b: 2}), 'Can be called with object');
    assert.notOk(_.some(list, 'd'), 'String mapped to object property');

    assert.ok(_.some({a: '1', b: '2', c: '3', d: '4', e: 6}, _.isNumber), 'takes objects');
    assert.notOk(_.some({a: 1, b: 2, c: 3, d: 4}, _.isObject), 'takes objects');
    assert.ok(_.some(['a', 'b', 'c', 'd'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
    assert.notOk(_.some(['x', 'y', 'z'], _.hasOwnProperty, {a: 1, b: 2, c: 3, d: 4}), 'context works');
  }
```

#### includes

```ts
test('includes', function(assert) {
    _.each([null, void 0, 0, 1, NaN, {}, []], function(val) {
      assert.strictEqual(_.includes(val, 'hasOwnProperty'), false);
    });
    assert.strictEqual(_.includes([1, 2, 3], 2), true, 'two is in the array');
    assert.notOk(_.includes([1, 3, 9], 2), 'two is not in the array');

    assert.strictEqual(_.includes([5, 4, 3, 2, 1], 5, true), true, 'doesn\'t delegate to binary search');

    assert.strictEqual(_.includes({moe: 1, larry: 3, curly: 9}, 3), true, '_.includes on objects checks their values');
    assert.ok(_([1, 2, 3]).includes(2), 'OO-style includes');

    var numbers = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    assert.strictEqual(_.includes(numbers, 1, 1), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -1), false, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -2), false, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, -3), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, 6), true, 'takes a fromIndex');
    assert.strictEqual(_.includes(numbers, 1, 7), false, 'takes a fromIndex');

    assert.ok(_.every([1, 2, 3], _.partial(_.includes, numbers)), 'fromIndex is guarded');
  }
```

#### invoke

```ts
test('invoke', function(assert) {
    assert.expect(5);
    var list = [[5, 1, 7], [3, 2, 1]];
    var result = _.invoke(list, 'sort');
    assert.deepEqual(result[0], [1, 5, 7], 'first array sorted');
    assert.deepEqual(result[1], [1, 2, 3], 'second array sorted');

    _.invoke([{
      method: function() {
        assert.deepEqual(_.toArray(arguments), [1, 2, 3], 'called with arguments');
      }
    }], 'method', 1, 2, 3);

    assert.deepEqual(_.invoke([{a: null}, {}, {a: _.constant(1)}], 'a'), [null, void 0, 1], 'handles null & undefined');

    assert.raises(function() {
      _.invoke([{a: 1}], 'a');
    }, TypeError, 'throws for non-functions');
  }
```

#### invoke when strings have a call method

```ts
test('invoke when strings have a call method', function(assert) {
    String.prototype.call = function() {
      return 42;
    };
    var list = [[5, 1, 7], [3, 2, 1]];
    var s = 'foo';
    assert.equal(s.call(), 42, 'call function exists');
    var result = _.invoke(list, 'sort');
    assert.deepEqual(result[0], [1, 5, 7], 'first array sorted');
    assert.deepEqual(result[1], [1, 2, 3], 'second array sorted');
    delete String.prototype.call;
    assert.equal(s.call, void 0, 'call function removed');
  }
```

#### pluck

```ts
test('pluck', function(assert) {
    var people = [{name: 'moe', age: 30}, {name: 'curly', age: 50}];
    assert.deepEqual(_.pluck(people, 'name'), ['moe', 'curly'], 'pulls names out of objects');
    assert.deepEqual(_.pluck(people, 'address'), [void 0, void 0], 'missing properties are returned as undefined');
    //compat: most flexible handling of edge cases
    assert.deepEqual(_.pluck([{'[object Object]': 1}], {}), [1]);
  }
```

#### max

```ts
test('max', function(assert) {
    assert.equal(-Infinity, _.max(null), 'can handle null/undefined');
    assert.equal(-Infinity, _.max(void 0), 'can handle null/undefined');
    assert.equal(-Infinity, _.max(null, _.identity), 'can handle null/undefined');

    assert.equal(_.max([1, 2, 3]), 3, 'can perform a regular Math.max');

    var neg = _.max([1, 2, 3], function(num){ return -num; });
    assert.equal(neg, 1, 'can perform a computation-based max');

    assert.equal(-Infinity, _.max({}), 'Maximum value of an empty object');
    assert.equal(-Infinity, _.max([]), 'Maximum value of an empty array');
    assert.equal(_.max({a: 'a'}), -Infinity, 'Maximum value of a non-numeric collection');

    assert.equal(_.max(_.range(1, 300000)), 299999, 'Maximum value of a too-big array');

    assert.equal(_.max([1, 2, 3, 'test']), 3, 'Finds correct max in array starting with num and containing a NaN');
    assert.equal(_.max(['test', 1, 2, 3]), 3, 'Finds correct max in array starting with NaN');

    assert.equal(_.max([1, 2, 3, null]), 3, 'Finds correct max in array starting with num and containing a `null`');
    assert.equal(_.max([null, 1, 2, 3]), 3, 'Finds correct max in array starting with a `null`');

    assert.equal(_.max([1, 2, 3, '']), 3, 'Finds correct max in array starting with num and containing an empty string');
    assert.equal(_.max(['', 1, 2, 3]), 3, 'Finds correct max in array starting with an empty string');

    assert.equal(_.max([1, 2, 3, false]), 3, 'Finds correct max in array starting with num and containing a false');
    assert.equal(_.max([false, 1, 2, 3]), 3, 'Finds correct max in array starting with a false');

    assert.equal(_.max([0, 1, 2, 3, 4]), 4, 'Finds correct max in array containing a zero');
    assert.equal(_.max([-3, -2, -1, 0]), 0, 'Finds correct max in array containing negative numbers');

    assert.deepEqual(_.map([[1, 2, 3], [4, 5, 6]], _.max), [3, 6], 'Finds correct max in array when mapping through multiple arrays');

    var a = {x: -Infinity};
    var b = {x: -Infinity};
    var iterator = function(o){ return o.x; };
    assert.equal(_.max([a, b], iterator), a, 'Respects iterator return value of -Infinity');

    assert.deepEqual(_.max([{a: 1}, {a: 0, b: 3}, {a: 4}, {a: 2}], 'a'), {a: 4}, 'String keys use property iterator');

    assert.deepEqual(_.max([0, 2], function(c){ return c * this.x; }, {x: 1}), 2, 'Iterator context');
    assert.deepEqual(_.max([[1], [2, 3], [-1, 4], [5]], 0), [5], 'Lookup falsy iterator');
    assert.deepEqual(_.max([{0: 1}, {0: 2}, {0: -1}, {a: 1}], 0), {0: 2}, 'Lookup falsy iterator');
  }
```

#### min

```ts
test('min', function(assert) {
    assert.equal(_.min(null), Infinity, 'can handle null/undefined');
    assert.equal(_.min(void 0), Infinity, 'can handle null/undefined');
    assert.equal(_.min(null, _.identity), Infinity, 'can handle null/undefined');

    assert.equal(_.min([1, 2, 3]), 1, 'can perform a regular Math.min');

    var neg = _.min([1, 2, 3], function(num){ return -num; });
    assert.equal(neg, 3, 'can perform a computation-based min');

    assert.equal(_.min({}), Infinity, 'Minimum value of an empty object');
    assert.equal(_.min([]), Infinity, 'Minimum value of an empty array');
    assert.equal(_.min({a: 'a'}), Infinity, 'Minimum value of a non-numeric collection');

    assert.deepEqual(_.map([[1, 2, 3], [4, 5, 6]], _.min), [1, 4], 'Finds correct min in array when mapping through multiple arrays');

    var now = new Date(9999999999);
    var then = new Date(0);
    assert.equal(_.min([now, then]), then);

    assert.equal(_.min(_.range(1, 300000)), 1, 'Minimum value of a too-big array');

    assert.equal(_.min([1, 2, 3, 'test']), 1, 'Finds correct min in array starting with num and containing a NaN');
    assert.equal(_.min(['test', 1, 2, 3]), 1, 'Finds correct min in array starting with NaN');

    assert.equal(_.min([1, 2, 3, null]), 1, 'Finds correct min in array starting with num and containing a `null`');
    assert.equal(_.min([null, 1, 2, 3]), 1, 'Finds correct min in array starting with a `null`');

    assert.equal(_.min([0, 1, 2, 3, 4]), 0, 'Finds correct min in array containing a zero');
    assert.equal(_.min([-3, -2, -1, 0]), -3, 'Finds correct min in array containing negative numbers');

    var a = {x: Infinity};
    var b = {x: Infinity};
    var iterator = function(o){ return o.x; };
    assert.equal(_.min([a, b], iterator), a, 'Respects iterator return value of Infinity');

    assert.deepEqual(_.min([{a: 1}, {a: 0, b: 3}, {a: 4}, {a: 2}], 'a'), {a: 0, b: 3}, 'String keys use property iterator');

    assert.deepEqual(_.min([0, 2], function(c){ return c * this.x; }, {x: -1}), 2, 'Iterator context');
    assert.deepEqual(_.min([[1], [2, 3], [-1, 4], [5]], 0), [-1, 4], 'Lookup falsy iterator');
    assert.deepEqual(_.min([{0: 1}, {0: 2}, {0: -1}, {a: 1}], 0), {0: -1}, 'Lookup falsy iterator');
  }
```

#### sortBy

```ts
test('sortBy', function(assert) {
    var people = [{name: 'curly', age: 50}, {name: 'moe', age: 30}];
    people = _.sortBy(people, function(person){ return person.age; });
    assert.deepEqual(_.pluck(people, 'name'), ['moe', 'curly'], 'stooges sorted by age');

    var list = [void 0, 4, 1, void 0, 3, 2];
    assert.deepEqual(_.sortBy(list, _.identity), [1, 2, 3, 4, void 0, void 0], 'sortBy with undefined values');

    list = ['one', 'two', 'three', 'four', 'five'];
    var sorted = _.sortBy(list, 'length');
    assert.deepEqual(sorted, ['one', 'two', 'four', 'five', 'three'], 'sorted by length');

    function Pair(x, y) {
      this.x = x;
      this.y = y;
    }

    var stableArray = [
      new Pair(1, 1), new Pair(1, 2),
      new Pair(1, 3), new Pair(1, 4),
      new Pair(1, 5), new Pair(1, 6),
      new Pair(2, 1), new Pair(2, 2),
      new Pair(2, 3), new Pair(2, 4),
      new Pair(2, 5), new Pair(2, 6),
      new Pair(void 0, 1), new Pair(void 0, 2),
      new Pair(void 0, 3), new Pair(void 0, 4),
      new Pair(void 0, 5), new Pair(void 0, 6)
    ];

    var stableObject = _.object('abcdefghijklmnopqr'.split(''), stableArray);

    var actual = _.sortBy(stableArray, function(pair) {
      return pair.x;
    });

    assert.deepEqual(actual, stableArray, 'sortBy should be stable for arrays');
    assert.deepEqual(_.sortBy(stableArray, 'x'), stableArray, 'sortBy accepts property string');

    actual = _.sortBy(stableObject, function(pair) {
      return pair.x;
    });

    assert.deepEqual(actual, stableArray, 'sortBy should be stable for objects');

    list = ['q', 'w', 'e', 'r', 't', 'y'];
    assert.deepEqual(_.sortBy(list), ['e', 'q', 'r', 't', 'w', 'y'], 'uses _.identity if iterator is not specified');
  }
```

#### sample

```ts
test('sample', function(assert) {
    assert.strictEqual(_.sample([1]), 1, 'behaves correctly when no second parameter is given');
    assert.deepEqual(_.sample([1, 2, 3], -2), [], 'behaves correctly on negative n');
    var numbers = _.range(10);
    var allSampled = _.sample(numbers, 10).sort();
    assert.deepEqual(allSampled, numbers, 'contains the same members before and after sample');
    allSampled = _.sample(numbers, 20).sort();
    assert.deepEqual(allSampled, numbers, 'also works when sampling more objects than are present');
    assert.ok(_.contains(numbers, _.sample(numbers)), 'sampling a single element returns something from the array');
    assert.strictEqual(_.sample([]), void 0, 'sampling empty array with no number returns undefined');
    assert.notStrictEqual(_.sample([], 5), [], 'sampling empty array with a number returns an empty array');
    assert.notStrictEqual(_.sample([1, 2, 3], 0), [], 'sampling an array with 0 picks returns an empty array');
    assert.deepEqual(_.sample([1, 2], -1), [], 'sampling a negative number of picks returns an empty array');
    assert.ok(_.contains([1, 2, 3], _.sample({a: 1, b: 2, c: 3})), 'sample one value from an object');
    var partialSample = _.sample(_.range(1000), 10);
    var partialSampleSorted = partialSample.sort();
    assert.notDeepEqual(partialSampleSorted, _.range(10), 'samples from the whole array, not just the beginning');
  }
```

#### toArray

```ts
test('toArray', function(assert) {
    assert.notOk(_.isArray(arguments), 'arguments object is not an array');
    assert.ok(_.isArray(_.toArray(arguments)), 'arguments object converted into array');
    var a = [1, 2, 3];
    assert.notStrictEqual(_.toArray(a), a, 'array is cloned');
    assert.deepEqual(_.toArray(a), [1, 2, 3], 'cloned array contains same elements');

    var numbers = _.toArray({one: 1, two: 2, three: 3});
    assert.deepEqual(numbers, [1, 2, 3], 'object flattened into array');

    var hearts = '\uD83D\uDC95';
    var pair = hearts.split('');
    var expected = [pair[0], hearts, '&', hearts, pair[1]];
    assert.deepEqual(_.toArray(expected.join('')), expected, 'maintains astral characters');
    assert.deepEqual(_.toArray(''), [], 'empty string into empty array');

    if (typeof document != 'undefined') {
      // test in IE < 9
      var actual;
      try {
        actual = _.toArray(document.childNodes);
      } catch (e) { /* ignored */ }
      assert.deepEqual(actual, _.map(document.childNodes, _.identity), 'works on NodeList');
    }
  }
```

#### Can use various collection methods on NodeLists

```ts
test('Can use various collection methods on NodeLists', function(assert) {
      var parent = document.createElement('div');
      parent.innerHTML = '<span id=id1></span>textnode<span id=id2></span>';

      var elementChildren = _.filter(parent.childNodes, _.isElement);
      assert.equal(elementChildren.length, 2);

      assert.deepEqual(_.map(elementChildren, 'id'), ['id1', 'id2']);
      assert.deepEqual(_.map(parent.childNodes, 'nodeType'), [1, 3, 1]);

      assert.notOk(_.every(parent.childNodes, _.isElement));
      assert.ok(_.some(parent.childNodes, _.isElement));

      function compareNode(node) {
        return _.isElement(node) ? node.id.charAt(2) : void 0;
      }
      assert.equal(_.max(parent.childNodes, compareNode), _.last(parent.childNodes));
      assert.equal(_.min(parent.childNodes, compareNode), _.first(parent.childNodes));
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.jsonp.js

#### should not override previous Content-Types with no callback

```ts
it('should not override previous Content-Types with no callback', function(done){
      var app = express();

      app.get('/', function(req, res){
        res.type('application/vnd.example+json');
        res.jsonp({ hello: 'world' });
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/vnd.example+json; charset=utf-8')
      .expect(utils.shouldNotHaveHeader('X-Content-Type-Options'))
      .expect(200, '{"hello":"world"}', done);
    }
```

#### should override previous Content-Types with callback

```ts
it('should override previous Content-Types with callback', function(done){
      var app = express();

      app.get('/', function(req, res){
        res.type('application/vnd.example+json');
        res.jsonp({ hello: 'world' });
      });

      request(app)
      .get('/?callback=cb')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(200, /cb\(\{"hello":"world"\}\);$/, done);
    }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json replacer', function(key, val){
          return key[0] === '_'
            ? undefined
            : val;
        });

        app.use(function(req, res){
          res.jsonp({ name: 'tobi', _id: 12345 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### routes (simple)

```ts
test('routes (simple)', function(assert) {
    assert.expect(4);
    location.replace('http://example.com#search/news');
    Backbone.history.checkUrl();
    assert.equal(router.query, 'news');
    assert.equal(router.page, void 0);
    assert.equal(lastRoute, 'search');
    assert.equal(lastArgs[0], 'news');
  }
```

#### routes (simple, but unicode)

```ts
test('routes (simple, but unicode)', function(assert) {
    assert.expect(4);
    location.replace('http://example.com#search/тест');
    Backbone.history.checkUrl();
    assert.equal(router.query, 'тест');
    assert.equal(router.page, void 0);
    assert.equal(lastRoute, 'search');
    assert.equal(lastArgs[0], 'тест');
  }
```

#### loadUrl is not called for identical routes.

```ts
test('loadUrl is not called for identical routes.', function(assert) {
    assert.expect(0);
    Backbone.history.loadUrl = function() { assert.ok(false); };
    location.replace('http://example.com#route');
    Backbone.history.navigate('route');
    Backbone.history.navigate('/route');
    Backbone.history.navigate('/route');
  }
```

#### use implicit callback if none provided

```ts
test('use implicit callback if none provided', function(assert) {
    assert.expect(1);
    router.count = 0;
    router.navigate('implicit', {trigger: true});
    assert.equal(router.count, 1);
  }
```

#### correctly handles URLs with % (#868)

```ts
test('correctly handles URLs with % (#868)', function(assert) {
    assert.expect(3);
    location.replace('http://example.com#search/fat%3A1.5%25');
    Backbone.history.checkUrl();
    location.replace('http://example.com#search/fat');
    Backbone.history.checkUrl();
    assert.equal(router.query, 'fat');
    assert.equal(router.page, void 0);
    assert.equal(lastRoute, 'search');
  }
```

#### Router#execute receives callback, args, name.

```ts
test('Router#execute receives callback, args, name.', function(assert) {
    assert.expect(3);
    location.replace('http://example.com#foo/123/bar?x=y');
    Backbone.history.stop();
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var MyRouter = Backbone.Router.extend({
      routes: {'foo/:id/bar': 'foo'},
      foo: function() {},
      execute: function(callback, args, name) {
        assert.strictEqual(callback, this.foo);
        assert.deepEqual(args, ['123', 'x=y']);
        assert.strictEqual(name, 'foo');
      }
    });
    var myRouter = new MyRouter;
    Backbone.history.start();
  }
```

#### #3175 - Urls in the params

```ts
test('#3175 - Urls in the params', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    location.replace('http://example.com#login?a=value&backUrl=https%3A%2F%2Fwww.msn.com%2Fidp%2Fidpdemo%3Fspid%3Dspdemo%26target%3Db');
    Backbone.history = _.extend(new Backbone.History, {location: location});
    var myRouter = new Backbone.Router;
    myRouter.route('login', function(params) {
      assert.strictEqual(params, 'a=value&backUrl=https%3A%2F%2Fwww.msn.com%2Fidp%2Fidpdemo%3Fspid%3Dspdemo%26target%3Db');
    });
    Backbone.history.start();
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/objects.js

#### keys

```ts
test('keys', function(assert) {
    assert.deepEqual(_.keys({one: 1, two: 2}), ['one', 'two'], 'can extract the keys from an object');
    // the test above is not safe because it relies on for-in enumeration order
    var a = []; a[1] = 0;
    assert.deepEqual(_.keys(a), ['1'], 'is not fooled by sparse arrays; see issue #95');
    assert.deepEqual(_.keys(null), []);
    assert.deepEqual(_.keys(void 0), []);
    assert.deepEqual(_.keys(1), []);
    assert.deepEqual(_.keys('a'), []);
    assert.deepEqual(_.keys(true), []);

    // keys that may be missed if the implementation isn't careful
    var trouble = {
      constructor: Object,
      valueOf: _.noop,
      hasOwnProperty: null,
      toString: 5,
      toLocaleString: void 0,
      propertyIsEnumerable: /a/,
      isPrototypeOf: this,
      __defineGetter__: Boolean,
      __defineSetter__: {},
      __lookupSetter__: false,
      __lookupGetter__: []
    };
    var troubleKeys = ['constructor', 'valueOf', 'hasOwnProperty', 'toString', 'toLocaleString', 'propertyIsEnumerable',
                  'isPrototypeOf', '__defineGetter__', '__defineSetter__', '__lookupSetter__', '__lookupGetter__'].sort();
    assert.deepEqual(_.keys(trouble).sort(), troubleKeys, 'matches non-enumerable properties');
  });

  QUnit.test('allKeys', function(assert) {
    assert.deepEqual(_.allKeys({one: 1, two: 2}), ['one', 'two'], 'can extract the allKeys from an object');
    // the test above is not safe because it relies on for-in enumeration order
    var a = []; a[1] = 0;
    assert.deepEqual(_.allKeys(a), ['1'], 'is not fooled by sparse arrays; see issue #95');

    a.a = a;
    assert.deepEqual(_.allKeys(a), ['1', 'a'], 'is not fooled by sparse arrays with additional properties');

    _.each([null, void 0, 1, 'a', true, NaN, {}, [], new Number(5), new Date(0)], function(val) {
      assert.deepEqual(_.allKeys(val), []);
    });

    // allKeys that may be missed if the implementation isn't careful
    var trouble = {
      constructor: Object,
      valueOf: _.noop,
      hasOwnProperty: null,
      toString: 5,
      toLocaleString: void 0,
      propertyIsEnumerable: /a/,
      isPrototypeOf: this
    };
    var troubleKeys = ['constructor', 'valueOf', 'hasOwnProperty', 'toString', 'toLocaleString', 'propertyIsEnumerable',
                  'isPrototypeOf'].sort();
    assert.deepEqual(_.allKeys(trouble).sort(), troubleKeys, 'matches non-enumerable properties');

    function A() {}
    A.prototype.foo = 'foo';
    var b = new A();
    b.bar = 'bar';
    assert.deepEqual(_.allKeys(b).sort(), ['bar', 'foo'], 'should include inherited keys');

    function y() {}
    y.x = 'z';
    assert.deepEqual(_.allKeys(y), ['x'], 'should get keys from constructor');
  }
```

#### extend

```ts
test('extend', function(assert) {
    var result;
    assert.equal(_.extend({}, {a: 'b'}).a, 'b', 'can extend an object with the attributes of another');
    assert.equal(_.extend({a: 'x'}, {a: 'b'}).a, 'b', 'properties in source override destination');
    assert.equal(_.extend({x: 'x'}, {a: 'b'}).x, 'x', "properties not in source don't get overriden");
    result = _.extend({x: 'x'}, {a: 'a'}, {b: 'b'});
    assert.deepEqual(result, {x: 'x', a: 'a', b: 'b'}, 'can extend from multiple source objects');
    result = _.extend({x: 'x'}, {a: 'a', x: 2}, {a: 'b'});
    assert.deepEqual(result, {x: 2, a: 'b'}, 'extending from multiple source objects last property trumps');
    result = _.extend({}, {a: void 0, b: null});
    assert.deepEqual(_.keys(result), ['a', 'b'], 'extend copies undefined values');

    var F = function() {};
    F.prototype = {a: 'b'};
    var subObj = new F();
    subObj.c = 'd';
    assert.deepEqual(_.extend({}, subObj), {a: 'b', c: 'd'}, 'extend copies all properties from source');
    _.extend(subObj, {});
    assert.notOk(subObj.hasOwnProperty('a'), "extend does not convert destination object's 'in' properties to 'own' properties");

    try {
      result = {};
      _.extend(result, null, void 0, {a: 1});
    } catch (e) { /* ignored */ }

    assert.equal(result.a, 1, 'should not error on `null` or `undefined` sources');

    assert.strictEqual(_.extend(null, {a: 1}), null, 'extending null results in null');
    assert.strictEqual(_.extend(void 0, {a: 1}), void 0, 'extending undefined results in undefined');
  }
```

#### extendOwn

```ts
test('extendOwn', function(assert) {
    var result;
    assert.equal(_.extendOwn({}, {a: 'b'}).a, 'b', 'can extend an object with the attributes of another');
    assert.equal(_.extendOwn({a: 'x'}, {a: 'b'}).a, 'b', 'properties in source override destination');
    assert.equal(_.extendOwn({x: 'x'}, {a: 'b'}).x, 'x', "properties not in source don't get overriden");
    result = _.extendOwn({x: 'x'}, {a: 'a'}, {b: 'b'});
    assert.deepEqual(result, {x: 'x', a: 'a', b: 'b'}, 'can extend from multiple source objects');
    result = _.extendOwn({x: 'x'}, {a: 'a', x: 2}, {a: 'b'});
    assert.deepEqual(result, {x: 2, a: 'b'}, 'extending from multiple source objects last property trumps');
    assert.deepEqual(_.extendOwn({}, {a: void 0, b: null}), {a: void 0, b: null}, 'copies undefined values');

    var F = function() {};
    F.prototype = {a: 'b'};
    var subObj = new F();
    subObj.c = 'd';
    assert.deepEqual(_.extendOwn({}, subObj), {c: 'd'}, 'copies own properties from source');

    result = {};
    assert.deepEqual(_.extendOwn(result, null, void 0, {a: 1}), {a: 1}, 'should not error on `null` or `undefined` sources');

    _.each(['a', 5, null, false], function(val) {
      assert.strictEqual(_.extendOwn(val, {a: 1}), val, 'extending non-objects results in returning the non-object value');
    });

    assert.strictEqual(_.extendOwn(void 0, {a: 1}), void 0, 'extending undefined results in undefined');

    result = _.extendOwn({a: 1, 0: 2, 1: '5', length: 6}, {0: 1, 1: 2, length: 2});
    assert.deepEqual(result, {a: 1, 0: 1, 1: 2, length: 2}, 'should treat array-like objects like normal objects');
  }
```

#### pick

```ts
test('pick', function(assert) {
    var result;
    result = _.pick({a: 1, b: 2, c: 3}, 'a', 'c');
    assert.deepEqual(result, {a: 1, c: 3}, 'can restrict properties to those named');
    result = _.pick({a: 1, b: 2, c: 3}, ['b', 'c']);
    assert.deepEqual(result, {b: 2, c: 3}, 'can restrict properties to those named in an array');
    result = _.pick({a: 1, b: 2, c: 3}, ['a'], 'b');
    assert.deepEqual(result, {a: 1, b: 2}, 'can restrict properties to those named in mixed args');
    result = _.pick(['a', 'b'], 1);
    assert.deepEqual(result, {1: 'b'}, 'can pick numeric properties');

    _.each([null, void 0], function(val) {
      assert.deepEqual(_.pick(val, 'hasOwnProperty'), {}, 'Called with null/undefined');
      assert.deepEqual(_.pick(val, _.constant(true)), {});
    });
    assert.deepEqual(_.pick(5, 'toString', 'b'), {toString: Number.prototype.toString}, 'can iterate primitives');

    var data = {a: 1, b: 2, c: 3};
    var callback = function(value, key, object) {
      assert.strictEqual(key, {1: 'a', 2: 'b', 3: 'c'}[value]);
      assert.strictEqual(object, data);
      return value !== this.value;
    };
    result = _.pick(data, callback, {value: 2});
    assert.deepEqual(result, {a: 1, c: 3}, 'can accept a predicate and context');

    var Obj = function(){};
    Obj.prototype = {a: 1, b: 2, c: 3};
    var instance = new Obj();
    assert.deepEqual(_.pick(instance, 'a', 'c'), {a: 1, c: 3}, 'include prototype props');

    assert.deepEqual(_.pick(data, function(val, key) {
      return this[key] === 3 && this === instance;
    }, instance), {c: 3}, 'function is given context');

    assert.notOk(_.has(_.pick({}, 'foo'), 'foo'), 'does not set own property if property not in object');
    _.pick(data, function(value, key, obj) {
      assert.equal(obj, data, 'passes same object as third parameter of iteratee');
    });
  }
```

#### omit

```ts
test('omit', function(assert) {
    var result;
    result = _.omit({a: 1, b: 2, c: 3}, 'b');
    assert.deepEqual(result, {a: 1, c: 3}, 'can omit a single named property');
    result = _.omit({a: 1, b: 2, c: 3}, 'a', 'c');
    assert.deepEqual(result, {b: 2}, 'can omit several named properties');
    result = _.omit({a: 1, b: 2, c: 3}, ['b', 'c']);
    assert.deepEqual(result, {a: 1}, 'can omit properties named in an array');
    result = _.omit(['a', 'b'], 0);
    assert.deepEqual(result, {1: 'b'}, 'can omit numeric properties');

    assert.deepEqual(_.omit(null, 'a', 'b'), {}, 'non objects return empty object');
    assert.deepEqual(_.omit(void 0, 'toString'), {}, 'null/undefined return empty object');
    assert.deepEqual(_.omit(5, 'toString', 'b'), {}, 'returns empty object for primitives');

    var data = {a: 1, b: 2, c: 3};
    var callback = function(value, key, object) {
      assert.strictEqual(key, {1: 'a', 2: 'b', 3: 'c'}[value]);
      assert.strictEqual(object, data);
      return value !== this.value;
    };
    result = _.omit(data, callback, {value: 2});
    assert.deepEqual(result, {b: 2}, 'can accept a predicate');

    var Obj = function(){};
    Obj.prototype = {a: 1, b: 2, c: 3};
    var instance = new Obj();
    assert.deepEqual(_.omit(instance, 'b'), {a: 1, c: 3}, 'include prototype props');

    assert.deepEqual(_.omit(data, function(val, key) {
      return this[key] === 3 && this === instance;
    }, instance), {a: 1, b: 2}, 'function is given context');
  }
```

#### defaults

```ts
test('defaults', function(assert) {
    var options = {zero: 0, one: 1, empty: '', nan: NaN, nothing: null};

    _.defaults(options, {zero: 1, one: 10, twenty: 20, nothing: 'str'});
    assert.equal(options.zero, 0, 'value exists');
    assert.equal(options.one, 1, 'value exists');
    assert.equal(options.twenty, 20, 'default applied');
    assert.equal(options.nothing, null, "null isn't overridden");

    _.defaults(options, {empty: 'full'}, {nan: 'nan'}, {word: 'word'}, {word: 'dog'});
    assert.equal(options.empty, '', 'value exists');
    assert.ok(_.isNaN(options.nan), "NaN isn't overridden");
    assert.equal(options.word, 'word', 'new value is added, first one wins');

    try {
      options = {};
      _.defaults(options, null, void 0, {a: 1});
    } catch (e) { /* ignored */ }

    assert.equal(options.a, 1, 'should not error on `null` or `undefined` sources');

    assert.deepEqual(_.defaults(null, {a: 1}), {a: 1}, 'defaults skips nulls');
    assert.deepEqual(_.defaults(void 0, {a: 1}), {a: 1}, 'defaults skips undefined');
  }
```

#### clone

```ts
test('clone', function(assert) {
    var moe = {name: 'moe', lucky: [13, 27, 34]};
    var clone = _.clone(moe);
    assert.equal(clone.name, 'moe', 'the clone as the attributes of the original');

    clone.name = 'curly';
    assert.ok(clone.name === 'curly' && moe.name === 'moe', 'clones can change shallow attributes without affecting the original');

    clone.lucky.push(101);
    assert.equal(_.last(moe.lucky), 101, 'changes to deep attributes are shared with the original');

    assert.equal(_.clone(void 0), void 0, 'non objects should not be changed by clone');
    assert.equal(_.clone(1), 1, 'non objects should not be changed by clone');
    assert.equal(_.clone(null), null, 'non objects should not be changed by clone');
  }
```

#### create

```ts
test('create', function(assert) {
    var Parent = function() {};
    Parent.prototype = {foo: function() {}, bar: 2};

    _.each(['foo', null, void 0, 1], function(val) {
      assert.deepEqual(_.create(val), {}, 'should return empty object when a non-object is provided');
    });

    assert.ok(_.create([]) instanceof Array, 'should return new instance of array when array is provided');

    var Child = function() {};
    Child.prototype = _.create(Parent.prototype);
    assert.ok(new Child instanceof Parent, 'object should inherit prototype');

    var func = function() {};
    Child.prototype = _.create(Parent.prototype, {func: func});
    assert.strictEqual(Child.prototype.func, func, 'properties should be added to object');

    Child.prototype = _.create(Parent.prototype, {constructor: Child});
    assert.strictEqual(Child.prototype.constructor, Child);

    Child.prototype.foo = 'foo';
    var created = _.create(Child.prototype, new Child);
    assert.notOk(created.hasOwnProperty('foo'), 'should only add own properties');
  }
```

#### isEqual

```ts
test('isEqual', function(assert) {
    function First() {
      this.value = 1;
    }
    First.prototype.value = 1;
    function Second() {
      this.value = 1;
    }
    Second.prototype.value = 2;

    // Basic equality and identity comparisons.
    assert.ok(_.isEqual(null, null), '`null` is equal to `null`');
    assert.ok(_.isEqual(), '`undefined` is equal to `undefined`');

    assert.notOk(_.isEqual(0, -0), '`0` is not equal to `-0`');
    assert.notOk(_.isEqual(-0, 0), 'Commutative equality is implemented for `0` and `-0`');
    assert.notOk(_.isEqual(null, void 0), '`null` is not equal to `undefined`');
    assert.notOk(_.isEqual(void 0, null), 'Commutative equality is implemented for `null` and `undefined`');

    // String object and primitive comparisons.
    assert.ok(_.isEqual('Curly', 'Curly'), 'Identical string primitives are equal');
    assert.ok(_.isEqual(new String('Curly'), new String('Curly')), 'String objects with identical primitive values are equal');
    assert.ok(_.isEqual(new String('Curly'), 'Curly'), 'String primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual('Curly', new String('Curly')), 'Commutative equality is implemented for string objects and primitives');

    assert.notOk(_.isEqual('Curly', 'Larry'), 'String primitives with different values are not equal');
    assert.notOk(_.isEqual(new String('Curly'), new String('Larry')), 'String objects with different primitive values are not equal');
    assert.notOk(_.isEqual(new String('Curly'), {toString: function(){ return 'Curly'; }}), 'String objects and objects with a custom `toString` method are not equal');

    // Number object and primitive comparisons.
    assert.ok(_.isEqual(75, 75), 'Identical number primitives are equal');
    assert.ok(_.isEqual(new Number(75), new Number(75)), 'Number objects with identical primitive values are equal');
    assert.ok(_.isEqual(75, new Number(75)), 'Number primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual(new Number(75), 75), 'Commutative equality is implemented for number objects and primitives');
    assert.notOk(_.isEqual(new Number(0), -0), '`new Number(0)` and `-0` are not equal');
    assert.notOk(_.isEqual(0, new Number(-0)), 'Commutative equality is implemented for `new Number(0)` and `-0`');

    assert.notOk(_.isEqual(new Number(75), new Number(63)), 'Number objects with different primitive values are not equal');
    assert.notOk(_.isEqual(new Number(63), {valueOf: function(){ return 63; }}), 'Number objects and objects with a `valueOf` method are not equal');

    // Comparisons involving `NaN`.
    assert.ok(_.isEqual(NaN, NaN), '`NaN` is equal to `NaN`');
    assert.ok(_.isEqual(new Number(NaN), NaN), 'Object(`NaN`) is equal to `NaN`');
    assert.notOk(_.isEqual(61, NaN), 'A number primitive is not equal to `NaN`');
    assert.notOk(_.isEqual(new Number(79), NaN), 'A number object is not equal to `NaN`');
    assert.notOk(_.isEqual(Infinity, NaN), '`Infinity` is not equal to `NaN`');

    // Boolean object and primitive comparisons.
    assert.ok(_.isEqual(true, true), 'Identical boolean primitives are equal');
    assert.ok(_.isEqual(new Boolean, new Boolean), 'Boolean objects with identical primitive values are equal');
    assert.ok(_.isEqual(true, new Boolean(true)), 'Boolean primitives and their corresponding object wrappers are equal');
    assert.ok(_.isEqual(new Boolean(true), true), 'Commutative equality is implemented for booleans');
    assert.notOk(_.isEqual(new Boolean(true), new Boolean), 'Boolean objects with different primitive values are not equal');

    // Common type coercions.
    assert.notOk(_.isEqual(new Boolean(false), true), '`new Boolean(false)` is not equal to `true`');
    assert.notOk(_.isEqual('75', 75), 'String and number primitives with like values are not equal');
    assert.notOk(_.isEqual(new Number(63), new String(63)), 'String and number objects with like values are not equal');
    assert.notOk(_.isEqual(75, '75'), 'Commutative equality is implemented for like string and number values');
    assert.notOk(_.isEqual(0, ''), 'Number and string primitives with like values are not equal');
    assert.notOk(_.isEqual(1, true), 'Number and boolean primitives with like values are not equal');
    assert.notOk(_.isEqual(new Boolean(false), new Number(0)), 'Boolean and number objects with like values are not equal');
    assert.notOk(_.isEqual(false, new String('')), 'Boolean primitives and string objects with like values are not equal');
    assert.notOk(_.isEqual(12564504e5, new Date(2009, 9, 25)), 'Dates and their corresponding numeric primitive values are not equal');

    // Dates.
    assert.ok(_.isEqual(new Date(2009, 9, 25), new Date(2009, 9, 25)), 'Date objects referencing identical times are equal');
    assert.notOk(_.isEqual(new Date(2009, 9, 25), new Date(2009, 11, 13)), 'Date objects referencing different times are not equal');
    assert.notOk(_.isEqual(new Date(2009, 11, 13), {
      getTime: function(){
        return 12606876e5;
      }
    }), 'Date objects and objects with a `getTime` method are not equal');
    assert.notOk(_.isEqual(new Date('Curly'), new Date('Curly')), 'Invalid dates are not equal');

    // Functions.
    assert.notOk(_.isEqual(First, Second), 'Different functions with identical bodies and source code representations are not equal');

    // RegExps.
    assert.ok(_.isEqual(/(?:)/gim, /(?:)/gim), 'RegExps with equivalent patterns and flags are equal');
    assert.ok(_.isEqual(/(?:)/gi, /(?:)/ig), 'Flag order is not significant');
    assert.notOk(_.isEqual(/(?:)/g, /(?:)/gi), 'RegExps with equivalent patterns and different flags are not equal');
    assert.notOk(_.isEqual(/Moe/gim, /Curly/gim), 'RegExps with different patterns and equivalent flags are not equal');
    assert.notOk(_.isEqual(/(?:)/gi, /(?:)/g), 'Commutative equality is implemented for RegExps');
    assert.notOk(_.isEqual(/Curly/g, {source: 'Larry', global: true, ignoreCase: false, multiline: false}), 'RegExps and RegExp-like objects are not equal');

    // Empty arrays, array-like objects, and object literals.
    assert.ok(_.isEqual({}, {}), 'Empty object literals are equal');
    assert.ok(_.isEqual([], []), 'Empty array literals are equal');
    assert.ok(_.isEqual([{}], [{}]), 'Empty nested arrays and objects are equal');
    assert.notOk(_.isEqual({length: 0}, []), 'Array-like objects and arrays are not equal.');
    assert.notOk(_.isEqual([], {length: 0}), 'Commutative equality is implemented for array-like objects');

    assert.notOk(_.isEqual({}, []), 'Object literals and array literals are not equal');
    assert.notOk(_.isEqual([], {}), 'Commutative equality is implemented for objects and arrays');

    // Arrays with primitive and object values.
    assert.ok(_.isEqual([1, 'Larry', true], [1, 'Larry', true]), 'Arrays containing identical primitives are equal');
    assert.ok(_.isEqual([/Moe/g, new Date(2009, 9, 25)], [/Moe/g, new Date(2009, 9, 25)]), 'Arrays containing equivalent elements are equal');

    // Multi-dimensional arrays.
    var a = [new Number(47), false, 'Larry', /Moe/, new Date(2009, 11, 13), ['running', 'biking', new String('programming')], {a: 47}];
    var b = [new Number(47), false, 'Larry', /Moe/, new Date(2009, 11, 13), ['running', 'biking', new String('programming')], {a: 47}];
    assert.ok(_.isEqual(a, b), 'Arrays containing nested arrays and objects are recursively compared');

    // Overwrite the methods defined in ES 5.1 section 15.4.4.
    a.forEach = a.map = a.filter = a.every = a.indexOf = a.lastIndexOf = a.some = a.reduce = a.reduceRight = null;
    b.join = b.pop = b.reverse = b.shift = b.slice = b.splice = b.concat = b.sort = b.unshift = null;

    // Array elements and properties.
    assert.ok(_.isEqual(a, b), 'Arrays containing equivalent elements and different non-numeric properties are equal');
    a.push('White Rocks');
    assert.notOk(_.isEqual(a, b), 'Arrays of different lengths are not equal');
    a.push('East Boulder');
    b.push('Gunbarrel Ranch', 'Teller Farm');
    assert.notOk(_.isEqual(a, b), 'Arrays of identical lengths containing different elements are not equal');

    // Sparse arrays.
    assert.ok(_.isEqual(Array(3), Array(3)), 'Sparse arrays of identical lengths are equal');
    assert.notOk(_.isEqual(Array(3), Array(6)), 'Sparse arrays of different lengths are not equal when both are empty');

    var sparse = [];
    sparse[1] = 5;
    assert.ok(_.isEqual(sparse, [void 0, 5]), 'Handles sparse arrays as dense');

    // Simple objects.
    assert.ok(_.isEqual({a: 'Curly', b: 1, c: true}, {a: 'Curly', b: 1, c: true}), 'Objects containing identical primitives are equal');
    assert.ok(_.isEqual({a: /Curly/g, b: new Date(2009, 11, 13)}, {a: /Curly/g, b: new Date(2009, 11, 13)}), 'Objects containing equivalent members are equal');
    assert.notOk(_.isEqual({a: 63, b: 75}, {a: 61, b: 55}), 'Objects of identical sizes with different values are not equal');
    assert.notOk(_.isEqual({a: 63, b: 75}, {a: 61, c: 55}), 'Objects of identical sizes with different property names are not equal');
    assert.notOk(_.isEqual({a: 1, b: 2}, {a: 1}), 'Objects of different sizes are not equal');
    assert.notOk(_.isEqual({a: 1}, {a: 1, b: 2}), 'Commutative equality is implemented for objects');
    assert.notOk(_.isEqual({x: 1, y: void 0}, {x: 1, z: 2}), 'Objects with identical keys and different values are not equivalent');

    // `A` contains nested objects and arrays.
    a = {
      name: new String('Moe Howard'),
      age: new Number(77),
      stooge: true,
      hobbies: ['acting'],
      film: {
        name: 'Sing a Song of Six Pants',
        release: new Date(1947, 9, 30),
        stars: [new String('Larry Fine'), 'Shemp Howard'],
        minutes: new Number(16),
        seconds: 54
      }
    };

    // `B` contains equivalent nested objects and arrays.
    b = {
      name: new String('Moe Howard'),
      age: new Number(77),
      stooge: true,
      hobbies: ['acting'],
      film: {
        name: 'Sing a Song of Six Pants',
        release: new Date(1947, 9, 30),
        stars: [new String('Larry Fine'), 'Shemp Howard'],
        minutes: new Number(16),
        seconds: 54
      }
    };
    assert.ok(_.isEqual(a, b), 'Objects with nested equivalent members are recursively compared');

    // Instances.
    assert.ok(_.isEqual(new First, new First), 'Object instances are equal');
    assert.notOk(_.isEqual(new First, new Second), 'Objects with different constructors and identical own properties are not equal');
    assert.notOk(_.isEqual({value: 1}, new First), 'Object instances and objects sharing equivalent properties are not equal');
    assert.notOk(_.isEqual({value: 2}, new Second), 'The prototype chain of objects should not be examined');

    // Circular Arrays.
    (a = []).push(a);
    (b = []).push(b);
    assert.ok(_.isEqual(a, b), 'Arrays containing circular references are equal');
    a.push(new String('Larry'));
    b.push(new String('Larry'));
    assert.ok(_.isEqual(a, b), 'Arrays containing circular references and equivalent properties are equal');
    a.push('Shemp');
    b.push('Curly');
    assert.notOk(_.isEqual(a, b), 'Arrays containing circular references and different properties are not equal');

    // More circular arrays #767.
    a = ['everything is checked but', 'this', 'is not'];
    a[1] = a;
    b = ['everything is checked but', ['this', 'array'], 'is not'];
    assert.notOk(_.isEqual(a, b), 'Comparison of circular references with non-circular references are not equal');

    // Circular Objects.
    a = {abc: null};
    b = {abc: null};
    a.abc = a;
    b.abc = b;
    assert.ok(_.isEqual(a, b), 'Objects containing circular references are equal');
    a.def = 75;
    b.def = 75;
    assert.ok(_.isEqual(a, b), 'Objects containing circular references and equivalent properties are equal');
    a.def = new Number(75);
    b.def = new Number(63);
    assert.notOk(_.isEqual(a, b), 'Objects containing circular references and different properties are not equal');

    // More circular objects #767.
    a = {everything: 'is checked', but: 'this', is: 'not'};
    a.but = a;
    b = {everything: 'is checked', but: {that: 'object'}, is: 'not'};
    assert.notOk(_.isEqual(a, b), 'Comparison of circular references with non-circular object references are not equal');

    // Cyclic Structures.
    a = [{abc: null}];
    b = [{abc: null}];
    (a[0].abc = a).push(a);
    (b[0].abc = b).push(b);
    assert.ok(_.isEqual(a, b), 'Cyclic structures are equal');
    a[0].def = 'Larry';
    b[0].def = 'Larry';
    assert.ok(_.isEqual(a, b), 'Cyclic structures containing equivalent properties are equal');
    a[0].def = new String('Larry');
    b[0].def = new String('Curly');
    assert.notOk(_.isEqual(a, b), 'Cyclic structures containing different properties are not equal');

    // Complex Circular References.
    a = {foo: {b: {foo: {c: {foo: null}}}}};
    b = {foo: {b: {foo: {c: {foo: null}}}}};
    a.foo.b.foo.c.foo = a;
    b.foo.b.foo.c.foo = b;
    assert.ok(_.isEqual(a, b), 'Cyclic structures with nested and identically-named properties are equal');

    // Chaining.
    assert.notOk(_.isEqual(_({x: 1, y: void 0}).chain(), _({x: 1, z: 2}).chain()), 'Chained objects containing different values are not equal');

    a = _({x: 1, y: 2}).chain();
    b = _({x: 1, y: 2}).chain();
    assert.equal(_.isEqual(a.isEqual(b), _(true)), true, '`isEqual` can be chained');

    // Objects without a `constructor` property
    if (Object.create) {
      a = Object.create(null, {x: {value: 1, enumerable: true}});
      b = {x: 1};
      assert.ok(_.isEqual(a, b), 'Handles objects without a constructor (e.g. from Object.create');
    }

    function Foo() { this.a = 1; }
    Foo.prototype.constructor = null;

    var other = {a: 1};
    assert.strictEqual(_.isEqual(new Foo, other), false, 'Objects from different constructors are not equal');


    // Tricky object cases val comparisions
    assert.equal(_.isEqual([0], [-0]), false);
    assert.equal(_.isEqual({a: 0}, {a: -0}), false);
    assert.equal(_.isEqual([NaN], [NaN]), true);
    assert.equal(_.isEqual({a: NaN}, {a: NaN}), true);

    if (typeof Symbol !== 'undefined') {
      var symbol = Symbol('x');
      assert.strictEqual(_.isEqual(symbol, symbol), true, 'A symbol is equal to itself');
      assert.strictEqual(_.isEqual(symbol, Object(symbol)), true, 'Even when wrapped in Object()');
      assert.strictEqual(_.isEqual(symbol, null), false, 'Different types are not equal');
    }

  }
```

#### isObject

```ts
test('isObject', function(assert) {
    assert.ok(_.isObject(arguments), 'the arguments object is object');
    assert.ok(_.isObject([1, 2, 3]), 'and arrays');
    if (testElement) {
      assert.ok(_.isObject(testElement), 'and DOM element');
    }
    assert.ok(_.isObject(function() {}), 'and functions');
    assert.notOk(_.isObject(null), 'but not null');
    assert.notOk(_.isObject(void 0), 'and not undefined');
    assert.notOk(_.isObject('string'), 'and not string');
    assert.notOk(_.isObject(12), 'and not number');
    assert.notOk(_.isObject(true), 'and not boolean');
    assert.ok(_.isObject(new String('string')), 'but new String()');
  }
```

#### isArray

```ts
test('isArray', function(assert) {
    assert.notOk(_.isArray(void 0), 'undefined vars are not arrays');
    assert.notOk(_.isArray(arguments), 'the arguments object is not an array');
    assert.ok(_.isArray([1, 2, 3]), 'but arrays are');
  }
```

#### isNumber

```ts
test('isNumber', function(assert) {
    assert.notOk(_.isNumber('string'), 'a string is not a number');
    assert.notOk(_.isNumber(arguments), 'the arguments object is not a number');
    assert.notOk(_.isNumber(void 0), 'undefined is not a number');
    assert.ok(_.isNumber(3 * 4 - 7 / 10), 'but numbers are');
    assert.ok(_.isNumber(NaN), 'NaN *is* a number');
    assert.ok(_.isNumber(Infinity), 'Infinity is a number');
    assert.notOk(_.isNumber('1'), 'numeric strings are not numbers');
  }
```

#### isBoolean

```ts
test('isBoolean', function(assert) {
    assert.notOk(_.isBoolean(2), 'a number is not a boolean');
    assert.notOk(_.isBoolean('string'), 'a string is not a boolean');
    assert.notOk(_.isBoolean('false'), 'the string "false" is not a boolean');
    assert.notOk(_.isBoolean('true'), 'the string "true" is not a boolean');
    assert.notOk(_.isBoolean(arguments), 'the arguments object is not a boolean');
    assert.notOk(_.isBoolean(void 0), 'undefined is not a boolean');
    assert.notOk(_.isBoolean(NaN), 'NaN is not a boolean');
    assert.notOk(_.isBoolean(null), 'null is not a boolean');
    assert.ok(_.isBoolean(true), 'but true is');
    assert.ok(_.isBoolean(false), 'and so is false');
  }
```

#### isMap

```ts
test('isMap', function(assert) {
    assert.notOk(_.isMap('string'), 'a string is not a map');
    assert.notOk(_.isMap(2), 'a number is not a map');
    assert.notOk(_.isMap({}), 'an object is not a map');
    assert.notOk(_.isMap(false), 'a boolean is not a map');
    assert.notOk(_.isMap(void 0), 'undefined is not a map');
    assert.notOk(_.isMap([1, 2, 3]), 'an array is not a map');
    if (typeof Set === 'function') {
      assert.notOk(_.isMap(new Set()), 'a set is not a map');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isMap(new WeakSet()), 'a weakset is not a map');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isMap(new WeakMap()), 'a weakmap is not a map');
    }
    if (typeof Map === 'function') {
      var keyString = 'a string';
      var obj = new Map();
      obj.set(keyString, 'value');
      assert.ok(_.isMap(obj), 'but a map is');
    }
  }
```

#### isWeakMap

```ts
test('isWeakMap', function(assert) {
    assert.notOk(_.isWeakMap('string'), 'a string is not a weakmap');
    assert.notOk(_.isWeakMap(2), 'a number is not a weakmap');
    assert.notOk(_.isWeakMap({}), 'an object is not a weakmap');
    assert.notOk(_.isWeakMap(false), 'a boolean is not a weakmap');
    assert.notOk(_.isWeakMap(void 0), 'undefined is not a weakmap');
    assert.notOk(_.isWeakMap([1, 2, 3]), 'an array is not a weakmap');
    if (typeof Set === 'function') {
      assert.notOk(_.isWeakMap(new Set()), 'a set is not a weakmap');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isWeakMap(new WeakSet()), 'a weakset is not a weakmap');
    }
    if (typeof Map === 'function') {
      assert.notOk(_.isWeakMap(new Map()), 'a map is not a weakmap');
    }
    if (typeof WeakMap === 'function') {
      var keyObj = {}, obj = new WeakMap();
      obj.set(keyObj, 'value');
      assert.ok(_.isWeakMap(obj), 'but a weakmap is');
    }
  }
```

#### isSet

```ts
test('isSet', function(assert) {
    assert.notOk(_.isSet('string'), 'a string is not a set');
    assert.notOk(_.isSet(2), 'a number is not a set');
    assert.notOk(_.isSet({}), 'an object is not a set');
    assert.notOk(_.isSet(false), 'a boolean is not a set');
    assert.notOk(_.isSet(void 0), 'undefined is not a set');
    assert.notOk(_.isSet([1, 2, 3]), 'an array is not a set');
    if (typeof Map === 'function') {
      assert.notOk(_.isSet(new Map()), 'a map is not a set');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isSet(new WeakMap()), 'a weakmap is not a set');
    }
    if (typeof WeakSet === 'function') {
      assert.notOk(_.isSet(new WeakSet()), 'a weakset is not a set');
    }
    if (typeof Set === 'function') {
      var obj = new Set();
      obj.add(1).add('string').add(false).add({});
      assert.ok(_.isSet(obj), 'but a set is');
    }
  }
```

#### isWeakSet

```ts
test('isWeakSet', function(assert) {

    assert.notOk(_.isWeakSet('string'), 'a string is not a weakset');
    assert.notOk(_.isWeakSet(2), 'a number is not a weakset');
    assert.notOk(_.isWeakSet({}), 'an object is not a weakset');
    assert.notOk(_.isWeakSet(false), 'a boolean is not a weakset');
    assert.notOk(_.isWeakSet(void 0), 'undefined is not a weakset');
    assert.notOk(_.isWeakSet([1, 2, 3]), 'an array is not a weakset');
    if (typeof Map === 'function') {
      assert.notOk(_.isWeakSet(new Map()), 'a map is not a weakset');
    }
    if (typeof WeakMap === 'function') {
      assert.notOk(_.isWeakSet(new WeakMap()), 'a weakmap is not a weakset');
    }
    if (typeof Set === 'function') {
      assert.notOk(_.isWeakSet(new Set()), 'a set is not a weakset');
    }
    if (typeof WeakSet === 'function') {
      var obj = new WeakSet();
      obj.add({x: 1}, {y: 'string'}).add({y: 'string'}).add({z: [1, 2, 3]});
      assert.ok(_.isWeakSet(obj), 'but a weakset is');
    }
  }
```

#### isFunction

```ts
test('isFunction', function(assert) {
    assert.notOk(_.isFunction(void 0), 'undefined vars are not functions');
    assert.notOk(_.isFunction([1, 2, 3]), 'arrays are not functions');
    assert.notOk(_.isFunction('moe'), 'strings are not functions');
    assert.ok(_.isFunction(_.isFunction), 'but functions are');
    assert.ok(_.isFunction(function(){}), 'even anonymous ones');

    if (testElement) {
      assert.notOk(_.isFunction(testElement), 'elements are not functions');
    }

    var nodelist = typeof document != 'undefined' && document.childNodes;
    if (nodelist) {
      assert.notOk(_.isFunction(nodelist));
    }
  }
```

#### isRegExp

```ts
test('isRegExp', function(assert) {
    assert.notOk(_.isRegExp(_.identity), 'functions are not RegExps');
    assert.ok(_.isRegExp(/identity/), 'but RegExps are');
  }
```

#### isFinite

```ts
test('isFinite', function(assert) {
    assert.notOk(_.isFinite(void 0), 'undefined is not finite');
    assert.notOk(_.isFinite(null), 'null is not finite');
    assert.notOk(_.isFinite(NaN), 'NaN is not finite');
    assert.notOk(_.isFinite(Infinity), 'Infinity is not finite');
    assert.notOk(_.isFinite(-Infinity), '-Infinity is not finite');
    assert.ok(_.isFinite('12'), 'Numeric strings are numbers');
    assert.notOk(_.isFinite('1a'), 'Non numeric strings are not numbers');
    assert.notOk(_.isFinite(''), 'Empty strings are not numbers');
    var obj = new Number(5);
    assert.ok(_.isFinite(obj), 'Number instances can be finite');
    assert.ok(_.isFinite(0), '0 is finite');
    assert.ok(_.isFinite(123), 'Ints are finite');
    assert.ok(_.isFinite(-12.44), 'Floats are finite');
    if (typeof Symbol === 'function') {
      assert.notOk(_.isFinite(Symbol()), 'symbols are not numbers');
      assert.notOk(_.isFinite(Symbol('description')), 'described symbols are not numbers');
      assert.notOk(_.isFinite(Object(Symbol())), 'boxed symbols are not numbers');
    }
  }
```

#### isNaN

```ts
test('isNaN', function(assert) {
    assert.notOk(_.isNaN(void 0), 'undefined is not NaN');
    assert.notOk(_.isNaN(null), 'null is not NaN');
    assert.notOk(_.isNaN(0), '0 is not NaN');
    assert.notOk(_.isNaN(new Number(0)), 'wrapped 0 is not NaN');
    assert.ok(_.isNaN(NaN), 'but NaN is');
    assert.ok(_.isNaN(new Number(NaN)), 'wrapped NaN is still NaN');
    if (typeof Symbol !== 'undefined'){
      assert.notOk(_.isNaN(Symbol()), 'symbol is not NaN');
    }
  }
```

#### isNull

```ts
test('isNull', function(assert) {
    assert.notOk(_.isNull(void 0), 'undefined is not null');
    assert.notOk(_.isNull(NaN), 'NaN is not null');
    assert.ok(_.isNull(null), 'but null is');
  }
```

#### isUndefined

```ts
test('isUndefined', function(assert) {
    assert.notOk(_.isUndefined(1), 'numbers are defined');
    assert.notOk(_.isUndefined(null), 'null is defined');
    assert.notOk(_.isUndefined(false), 'false is defined');
    assert.notOk(_.isUndefined(NaN), 'NaN is defined');
    assert.ok(_.isUndefined(), 'nothing is undefined');
    assert.ok(_.isUndefined(void 0), 'undefined is undefined');
  }
```

#### has

```ts
test('has', function(assert) {
    var obj = {foo: 'bar', func: function(){}};
    assert.ok(_.has(obj, 'foo'), 'has() checks that the object has a property.');
    assert.notOk(_.has(obj, 'baz'), "has() returns false if the object doesn't have the property.");
    assert.ok(_.has(obj, 'func'), 'has() works for functions too.');
    obj.hasOwnProperty = null;
    assert.ok(_.has(obj, 'foo'), 'has() works even when the hasOwnProperty method is deleted.');
    var child = {};
    child.prototype = obj;
    assert.notOk(_.has(child, 'foo'), 'has() does not check the prototype chain for a property.');
    assert.strictEqual(_.has(null, 'foo'), false, 'has() returns false for null');
    assert.strictEqual(_.has(void 0, 'foo'), false, 'has() returns false for undefined');
  }
```

#### isMatch

```ts
test('isMatch', function(assert) {
    var moe = {name: 'Moe Howard', hair: true};
    var curly = {name: 'Curly Howard', hair: false};

    assert.equal(_.isMatch(moe, {hair: true}), true, 'Returns a boolean');
    assert.equal(_.isMatch(curly, {hair: true}), false, 'Returns a boolean');

    assert.equal(_.isMatch(5, {__x__: void 0}), false, 'can match undefined props on primitives');
    assert.equal(_.isMatch({__x__: void 0}, {__x__: void 0}), true, 'can match undefined props');

    assert.equal(_.isMatch(null, {}), true, 'Empty spec called with null object returns true');
    assert.equal(_.isMatch(null, {a: 1}), false, 'Non-empty spec called with null object returns false');

    _.each([null, void 0], function(item) { assert.strictEqual(_.isMatch(item, null), true, 'null matches null'); });
    _.each([null, void 0], function(item) { assert.strictEqual(_.isMatch(item, null), true, 'null matches {}'); });
    assert.strictEqual(_.isMatch({b: 1}, {a: void 0}), false, 'handles undefined values (1683)');

    _.each([true, 5, NaN, null, void 0], function(item) {
      assert.strictEqual(_.isMatch({a: 1}, item), true, 'treats primitives as empty');
    });

    function Prototest() {}
    Prototest.prototype.x = 1;
    var specObj = new Prototest;
    assert.equal(_.isMatch({x: 2}, specObj), true, 'spec is restricted to own properties');

    specObj.y = 5;
    assert.equal(_.isMatch({x: 1, y: 5}, specObj), true);
    assert.equal(_.isMatch({x: 1, y: 4}, specObj), false);

    assert.ok(_.isMatch(specObj, {x: 1, y: 5}), 'inherited and own properties are checked on the test object');

    Prototest.x = 5;
    assert.ok(_.isMatch({x: 5, y: 1}, Prototest), 'spec can be a function');

    //null edge cases
    var oCon = {constructor: Object};
    assert.deepEqual(_.map([null, void 0, 5, {}], _.partial(_.isMatch, _, oCon)), [false, false, false, true], 'doesnt falsey match constructor on undefined/null');
  }
```

#### matcher

```ts
test('matcher', function(assert) {
    var moe = {name: 'Moe Howard', hair: true};
    var curly = {name: 'Curly Howard', hair: false};
    var stooges = [moe, curly];

    assert.equal(_.matcher({hair: true})(moe), true, 'Returns a boolean');
    assert.equal(_.matcher({hair: true})(curly), false, 'Returns a boolean');

    assert.equal(_.matcher({__x__: void 0})(5), false, 'can match undefined props on primitives');
    assert.equal(_.matcher({__x__: void 0})({__x__: void 0}), true, 'can match undefined props');

    assert.equal(_.matcher({})(null), true, 'Empty spec called with null object returns true');
    assert.equal(_.matcher({a: 1})(null), false, 'Non-empty spec called with null object returns false');

    assert.strictEqual(_.find(stooges, _.matcher({hair: false})), curly, 'returns a predicate that can be used by finding functions.');
    assert.strictEqual(_.find(stooges, _.matcher(moe)), moe, 'can be used to locate an object exists in a collection.');
    assert.deepEqual(_.filter([null, void 0], _.matcher({a: 1})), [], 'Do not throw on null values.');

    assert.deepEqual(_.filter([null, void 0], _.matcher(null)), [null, void 0], 'null matches null');
    assert.deepEqual(_.filter([null, void 0], _.matcher({})), [null, void 0], 'null matches {}');
    assert.deepEqual(_.filter([{b: 1}], _.matcher({a: void 0})), [], 'handles undefined values (1683)');

    _.each([true, 5, NaN, null, void 0], function(item) {
      assert.equal(_.matcher(item)({a: 1}), true, 'treats primitives as empty');
    });

    function Prototest() {}
    Prototest.prototype.x = 1;
    var specObj = new Prototest;
    var protospec = _.matcher(specObj);
    assert.equal(protospec({x: 2}), true, 'spec is restricted to own properties');

    specObj.y = 5;
    protospec = _.matcher(specObj);
    assert.equal(protospec({x: 1, y: 5}), true);
    assert.equal(protospec({x: 1, y: 4}), false);

    assert.ok(_.matcher({x: 1, y: 5})(specObj), 'inherited and own properties are checked on the test object');

    Prototest.x = 5;
    assert.ok(_.matcher(Prototest)({x: 5, y: 1}), 'spec can be a function');

    // #1729
    var o = {b: 1};
    var m = _.matcher(o);

    assert.equal(m({b: 1}), true);
    o.b = 2;
    o.a = 1;
    assert.equal(m({b: 1}), true, 'changing spec object doesnt change matches result');


    //null edge cases
    var oCon = _.matcher({constructor: Object});
    assert.deepEqual(_.map([null, void 0, 5, {}], oCon), [false, false, false, true], 'doesnt falsey match constructor on undefined/null');
  }
```

#### findKey

```ts
test('findKey', function(assert) {
    var objects = {
      a: {a: 0, b: 0},
      b: {a: 1, b: 1},
      c: {a: 2, b: 2}
    };

    assert.equal(_.findKey(objects, function(obj) {
      return obj.a === 0;
    }), 'a');

    assert.equal(_.findKey(objects, function(obj) {
      return obj.b * obj.a === 4;
    }), 'c');

    assert.equal(_.findKey(objects, 'a'), 'b', 'Uses lookupIterator');

    assert.equal(_.findKey(objects, function(obj) {
      return obj.b * obj.a === 5;
    }), void 0);

    assert.strictEqual(_.findKey([1, 2, 3, 4, 5, 6], function(obj) {
      return obj === 3;
    }), '2', 'Keys are strings');

    assert.strictEqual(_.findKey(objects, function(a) {
      return a.foo === null;
    }), void 0);

    _.findKey({a: {a: 1}}, function(a, key, obj) {
      assert.equal(key, 'a');
      assert.deepEqual(obj, {a: {a: 1}});
      assert.strictEqual(this, objects, 'called with context');
    }, objects);

    var array = [1, 2, 3, 4];
    array.match = 55;
    assert.strictEqual(_.findKey(array, function(x) { return x === 55; }), 'match', 'matches array-likes keys');
  }
```

#### mapObject

```ts
test('mapObject', function(assert) {
    var obj = {a: 1, b: 2};
    var objects = {
      a: {a: 0, b: 0},
      b: {a: 1, b: 1},
      c: {a: 2, b: 2}
    };

    assert.deepEqual(_.mapObject(obj, function(val) {
      return val * 2;
    }), {a: 2, b: 4}, 'simple objects');

    assert.deepEqual(_.mapObject(objects, function(val) {
      return _.reduce(val, function(memo, v){
        return memo + v;
      }, 0);
    }), {a: 0, b: 2, c: 4}, 'nested objects');

    assert.deepEqual(_.mapObject(obj, function(val, key, o) {
      return o[key] * 2;
    }), {a: 2, b: 4}, 'correct keys');

    assert.deepEqual(_.mapObject([1, 2], function(val) {
      return val * 2;
    }), {0: 2, 1: 4}, 'check behavior for arrays');

    assert.deepEqual(_.mapObject(obj, function(val) {
      return val * this.multiplier;
    }, {multiplier: 3}), {a: 3, b: 6}, 'keep context');

    assert.deepEqual(_.mapObject({a: 1}, function() {
      return this.length;
    }, [1, 2]), {a: 2}, 'called with context');

    var ids = _.mapObject({length: 2, 0: {id: '1'}, 1: {id: '2'}}, function(n){
      return n.id;
    });
    assert.deepEqual(ids, {length: void 0, 0: '1', 1: '2'}, 'Check with array-like objects');

    // Passing a property name like _.pluck.
    var people = {a: {name: 'moe', age: 30}, b: {name: 'curly', age: 50}};
    assert.deepEqual(_.mapObject(people, 'name'), {a: 'moe', b: 'curly'}, 'predicate string map to object properties');

    _.each([null, void 0, 1, 'abc', [], {}, void 0], function(val){
      assert.deepEqual(_.mapObject(val, _.identity), {}, 'mapValue identity');
    });

    var Proto = function(){ this.a = 1; };
    Proto.prototype.b = 1;
    var protoObj = new Proto();
    assert.deepEqual(_.mapObject(protoObj, _.identity), {a: 1}, 'ignore inherited values from prototypes');

  }
```

## @/utils/comment-note

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

