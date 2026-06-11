# External tests for history.ts

**Arquivo:** `packages/app/src/components/prompt-input/history.ts`

## Checklist

- [ ] @/context/prompt
- [ ] @/context/file

## @/context/prompt

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/file

**Consultas usadas no Horsebox:** `SelectedLineRange`, `@/context/file SelectedLineRange`, `/context/file SelectedLineRange`, `file SelectedLineRange`

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

