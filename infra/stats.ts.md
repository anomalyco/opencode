# External tests for stats.ts

**Arquivo:** `infra/stats.ts`

## Checklist

- [ ] ./lake
- [ ] ./app
- [ ] ./stage

## ./lake

**Consultas usadas no Horsebox:** `arn`, `./lake arn`, `lake arn`, `name`, `./lake name`, `lake name`, `lakeAthenaWorkgroup`, `./lake lakeAthenaWorkgroup`, `lake lakeAthenaWorkgroup`, `lakeCatalog`, `./lake lakeCatalog`, `lake lakeCatalog`, `lakeCluster`, `./lake lakeCluster`, `lake lakeCluster`, `lakeQueryPermissions`, `./lake lakeQueryPermissions`, `lake lakeQueryPermissions`, `lakeRegion`, `./lake lakeRegion`, `lake lakeRegion`, `tableBucket`, `./lake tableBucket`, `lake tableBucket`

**Arquivos de teste encontrados:** 41

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

#### should throw on invalid date

```ts
it('should throw on invalid date', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { expires: new Date(NaN) })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option expires is invalid/, done)
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

#### should set max-age

```ts
it('should set max-age', function(done){
        var app = express();

        app.use(function(req, res){
          res.cookie('name', 'tobi', { maxAge: 1000 });
          res.end();
        });

        request(app)
        .get('/')
        .expect('Set-Cookie', /Max-Age=1/, done)
      }
```

#### should not mutate the options object

```ts
it('should not mutate the options object', function(done){
        var app = express();

        var options = { maxAge: 1000 };
        var optionsCopy = { ...options };

        app.use(function(req, res){
          res.cookie('name', 'tobi', options)
          res.json(options)
        });

        request(app)
        .get('/')
        .expect(200, optionsCopy, done)
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

#### should throw an error with invalid maxAge

```ts
it('should throw an error with invalid maxAge', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { maxAge: 'foobar' })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option maxAge is invalid/, done)
      }
```

#### should set low priority

```ts
it('should set low priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'low' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=Low/)
          .expect(200, done)
      }
```

#### should set medium priority

```ts
it('should set medium priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'medium' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=Medium/)
          .expect(200, done)
      }
```

#### should set high priority

```ts
it('should set high priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'high' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=High/)
          .expect(200, done)
      }
```

#### should throw with invalid priority

```ts
it('should throw with invalid priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'foobar' })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option priority is invalid/, done)
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

#### should throw an error

```ts
it('should throw an error', function(done){
        var app = express();

        app.use(cookieParser());

        app.use(function(req, res){
          res.cookie('name', 'tobi', { signed: true }).end();
        });

        request(app)
        .get('/')
        .expect(500, /secret\S+ required for signed cookies/, done);
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

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/resource.js

#### should respond with all users

```ts
it('should respond with all users', function(done){
      request(app)
        .get('/users')
        .expect(/^\[{"name":"tj"},{"name":"ciaran"},{"name":"aaron"},{"name":"guillermo"},{"name":"simon"},{"name":"tobi"}\]/,done)
    }
```

#### should respond with user 1

```ts
it('should respond with user 1', function(done){
      request(app)
        .get('/users/1')
        .expect(/^{"name":"ciaran"}/,done)
    }
```

#### should respond with users 2 and 3 as json

```ts
it('should respond with users 2 and 3 as json', function(done){
      request(app)
        .get('/users/1..3.json')
        .expect(/^\[null,{"name":"aaron"},{"name":"guillermo"}\]/,done)
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

#### partial

```ts
test('partial', function(assert) {
    var obj = {name: 'moe'};
    var func = function() { return this.name + ' ' + _.toArray(arguments).join(' '); };

    obj.func = _.partial(func, 'a', 'b');
    assert.equal(obj.func('c', 'd'), 'moe a b c d', 'can partially apply');

    obj.func = _.partial(func, _, 'b', _, 'd');
    assert.equal(obj.func('a', 'c'), 'moe a b c d', 'can partially apply with placeholders');

    func = _.partial(function() { return arguments.length; }, _, 'b', _, 'd');
    assert.equal(func('a', 'c', 'e'), 5, 'accepts more arguments than the number of placeholders');
    assert.equal(func('a'), 4, 'accepts fewer arguments than the number of placeholders');

    func = _.partial(function() { return typeof arguments[2]; }, _, 'b', _, 'd');
    assert.equal(func('a'), 'undefined', 'unfilled placeholders are undefined');

    // passes context
    function MyWidget(name, options) {
      this.name = name;
      this.options = options;
    }
    MyWidget.prototype.get = function() {
      return this.name;
    };
    var MyWidgetWithCoolOpts = _.partial(MyWidget, _, {a: 1});
    var widget = new MyWidgetWithCoolOpts('foo');
    assert.ok(widget instanceof MyWidget, 'Can partially bind a constructor');
    assert.equal(widget.get(), 'foo', 'keeps prototype');
    assert.deepEqual(widget.options, {a: 1});

    _.partial.placeholder = obj;
    func = _.partial(function() { return arguments.length; }, obj, 'b', obj, 'd');
    assert.equal(func('a'), 4, 'allows the placeholder to be swapped out');

    _.partial.placeholder = {};
    func = _.partial(function() { return arguments.length; }, obj, 'b', obj, 'd');
    assert.equal(func('a'), 5, 'swapping the placeholder preserves previously bound arguments');

    _.partial.placeholder = _;
  }
```

#### bindAll

```ts
test('bindAll', function(assert) {
    var curly = {name: 'curly'};
    var moe = {
      name: 'moe',
      getName: function() { return 'name: ' + this.name; },
      sayHi: function() { return 'hi: ' + this.name; }
    };
    curly.getName = moe.getName;
    _.bindAll(moe, 'getName', 'sayHi');
    curly.sayHi = moe.sayHi;
    assert.equal(curly.getName(), 'name: curly', 'unbound function is bound to current object');
    assert.equal(curly.sayHi(), 'hi: moe', 'bound function is still bound to original object');

    curly = {name: 'curly'};
    moe = {
      name: 'moe',
      getName: function() { return 'name: ' + this.name; },
      sayHi: function() { return 'hi: ' + this.name; },
      sayLast: function() { return this.sayHi(_.last(arguments)); }
    };

    assert.raises(function() { _.bindAll(moe); }, Error, 'throws an error for bindAll with no functions named');
    assert.raises(function() { _.bindAll(moe, 'sayBye'); }, TypeError, 'throws an error for bindAll if the given key is undefined');
    assert.raises(function() { _.bindAll(moe, 'name'); }, TypeError, 'throws an error for bindAll if the given key is not a function');

    _.bindAll(moe, 'sayHi', 'sayLast');
    curly.sayHi = moe.sayHi;
    assert.equal(curly.sayHi(), 'hi: moe');

    var sayLast = moe.sayLast;
    assert.equal(sayLast(1, 2, 3, 4, 5, 6, 7, 'Tom'), 'hi: moe', 'createCallback works with any number of arguments');

    _.bindAll(moe, ['getName']);
    var getName = moe.getName;
    assert.equal(getName(), 'name: moe', 'flattens arguments into a single list');
  }
```

#### wrap

```ts
test('wrap', function(assert) {
    var greet = function(name){ return 'hi: ' + name; };
    var backwards = _.wrap(greet, function(func, name){ return func(name) + ' ' + name.split('').reverse().join(''); });
    assert.equal(backwards('moe'), 'hi: moe eom', 'wrapped the salutation function');

    var inner = function(){ return 'Hello '; };
    var obj = {name: 'Moe'};
    obj.hi = _.wrap(inner, function(fn){ return fn() + this.name; });
    assert.equal(obj.hi(), 'Hello Moe');

    var noop = function(){};
    var wrapped = _.wrap(noop, function(){ return Array.prototype.slice.call(arguments, 0); });
    var ret = wrapped(['whats', 'your'], 'vector', 'victor');
    assert.deepEqual(ret, [noop, ['whats', 'your'], 'vector', 'victor']);
  }
```

#### compose

```ts
test('compose', function(assert) {
    var greet = function(name){ return 'hi: ' + name; };
    var exclaim = function(sentence){ return sentence + '!'; };
    var composed = _.compose(exclaim, greet);
    assert.equal(composed('moe'), 'hi: moe!', 'can compose a function that takes another');

    composed = _.compose(greet, exclaim);
    assert.equal(composed('moe'), 'hi: moe!', 'in this case, the functions are also commutative');

    // f(g(h(x, y, z)))
    function h(x, y, z) {
      assert.equal(arguments.length, 3, 'First function called with multiple args');
      return z * y;
    }
    function g(x) {
      assert.equal(arguments.length, 1, 'Composed function is called with 1 argument');
      return x;
    }
    function f(x) {
      assert.equal(arguments.length, 1, 'Composed function is called with 1 argument');
      return x * 2;
    }
    composed = _.compose(f, g, h);
    assert.equal(composed(1, 2, 3), 12);
  }
```

#### restArgs

```ts
test('restArgs', function(assert) {
    assert.expect(10);
    _.restArgs(function(a, args) {
      assert.strictEqual(a, 1);
      assert.deepEqual(args, [2, 3], 'collects rest arguments into an array');
    })(1, 2, 3);

    _.restArgs(function(a, args) {
      assert.strictEqual(a, void 0);
      assert.deepEqual(args, [], 'passes empty array if there are not enough arguments');
    })();

    _.restArgs(function(a, b, c, args) {
      assert.strictEqual(arguments.length, 4);
      assert.deepEqual(args, [4, 5], 'works on functions with many named parameters');
    })(1, 2, 3, 4, 5);

    var obj = {};
    _.restArgs(function() {
      assert.strictEqual(this, obj, 'invokes function with this context');
    }).call(obj);

    _.restArgs(function(array, iteratee, context) {
      assert.deepEqual(array, [1, 2, 3, 4], 'startIndex can be used manually specify index of rest parameter');
      assert.strictEqual(iteratee, void 0);
      assert.strictEqual(context, void 0);
    }, 0)(1, 2, 3, 4);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/content-negotiation.js

#### should accept to application/json

```ts
it('should accept to application/json', function(done){
      request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect(200, '[{"name":"Tobi"},{"name":"Loki"},{"name":"Jane"}]', done)
    }
```

#### should accept to application/json

```ts
it('should accept to application/json', function(done){
      request(app)
      .get('/users')
      .set('Accept', 'application/json')
      .expect(200, '[{"name":"Tobi"},{"name":"Loki"},{"name":"Jane"}]', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.param.js

#### should work with encoded values

```ts
it('should work with encoded values', function(done){
      var app = express();

      app.param('name', function(req, res, next, name){
        req.params.name = name;
        next();
      });

      app.get('/user/:name', function(req, res){
        var name = req.params.name;
        res.send('' + name);
      });

      request(app)
      .get('/user/foo%25bar')
      .expect('foo%bar', done);
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

### ../../.sbomtest/repos/f3c62de455-express/test/res.sendFile.js

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

#### should pass options to send module

```ts
it('should pass options to send module', function (done) {
      request(createApp(path.resolve(fixtures, 'name.txt'), { start: 0, end: 1 }))
      .get('/')
      .expect(200, 'to', done)
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.router.js

#### should decode correct params

```ts
it('should decode correct params', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/foo%2Fbar')
        .expect('foo/bar', done);
    }
```

#### should not accept params in malformed paths

```ts
it('should not accept params in malformed paths', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/%foobar')
        .expect(400, done);
    }
```

#### should not decode spaces

```ts
it('should not decode spaces', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/foo+bar')
        .expect('foo+bar', done);
    }
```

#### should work with unicode

```ts
it('should work with unicode', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/%ce%b1')
        .expect('\u03b1', done);
    }
```

#### should match the pathname only

```ts
it('should match the pathname only', function (done) {
      var app = express();

      app.get(/^\/user\/[0-9]+$/, function (req, res) {
        res.end('user');
      });

      request(app)
        .get('/user/12?foo=bar')
        .expect('user', done);
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

#### should denote a format

```ts
it('should denote a format', function (done) {
      var app = express();
      var cb = after(2, done)

      app.get('/:name.:format', function (req, res) {
        res.end(req.params.name + ' as ' + req.params.format);
      });

      request(app)
        .get('/foo.json')
        .expect(200, 'foo as json', cb)

      request(app)
        .get('/foo')
        .expect(404, cb)
    }
```

#### should denote an optional format

```ts
it('should denote an optional format', function (done) {
      var app = express();
      var cb = after(2, done)

      app.get('/:name{.:format}', function (req, res) {
        res.end(req.params.name + ' as ' + (req.params.format || 'html'));
      });

      request(app)
        .get('/foo')
        .expect(200, 'foo as html', cb)

      request(app)
        .get('/foo.json')
        .expect(200, 'foo as json', cb)
    }
```

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
      var app = express()
      var router = new express.Router()

      router.use(function createError(req, res, next) {
        return Promise.reject(new Error('boom!'))
      })

      router.use(function sawError(err, req, res, next) {
        res.send('saw ' + err.name + ': ' + err.message)
      })

      app.use(router)

      request(app)
        .get('/')
        .expect(200, 'saw Error: boom!', done)
    }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
      var app = express()
      var router = new express.Router()

      router.use(function createError(req, res, next) {
        return Promise.reject()
      })

      router.use(function sawError(err, req, res, next) {
        res.send('saw ' + err.name + ': ' + err.message)
      })

      app.use(router)

      request(app)
        .get('/')
        .expect(200, 'saw Error: Rejected promise', done)
    }
```

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
        var app = express()
        var router = new express.Router()

        router.use(function createError(req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error('caught: ' + err.message))
        })

        router.use(function sawError(err, req, res, next) {
          res.send('saw ' + err.name + ': ' + err.message)
        })

        app.use(router)

        request(app)
          .get('/')
          .expect(200, 'saw Error: caught: boom!', done)
      }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
        var app = express()
        var router = new express.Router()

        router.use(function createError(req, res, next) {
          return Promise.reject()
        })

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error('caught: ' + err.message))
        })

        router.use(function sawError(err, req, res, next) {
          res.send('saw ' + err.name + ': ' + err.message)
        })

        app.use(router)

        request(app)
          .get('/')
          .expect(200, 'saw Error: caught: Rejected promise', done)
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

### ../../.sbomtest/repos/f3c62de455-express/test/req.query.js

#### should default to parse simple keys

```ts
it('should default to parse simple keys', function (done) {
      var app = createApp();

      request(app)
      .get('/?user[name]=tj')
      .expect(200, '{"user[name]":"tj"}', done);
    }
```

#### should parse parameters with dots

```ts
it('should parse parameters with dots', function (done) {
        var app = createApp('extended');

        request(app)
        .get('/?user.name=tj')
        .expect(200, '{"user.name":"tj"}', done);
      }
```

#### should not parse complex keys

```ts
it('should not parse complex keys', function (done) {
        var app = createApp('simple');

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"user[name]":"tj"}', done);
      }
```

#### should parse using function

```ts
it('should parse using function', function (done) {
        var app = createApp(function (str) {
          return {'length': (str || '').length};
        });

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"length":17}', done);
      }
```

#### should not parse query

```ts
it('should not parse query', function (done) {
        var app = createApp(false);

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{}', done);
      }
```

#### should not parse complex keys

```ts
it('should not parse complex keys', function (done) {
        var app = createApp(true);

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"user[name]":"tj"}', done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.download.js

#### should transfer as an attachment

```ts
it('should transfer as an attachment', function(done){
      var app = express();

      app.use(function(req, res){
        res.download('test/fixtures/user.html');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="user.html"')
      .expect(200, '<p>{{user.name}}</p>', done)
    }
```

#### should accept range requests

```ts
it('should accept range requests', function (done) {
      var app = express()

      app.get('/', function (req, res) {
        res.download('test/fixtures/user.html')
      })

      request(app)
        .get('/')
        .expect('Accept-Ranges', 'bytes')
        .expect(200, '<p>{{user.name}}</p>', done)
    }
```

#### should provide an alternate filename

```ts
it('should provide an alternate filename', function(done){
      var app = express();

      app.use(function(req, res){
        res.download('test/fixtures/user.html', 'document');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .expect(200, done)
    }
```

#### should invoke the callback

```ts
it('should invoke the callback', function(done){
      var app = express();
      var cb = after(2, done);

      app.use(function(req, res){
        res.download('test/fixtures/user.html', cb);
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="user.html"')
      .expect(200, cb);
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

#### should allow options to res.sendFile()

```ts
it('should allow options to res.sendFile()', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.download('test/fixtures/.name', {
          dotfiles: 'allow',
          maxAge: '4h'
        })
      })

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Disposition', 'attachment; filename=".name"')
        .expect('Cache-Control', 'public, max-age=14400')
        .expect(utils.shouldHaveBody(Buffer.from('tobi')))
        .end(done)
    }
```

#### should be ignored

```ts
it('should be ignored', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.download('test/fixtures/user.html', {
              headers: {
                'Content-Disposition': 'inline'
              }
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Content-Disposition', 'attachment; filename="user.html"')
            .end(done)
        }
```

#### should be ignored case-insensitively

```ts
it('should be ignored case-insensitively', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.download('test/fixtures/user.html', {
              headers: {
                'content-disposition': 'inline'
              }
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Content-Disposition', 'attachment; filename="user.html"')
            .end(done)
        }
```

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

#### should invoke the callback

```ts
it('should invoke the callback', function(done){
      var app = express();
      var cb = after(2, done);

      app.use(function(req, res){
        res.download('test/fixtures/user.html', 'document', cb)
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .expect(200, cb);
    }
```

#### should invoke the callback

```ts
it('should invoke the callback', function (done) {
      var app = express()
      var cb = after(2, done)
      var options = {}

      app.use(function (req, res) {
        res.download('test/fixtures/user.html', 'document', options, cb)
      })

      request(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .end(cb)
    }
```

#### should allow options to res.sendFile()

```ts
it('should allow options to res.sendFile()', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.download('test/fixtures/.name', 'document', {
          dotfiles: 'allow',
          maxAge: '4h'
        })
      })

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Disposition', 'attachment; filename="document"')
        .expect('Cache-Control', 'public, max-age=14400')
        .expect(utils.shouldHaveBody(Buffer.from('tobi')))
        .end(done)
    }
```

#### should be ignored

```ts
it('should be ignored', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('test/fixtures/user.html', 'document', {
            headers: {
              'Content-Type': 'text/x-custom',
              'Content-Disposition': 'inline'
            }
          })
        })

        request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'text/x-custom')
        .expect('Content-Disposition', 'attachment; filename="document"')
        .end(done)
      }
```

#### should be ignored case-insensitively

```ts
it('should be ignored case-insensitively', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('test/fixtures/user.html', 'document', {
            headers: {
              'content-type': 'text/x-custom',
              'content-disposition': 'inline'
            }
          })
        })

        request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'text/x-custom')
        .expect('Content-Disposition', 'attachment; filename="document"')
        .end(done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/web-service.js

#### should respond users json

```ts
it('should respond users json', function(done){
        request(app)
        .get('/api/users?api-key=foo')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '[{"name":"tobi"},{"name":"loki"},{"name":"jane"}]', done)
      }
```

#### should respond repos json

```ts
it('should respond repos json', function(done){
        request(app)
        .get('/api/repos?api-key=foo')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(/"name":"express"/)
        .expect(/"url":"https:\/\/github.com\/expressjs\/express"/)
        .expect(200, done)
      }
```

#### should respond user repos json

```ts
it('should respond user repos json', function(done){
        request(app)
        .get('/api/user/loki/repos?api-key=foo')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(/"name":"stylus"/)
        .expect(/"url":"https:\/\/github.com\/learnboost\/stylus"/)
        .expect(200, done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### has

```ts
test('has', function(assert) {
    assert.expect(10);
    var model = new Backbone.Model();

    assert.strictEqual(model.has('name'), false);

    model.set({
      '0': 0,
      '1': 1,
      'true': true,
      'false': false,
      'empty': '',
      'name': 'name',
      'null': null,
      'undefined': undefined
    });

    assert.strictEqual(model.has('0'), true);
    assert.strictEqual(model.has('1'), true);
    assert.strictEqual(model.has('true'), true);
    assert.strictEqual(model.has('false'), true);
    assert.strictEqual(model.has('empty'), true);
    assert.strictEqual(model.has('name'), true);

    model.unset('name');

    assert.strictEqual(model.has('name'), false);
    assert.strictEqual(model.has('null'), false);
    assert.strictEqual(model.has('undefined'), false);
  }
```

#### matches

```ts
test('matches', function(assert) {
    assert.expect(4);
    var model = new Backbone.Model();

    assert.strictEqual(model.matches({name: 'Jonas', cool: true}), false);

    model.set({name: 'Jonas', cool: true});

    assert.strictEqual(model.matches({name: 'Jonas'}), true);
    assert.strictEqual(model.matches({name: 'Jonas', cool: true}), true);
    assert.strictEqual(model.matches({name: 'Jonas', cool: false}), false);
  }
```

#### set an empty string

```ts
test('set an empty string', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model({name: 'Model'});
    model.set({name: ''});
    assert.equal(model.get('name'), '');
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

#### change with options

```ts
test('change with options', function(assert) {
    assert.expect(2);
    var value;
    var model = new Backbone.Model({name: 'Rob'});
    model.on('change', function(m, options) {
      value = options.prefix + m.get('name');
    });
    model.set({name: 'Bob'}, {prefix: 'Mr. '});
    assert.equal(value, 'Mr. Bob');
    model.set({name: 'Sue'}, {prefix: 'Ms. '});
    assert.equal(value, 'Ms. Sue');
  }
```

#### save within change event

```ts
test('save within change event', function(assert) {
    assert.expect(1);
    var env = this;
    var model = new Backbone.Model({firstName: 'Taylor', lastName: 'Swift'});
    model.url = '/test';
    model.on('change', function() {
      model.save();
      assert.ok(_.isEqual(env.syncArgs.model, model));
    });
    model.set({lastName: 'Hicks'});
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

### ../../.sbomtest/repos/f3c62de455-express/test/req.get.js

#### should throw missing header name

```ts
it('should throw missing header name', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.end(req.get())
      })

      request(app)
      .get('/')
      .expect(500, /TypeError: name argument is required to req.get/, done)
    }
```

#### should throw for non-string header name

```ts
it('should throw for non-string header name', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.end(req.get(42))
      })

      request(app)
      .get('/')
      .expect(500, /TypeError: name must be a string to req.get/, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

#### should respond with json

```ts
it('should respond with json', function(done){
        var app = express();

        app.use(function(req, res){
          res.json({ name: 'tobi' });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
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

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.json({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
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

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'text/plain')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
        test.expect(200, '"name is 论"', done)
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

#### should parse utf-8

```ts
it('should parse utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=utf-8')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should parse codepage charsets

```ts
it('should parse codepage charsets', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=koi8-r')
      test.write(Buffer.from('6e616d6520697320cec5d4', 'hex'))
      test.expect(200, '"name is нет"', done)
    }
```

#### should parse when content-length != char length

```ts
it('should parse when content-length != char length', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=utf-8')
      test.set('Content-Length', '11')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should default to utf-8

```ts
it('should default to utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('789ccb4bcc4d55c82c5678b16e17001a6f050e', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.urlencoded.js

#### should not parse extended syntax

```ts
it('should not parse extended syntax', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('user[name][first]=Tobi')
      .expect(200, '{"user[name][first]":"Tobi"}', done)
  }
```

#### should not parse extended syntax

```ts
it('should not parse extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user[name][first]=Tobi')
          .expect(200, '{"user[name][first]":"Tobi"}', done)
      }
```

#### should parse extended syntax

```ts
it('should parse extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user[name][first]=Tobi')
          .expect(200, '{"user":{"name":{"first":"Tobi"}}}', done)
      }
```

#### should parse parameters with dots

```ts
it('should parse parameters with dots', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user.name=Tobi')
          .expect(200, '{"user.name":"Tobi"}', done)
      }
```

#### should parse fully-encoded extended syntax

```ts
it('should parse fully-encoded extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user%5Bname%5D%5Bfirst%5D=Tobi')
          .expect(200, '{"user":{"name":{"first":"Tobi"}}}', done)
      }
```

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/x-www-form-urlencoded')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
        test.expect(200, '{"name":"论"}', done)
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

#### should parse utf-8

```ts
it('should parse utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should default to utf-8

```ts
it('should default to utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('789ccb4bcc4db57db16e17001068042f', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.jsonp.js

#### should allow renaming callback

```ts
it('should allow renaming callback', function(done){
      var app = express();

      app.set('jsonp callback name', 'clb');

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?clb=something')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /something\(\{"count":1\}\);/, done);
    }
```

#### should invoke callback with an object

```ts
it('should invoke callback with an object', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp({ name: 'tobi' })
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(\{"name":"tobi"\}\)/, done)
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

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.jsonp({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

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

#### add model to collection with sort()-style comparator

```ts
test('add model to collection with sort()-style comparator', function(assert) {
    assert.expect(3);
    var collection = new Backbone.Collection;
    collection.comparator = function(m1, m2) {
      return m1.get('name') < m2.get('name') ? -1 : 1;
    };
    var tom = new Backbone.Model({name: 'Tom'});
    var rob = new Backbone.Model({name: 'Rob'});
    var tim = new Backbone.Model({name: 'Tim'});
    collection.add(tom);
    collection.add(rob);
    collection.add(tim);
    assert.equal(collection.indexOf(rob), 0);
    assert.equal(collection.indexOf(tim), 1);
    assert.equal(collection.indexOf(tom), 2);
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

## ./app

**Consultas usadas no Horsebox:** `EMAILOCTOPUS_API_KEY`, `./app EMAILOCTOPUS_API_KEY`, `app EMAILOCTOPUS_API_KEY`

**Arquivos de teste encontrados:** 147

### ../../.sbomtest/repos/f3c62de455-express/test/app.js

#### should inherit from event emitter

```ts
it('should inherit from event emitter', function(done){
    var app = express();
    app.on('foo', done);
    app.emit('foo');
  }
```

#### should be callable

```ts
it('should be callable', function(){
    var app = express();
    assert.equal(typeof app, 'function');
  }
```

#### should return the parent when mounted

```ts
it('should return the parent when mounted', function(){
    var app = express()
      , blog = express()
      , blogAdmin = express();

    app.use('/blog', blog);
    blog.use('/admin', blogAdmin);

    assert(!app.parent, 'app.parent');
    assert.strictEqual(blog.parent, app)
    assert.strictEqual(blogAdmin.parent, blog)
  }
```

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

#### should disable "view cache"

```ts
it('should disable "view cache"', function(){
    var app = express();
    assert.ok(!app.enabled('view cache'))
  }
```

#### should enable "view cache"

```ts
it('should enable "view cache"', function(){
    var app = express();
    assert.ok(app.enabled('view cache'))
  }
```

#### should default to development

```ts
it('should default to development', function(){
    var app = express();
    assert.strictEqual(app.get('env'), 'development')
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

#### should include ' + method.toUpperCase(), function (done) {
        if (method === 'query' && shouldSkipQuery(process.versions.node)) {
          this.skip()
        }
        var app = express();

        app[method]('/foo

```ts
it('should include ' + method.toUpperCase(), function (done) {
        if (method === 'query' && shouldSkipQuery(process.versions.node)) {
          this.skip()
        }
        var app = express();

        app[method]('/foo', function (req, res) {
          res.send(method)
        }
```

#### should reject numbers for app.' + method, function () {
        var app = express();
        assert.throws(app[method].bind(app, '/

```ts
it('should reject numbers for app.' + method, function () {
        var app = express();
        assert.throws(app[method].bind(app, '/', 3), /argument handler must be a function/);
      })
    });

    it('should re-route when method is altered', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(function (req, res, next) {
        if (req.method !== 'POST') return next();
        req.method = 'DELETE';
        res.setHeader('X-Method-Altered', '1');
        next();
      });

      app.delete('/', function (req, res) {
        res.end('deleted everything');
      });

      request(app)
        .get('/')
        .expect(404, cb)

      request(app)
        .delete('/')
        .expect(200, 'deleted everything', cb);

      request(app)
        .post('/')
        .expect('X-Method-Altered', '1')
        .expect(200, 'deleted everything', cb);
    }
```

#### should decode correct params

```ts
it('should decode correct params', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/foo%2Fbar')
        .expect('foo/bar', done);
    }
```

#### should not accept params in malformed paths

```ts
it('should not accept params in malformed paths', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/%foobar')
        .expect(400, done);
    }
```

#### should not decode spaces

```ts
it('should not decode spaces', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/foo+bar')
        .expect('foo+bar', done);
    }
```

#### should work with unicode

```ts
it('should work with unicode', function (done) {
      var app = express();

      app.get('/:name', function (req, res) {
        res.send(req.params.name);
      });

      request(app)
        .get('/%ce%b1')
        .expect('\u03b1', done);
    }
```

#### should be .use()able

```ts
it('should be .use()able', function (done) {
    var app = express();

    var calls = [];

    app.use(function (req, res, next) {
      calls.push('before');
      next();
    });

    app.get('/', function (req, res, next) {
      calls.push('GET /')
      next();
    });

    app.use(function (req, res, next) {
      calls.push('after');
      res.json(calls)
    });

    request(app)
      .get('/')
      .expect(200, ['before', 'GET /', 'after'], done)
  }
```

#### should match the pathname only

```ts
it('should match the pathname only', function (done) {
      var app = express();

      app.get(/^\/user\/[0-9]+$/, function (req, res) {
        res.end('user');
      });

      request(app)
        .get('/user/12?foo=bar')
        .expect('user', done);
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

#### should ensure regexp matches path prefix

```ts
it('should ensure regexp matches path prefix', function (done) {
      var app = express()
      var p = []

      app.use(/\/api.*/, function (req, res, next) {
        p.push('a')
        next()
      })
      app.use(/api/, function (req, res, next) {
        p.push('b')
        next()
      })
      app.use(/\/test/, function (req, res, next) {
        p.push('c')
        next()
      })
      app.use(function (req, res) {
        res.end()
      })

      request(app)
        .get('/test/api/1234')
        .expect(200, function (err) {
          if (err) return done(err)
          assert.deepEqual(p, ['c'])
          done()
        })
    }
```

#### should be disabled by default

```ts
it('should be disabled by default', function (done) {
      var app = express();

      app.get('/user', function (req, res) {
        res.end('tj');
      });

      request(app)
        .get('/USER')
        .expect('tj', done);
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

#### should not match otherwise

```ts
it('should not match otherwise', function (done) {
        var app = express();

        app.enable('case sensitive routing');

        app.get('/uSer', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user')
          .expect(404, done);
      }
```

#### should overwrite existing req.params by default

```ts
it('should overwrite existing req.params by default', function (done) {
      var app = express();
      var router = new express.Router();

      router.get('/:action', function (req, res) {
        res.send(req.params);
      });

      app.use('/user/:user', router);

      request(app)
        .get('/user/1/get')
        .expect(200, '{"action":"get"}', done);
    }
```

#### should allow merging existing req.params

```ts
it('should allow merging existing req.params', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get('/:action', function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use('/user/:user', router);

      request(app)
        .get('/user/tj/get')
        .expect(200, '[["action","get"],["user","tj"]]', done);
    }
```

#### should use params from router

```ts
it('should use params from router', function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get('/:thing', function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(keys.map(function (k) { return [k, req.params[k]] }));
      });

      app.use('/user/:thing', router);

      request(app)
        .get('/user/tj/get')
        .expect(200, '[["thing","get"]]', done);
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

#### should be optional by default

```ts
it('should be optional by default', function (done) {
      var app = express();

      app.get('/user', function (req, res) {
        res.end('tj');
      });

      request(app)
        .get('/user/')
        .expect('tj', done);
    }
```

#### should match trailing slashes

```ts
it('should match trailing slashes', function (done) {
        var app = express();

        app.enable('strict routing');

        app.get('/user/', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user/')
          .expect('tj', done);
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

#### should match no slashes

```ts
it('should match no slashes', function (done) {
        var app = express();

        app.enable('strict routing');

        app.get('/user', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user')
          .expect('tj', done);
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

#### should fail when omitting the trailing slash

```ts
it('should fail when omitting the trailing slash', function (done) {
        var app = express();

        app.enable('strict routing');

        app.get('/user/', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user')
          .expect(404, done);
      }
```

#### should fail when adding the trailing slash

```ts
it('should fail when adding the trailing slash', function (done) {
        var app = express();

        app.enable('strict routing');

        app.get('/user', function (req, res) {
          res.end('tj');
        });

        request(app)
          .get('/user/')
          .expect(404, done);
      }
```

#### should allow literal "."

```ts
it('should allow literal "."', function (done) {
    var app = express();

    app.get('/api/users/:from..:to', function (req, res) {
      var from = req.params.from
        , to = req.params.to;

      res.end('users from ' + from + ' to ' + to);
    });

    request(app)
      .get('/api/users/1..50')
      .expect('users from 1 to 50', done);
  }
```

#### should denote a capture group

```ts
it('should denote a capture group', function (done) {
      var app = express();

      app.get('/user/:user', function (req, res) {
        res.end(req.params.user);
      });

      request(app)
        .get('/user/tj')
        .expect('tj', done);
    }
```

#### should match a single segment only

```ts
it('should match a single segment only', function (done) {
      var app = express();

      app.get('/user/:user', function (req, res) {
        res.end(req.params.user);
      });

      request(app)
        .get('/user/tj/edit')
        .expect(404, done);
    }
```

#### should allow several capture groups

```ts
it('should allow several capture groups', function (done) {
      var app = express();

      app.get('/user/:user/:op', function (req, res) {
        res.end(req.params.op + 'ing ' + req.params.user);
      });

      request(app)
        .get('/user/tj/edit')
        .expect('editing tj', done);
    }
```

#### should work following a partial capture group

```ts
it('should work following a partial capture group', function (done) {
      var app = express();
      var cb = after(2, done);

      app.get('/user{s}/:user/:op', function (req, res) {
        res.end(req.params.op + 'ing ' + req.params.user + (req.url.startsWith('/users') ? ' (old)' : ''));
      });

      request(app)
        .get('/user/tj/edit')
        .expect('editing tj', cb);

      request(app)
        .get('/users/tj/edit')
        .expect('editing tj (old)', cb);
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

#### should work in array of paths

```ts
it('should work in array of paths', function (done) {
      var app = express();
      var cb = after(2, done);

      app.get(['/user/:user/poke', '/user/:user/pokes'], function (req, res) {
        res.end('poking ' + req.params.user);
      });

      request(app)
        .get('/user/tj/poke')
        .expect('poking tj', cb);

      request(app)
        .get('/user/tj/pokes')
        .expect('poking tj', cb);
    }
```

#### should denote an optional capture group

```ts
it('should denote an optional capture group', function (done) {
      var app = express();

      app.get('/user/:user{/:op}', function (req, res) {
        var op = req.params.op || 'view';
        res.end(op + 'ing ' + req.params.user);
      });

      request(app)
        .get('/user/tj')
        .expect('viewing tj', done);
    }
```

#### should populate the capture group

```ts
it('should populate the capture group', function (done) {
      var app = express();

      app.get('/user/:user{/:op}', function (req, res) {
        var op = req.params.op || 'view';
        res.end(op + 'ing ' + req.params.user);
      });

      request(app)
        .get('/user/tj/edit')
        .expect('editing tj', done);
    }
```

#### should match one segment

```ts
it('should match one segment', function (done) {
      var app = express()

      app.get('/user/*user', function (req, res) {
        res.end(req.params.user[0])
      })

      request(app)
        .get('/user/122')
        .expect('122', done)
    }
```

#### should match many segments

```ts
it('should match many segments', function (done) {
      var app = express()

      app.get('/user/*user', function (req, res) {
        res.end(req.params.user.join('/'))
      })

      request(app)
        .get('/user/1/2/3/4')
        .expect('1/2/3/4', done)
    }
```

#### should match zero segments

```ts
it('should match zero segments', function (done) {
      var app = express()

      app.get('/user{/*user}', function (req, res) {
        res.end(req.params.user)
      })

      request(app)
        .get('/user')
        .expect('', done)
    }
```

#### should match one segment

```ts
it('should match one segment', function (done) {
      var app = express()

      app.get('/user/*user', function (req, res) {
        res.end(req.params.user[0])
      })

      request(app)
        .get('/user/122')
        .expect(200, '122', done)
    }
```

#### should match many segments

```ts
it('should match many segments', function (done) {
      var app = express()

      app.get('/user/*user', function (req, res) {
        res.end(req.params.user.join('/'))
      })

      request(app)
        .get('/user/1/2/3/4')
        .expect(200, '1/2/3/4', done)
    }
```

#### should not match zero segments

```ts
it('should not match zero segments', function (done) {
      var app = express()

      app.get('/user/*user', function (req, res) {
        res.end(req.params.user)
      })

      request(app)
        .get('/user')
        .expect(404, done)
    }
```

#### should denote a format

```ts
it('should denote a format', function (done) {
      var app = express();
      var cb = after(2, done)

      app.get('/:name.:format', function (req, res) {
        res.end(req.params.name + ' as ' + req.params.format);
      });

      request(app)
        .get('/foo.json')
        .expect(200, 'foo as json', cb)

      request(app)
        .get('/foo')
        .expect(404, cb)
    }
```

#### should denote an optional format

```ts
it('should denote an optional format', function (done) {
      var app = express();
      var cb = after(2, done)

      app.get('/:name{.:format}', function (req, res) {
        res.end(req.params.name + ' as ' + (req.params.format || 'html'));
      });

      request(app)
        .get('/foo')
        .expect(200, 'foo as html', cb)

      request(app)
        .get('/foo.json')
        .expect(200, 'foo as json', cb)
    }
```

#### should continue lookup

```ts
it('should continue lookup', function (done) {
      var app = express()
        , calls = [];

      app.get('/foo{/:bar}', function (req, res, next) {
        calls.push('/foo/:bar?');
        next();
      });

      app.get('/bar', function () {
        assert(0);
      });

      app.get('/foo', function (req, res, next) {
        calls.push('/foo');
        next();
      });

      app.get('/foo', function (req, res) {
        calls.push('/foo 2');
        res.json(calls)
      });

      request(app)
        .get('/foo')
        .expect(200, ['/foo/:bar?', '/foo', '/foo 2'], done)
    }
```

#### should jump to next route

```ts
it('should jump to next route', function (done) {
      var app = express()

      function fn(req, res, next) {
        res.set('X-Hit', '1')
        next('route')
      }

      app.get('/foo', fn, function (req, res) {
        res.end('failure')
      });

      app.get('/foo', function (req, res) {
        res.end('success')
      })

      request(app)
        .get('/foo')
        .expect('X-Hit', '1')
        .expect(200, 'success', done)
    }
```

#### should jump out of router

```ts
it('should jump out of router', function (done) {
      var app = express()
      var router = express.Router()

      function fn(req, res, next) {
        res.set('X-Hit', '1')
        next('router')
      }

      router.get('/foo', fn, function (req, res) {
        res.end('failure')
      })

      router.get('/foo', function (req, res) {
        res.end('failure')
      })

      app.use(router)

      app.get('/foo', function (req, res) {
        res.end('success')
      })

      request(app)
        .get('/foo')
        .expect('X-Hit', '1')
        .expect(200, 'success', done)
    }
```

#### should break out of app.router

```ts
it('should break out of app.router', function (done) {
      var app = express()
        , calls = [];

      app.get('/foo{/:bar}', function (req, res, next) {
        calls.push('/foo/:bar?');
        next();
      });

      app.get('/bar', function () {
        assert(0);
      });

      app.get('/foo', function (req, res, next) {
        calls.push('/foo');
        next(new Error('fail'));
      });

      app.get('/foo', function () {
        assert(0);
      });

      app.use(function (err, req, res, next) {
        res.json({
          calls: calls,
          error: err.message
        })
      })

      request(app)
        .get('/foo')
        .expect(200, { calls: ['/foo/:bar?', '/foo'], error: 'fail' }, done)
    }
```

#### should call handler in same route, if exists

```ts
it('should call handler in same route, if exists', function (done) {
      var app = express();

      function fn1(req, res, next) {
        next(new Error('boom!'));
      }

      function fn2(req, res, next) {
        res.send('foo here');
      }

      function fn3(err, req, res, next) {
        res.send('route go ' + err.message);
      }

      app.get('/foo', fn1, fn2, fn3);

      app.use(function (err, req, res, next) {
        res.end('error!');
      })

      request(app)
        .get('/foo')
        .expect('route go boom!', done)
    }
```

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
      var app = express()
      var router = new express.Router()

      router.use(function createError(req, res, next) {
        return Promise.reject(new Error('boom!'))
      })

      router.use(function sawError(err, req, res, next) {
        res.send('saw ' + err.name + ': ' + err.message)
      })

      app.use(router)

      request(app)
        .get('/')
        .expect(200, 'saw Error: boom!', done)
    }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
      var app = express()
      var router = new express.Router()

      router.use(function createError(req, res, next) {
        return Promise.reject()
      })

      router.use(function sawError(err, req, res, next) {
        res.send('saw ' + err.name + ': ' + err.message)
      })

      app.use(router)

      request(app)
        .get('/')
        .expect(200, 'saw Error: Rejected promise', done)
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

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
        var app = express()
        var router = new express.Router()

        router.use(function createError(req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error('caught: ' + err.message))
        })

        router.use(function sawError(err, req, res, next) {
          res.send('saw ' + err.name + ': ' + err.message)
        })

        app.use(router)

        request(app)
          .get('/')
          .expect(200, 'saw Error: caught: boom!', done)
      }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
        var app = express()
        var router = new express.Router()

        router.use(function createError(req, res, next) {
          return Promise.reject()
        })

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error('caught: ' + err.message))
        })

        router.use(function sawError(err, req, res, next) {
          res.send('saw ' + err.name + ': ' + err.message)
        })

        app.use(router)

        request(app)
          .get('/')
          .expect(200, 'saw Error: caught: Rejected promise', done)
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

#### should be chainable

```ts
it('should be chainable', function () {
    var app = express();
    assert.strictEqual(app.get('/', function () { }), app)
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

#### should only call once per request

```ts
it('should only call once per request', function(done) {
      var app = express();
      var called = 0;
      var count = 0;

      app.param('user', function(req, res, next, user) {
        called++;
        req.user = user;
        next();
      });

      app.get('/foo/:user', function(req, res, next) {
        count++;
        next();
      });
      app.get('/foo/:user', function(req, res, next) {
        count++;
        next();
      });
      app.use(function(req, res) {
        res.end([count, called, req.user].join(' '));
      });

      request(app)
      .get('/foo/bob')
      .expect('2 1 bob', done);
    }
```

#### should call when values differ

```ts
it('should call when values differ', function(done) {
      var app = express();
      var called = 0;
      var count = 0;

      app.param('user', function(req, res, next, user) {
        called++;
        req.users = (req.users || []).concat(user);
        next();
      });

      app.get('/:user/bob', function(req, res, next) {
        count++;
        next();
      });
      app.get('/foo/:user', function(req, res, next) {
        count++;
        next();
      });
      app.use(function(req, res) {
        res.end([count, called, req.users.join(',')].join(' '));
      });

      request(app)
      .get('/foo/bob')
      .expect('2 2 foo,bob', done);
    }
```

#### should support altering req.params across routes

```ts
it('should support altering req.params across routes', function(done) {
      var app = express();

      app.param('user', function(req, res, next, user) {
        req.params.user = 'loki';
        next();
      });

      app.get('/:user', function(req, res, next) {
        next('route');
      });
      app.get('/:user', function (req, res) {
        res.send(req.params.user);
      });

      request(app)
      .get('/bob')
      .expect('loki', done);
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

#### should work with encoded values

```ts
it('should work with encoded values', function(done){
      var app = express();

      app.param('name', function(req, res, next, name){
        req.params.name = name;
        next();
      });

      app.get('/user/:name', function(req, res){
        var name = req.params.name;
        res.send('' + name);
      });

      request(app)
      .get('/user/foo%25bar')
      .expect('foo%bar', done);
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

#### should not call when values differ on error

```ts
it('should not call when values differ on error', function(done) {
      var app = express();
      var called = 0;
      var count = 0;

      app.param('user', function(req, res, next, user) {
        called++;
        if (user === 'foo') throw new Error('err!');
        req.user = user;
        next();
      });

      app.get('/:user/bob', function(req, res, next) {
        count++;
        next();
      });
      app.get('/foo/:user', function(req, res, next) {
        count++;
        next();
      });

      app.use(function(err, req, res, next) {
        res.status(500);
        res.send([count, called, err.message].join(' '));
      });

      request(app)
      .get('/foo/bob')
      .expect(500, '0 1 err!', done)
    }
```

#### should call when values differ when using "next"

```ts
it('should call when values differ when using "next"', function(done) {
      var app = express();
      var called = 0;
      var count = 0;

      app.param('user', function(req, res, next, user) {
        called++;
        if (user === 'foo') return next('route');
        req.user = user;
        next();
      });

      app.get('/:user/bob', function(req, res, next) {
        count++;
        next();
      });
      app.get('/foo/:user', function(req, res, next) {
        count++;
        next();
      });
      app.use(function(req, res) {
        res.end([count, called, req.user].join(' '));
      });

      request(app)
      .get('/foo/bob')
      .expect('1 2 bob', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.use.js

#### should emit "mount" when mounted

```ts
it('should emit "mount" when mounted', function(done){
    var blog = express()
      , app = express();

    blog.on('mount', function(arg){
      assert.strictEqual(arg, app)
      done();
    });

    app.use(blog);
  }
```

#### should mount the app

```ts
it('should mount the app', function(done){
      var blog = express()
        , app = express();

      blog.get('/blog', function(req, res){
        res.end('blog');
      });

      app.use(blog);

      request(app)
      .get('/blog')
      .expect('blog', done);
    }
```

#### should support mount-points

```ts
it('should support mount-points', function(done){
      var blog = express()
        , forum = express()
        , app = express();
      var cb = after(2, done)

      blog.get('/', function(req, res){
        res.end('blog');
      });

      forum.get('/', function(req, res){
        res.end('forum');
      });

      app.use('/blog', blog);
      app.use('/forum', forum);

      request(app)
        .get('/blog')
        .expect(200, 'blog', cb)

      request(app)
        .get('/forum')
        .expect(200, 'forum', cb)
    }
```

#### should set the child\'s .parent

```ts
it('should set the child\'s .parent', function(){
      var blog = express()
        , app = express();

      app.use('/blog', blog);
      assert.strictEqual(blog.parent, app)
    }
```

#### should support dynamic routes

```ts
it('should support dynamic routes', function(done){
      var blog = express()
        , app = express();

      blog.get('/', function(req, res){
        res.end('success');
      });

      app.use('/post/:article', blog);

      request(app)
      .get('/post/once-upon-a-time')
      .expect('success', done);
    }
```

#### should support mounted app anywhere

```ts
it('should support mounted app anywhere', function(done){
      var cb = after(3, done);
      var blog = express()
        , other = express()
        , app = express();

      function fn1(req, res, next) {
        res.setHeader('x-fn-1', 'hit');
        next();
      }

      function fn2(req, res, next) {
        res.setHeader('x-fn-2', 'hit');
        next();
      }

      blog.get('/', function(req, res){
        res.end('success');
      });

      blog.once('mount', function (parent) {
        assert.strictEqual(parent, app)
        cb();
      });
      other.once('mount', function (parent) {
        assert.strictEqual(parent, app)
        cb();
      });

      app.use('/post/:article', fn1, other, fn2, blog);

      request(app)
      .get('/post/once-upon-a-time')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('success', cb);
    }
```

#### should accept multiple arguments

```ts
it('should accept multiple arguments', function (done) {
      var app = express();

      function fn1(req, res, next) {
        res.setHeader('x-fn-1', 'hit');
        next();
      }

      function fn2(req, res, next) {
        res.setHeader('x-fn-2', 'hit');
        next();
      }

      app.use(fn1, fn2, function fn3(req, res) {
        res.setHeader('x-fn-3', 'hit');
        res.end();
      });

      request(app)
      .get('/')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should invoke middleware for all requests

```ts
it('should invoke middleware for all requests', function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(function (req, res) {
        res.send('saw ' + req.method + ' ' + req.url);
      });

      request(app)
      .get('/')
      .expect(200, 'saw GET /', cb);

      request(app)
      .options('/')
      .expect(200, 'saw OPTIONS /', cb);

      request(app)
      .post('/foo')
      .expect(200, 'saw POST /foo', cb);
    }
```

#### should accept array of middleware

```ts
it('should accept array of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use([fn1, fn2, fn3]);

      request(app)
      .get('/')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should accept multiple arrays of middleware

```ts
it('should accept multiple arrays of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use([fn1, fn2], [fn3]);

      request(app)
      .get('/')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should accept nested arrays of middleware

```ts
it('should accept nested arrays of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use([[fn1], fn2], [fn3]);

      request(app)
      .get('/')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should require middleware

```ts
it('should require middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/') }, 'TypeError: app.use() requires a middleware function')
    }
```

#### should reject string as middleware

```ts
it('should reject string as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', 'foo') }, /argument handler must be a function/)
    }
```

#### should reject number as middleware

```ts
it('should reject number as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', 42) }, /argument handler must be a function/)
    }
```

#### should reject null as middleware

```ts
it('should reject null as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', null) }, /argument handler must be a function/)
    }
```

#### should reject Date as middleware

```ts
it('should reject Date as middleware', function () {
      var app = express()
      assert.throws(function () { app.use('/', new Date()) }, /argument handler must be a function/)
    }
```

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

#### should accept multiple arguments

```ts
it('should accept multiple arguments', function (done) {
      var app = express();

      function fn1(req, res, next) {
        res.setHeader('x-fn-1', 'hit');
        next();
      }

      function fn2(req, res, next) {
        res.setHeader('x-fn-2', 'hit');
        next();
      }

      app.use('/foo', fn1, fn2, function fn3(req, res) {
        res.setHeader('x-fn-3', 'hit');
        res.end();
      });

      request(app)
      .get('/foo')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
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

#### should accept array of middleware

```ts
it('should accept array of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use('/foo', [fn1, fn2, fn3]);

      request(app)
      .get('/foo')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should accept multiple arrays of middleware

```ts
it('should accept multiple arrays of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use('/foo', [fn1, fn2], [fn3]);

      request(app)
      .get('/foo')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
    }
```

#### should accept nested arrays of middleware

```ts
it('should accept nested arrays of middleware', function (done) {
      var app = express();

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
        res.end();
      }

      app.use('/foo', [fn1, [fn2]], [fn3]);

      request(app)
      .get('/foo')
      .expect('x-fn-1', 'hit')
      .expect('x-fn-2', 'hit')
      .expect('x-fn-3', 'hit')
      .expect(200, done);
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.options.js

#### should default to the routes defined

```ts
it('should default to the routes defined', function(done){
    var app = express();

    app.post('/', function(){});
    app.get('/users', function(req, res){});
    app.put('/users', function(req, res){});

    request(app)
    .options('/users')
    .expect('Allow', 'GET, HEAD, PUT')
    .expect(200, 'GET, HEAD, PUT', done);
  }
```

#### should only include each method once

```ts
it('should only include each method once', function(done){
    var app = express();

    app.delete('/', function(){});
    app.get('/users', function(req, res){});
    app.put('/users', function(req, res){});
    app.get('/users', function(req, res){});

    request(app)
    .options('/users')
    .expect('Allow', 'GET, HEAD, PUT')
    .expect(200, 'GET, HEAD, PUT', done);
  }
```

#### should not be affected by app.all

```ts
it('should not be affected by app.all', function(done){
    var app = express();

    app.get('/', function(){});
    app.get('/users', function(req, res){});
    app.put('/users', function(req, res){});
    app.all('/users', function(req, res, next){
      res.setHeader('x-hit', '1');
      next();
    });

    request(app)
    .options('/users')
    .expect('x-hit', '1')
    .expect('Allow', 'GET, HEAD, PUT')
    .expect(200, 'GET, HEAD, PUT', done);
  }
```

#### should not respond if the path is not defined

```ts
it('should not respond if the path is not defined', function(done){
    var app = express();

    app.get('/users', function(req, res){});

    request(app)
    .options('/other')
    .expect(404, done);
  }
```

#### should forward requests down the middleware chain

```ts
it('should forward requests down the middleware chain', function(done){
    var app = express();
    var router = new express.Router();

    router.get('/users', function(req, res){});
    app.use(router);
    app.get('/other', function(req, res){});

    request(app)
    .options('/other')
    .expect('Allow', 'GET, HEAD')
    .expect(200, 'GET, HEAD', done);
  }
```

#### should pass error to callback

```ts
it('should pass error to callback', function (done) {
      var app = express();
      var router = express.Router();

      router.get('/users', function(req, res){});

      app.use(function (req, res, next) {
        res.writeHead(200);
        next();
      });
      app.use(router);
      app.use(function (err, req, res, next) {
        res.end('true');
      });

      request(app)
      .options('/users')
      .expect(200, 'true', done)
    }
```

#### should override the default behavior

```ts
it('should override the default behavior', function(done){
    var app = express();

    app.options('/users', function(req, res){
      res.set('Allow', 'GET');
      res.send('GET');
    });

    app.get('/users', function(req, res){});
    app.put('/users', function(req, res){});

    request(app)
    .options('/users')
    .expect('GET')
    .expect('Allow', 'GET', done);
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

#### should throw when the callback is missing

```ts
it('should throw when the callback is missing', function(){
      var app = express();
      assert.throws(function () {
        app.engine('.html', null);
      }, /callback function required/)
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.route.js

#### should return a new route

```ts
it('should return a new route', function(done){
    var app = express();

    app.route('/foo')
    .get(function(req, res) {
      res.send('get');
    })
    .post(function(req, res) {
      res.send('post');
    });

    request(app)
    .post('/foo')
    .expect('post', done);
  }
```

#### should all .VERB after .all

```ts
it('should all .VERB after .all', function(done){
    var app = express();

    app.route('/foo')
    .all(function(req, res, next) {
      next();
    })
    .get(function(req, res) {
      res.send('get');
    })
    .post(function(req, res) {
      res.send('post');
    });

    request(app)
    .post('/foo')
    .expect('post', done);
  }
```

#### should support dynamic routes

```ts
it('should support dynamic routes', function(done){
    var app = express();

    app.route('/:foo')
    .get(function(req, res) {
      res.send(req.params.foo);
    });

    request(app)
    .get('/test')
    .expect('test', done);
  }
```

#### should not error on empty routes

```ts
it('should not error on empty routes', function(done){
    var app = express();

    app.route('/:foo');

    request(app)
    .get('/test')
    .expect(404, done);
  }
```

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
      var app = express()
      var route = app.route('/foo')

      route.all(function createError (req, res, next) {
        return Promise.reject(new Error('boom!'))
      })

      route.all(function helloWorld (req, res) {
        res.send('hello, world!')
      })

      route.all(function handleError (err, req, res, next) {
        res.status(500)
        res.send('caught: ' + err.message)
      })

      request(app)
      .get('/foo')
      .expect(500, 'caught: boom!', done)
    }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
      var app = express()
      var route = app.route('/foo')

      route.all(function createError (req, res, next) {
        return Promise.reject()
      })

      route.all(function helloWorld (req, res) {
        res.send('hello, world!')
      })

      route.all(function handleError (err, req, res, next) {
        res.status(500)
        res.send('caught: ' + err.message)
      })

      request(app)
      .get('/foo')
      .expect(500, 'caught: Rejected promise', done)
    }
```

#### should ignore resolved promise

```ts
it('should ignore resolved promise', function (done) {
      var app = express()
      var route = app.route('/foo')

      route.all(function createError (req, res, next) {
        res.send('saw GET /foo')
        return Promise.resolve('foo')
      })

      route.all(function () {
        done(new Error('Unexpected route invoke'))
      })

      request(app)
      .get('/foo')
      .expect(200, 'saw GET /foo', done)
    }
```

#### should pass rejected promise value

```ts
it('should pass rejected promise value', function (done) {
        var app = express()
        var route = app.route('/foo')

        route.all(function createError (req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        route.all(function handleError (err, req, res, next) {
          return Promise.reject(new Error('caught: ' + err.message))
        })

        route.all(function handleError (err, req, res, next) {
          res.status(500)
          res.send('caught again: ' + err.message)
        })

        request(app)
        .get('/foo')
        .expect(500, 'caught again: caught: boom!', done)
      }
```

#### should pass rejected promise without value

```ts
it('should pass rejected promise without value', function (done) {
        var app = express()
        var route = app.route('/foo')

        route.all(function createError (req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        route.all(function handleError (err, req, res, next) {
          return Promise.reject()
        })

        route.all(function handleError (err, req, res, next) {
          res.status(500)
          res.send('caught again: ' + err.message)
        })

        request(app)
        .get('/foo')
        .expect(500, 'caught again: Rejected promise', done)
      }
```

#### should ignore resolved promise

```ts
it('should ignore resolved promise', function (done) {
        var app = express()
        var route = app.route('/foo')

        route.all(function createError (req, res, next) {
          return Promise.reject(new Error('boom!'))
        })

        route.all(function handleError (err, req, res, next) {
          res.status(500)
          res.send('caught: ' + err.message)
          return Promise.resolve('foo')
        })

        route.all(function () {
          done(new Error('Unexpected route invoke'))
        })

        request(app)
        .get('/foo')
        .expect(500, 'caught: boom!', done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.locals.js

#### should default object with null prototype

```ts
it('should default object with null prototype', function () {
      var app = express()
      assert.ok(app.locals)
      assert.strictEqual(typeof app.locals, 'object')
      assert.strictEqual(Object.getPrototypeOf(app.locals), null)
    }
```

#### should contain app settings

```ts
it('should contain app settings ', function () {
        var app = express()
        app.set('title', 'Express')
        assert.ok(app.locals.settings)
        assert.strictEqual(typeof app.locals.settings, 'object')
        assert.strictEqual(app.locals.settings, app.settings)
        assert.strictEqual(app.locals.settings.title, 'Express')
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.head.js

#### should default to GET

```ts
it('should default to GET', function(done){
    var app = express();

    app.get('/tobi', function(req, res){
      // send() detects HEAD
      res.send('tobi');
    });

    request(app)
    .head('/tobi')
    .expect(200, done);
  }
```

#### should output the same headers as GET requests

```ts
it('should output the same headers as GET requests', function(done){
    var app = express();

    app.get('/tobi', function(req, res){
      // send() detects HEAD
      res.send('tobi');
    });

    request(app)
    .head('/tobi')
    .expect(200, function(err, res){
      if (err) return done(err);
      var headers = res.headers;
      request(app)
      .get('/tobi')
      .expect(200, function(err, res){
        if (err) return done(err);
        delete headers.date;
        delete res.headers.date;
        assert.deepEqual(res.headers, headers);
        done();
      });
    });
  }
```

#### should override

```ts
it('should override', function(done){
    var app = express()

    app.head('/tobi', function(req, res){
      res.header('x-method', 'head')
      res.end()
    });

    app.get('/tobi', function(req, res){
      res.header('x-method', 'get')
      res.send('tobi');
    });

    request(app)
      .head('/tobi')
      .expect('x-method', 'head')
      .expect(200, done)
  }
```

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

### ../../.sbomtest/repos/f3c62de455-express/test/app.all.js

#### should add a router per method

```ts
it('should add a router per method', function(done){
    var app = express();
    var cb = after(2, done)

    app.all('/tobi', function(req, res){
      res.end(req.method);
    });

    request(app)
      .put('/tobi')
      .expect(200, 'PUT', cb)

    request(app)
      .get('/tobi')
      .expect(200, 'GET', cb)
  }
```

#### should run the callback for a method just once

```ts
it('should run the callback for a method just once', function(done){
    var app = express()
      , n = 0;

    app.all('/*splat', function(req, res, next){
      if (n++) return done(new Error('DELETE called several times'));
      next();
    });

    request(app)
    .del('/tobi')
    .expect(404, done);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.request.js

#### should extend the request prototype

```ts
it('should extend the request prototype', function(done){
      var app = express();

      app.request.querystring = function(){
        return require('node:url').parse(this.url).query;
      };

      app.use(function(req, res){
        res.end(req.querystring());
      });

      request(app)
      .get('/foo?name=tobi')
      .expect('name=tobi', done);
    }
```

#### should only extend for the referenced app

```ts
it('should only extend for the referenced app', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.request.foobar = function () {
        return 'tobi'
      }

      app1.get('/', function (req, res) {
        res.send(req.foobar())
      })

      app2.get('/', function (req, res) {
        res.send(req.foobar())
      })

      request(app1)
        .get('/')
        .expect(200, 'tobi', cb)

      request(app2)
        .get('/')
        .expect(500, /(?:not a function|has no method)/, cb)
    }
```

#### should inherit to sub apps

```ts
it('should inherit to sub apps', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.request.foobar = function () {
        return 'tobi'
      }

      app1.use('/sub', app2)

      app1.get('/', function (req, res) {
        res.send(req.foobar())
      })

      app2.get('/', function (req, res) {
        res.send(req.foobar())
      })

      request(app1)
        .get('/')
        .expect(200, 'tobi', cb)

      request(app1)
        .get('/sub')
        .expect(200, 'tobi', cb)
    }
```

#### should allow sub app to override

```ts
it('should allow sub app to override', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.request.foobar = function () {
        return 'tobi'
      }

      app2.request.foobar = function () {
        return 'loki'
      }

      app1.use('/sub', app2)

      app1.get('/', function (req, res) {
        res.send(req.foobar())
      })

      app2.get('/', function (req, res) {
        res.send(req.foobar())
      })

      request(app1)
        .get('/')
        .expect(200, 'tobi', cb)

      request(app1)
        .get('/sub')
        .expect(200, 'loki', cb)
    }
```

#### should not pollute parent app

```ts
it('should not pollute parent app', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.request.foobar = function () {
        return 'tobi'
      }

      app2.request.foobar = function () {
        return 'loki'
      }

      app1.use('/sub', app2)

      app1.get('/sub/foo', function (req, res) {
        res.send(req.foobar())
      })

      app2.get('/', function (req, res) {
        res.send(req.foobar())
      })

      request(app1)
        .get('/sub')
        .expect(200, 'loki', cb)

      request(app1)
        .get('/sub/foo')
        .expect(200, 'tobi', cb)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.response.js

#### should extend the response prototype

```ts
it('should extend the response prototype', function(done){
      var app = express();

      app.response.shout = function(str){
        this.send(str.toUpperCase());
      };

      app.use(function(req, res){
        res.shout('hey');
      });

      request(app)
      .get('/')
      .expect('HEY', done);
    }
```

#### should only extend for the referenced app

```ts
it('should only extend for the referenced app', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.response.shout = function (str) {
        this.send(str.toUpperCase())
      }

      app1.get('/', function (req, res) {
        res.shout('foo')
      })

      app2.get('/', function (req, res) {
        res.shout('foo')
      })

      request(app1)
        .get('/')
        .expect(200, 'FOO', cb)

      request(app2)
        .get('/')
        .expect(500, /(?:not a function|has no method)/, cb)
    }
```

#### should inherit to sub apps

```ts
it('should inherit to sub apps', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.response.shout = function (str) {
        this.send(str.toUpperCase())
      }

      app1.use('/sub', app2)

      app1.get('/', function (req, res) {
        res.shout('foo')
      })

      app2.get('/', function (req, res) {
        res.shout('foo')
      })

      request(app1)
        .get('/')
        .expect(200, 'FOO', cb)

      request(app1)
        .get('/sub')
        .expect(200, 'FOO', cb)
    }
```

#### should allow sub app to override

```ts
it('should allow sub app to override', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.response.shout = function (str) {
        this.send(str.toUpperCase())
      }

      app2.response.shout = function (str) {
        this.send(str + '!')
      }

      app1.use('/sub', app2)

      app1.get('/', function (req, res) {
        res.shout('foo')
      })

      app2.get('/', function (req, res) {
        res.shout('foo')
      })

      request(app1)
        .get('/')
        .expect(200, 'FOO', cb)

      request(app1)
        .get('/sub')
        .expect(200, 'foo!', cb)
    }
```

#### should not pollute parent app

```ts
it('should not pollute parent app', function (done) {
      var app1 = express()
      var app2 = express()
      var cb = after(2, done)

      app1.response.shout = function (str) {
        this.send(str.toUpperCase())
      }

      app2.response.shout = function (str) {
        this.send(str + '!')
      }

      app1.use('/sub', app2)

      app1.get('/sub/foo', function (req, res) {
        res.shout('foo')
      })

      app2.get('/', function (req, res) {
        res.shout('foo')
      })

      request(app1)
        .get('/sub')
        .expect(200, 'foo!', cb)

      request(app1)
        .get('/sub/foo')
        .expect(200, 'FOO', cb)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/app.routes.error.js

#### should not get invoked without error handler on error

```ts
it('should not get invoked without error handler on error', function(done) {
      var app = express();

      app.use(function(req, res, next){
        next(new Error('boom!'))
      });

      app.get('/bar', function(req, res){
        res.send('hello, world!');
      });

      request(app)
      .post('/bar')
      .expect(500, /Error: boom!/, done);
    }
```

#### should only call an error handling routing callback when an error is propagated

```ts
it('should only call an error handling routing callback when an error is propagated', function(done){
      var app = express();

      var a = false;
      var b = false;
      var c = false;
      var d = false;

      app.get('/', function(req, res, next){
        next(new Error('fabricated error'));
      }, function(req, res, next) {
        a = true;
        next();
      }, function(err, req, res, next){
        b = true;
        assert.strictEqual(err.message, 'fabricated error')
        next(err);
      }, function(err, req, res, next){
        c = true;
        assert.strictEqual(err.message, 'fabricated error')
        next();
      }, function(err, req, res, next){
        d = true;
        next();
      }, function(req, res){
        assert.ok(!a)
        assert.ok(b)
        assert.ok(c)
        assert.ok(!d)
        res.sendStatus(204);
      });

      request(app)
      .get('/')
      .expect(204, done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/config.js

#### should set a value

```ts
it('should set a value', function () {
      var app = express();
      app.set('foo', 'bar');
      assert.equal(app.get('foo'), 'bar');
    }
```

#### should set prototype values

```ts
it('should set prototype values', function () {
      var app = express()
      app.set('hasOwnProperty', 42)
      assert.strictEqual(app.get('hasOwnProperty'), 42)
    }
```

#### should return the app

```ts
it('should return the app', function () {
      var app = express();
      assert.equal(app.set('foo', 'bar'), app);
    }
```

#### should return the app when undefined

```ts
it('should return the app when undefined', function () {
      var app = express();
      assert.equal(app.set('foo', undefined), app);
    }
```

#### should return set value

```ts
it('should return set value', function () {
      var app = express()
      app.set('foo', 'bar')
      assert.strictEqual(app.set('foo'), 'bar')
    }
```

#### should return undefined for prototype values

```ts
it('should return undefined for prototype values', function () {
      var app = express()
      assert.strictEqual(app.set('hasOwnProperty'), undefined)
    }
```

#### should throw on bad value

```ts
it('should throw on bad value', function(){
        var app = express();
        assert.throws(app.set.bind(app, 'etag', 42), /unknown value/);
      }
```

#### should set "etag fn"

```ts
it('should set "etag fn"', function(){
        var app = express()
        var fn = function(){}
        app.set('etag', fn)
        assert.equal(app.get('etag fn'), fn)
      }
```

#### should set "trust proxy fn"

```ts
it('should set "trust proxy fn"', function(){
        var app = express()
        var fn = function(){}
        app.set('trust proxy', fn)
        assert.equal(app.get('trust proxy fn'), fn)
      }
```

#### should return undefined when unset

```ts
it('should return undefined when unset', function(){
      var app = express();
      assert.strictEqual(app.get('foo'), undefined);
    }
```

#### should otherwise return the value

```ts
it('should otherwise return the value', function(){
      var app = express();
      app.set('foo', 'bar');
      assert.equal(app.get('foo'), 'bar');
    }
```

#### should default to the parent app

```ts
it('should default to the parent app', function(){
        var app = express();
        var blog = express();

        app.set('title', 'Express');
        app.use(blog);
        assert.equal(blog.get('title'), 'Express');
      }
```

#### should given precedence to the child

```ts
it('should given precedence to the child', function(){
        var app = express();
        var blog = express();

        app.use(blog);
        app.set('title', 'Express');
        blog.set('title', 'Some Blog');

        assert.equal(blog.get('title'), 'Some Blog');
      }
```

#### should inherit "trust proxy" setting

```ts
it('should inherit "trust proxy" setting', function () {
        var app = express();
        var blog = express();

        function fn() { return false }

        app.set('trust proxy', fn);
        assert.equal(app.get('trust proxy'), fn);
        assert.equal(app.get('trust proxy fn'), fn);

        app.use(blog);

        assert.equal(blog.get('trust proxy'), fn);
        assert.equal(blog.get('trust proxy fn'), fn);
      }
```

#### should prefer child "trust proxy" setting

```ts
it('should prefer child "trust proxy" setting', function () {
        var app = express();
        var blog = express();

        function fn1() { return false }
        function fn2() { return true }

        app.set('trust proxy', fn1);
        assert.equal(app.get('trust proxy'), fn1);
        assert.equal(app.get('trust proxy fn'), fn1);

        blog.set('trust proxy', fn2);
        assert.equal(blog.get('trust proxy'), fn2);
        assert.equal(blog.get('trust proxy fn'), fn2);

        app.use(blog);

        assert.equal(app.get('trust proxy'), fn1);
        assert.equal(app.get('trust proxy fn'), fn1);
        assert.equal(blog.get('trust proxy'), fn2);
        assert.equal(blog.get('trust proxy fn'), fn2);
      }
```

#### should set the value to true

```ts
it('should set the value to true', function(){
      var app = express();
      assert.equal(app.enable('tobi'), app);
      assert.strictEqual(app.get('tobi'), true);
    }
```

#### should set prototype values

```ts
it('should set prototype values', function () {
      var app = express()
      app.enable('hasOwnProperty')
      assert.strictEqual(app.get('hasOwnProperty'), true)
    }
```

#### should set the value to false

```ts
it('should set the value to false', function(){
      var app = express();
      assert.equal(app.disable('tobi'), app);
      assert.strictEqual(app.get('tobi'), false);
    }
```

#### should set prototype values

```ts
it('should set prototype values', function () {
      var app = express()
      app.disable('hasOwnProperty')
      assert.strictEqual(app.get('hasOwnProperty'), false)
    }
```

#### should default to false

```ts
it('should default to false', function(){
      var app = express();
      assert.strictEqual(app.enabled('foo'), false);
    }
```

#### should return true when set

```ts
it('should return true when set', function(){
      var app = express();
      app.set('foo', 'bar');
      assert.strictEqual(app.enabled('foo'), true);
    }
```

#### should default to false for prototype values

```ts
it('should default to false for prototype values', function () {
      var app = express()
      assert.strictEqual(app.enabled('hasOwnProperty'), false)
    }
```

#### should default to true

```ts
it('should default to true', function(){
      var app = express();
      assert.strictEqual(app.disabled('foo'), true);
    }
```

#### should return false when set

```ts
it('should return false when set', function(){
      var app = express();
      app.set('foo', 'bar');
      assert.strictEqual(app.disabled('foo'), false);
    }
```

#### should default to true for prototype values

```ts
it('should default to true for prototype values', function () {
      var app = express()
      assert.strictEqual(app.disabled('hasOwnProperty'), true)
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

### ../../.sbomtest/repos/f3c62de455-express/test/res.send.js

#### should set body to ""

```ts
it('should set body to ""', function(done){
      var app = express();

      app.use(function(req, res){
        res.send();
      });

      request(app)
      .get('/')
      .expect(200, '', done);
    }
```

#### should set body to ""

```ts
it('should set body to ""', function(done){
      var app = express();

      app.use(function(req, res){
        res.send(null);
      });

      request(app)
      .get('/')
      .expect('Content-Length', '0')
      .expect(200, '', done);
    }
```

#### should set body to ""

```ts
it('should set body to ""', function(done){
      var app = express();

      app.use(function(req, res){
        res.send(undefined);
      });

      request(app)
      .get('/')
      .expect(200, '', done);
    }
```

#### should send as application/json

```ts
it('should send as application/json', function(done){
      var app = express();

      app.use(function(req, res){
        res.send(1000);
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(200, '1000', done)
    }
```

#### should send as html

```ts
it('should send as html', function(done){
      var app = express();

      app.use(function(req, res){
        res.send('<p>hey</p>');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(200, '<p>hey</p>', done);
    }
```

#### should set ETag

```ts
it('should set ETag', function (done) {
      var app = express();

      app.use(function (req, res) {
        var str = Array(1000).join('-');
        res.send(str);
      });

      request(app)
      .get('/')
      .expect('ETag', 'W/"3e7-qPnkJ3CVdVhFJQvUBfF10TmVA7g"')
      .expect(200, done);
    }
```

#### should not override Content-Type

```ts
it('should not override Content-Type', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/plain').send('hey');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/plain; charset=utf-8')
      .expect(200, 'hey', done);
    }
```

#### should override charset in Content-Type

```ts
it('should override charset in Content-Type', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/plain; charset=iso-8859-1').send('hey');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/plain; charset=utf-8')
      .expect(200, 'hey', done);
    }
```

#### should keep charset in Content-Type for Buffers

```ts
it('should keep charset in Content-Type for Buffers', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/plain; charset=iso-8859-1').send(Buffer.from('hi'))
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/plain; charset=iso-8859-1')
      .expect(200, 'hi', done);
    }
```

#### should send as octet-stream

```ts
it('should send as octet-stream', function(done){
      var app = express();

      app.use(function(req, res){
        res.send(Buffer.from('hello'))
      });

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'application/octet-stream')
        .expect(utils.shouldHaveBody(Buffer.from('hello')))
        .end(done)
    }
```

#### should set ETag

```ts
it('should set ETag', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.send(Buffer.alloc(999, '-'))
      });

      request(app)
      .get('/')
      .expect('ETag', 'W/"3e7-qPnkJ3CVdVhFJQvUBfF10TmVA7g"')
      .expect(200, done);
    }
```

#### should not override Content-Type

```ts
it('should not override Content-Type', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/plain').send(Buffer.from('hey'))
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/plain; charset=utf-8')
      .expect(200, 'hey', done);
    }
```

#### should accept Uint8Array

```ts
it('should accept Uint8Array', function(done){
      var app = express();
      app.use(function(req, res){
        const encodedHey = new TextEncoder().encode("hey");
        res.set("Content-Type", "text/plain").send(encodedHey);
      })

      request(app)
        .get("/")
        .expect("Content-Type", "text/plain; charset=utf-8")
        .expect(200, "hey", done);
    }
```

#### should not override ETag

```ts
it('should not override ETag', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.type('text/plain').set('ETag', '"foo"').send(Buffer.from('hey'))
      })

      request(app)
      .get('/')
      .expect('ETag', '"foo"')
      .expect(200, 'hey', done)
    }
```

#### should send as application/json

```ts
it('should send as application/json', function(done){
      var app = express();

      app.use(function(req, res){
        res.send({ name: 'tobi' });
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(200, '{"name":"tobi"}', done)
    }
```

#### should ignore the body

```ts
it('should ignore the body', function(done){
      var app = express();

      app.use(function(req, res){
        res.send('yay');
      });

      request(app)
        .head('/')
        .expect(200)
        .expect(utils.shouldNotHaveBody())
        .end(done)
    }
```

#### should strip Content-* fields, Transfer-Encoding field, and body

```ts
it('should strip Content-* fields, Transfer-Encoding field, and body', function(done){
      var app = express();

      app.use(function(req, res){
        res.status(204).set('Transfer-Encoding', 'chunked').send('foo');
      });

      request(app)
      .get('/')
      .expect(utils.shouldNotHaveHeader('Content-Type'))
      .expect(utils.shouldNotHaveHeader('Content-Length'))
      .expect(utils.shouldNotHaveHeader('Transfer-Encoding'))
      .expect(204, '', done);
    }
```

#### should strip Transfer-Encoding field and body, set Content-Length

```ts
it('should strip Transfer-Encoding field and body, set Content-Length', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.status(205).set('Transfer-Encoding', 'chunked').send('foo')
      })

      request(app)
        .get('/')
        .expect(utils.shouldNotHaveHeader('Transfer-Encoding'))
        .expect('Content-Length', '0')
        .expect(205, '', done)
    }
```

#### should always check regardless of length

```ts
it('should always check regardless of length', function(done){
    var app = express();
    var etag = '"asdf"';

    app.use(function(req, res, next){
      res.set('ETag', etag);
      res.send('hey');
    });

    request(app)
    .get('/')
    .set('If-None-Match', etag)
    .expect(304, done);
  }
```

#### should respond with 304 Not Modified when fresh

```ts
it('should respond with 304 Not Modified when fresh', function(done){
    var app = express();
    var etag = '"asdf"';

    app.use(function(req, res){
      var str = Array(1000).join('-');
      res.set('ETag', etag);
      res.send(str);
    });

    request(app)
    .get('/')
    .set('If-None-Match', etag)
    .expect(304, done);
  }
```

#### should not perform freshness check unless 2xx or 304

```ts
it('should not perform freshness check unless 2xx or 304', function(done){
    var app = express();
    var etag = '"asdf"';

    app.use(function(req, res, next){
      res.status(500);
      res.set('ETag', etag);
      res.send('hey');
    });

    request(app)
    .get('/')
    .set('If-None-Match', etag)
    .expect('hey')
    .expect(500, done);
  }
```

#### should not support jsonp callbacks

```ts
it('should not support jsonp callbacks', function(done){
    var app = express();

    app.use(function(req, res){
      res.send({ foo: 'bar' });
    });

    request(app)
    .get('/?callback=foo')
    .expect('{"foo":"bar"}', done);
  }
```

#### should be chainable

```ts
it('should be chainable', function (done) {
    var app = express()

    app.use(function (req, res) {
      assert.equal(res.send('hey'), res)
    })

    request(app)
    .get('/')
    .expect(200, 'hey', done)
  }
```

#### should send ETag

```ts
it('should send ETag', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.send('kajdslfkasdf');
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect('ETag', 'W/"c-IgR/L5SF7CJQff4wxKGF/vfPuZ0"')
        .expect(200, done);
      }
```

#### should send ETag in response to ' + method.toUpperCase() + ' request

```ts
it('should send ETag in response to ' + method.toUpperCase() + ' request', function (done) {
          if (method === 'query' && shouldSkipQuery(process.versions.node)) {
            this.skip()
          }
          var app = express();

          app[method]('/', function (req, res) {
            res.send('kajdslfkasdf');
          });

          request(app)
          [method]('/')
          .expect('ETag', 'W/"c-IgR/L5SF7CJQff4wxKGF/vfPuZ0"')
          .expect(200, done);
        }
```

#### should send ETag for empty string response

```ts
it('should send ETag for empty string response', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.send('');
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect('ETag', 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"')
        .expect(200, done);
      }
```

#### should send ETag for long response

```ts
it('should send ETag for long response', function (done) {
        var app = express();

        app.use(function (req, res) {
          var str = Array(1000).join('-');
          res.send(str);
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect('ETag', 'W/"3e7-qPnkJ3CVdVhFJQvUBfF10TmVA7g"')
        .expect(200, done);
      }
```

#### should not override ETag when manually set

```ts
it('should not override ETag when manually set', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.set('etag', '"asdf"');
          res.send('hello!');
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect('ETag', '"asdf"')
        .expect(200, done);
      }
```

#### should not send ETag for res.send()

```ts
it('should not send ETag for res.send()', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.send();
        });

        app.enable('etag');

        request(app)
        .get('/')
        .expect(utils.shouldNotHaveHeader('ETag'))
        .expect(200, done);
      }
```

#### should send no ETag

```ts
it('should send no ETag', function (done) {
        var app = express();

        app.use(function (req, res) {
          var str = Array(1000).join('-');
          res.send(str);
        });

        app.disable('etag');

        request(app)
        .get('/')
        .expect(utils.shouldNotHaveHeader('ETag'))
        .expect(200, done);
      }
```

#### should send ETag when manually set

```ts
it('should send ETag when manually set', function (done) {
        var app = express();

        app.disable('etag');

        app.use(function (req, res) {
          res.set('etag', '"asdf"');
          res.send('hello!');
        });

        request(app)
        .get('/')
        .expect('ETag', '"asdf"')
        .expect(200, done);
      }
```

#### should send strong ETag

```ts
it('should send strong ETag', function (done) {
        var app = express();

        app.set('etag', 'strong');

        app.use(function (req, res) {
          res.send('hello, world!');
        });

        request(app)
        .get('/')
        .expect('ETag', '"d-HwnTDHB9U/PRbFMN1z1wps51lqk"')
        .expect(200, done);
      }
```

#### should send weak ETag

```ts
it('should send weak ETag', function (done) {
        var app = express();

        app.set('etag', 'weak');

        app.use(function (req, res) {
          res.send('hello, world!');
        });

        request(app)
        .get('/')
        .expect('ETag', 'W/"d-HwnTDHB9U/PRbFMN1z1wps51lqk"')
        .expect(200, done)
      }
```

#### should send custom ETag

```ts
it('should send custom ETag', function (done) {
        var app = express();

        app.set('etag', function (body, encoding) {
          var chunk = !Buffer.isBuffer(body)
            ? Buffer.from(body, encoding)
            : body;
          assert.strictEqual(chunk.toString(), 'hello, world!')
          return '"custom"';
        });

        app.use(function (req, res) {
          res.send('hello, world!');
        });

        request(app)
        .get('/')
        .expect('ETag', '"custom"')
        .expect(200, done);
      }
```

#### should not send falsy ETag

```ts
it('should not send falsy ETag', function (done) {
        var app = express();

        app.set('etag', function (body, encoding) {
          return undefined;
        });

        app.use(function (req, res) {
          res.send('hello, world!');
        });

        request(app)
        .get('/')
        .expect(utils.shouldNotHaveHeader('ETag'))
        .expect(200, done);
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

#### should throw on invalid date

```ts
it('should throw on invalid date', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { expires: new Date(NaN) })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option expires is invalid/, done)
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

#### should set max-age

```ts
it('should set max-age', function(done){
        var app = express();

        app.use(function(req, res){
          res.cookie('name', 'tobi', { maxAge: 1000 });
          res.end();
        });

        request(app)
        .get('/')
        .expect('Set-Cookie', /Max-Age=1/, done)
      }
```

#### should not mutate the options object

```ts
it('should not mutate the options object', function(done){
        var app = express();

        var options = { maxAge: 1000 };
        var optionsCopy = { ...options };

        app.use(function(req, res){
          res.cookie('name', 'tobi', options)
          res.json(options)
        });

        request(app)
        .get('/')
        .expect(200, optionsCopy, done)
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

#### should throw an error with invalid maxAge

```ts
it('should throw an error with invalid maxAge', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { maxAge: 'foobar' })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option maxAge is invalid/, done)
      }
```

#### should set low priority

```ts
it('should set low priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'low' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=Low/)
          .expect(200, done)
      }
```

#### should set medium priority

```ts
it('should set medium priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'medium' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=Medium/)
          .expect(200, done)
      }
```

#### should set high priority

```ts
it('should set high priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'high' })
          res.end()
        })

        request(app)
          .get('/')
          .expect('Set-Cookie', /Priority=High/)
          .expect(200, done)
      }
```

#### should throw with invalid priority

```ts
it('should throw with invalid priority', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.cookie('name', 'tobi', { priority: 'foobar' })
          res.end()
        })

        request(app)
          .get('/')
          .expect(500, /option priority is invalid/, done)
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

#### should throw an error

```ts
it('should throw an error', function(done){
        var app = express();

        app.use(cookieParser());

        app.use(function(req, res){
          res.cookie('name', 'tobi', { signed: true }).end();
        });

        request(app)
        .get('/')
        .expect(500, /secret\S+ required for signed cookies/, done);
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

### ../../.sbomtest/repos/f3c62de455-express/test/res.jsonp.js

#### should respond with jsonp

```ts
it('should respond with jsonp', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?callback=something')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /something\(\{"count":1\}\);/, done);
    }
```

#### should use first callback parameter with jsonp

```ts
it('should use first callback parameter with jsonp', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?callback=something&callback=somethingelse')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /something\(\{"count":1\}\);/, done);
    }
```

#### should ignore object callback parameter with jsonp

```ts
it('should ignore object callback parameter with jsonp', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?callback[a]=something')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(200, '{"count":1}', done)
    }
```

#### should allow renaming callback

```ts
it('should allow renaming callback', function(done){
      var app = express();

      app.set('jsonp callback name', 'clb');

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?clb=something')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /something\(\{"count":1\}\);/, done);
    }
```

#### should allow []

```ts
it('should allow []', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?callback=callbacks[123]')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /callbacks\[123\]\(\{"count":1\}\);/, done);
    }
```

#### should disallow arbitrary js

```ts
it('should disallow arbitrary js', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({});
      });

      request(app)
      .get('/?callback=foo;bar()')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /foobar\(\{\}\);/, done);
    }
```

#### should escape utf whitespace

```ts
it('should escape utf whitespace', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ str: '\u2028 \u2029 woot' });
      });

      request(app)
      .get('/?callback=foo')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect(200, /foo\(\{"str":"\\u2028 \\u2029 woot"\}\);/, done);
    }
```

#### should not escape utf whitespace for json fallback

```ts
it('should not escape utf whitespace for json fallback', function(done){
      var app = express();

      app.use(function(req, res){
        res.jsonp({ str: '\u2028 \u2029 woot' });
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(200, '{"str":"\u2028 \u2029 woot"}', done);
    }
```

#### should include security header and prologue

```ts
it('should include security header and prologue', function (done) {
      var app = express();

      app.use(function(req, res){
        res.jsonp({ count: 1 });
      });

      request(app)
      .get('/?callback=something')
      .expect('Content-Type', 'text/javascript; charset=utf-8')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(200, /^\/\*\*\//, done);
    }
```

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

#### should invoke callback with no arguments

```ts
it('should invoke callback with no arguments', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp(undefined)
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(\)/, done)
      }
```

#### should invoke callback with null

```ts
it('should invoke callback with null', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp(null)
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(null\)/, done)
      }
```

#### should invoke callback with a string

```ts
it('should invoke callback with a string', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp('tobi')
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\("tobi"\)/, done)
      }
```

#### should invoke callback with a number

```ts
it('should invoke callback with a number', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp(42)
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(42\)/, done)
      }
```

#### should invoke callback with an array

```ts
it('should invoke callback with an array', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp(['foo', 'bar', 'baz'])
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(\["foo","bar","baz"\]\)/, done)
      }
```

#### should invoke callback with an object

```ts
it('should invoke callback with an object', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.jsonp({ name: 'tobi' })
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(\{"name":"tobi"\}\)/, done)
      }
```

#### should be undefined by default

```ts
it('should be undefined by default', function () {
        var app = express()
        assert.strictEqual(app.get('json escape'), undefined)
      }
```

#### should unicode escape HTML-sniffing characters

```ts
it('should unicode escape HTML-sniffing characters', function (done) {
        var app = express()

        app.enable('json escape')

        app.use(function (req, res) {
          res.jsonp({ '&': '\u2028<script>\u2029' })
        })

        request(app)
        .get('/?callback=foo')
        .expect('Content-Type', 'text/javascript; charset=utf-8')
        .expect(200, /foo\({"\\u0026":"\\u2028\\u003cscript\\u003e\\u2029"}\)/, done)
      }
```

#### should not break undefined escape

```ts
it('should not break undefined escape', function (done) {
        var app = express()

        app.enable('json escape')

        app.use(function (req, res) {
          res.jsonp(undefined)
        })

        request(app)
          .get('/?callback=cb')
          .expect('Content-Type', 'text/javascript; charset=utf-8')
          .expect(200, /cb\(\)/, done)
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

#### should be undefined by default

```ts
it('should be undefined by default', function(){
        var app = express();
        assert(undefined === app.get('json spaces'));
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.jsonp({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.status.js

#### should set the status code when valid

```ts
it('should set the status code when valid', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.status(200).end();
      });

      request(app)
        .get('/')
        .expect(200, done);
    }
```

#### should set the response status code to 101

```ts
it('should set the response status code to 101', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(101).end()
        })

        request(app)
          .get('/')
          .expect(101, done)
      }
```

#### should set the response status code to 201

```ts
it('should set the response status code to 201', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(201).end()
        })

        request(app)
          .get('/')
          .expect(201, done)
      }
```

#### should set the response status code to 302

```ts
it('should set the response status code to 302', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(302).end()
        })

        request(app)
          .get('/')
          .expect(302, done)
      }
```

#### should set the response status code to 403

```ts
it('should set the response status code to 403', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(403).end()
        })

        request(app)
          .get('/')
          .expect(403, done)
      }
```

#### should set the response status code to 501

```ts
it('should set the response status code to 501', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(501).end()
        })

        request(app)
          .get('/')
          .expect(501, done)
      }
```

#### should set the response status code to 700

```ts
it('should set the response status code to 700', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(700).end()
        })

        request(app)
          .get('/')
          .expect(700, done)
      }
```

#### should set the response status code to 800

```ts
it('should set the response status code to 800', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(800).end()
        })

        request(app)
          .get('/')
          .expect(800, done)
      }
```

#### should set the response status code to 900

```ts
it('should set the response status code to 900', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.status(900).end()
        })

        request(app)
          .get('/')
          .expect(900, done)
      }
```

#### should raise error for status code below 100

```ts
it('should raise error for status code below 100', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(99).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for status code above 999

```ts
it('should raise error for status code above 999', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(1000).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for non-integer status codes

```ts
it('should raise error for non-integer status codes', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(200.1).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for undefined status code

```ts
it('should raise error for undefined status code', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(undefined).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for null status code

```ts
it('should raise error for null status code', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(null).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for string status code

```ts
it('should raise error for string status code', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status("200").end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

#### should raise error for NaN status code

```ts
it('should raise error for NaN status code', function (done) {
        var app = express();

        app.use(function (req, res) {
          res.status(NaN).end();
        });

        request(app)
          .get('/')
          .expect(500, /Invalid status code/, done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.download.js

#### should transfer as an attachment

```ts
it('should transfer as an attachment', function(done){
      var app = express();

      app.use(function(req, res){
        res.download('test/fixtures/user.html');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="user.html"')
      .expect(200, '<p>{{user.name}}</p>', done)
    }
```

#### should accept range requests

```ts
it('should accept range requests', function (done) {
      var app = express()

      app.get('/', function (req, res) {
        res.download('test/fixtures/user.html')
      })

      request(app)
        .get('/')
        .expect('Accept-Ranges', 'bytes')
        .expect(200, '<p>{{user.name}}</p>', done)
    }
```

#### should respond with requested byte range

```ts
it('should respond with requested byte range', function (done) {
      var app = express()

      app.get('/', function (req, res) {
        res.download('test/fixtures/user.html')
      })

      request(app)
        .get('/')
        .set('Range', 'bytes=0-2')
        .expect('Content-Range', 'bytes 0-2/20')
        .expect(206, '<p>', done)
    }
```

#### should provide an alternate filename

```ts
it('should provide an alternate filename', function(done){
      var app = express();

      app.use(function(req, res){
        res.download('test/fixtures/user.html', 'document');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .expect(200, done)
    }
```

#### should invoke the callback

```ts
it('should invoke the callback', function(done){
      var app = express();
      var cb = after(2, done);

      app.use(function(req, res){
        res.download('test/fixtures/user.html', cb);
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="user.html"')
      .expect(200, cb);
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

#### should allow options to res.sendFile()

```ts
it('should allow options to res.sendFile()', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.download('test/fixtures/.name', {
          dotfiles: 'allow',
          maxAge: '4h'
        })
      })

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Disposition', 'attachment; filename=".name"')
        .expect('Cache-Control', 'public, max-age=14400')
        .expect(utils.shouldHaveBody(Buffer.from('tobi')))
        .end(done)
    }
```

#### should set headers on response

```ts
it('should set headers on response', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('test/fixtures/user.html', {
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
          res.download('test/fixtures/user.html', {
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
          res.download('test/fixtures/user.html', {
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
          res.download('test/fixtures/does-not-exist', {
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

#### should be ignored

```ts
it('should be ignored', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.download('test/fixtures/user.html', {
              headers: {
                'Content-Disposition': 'inline'
              }
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Content-Disposition', 'attachment; filename="user.html"')
            .end(done)
        }
```

#### should be ignored case-insensitively

```ts
it('should be ignored case-insensitively', function (done) {
          var app = express()

          app.use(function (req, res) {
            res.download('test/fixtures/user.html', {
              headers: {
                'content-disposition': 'inline'
              }
            })
          })

          request(app)
            .get('/')
            .expect(200)
            .expect('Content-Disposition', 'attachment; filename="user.html"')
            .end(done)
        }
```

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

#### should invoke the callback

```ts
it('should invoke the callback', function(done){
      var app = express();
      var cb = after(2, done);

      app.use(function(req, res){
        res.download('test/fixtures/user.html', 'document', cb)
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .expect(200, cb);
    }
```

#### should invoke the callback

```ts
it('should invoke the callback', function (done) {
      var app = express()
      var cb = after(2, done)
      var options = {}

      app.use(function (req, res) {
        res.download('test/fixtures/user.html', 'document', options, cb)
      })

      request(app)
      .get('/')
      .expect(200)
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect('Content-Disposition', 'attachment; filename="document"')
      .end(cb)
    }
```

#### should allow options to res.sendFile()

```ts
it('should allow options to res.sendFile()', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.download('test/fixtures/.name', 'document', {
          dotfiles: 'allow',
          maxAge: '4h'
        })
      })

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Disposition', 'attachment; filename="document"')
        .expect('Cache-Control', 'public, max-age=14400')
        .expect(utils.shouldHaveBody(Buffer.from('tobi')))
        .end(done)
    }
```

#### should be ignored

```ts
it('should be ignored', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('test/fixtures/user.html', 'document', {
            headers: {
              'Content-Type': 'text/x-custom',
              'Content-Disposition': 'inline'
            }
          })
        })

        request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'text/x-custom')
        .expect('Content-Disposition', 'attachment; filename="document"')
        .end(done)
      }
```

#### should be ignored case-insensitively

```ts
it('should be ignored case-insensitively', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.download('test/fixtures/user.html', 'document', {
            headers: {
              'content-type': 'text/x-custom',
              'content-disposition': 'inline'
            }
          })
        })

        request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'text/x-custom')
        .expect('Content-Disposition', 'attachment; filename="document"')
        .end(done)
      }
```

#### should remove Content-Disposition

```ts
it('should remove Content-Disposition', function(done){
      var app = express()

      app.use(function (req, res, next) {
        res.download('test/fixtures/foobar.html', function(err){
          if (!err) return next(new Error('expected error'));
          res.end('failed');
        });
      });

      request(app)
        .get('/')
        .expect(utils.shouldNotHaveHeader('Content-Disposition'))
        .expect(200, 'failed', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.hostname.js

#### should return the Host when present

```ts
it('should return the Host when present', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.hostname);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com')
      .expect('example.com', done);
    }
```

#### should strip port number

```ts
it('should strip port number', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.hostname);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com:3000')
      .expect('example.com', done);
    }
```

#### should return undefined otherwise

```ts
it('should return undefined otherwise', function(done){
      var app = express();

      app.use(function(req, res){
        req.headers.host = null;
        res.end(String(req.hostname));
      });

      request(app)
      .post('/')
      .expect('undefined', done);
    }
```

#### should work with IPv6 Host

```ts
it('should work with IPv6 Host', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.hostname);
      });

      request(app)
      .post('/')
      .set('Host', '[::1]')
      .expect('[::1]', done);
    }
```

#### should work with IPv6 Host and port

```ts
it('should work with IPv6 Host and port', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.hostname);
      });

      request(app)
      .post('/')
      .set('Host', '[::1]:3000')
      .expect('[::1]', done);
    }
```

#### should respect X-Forwarded-Host

```ts
it('should respect X-Forwarded-Host', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.hostname);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'example.com:3000')
        .expect('example.com', done);
      }
```

#### should ignore X-Forwarded-Host if socket addr not trusted

```ts
it('should ignore X-Forwarded-Host if socket addr not trusted', function(done){
        var app = express();

        app.set('trust proxy', '10.0.0.1');

        app.use(function(req, res){
          res.end(req.hostname);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'example.com')
        .expect('localhost', done);
      }
```

#### should default to Host

```ts
it('should default to Host', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.hostname);
        });

        request(app)
        .get('/')
        .set('Host', 'example.com')
        .expect('example.com', done);
      }
```

#### should use the first value

```ts
it('should use the first value', function (done) {
          var app = express()

          app.enable('trust proxy')

          app.use(function (req, res) {
            res.send(req.hostname)
          })

          request(app)
          .get('/')
          .set('Host', 'localhost')
          .set('X-Forwarded-Host', 'example.com, foobar.com')
          .expect(200, 'example.com', done)
        }
```

#### should remove OWS around comma

```ts
it('should remove OWS around comma', function (done) {
          var app = express()

          app.enable('trust proxy')

          app.use(function (req, res) {
            res.send(req.hostname)
          })

          request(app)
          .get('/')
          .set('Host', 'localhost')
          .set('X-Forwarded-Host', 'example.com , foobar.com')
          .expect(200, 'example.com', done)
        }
```

#### should strip port number

```ts
it('should strip port number', function (done) {
          var app = express()

          app.enable('trust proxy')

          app.use(function (req, res) {
            res.send(req.hostname)
          })

          request(app)
          .get('/')
          .set('Host', 'localhost')
          .set('X-Forwarded-Host', 'example.com:8080 , foobar.com:8888')
          .expect(200, 'example.com', done)
        }
```

#### should ignore X-Forwarded-Host

```ts
it('should ignore X-Forwarded-Host', function(done){
        var app = express();

        app.use(function(req, res){
          res.end(req.hostname);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'evil')
        .expect('localhost', done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.location.js

#### should set the header

```ts
it('should set the header', function(done){
      var app = express();

      app.use(function(req, res){
        res.location('http://google.com/').end();
      });

      request(app)
      .get('/')
      .expect('Location', 'http://google.com/')
      .expect(200, done)
    }
```

#### should preserve trailing slashes when not present

```ts
it('should preserve trailing slashes when not present', function(done){
      var app = express();

      app.use(function(req, res){
        res.location('http://google.com').end();
      });

      request(app)
      .get('/')
      .expect('Location', 'http://google.com')
      .expect(200, done)
    }
```

#### should encode "url"

```ts
it('should encode "url"', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.location('https://google.com?q=\u2603 §10').end()
      })

      request(app)
      .get('/')
      .expect('Location', 'https://google.com?q=%E2%98%83%20%C2%A710')
      .expect(200, done)
    }
```

#### should encode data uri

```ts
it('should encode data uri', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location('data:text/javascript,export default () => { }').end();
      });

      request(app)
        .get('/')
        .expect('Location', 'data:text/javascript,export%20default%20()%20=%3E%20%7B%20%7D')
        .expect(200, done)
    }
```

#### should consistently handle non-string input: boolean

```ts
it('should consistently handle non-string input: boolean', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location(true).end();
      });

      request(app)
        .get('/')
        .expect('Location', 'true')
        .expect(200, done)
    }
```

#### should consistently handle non-string inputs: object

```ts
it('should consistently handle non-string inputs: object', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location({}).end();
      });

      request(app)
        .get('/')
        .expect('Location', '[object%20Object]')
        .expect(200, done)
    }
```

#### should consistently handle non-string inputs: array

```ts
it('should consistently handle non-string inputs: array', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location([]).end();
      });

      request(app)
        .get('/')
        .expect('Location', '')
        .expect(200, done)
    }
```

#### should consistently handle empty string input

```ts
it('should consistently handle empty string input', function (done) {
      var app = express()
      app.use(function (req, res) {
        res.location('').end();
      });

      request(app)
        .get('/')
        .expect('Location', '')
        .expect(200, done)
    }
```

#### should accept an instance of URL

```ts
it('should accept an instance of URL', function (done) {
        var app = express();

        app.use(function(req, res){
          res.location(new URL('http://google.com/')).end();
        });

        request(app)
          .get('/')
          .expect('Location', 'http://google.com/')
          .expect(200, done);
      }
```

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

#### should not support jsonp callbacks

```ts
it('should not support jsonp callbacks', function(done){
      var app = express();

      app.use(function(req, res){
        res.json({ foo: 'bar' });
      });

      request(app)
      .get('/?callback=foo')
      .expect('{"foo":"bar"}', done);
    }
```

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

#### should respond with json for null

```ts
it('should respond with json for null', function(done){
        var app = express();

        app.use(function(req, res){
          res.json(null);
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, 'null', done)
      }
```

#### should respond with json for Number

```ts
it('should respond with json for Number', function(done){
        var app = express();

        app.use(function(req, res){
          res.json(300);
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '300', done)
      }
```

#### should respond with json for String

```ts
it('should respond with json for String', function(done){
        var app = express();

        app.use(function(req, res){
          res.json('str');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '"str"', done)
      }
```

#### should respond with json

```ts
it('should respond with json', function(done){
        var app = express();

        app.use(function(req, res){
          res.json(['foo', 'bar', 'baz']);
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '["foo","bar","baz"]', done)
      }
```

#### should respond with json

```ts
it('should respond with json', function(done){
        var app = express();

        app.use(function(req, res){
          res.json({ name: 'tobi' });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"name":"tobi"}', done)
      }
```

#### should be undefined by default

```ts
it('should be undefined by default', function () {
        var app = express()
        assert.strictEqual(app.get('json escape'), undefined)
      }
```

#### should unicode escape HTML-sniffing characters

```ts
it('should unicode escape HTML-sniffing characters', function (done) {
        var app = express()

        app.enable('json escape')

        app.use(function (req, res) {
          res.json({ '&': '<script>' })
        })

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{"\\u0026":"\\u003cscript\\u003e"}', done)
      }
```

#### should not break undefined escape

```ts
it('should not break undefined escape', function (done) {
        var app = express()

        app.enable('json escape')

        app.use(function (req, res) {
          res.json(undefined)
        })

        request(app)
          .get('/')
          .expect('Content-Type', 'application/json; charset=utf-8')
          .expect(200, '', done)
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

#### should be undefined by default

```ts
it('should be undefined by default', function(){
        var app = express();
        assert(undefined === app.get('json spaces'));
      }
```

#### should be passed to JSON.stringify()

```ts
it('should be passed to JSON.stringify()', function(done){
        var app = express();

        app.set('json spaces', 2);

        app.use(function(req, res){
          res.json({ name: 'tobi', age: 2 });
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/json; charset=utf-8')
        .expect(200, '{\n  "name": "tobi",\n  "age": 2\n}', done)
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

#### should support nesting

```ts
it('should support nesting', function (done) {
      request(this.app)
        .get('/users/tobi.txt')
        .expect(200, 'ferret', done)
    }
```

#### should set Content-Type

```ts
it('should set Content-Type', function (done) {
      request(this.app)
        .get('/todo.txt')
        .expect('Content-Type', 'text/plain; charset=utf-8')
        .expect(200, done)
    }
```

#### should set Last-Modified

```ts
it('should set Last-Modified', function (done) {
      request(this.app)
        .get('/todo.txt')
        .expect('Last-Modified', /\d{2} \w{3} \d{4}/)
        .expect(200, done)
    }
```

#### should default max-age=0

```ts
it('should default max-age=0', function (done) {
      request(this.app)
        .get('/todo.txt')
        .expect('Cache-Control', 'public, max-age=0')
        .expect(200, done)
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

#### should not choke on auth-looking URL

```ts
it('should not choke on auth-looking URL', function (done) {
      request(this.app)
        .get('//todo@txt')
        .expect(404, 'Not Found', done)
    }
```

#### should support index.html

```ts
it('should support index.html', function (done) {
      request(this.app)
        .get('/users/')
        .expect(200)
        .expect('Content-Type', /html/)
        .expect('<p>tobi, loki, jane</p>', done)
    }
```

#### should support ../

```ts
it('should support ../', function (done) {
      request(this.app)
        .get('/users/../todo.txt')
        .expect(200, '- groceries', done)
    }
```

#### should support HEAD

```ts
it('should support HEAD', function (done) {
      request(this.app)
        .head('/todo.txt')
        .expect(200)
        .expect(utils.shouldNotHaveBody())
        .end(done)
    }
```

#### should skip POST requests

```ts
it('should skip POST requests', function (done) {
      request(this.app)
        .post('/todo.txt')
        .expect(404, 'Not Found', done)
    }
```

#### should support conditional requests

```ts
it('should support conditional requests', function (done) {
      var app = this.app

      request(app)
        .get('/todo.txt')
        .end(function (err, res) {
          if (err) throw err
          request(app)
            .get('/todo.txt')
            .set('If-None-Match', res.headers.etag)
            .expect(304, done)
        })
    }
```

#### should support precondition checks

```ts
it('should support precondition checks', function (done) {
      request(this.app)
        .get('/todo.txt')
        .set('If-Match', '"foo"')
        .expect(412, done)
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

#### should be served with "."

```ts
it('should be served with "."', function (done) {
      var dest = relative.split(path.sep).join('/')
      request(this.app)
        .get('/' + dest + '/todo.txt')
        .expect(200, '- groceries', done)
    }
```

#### should not include Accept-Ranges

```ts
it('should not include Accept-Ranges', function (done) {
        request(createApp(fixtures, { 'acceptRanges': false }))
          .get('/nums.txt')
          .expect(utils.shouldNotHaveHeader('Accept-Ranges'))
          .expect(200, '123456789', done)
      }
```

#### should ignore Rage request header

```ts
it('should ignore Rage request header', function (done) {
        request(createApp(fixtures, { 'acceptRanges': false }))
          .get('/nums.txt')
          .set('Range', 'bytes=0-3')
          .expect(utils.shouldNotHaveHeader('Accept-Ranges'))
          .expect(utils.shouldNotHaveHeader('Content-Range'))
          .expect(200, '123456789', done)
      }
```

#### should include Accept-Ranges

```ts
it('should include Accept-Ranges', function (done) {
        request(createApp(fixtures, { 'acceptRanges': true }))
          .get('/nums.txt')
          .expect('Accept-Ranges', 'bytes')
          .expect(200, '123456789', done)
      }
```

#### should obey Rage request header

```ts
it('should obey Rage request header', function (done) {
        request(createApp(fixtures, { 'acceptRanges': true }))
          .get('/nums.txt')
          .set('Range', 'bytes=0-3')
          .expect('Accept-Ranges', 'bytes')
          .expect('Content-Range', 'bytes 0-3/9')
          .expect(206, '1234', done)
      }
```

#### should not include Cache-Control

```ts
it('should not include Cache-Control', function (done) {
        request(createApp(fixtures, { 'cacheControl': false }))
          .get('/nums.txt')
          .expect(utils.shouldNotHaveHeader('Cache-Control'))
          .expect(200, '123456789', done)
      }
```

#### should ignore maxAge

```ts
it('should ignore maxAge', function (done) {
        request(createApp(fixtures, { 'cacheControl': false, 'maxAge': 12000 }))
          .get('/nums.txt')
          .expect(utils.shouldNotHaveHeader('Cache-Control'))
          .expect(200, '123456789', done)
      }
```

#### should include Cache-Control

```ts
it('should include Cache-Control', function (done) {
        request(createApp(fixtures, { 'cacheControl': true }))
          .get('/nums.txt')
          .expect('Cache-Control', 'public, max-age=0')
          .expect(200, '123456789', done)
      }
```

#### should be not be enabled by default

```ts
it('should be not be enabled by default', function (done) {
      request(createApp(fixtures))
        .get('/todo')
        .expect(404, done)
    }
```

#### should be configurable

```ts
it('should be configurable', function (done) {
      request(createApp(fixtures, { 'extensions': 'txt' }))
        .get('/todo')
        .expect(200, '- groceries', done)
    }
```

#### should support disabling extensions

```ts
it('should support disabling extensions', function (done) {
      request(createApp(fixtures, { 'extensions': false }))
        .get('/todo')
        .expect(404, done)
    }
```

#### should support fallbacks

```ts
it('should support fallbacks', function (done) {
      request(createApp(fixtures, { 'extensions': ['htm', 'html', 'txt'] }))
        .get('/todo')
        .expect(200, '<li>groceries</li>', done)
    }
```

#### should 404 if nothing found

```ts
it('should 404 if nothing found', function (done) {
      request(createApp(fixtures, { 'extensions': ['htm', 'html', 'txt'] }))
        .get('/bob')
        .expect(404, done)
    }
```

#### should default to true

```ts
it('should default to true', function (done) {
      request(createApp())
        .get('/does-not-exist')
        .expect(404, 'Not Found', done)
    }
```

#### should fall-through when OPTIONS request

```ts
it('should fall-through when OPTIONS request', function (done) {
        request(this.app)
          .options('/todo.txt')
          .expect(404, 'Not Found', done)
      }
```

#### should fall-through when URL malformed

```ts
it('should fall-through when URL malformed', function (done) {
        request(this.app)
          .get('/%')
          .expect(404, 'Not Found', done)
      }
```

#### should fall-through when traversing past root

```ts
it('should fall-through when traversing past root', function (done) {
        request(this.app)
          .get('/users/../../todo.txt')
          .expect(404, 'Not Found', done)
      }
```

#### should fall-through when URL too long

```ts
it('should fall-through when URL too long', function (done) {
        var app = express()
        var root = fixtures + Array(10000).join('/foobar')

        app.use(express.static(root, { 'fallthrough': true }))
        app.use(function (req, res, next) {
          res.sendStatus(404)
        })

        request(app)
          .get('/')
          .expect(404, 'Not Found', done)
      }
```

#### should fall-through when directory

```ts
it('should fall-through when directory', function (done) {
          request(this.app)
            .get('/pets/')
            .expect(404, 'Not Found', done)
        }
```

#### should redirect when directory without slash

```ts
it('should redirect when directory without slash', function (done) {
          request(this.app)
            .get('/pets')
            .expect(301, /Redirecting/, done)
        }
```

#### should fall-through when directory without slash

```ts
it('should fall-through when directory without slash', function (done) {
          request(this.app)
            .get('/pets')
            .expect(404, 'Not Found', done)
        }
```

#### should 405 when OPTIONS request

```ts
it('should 405 when OPTIONS request', function (done) {
        request(this.app)
          .options('/todo.txt')
          .expect('Allow', 'GET, HEAD')
          .expect(405, done)
      }
```

#### should 400 when URL malformed

```ts
it('should 400 when URL malformed', function (done) {
        request(this.app)
          .get('/%')
          .expect(400, /BadRequestError/, done)
      }
```

#### should 403 when traversing past root

```ts
it('should 403 when traversing past root', function (done) {
        request(this.app)
          .get('/users/../../todo.txt')
          .expect(403, /ForbiddenError/, done)
      }
```

#### should 404 when URL too long

```ts
it('should 404 when URL too long', function (done) {
        var app = express()
        var root = fixtures + Array(10000).join('/foobar')

        app.use(express.static(root, { 'fallthrough': false }))
        app.use(function (req, res, next) {
          res.sendStatus(404)
        })

        request(app)
          .get('/')
          .expect(404, /ENAMETOOLONG/, done)
      }
```

#### should 404 when directory

```ts
it('should 404 when directory', function (done) {
          request(this.app)
            .get('/pets/')
            .expect(404, /NotFoundError|ENOENT/, done)
        }
```

#### should 404 when directory without slash

```ts
it('should 404 when directory without slash', function (done) {
          request(this.app)
            .get('/pets')
            .expect(404, /NotFoundError|ENOENT/, done)
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

#### should default to false

```ts
it('should default to false', function (done) {
      request(createApp(fixtures))
        .get('/nums.txt')
        .expect('Cache-Control', 'public, max-age=0', done)
    }
```

#### should set immutable directive in Cache-Control

```ts
it('should set immutable directive in Cache-Control', function (done) {
      request(createApp(fixtures, { 'immutable': true, 'maxAge': '1h' }))
        .get('/nums.txt')
        .expect('Cache-Control', 'public, max-age=3600, immutable', done)
    }
```

#### should not include Last-Modified

```ts
it('should not include Last-Modified', function (done) {
        request(createApp(fixtures, { 'lastModified': false }))
          .get('/nums.txt')
          .expect(utils.shouldNotHaveHeader('Last-Modified'))
          .expect(200, '123456789', done)
      }
```

#### should include Last-Modified

```ts
it('should include Last-Modified', function (done) {
        request(createApp(fixtures, { 'lastModified': true }))
          .get('/nums.txt')
          .expect('Last-Modified', /^\w{3}, \d+ \w+ \d+ \d+:\d+:\d+ \w+$/)
          .expect(200, '123456789', done)
      }
```

#### should accept string

```ts
it('should accept string', function (done) {
      request(createApp(fixtures, { 'maxAge': '30d' }))
        .get('/todo.txt')
        .expect('cache-control', 'public, max-age=' + (60 * 60 * 24 * 30))
        .expect(200, done)
    }
```

#### should be reasonable when infinite

```ts
it('should be reasonable when infinite', function (done) {
      request(createApp(fixtures, { 'maxAge': Infinity }))
        .get('/todo.txt')
        .expect('cache-control', 'public, max-age=' + (60 * 60 * 24 * 365))
        .expect(200, done)
    }
```

#### should redirect directories

```ts
it('should redirect directories', function (done) {
      request(this.app)
        .get('/users')
        .expect('Location', '/users/')
        .expect(301, done)
    }
```

#### should include HTML link

```ts
it('should include HTML link', function (done) {
      request(this.app)
        .get('/users')
        .expect('Location', '/users/')
        .expect(301, /\/users\//, done)
    }
```

#### should redirect directories with query string

```ts
it('should redirect directories with query string', function (done) {
      request(this.app)
        .get('/users?name=john')
        .expect('Location', '/users/?name=john')
        .expect(301, done)
    }
```

#### should not redirect to protocol-relative locations

```ts
it('should not redirect to protocol-relative locations', function (done) {
      request(this.app)
        .get('//users')
        .expect('Location', '/users/')
        .expect(301, done)
    }
```

#### should ensure redirect URL is properly encoded

```ts
it('should ensure redirect URL is properly encoded', function (done) {
      request(this.app)
        .get('/snow')
        .expect('Location', '/snow%20%E2%98%83/')
        .expect('Content-Type', /html/)
        .expect(301, />Redirecting to \/snow%20%E2%98%83\/</, done)
    }
```

#### should respond with default Content-Security-Policy

```ts
it('should respond with default Content-Security-Policy', function (done) {
      request(this.app)
        .get('/users')
        .expect('Content-Security-Policy', "default-src 'none'")
        .expect(301, done)
    }
```

#### should not redirect incorrectly

```ts
it('should not redirect incorrectly', function (done) {
      request(this.app)
        .get('/')
        .expect(404, done)
    }
```

#### should disable redirect

```ts
it('should disable redirect', function (done) {
        request(this.app)
          .get('/users')
          .expect(404, done)
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

#### should not get called on 404

```ts
it('should not get called on 404', function (done) {
      request(this.app)
        .get('/bogus')
        .expect(utils.shouldNotHaveHeader('x-custom'))
        .expect(404, done)
    }
```

#### should not get called on redirect

```ts
it('should not get called on redirect', function (done) {
      request(this.app)
        .get('/users')
        .expect(utils.shouldNotHaveHeader('x-custom'))
        .expect(301, done)
    }
```

#### should catch urlencoded ../

```ts
it('should catch urlencoded ../', function (done) {
      request(this.app)
        .get('/users/%2e%2e/%2e%2e/todo.txt')
        .expect(403, done)
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

#### should support byte ranges

```ts
it('should support byte ranges', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=0-4')
        .expect('12345', done)
    }
```

#### should be inclusive

```ts
it('should be inclusive', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=0-0')
        .expect('1', done)
    }
```

#### should set Content-Range

```ts
it('should set Content-Range', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=2-5')
        .expect('Content-Range', 'bytes 2-5/9', done)
    }
```

#### should support -n

```ts
it('should support -n', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=-3')
        .expect('789', done)
    }
```

#### should support n-

```ts
it('should support n-', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=3-')
        .expect('456789', done)
    }
```

#### should respond with 206 "Partial Content"

```ts
it('should respond with 206 "Partial Content"', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=0-4')
        .expect(206, done)
    }
```

#### should set Content-Length to the # of octets transferred

```ts
it('should set Content-Length to the # of octets transferred', function (done) {
      request(this.app)
        .get('/nums.txt')
        .set('Range', 'bytes=2-3')
        .expect('Content-Length', '2')
        .expect(206, '34', done)
    }
```

#### is taken to be equal to one less than the current length

```ts
it('is taken to be equal to one less than the current length', function (done) {
        request(this.app)
          .get('/nums.txt')
          .set('Range', 'bytes=2-50')
          .expect('Content-Range', 'bytes 2-8/9', done)
      }
```

#### should adapt the Content-Length accordingly

```ts
it('should adapt the Content-Length accordingly', function (done) {
        request(this.app)
          .get('/nums.txt')
          .set('Range', 'bytes=2-50')
          .expect('Content-Length', '7')
          .expect(206, done)
      }
```

#### should respond with 416

```ts
it('should respond with 416', function (done) {
        request(this.app)
          .get('/nums.txt')
          .set('Range', 'bytes=9-50')
          .expect(416, done)
      }
```

#### should include a Content-Range header of complete length

```ts
it('should include a Content-Range header of complete length', function (done) {
        request(this.app)
          .get('/nums.txt')
          .set('Range', 'bytes=9-50')
          .expect('Content-Range', 'bytes */9')
          .expect(416, done)
      }
```

#### should respond with 200 and the entire contents

```ts
it('should respond with 200 and the entire contents', function (done) {
        request(this.app)
          .get('/nums.txt')
          .set('Range', 'asdf')
          .expect('123456789', done)
      }
```

#### should redirect correctly

```ts
it('should redirect correctly', function (done) {
      request(this.app)
        .get('/users')
        .expect('Location', '/users/')
        .expect(301, done)
    }
```

#### should redirect relative to the originalUrl

```ts
it('should redirect relative to the originalUrl', function (done) {
      request(this.app)
        .get('/static/users')
        .expect('Location', '/static/users/')
        .expect(301, done)
    }
```

#### should not choke on auth-looking URL

```ts
it('should not choke on auth-looking URL', function (done) {
      request(this.app)
        .get('//todo@txt')
        .expect(404, done)
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

#### should 404 when trailing slash

```ts
it('should 404 when trailing slash', function (done) {
      request(this.app)
        .get('/todo.txt/')
        .expect(404, done)
    }
```

#### should not alter the status

```ts
it('should not alter the status', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.status(501)
        next()
      })
      app.use(express.static(fixtures))

      request(app)
        .get('/todo.txt')
        .expect(501, '- groceries', done)
    }
```

#### should next() on directory

```ts
it('should next() on directory', function (done) {
      request(this.app)
        .get('/static/users/')
        .expect(404, 'Not Found', done)
    }
```

#### should redirect to trailing slash

```ts
it('should redirect to trailing slash', function (done) {
      request(this.app)
        .get('/static/users')
        .expect('Location', '/static/users/')
        .expect(301, done)
    }
```

#### should next() on mount point

```ts
it('should next() on mount point', function (done) {
      request(this.app)
        .get('/static/')
        .expect(404, 'Not Found', done)
    }
```

#### should redirect to trailing slash mount point

```ts
it('should redirect to trailing slash mount point', function (done) {
      request(this.app)
        .get('/static')
        .expect('Location', '/static/')
        .expect(301, done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.host.js

#### should return the Host when present

```ts
it('should return the Host when present', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.host);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com')
      .expect('example.com', done);
    }
```

#### should strip port number

```ts
it('should strip port number', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.host);
      });

      request(app)
      .post('/')
      .set('Host', 'example.com:3000')
      .expect(200, 'example.com:3000', done);
    }
```

#### should return undefined otherwise

```ts
it('should return undefined otherwise', function(done){
      var app = express();

      app.use(function(req, res){
        req.headers.host = null;
        res.end(String(req.host));
      });

      request(app)
      .post('/')
      .expect('undefined', done);
    }
```

#### should work with IPv6 Host

```ts
it('should work with IPv6 Host', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.host);
      });

      request(app)
      .post('/')
      .set('Host', '[::1]')
      .expect('[::1]', done);
    }
```

#### should work with IPv6 Host and port

```ts
it('should work with IPv6 Host and port', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.host);
      });

      request(app)
      .post('/')
      .set('Host', '[::1]:3000')
      .expect(200, '[::1]:3000', done);
    }
```

#### should respect X-Forwarded-Host

```ts
it('should respect X-Forwarded-Host', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.host);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'example.com')
        .expect('example.com', done);
      }
```

#### should ignore X-Forwarded-Host if socket addr not trusted

```ts
it('should ignore X-Forwarded-Host if socket addr not trusted', function(done){
        var app = express();

        app.set('trust proxy', '10.0.0.1');

        app.use(function(req, res){
          res.end(req.host);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'example.com')
        .expect('localhost', done);
      }
```

#### should default to Host

```ts
it('should default to Host', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.host);
        });

        request(app)
        .get('/')
        .set('Host', 'example.com')
        .expect('example.com', done);
      }
```

#### should respect X-Forwarded-Host

```ts
it('should respect X-Forwarded-Host', function (done) {
          var app = express();

          app.set('trust proxy', 1);

          app.use(function (req, res) {
            res.end(req.host);
          });

          request(app)
          .get('/')
          .set('Host', 'localhost')
          .set('X-Forwarded-Host', 'example.com')
          .expect('example.com', done);
        }
```

#### should ignore X-Forwarded-Host

```ts
it('should ignore X-Forwarded-Host', function(done){
        var app = express();

        app.use(function(req, res){
          res.end(req.host);
        });

        request(app)
        .get('/')
        .set('Host', 'localhost')
        .set('X-Forwarded-Host', 'evil')
        .expect('localhost', done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.raw.js

#### should parse application/octet-stream

```ts
it('should parse application/octet-stream', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .send('the user is tobi')
      .expect(200, { buf: '746865207573657220697320746f6269' }, done)
  }
```

#### should 400 when invalid content-length

```ts
it('should 400 when invalid content-length', function (done) {
    var app = express()

    app.use(function (req, res, next) {
      req.headers['content-length'] = '20' // bad length
      next()
    })

    app.use(express.raw())

    app.post('/', function (req, res) {
      if (Buffer.isBuffer(req.body)) {
        res.json({ buf: req.body.toString('hex') })
      } else {
        res.json(req.body)
      }
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .send('stuff')
      .expect(400, /content length/, done)
  }
```

#### should handle Content-Length: 0

```ts
it('should handle Content-Length: 0', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .set('Content-Length', '0')
      .expect(200, { buf: '' }, done)
  }
```

#### should handle empty message-body

```ts
it('should handle empty message-body', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .set('Transfer-Encoding', 'chunked')
      .send('')
      .expect(200, { buf: '' }, done)
  }
```

#### should handle duplicated middleware

```ts
it('should handle duplicated middleware', function (done) {
    var app = express()

    app.use(express.raw())
    app.use(express.raw())

    app.post('/', function (req, res) {
      if (Buffer.isBuffer(req.body)) {
        res.json({ buf: req.body.toString('hex') })
      } else {
        res.json(req.body)
      }
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/octet-stream')
      .send('the user is tobi')
      .expect(200, { buf: '746865207573657220697320746f6269' }, done)
  }
```

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.set('Content-Length', '1028')
      test.write(buf)
      test.expect(413, done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.set('Transfer-Encoding', 'chunked')
      test.write(buf)
      test.expect(413, done)
    }
```

#### should 413 when inflated body over limit

```ts
it('should 413 when inflated body over limit', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000ad3d31b05a360148c64000087e5a14704040000', 'hex'))
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var app = createApp({ limit: 1024 })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not hang response

```ts
it('should not hang response', function (done) {
      var buf = Buffer.alloc(10240, '.')
      var app = createApp({ limit: '8kb' })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(buf)
      test.write(buf)
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not error when inflating

```ts
it('should not error when inflating', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000ad3d31b05a360148c64000087e5a147040400', 'hex'))
      test.expect(413, done)
    }
```

#### should not accept content-encoding

```ts
it('should not accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/octet-stream')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
        test.expect(415, '[encoding.unsupported] content encoding unsupported', done)
      }
```

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/octet-stream')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
        test.expect(200, { buf: '6e616d653de8aeba' }, done)
      }
```

#### should parse for custom type

```ts
it('should parse for custom type', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Type', 'application/vnd+octets')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, { buf: '000102' }, done)
      }
```

#### should ignore standard type

```ts
it('should ignore standard type', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Type', 'application/octet-stream')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, '', done)
      }
```

#### should parse "application/octet-stream"

```ts
it('should parse "application/octet-stream"', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Type', 'application/octet-stream')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, { buf: '000102' }, done)
      }
```

#### should parse "application/vnd+octets"

```ts
it('should parse "application/vnd+octets"', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Type', 'application/vnd+octets')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, { buf: '000102' }, done)
      }
```

#### should ignore "application/x-foo"

```ts
it('should ignore "application/x-foo"', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Type', 'application/x-foo')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, '', done)
      }
```

#### should parse when truthy value returned

```ts
it('should parse when truthy value returned', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return req.headers['content-type'] === 'application/vnd.octet'
        }

        var test = request(app).post('/')
        test.set('Content-Type', 'application/vnd.octet')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, { buf: '000102' }, done)
      }
```

#### should work without content-type

```ts
it('should work without content-type', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return true
        }

        var test = request(app).post('/')
        test.write(Buffer.from('000102', 'hex'))
        test.expect(200, { buf: '000102' }, done)
      }
```

#### should not invoke without a body

```ts
it('should not invoke without a body', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          throw new Error('oops!')
        }

        request(app)
          .get('/')
          .expect(404, done)
      }
```

#### should assert value is function

```ts
it('should assert value is function', function () {
      assert.throws(createApp.bind(null, { verify: 'lol' }),
        /TypeError: option verify must be function/)
    }
```

#### should error from verify

```ts
it('should error from verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x00) throw new Error('no leading null')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('000102', 'hex'))
      test.expect(403, '[entity.verify.failed] no leading null', done)
    }
```

#### should allow custom codes

```ts
it('should allow custom codes', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x00) return
          var err = new Error('no leading null')
          err.status = 400
          throw err
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('000102', 'hex'))
      test.expect(400, '[entity.verify.failed] no leading null', done)
    }
```

#### should allow pass-through

```ts
it('should allow pass-through', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x00) throw new Error('no leading null')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('0102', 'hex'))
      test.expect(200, { buf: '0102' }, done)
    }
```

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

#### should ignore charset

```ts
it('should ignore charset', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/octet-stream; charset=utf-8')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, { buf: '6e616d6520697320e8aeba' }, done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, { buf: '6e616d653de8aeba' }, done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, { buf: '6e616d653de8aeba' }, done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, { buf: '6e616d653de8aeba' }, done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('789ccb4bcc4db57db16e17001068042f', 'hex'))
      test.expect(200, { buf: '6e616d653de8aeba' }, done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, { buf: '6e616d653de8aeba' }, done)
    }
```

#### should 415 on unknown encoding

```ts
it('should 415 on unknown encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'nulls')
      test.set('Content-Type', 'application/octet-stream')
      test.write(Buffer.from('000000000000', 'hex'))
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.is.js

#### should return the type when matching

```ts
it('should return the type when matching', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('application/json'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

#### should return false when not matching

```ts
it('should return false when not matching', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('image/jpeg'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, 'false', done)
    }
```

#### should ignore charset

```ts
it('should ignore charset', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('application/json'))
      })

      request(app)
      .post('/')
      .type('application/json; charset=UTF-8')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

#### should return false

```ts
it('should return false', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('application/json'))
      })

      request(app)
      .post('/')
      .send('{}')
      .expect(200, 'false', done)
    }
```

#### should lookup the mime type

```ts
it('should lookup the mime type', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('json'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, '"json"', done)
    }
```

#### should return the full type when matching

```ts
it('should return the full type when matching', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('*/json'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

#### should return false when not matching

```ts
it('should return false when not matching', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('*/html'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, 'false', done)
    }
```

#### should ignore charset

```ts
it('should ignore charset', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('*/json'))
      })

      request(app)
      .post('/')
      .type('application/json; charset=UTF-8')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

#### should return the full type when matching

```ts
it('should return the full type when matching', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('application/*'))
      })

      request(app)
      .post('/')
      .type('application/json')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

#### should ignore charset

```ts
it('should ignore charset', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.is('application/*'))
      })

      request(app)
      .post('/')
      .type('application/json; charset=UTF-8')
      .send('{}')
      .expect(200, '"application/json"', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.redirect.js

#### should default to a 302 redirect

```ts
it('should default to a 302 redirect', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://google.com');
      });

      request(app)
      .get('/')
      .expect('location', 'http://google.com')
      .expect(302, done)
    }
```

#### should encode "url"

```ts
it('should encode "url"', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.redirect('https://google.com?q=\u2603 §10')
      })

      request(app)
      .get('/')
      .expect('Location', 'https://google.com?q=%E2%98%83%20%C2%A710')
      .expect(302, done)
    }
```

#### should not touch already-encoded sequences in "url"

```ts
it('should not touch already-encoded sequences in "url"', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.redirect('https://google.com?q=%A710')
      })

      request(app)
      .get('/')
      .expect('Location', 'https://google.com?q=%A710')
      .expect(302, done)
    }
```

#### should set the response status

```ts
it('should set the response status', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect(303, 'http://google.com');
      });

      request(app)
      .get('/')
      .expect('Location', 'http://google.com')
      .expect(303, done)
    }
```

#### should ignore the body

```ts
it('should ignore the body', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://google.com');
      });

      request(app)
        .head('/')
        .expect(302)
        .expect('Location', 'http://google.com')
        .expect(utils.shouldNotHaveBody())
        .end(done)
    }
```

#### should respond with html

```ts
it('should respond with html', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://google.com');
      });

      request(app)
      .get('/')
      .set('Accept', 'text/html')
      .expect('Content-Type', /html/)
      .expect('Location', 'http://google.com')
      .expect(302, '<!DOCTYPE html><head><title>Found</title></head><body><p>Found. Redirecting to http://google.com</p></body>', done)
    }
```

#### should escape the url

```ts
it('should escape the url', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('<la\'me>');
      });

      request(app)
      .get('/')
      .set('Host', 'http://example.com')
      .set('Accept', 'text/html')
      .expect('Content-Type', /html/)
      .expect('Location', '%3Cla\'me%3E')
      .expect(302, '<!DOCTYPE html><head><title>Found</title></head><body><p>Found. Redirecting to %3Cla&#39;me%3E</p></body>', done)
    }
```

#### should not render evil javascript links in anchor href (prevent XSS)

```ts
it('should not render evil javascript links in anchor href (prevent XSS)', function(done){
      var app = express();
      var xss = 'javascript:eval(document.body.innerHTML=`<p>XSS</p>`);';
      var encodedXss = 'javascript:eval(document.body.innerHTML=%60%3Cp%3EXSS%3C/p%3E%60);';

      app.use(function(req, res){
        res.redirect(xss);
      });

      request(app)
      .get('/')
      .set('Host', 'http://example.com')
      .set('Accept', 'text/html')
      .expect('Content-Type', /html/)
      .expect('Location', encodedXss)
      .expect(302, '<!DOCTYPE html><head><title>Found</title></head><body><p>Found. Redirecting to ' + encodedXss +'</p></body>', done);
    }
```

#### should include the redirect type

```ts
it('should include the redirect type', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect(301, 'http://google.com');
      });

      request(app)
      .get('/')
      .set('Accept', 'text/html')
      .expect('Content-Type', /html/)
      .expect('Location', 'http://google.com')
      .expect(301, '<!DOCTYPE html><head><title>Moved Permanently</title></head><body><p>Moved Permanently. Redirecting to http://google.com</p></body>', done);
    }
```

#### should respond with text

```ts
it('should respond with text', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://google.com');
      });

      request(app)
      .get('/')
      .set('Accept', 'text/plain, */*')
      .expect('Content-Type', /plain/)
      .expect('Location', 'http://google.com')
      .expect(302, 'Found. Redirecting to http://google.com', done)
    }
```

#### should encode the url

```ts
it('should encode the url', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://example.com/?param=<script>alert("hax");</script>');
      });

      request(app)
      .get('/')
      .set('Host', 'http://example.com')
      .set('Accept', 'text/plain, */*')
      .expect('Content-Type', /plain/)
      .expect('Location', 'http://example.com/?param=%3Cscript%3Ealert(%22hax%22);%3C/script%3E')
      .expect(302, 'Found. Redirecting to http://example.com/?param=%3Cscript%3Ealert(%22hax%22);%3C/script%3E', done)
    }
```

#### should include the redirect type

```ts
it('should include the redirect type', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect(301, 'http://google.com');
      });

      request(app)
      .get('/')
      .set('Accept', 'text/plain, */*')
      .expect('Content-Type', /plain/)
      .expect('Location', 'http://google.com')
      .expect(301, 'Moved Permanently. Redirecting to http://google.com', done);
    }
```

#### should respond with an empty body

```ts
it('should respond with an empty body', function(done){
      var app = express();

      app.use(function(req, res){
        res.redirect('http://google.com');
      });

      request(app)
        .get('/')
        .set('Accept', 'application/octet-stream')
        .expect(302)
        .expect('location', 'http://google.com')
        .expect('content-length', '0')
        .expect(utils.shouldNotHaveHeader('Content-Type'))
        .expect(utils.shouldNotHaveBody())
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.json.js

#### should parse JSON

```ts
it('should parse JSON', function (done) {
    request(createApp())
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"user":"tobi"}')
      .expect(200, '{"user":"tobi"}', done)
  }
```

#### should handle Content-Length: 0

```ts
it('should handle Content-Length: 0', function (done) {
    request(createApp())
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Content-Length', '0')
      .expect(200, '{}', done)
  }
```

#### should handle empty message-body

```ts
it('should handle empty message-body', function (done) {
    request(createApp())
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Transfer-Encoding', 'chunked')
      .expect(200, '{}', done)
  }
```

#### should handle no message-body

```ts
it('should handle no message-body', function (done) {
    request(createApp())
      .post('/')
      .set('Content-Type', 'application/json')
      .unset('Transfer-Encoding')
      .expect(200, '{}', done)
  }
```

#### should 400 when only whitespace

```ts
it('should 400 when only whitespace', function (done) {
    request(createApp())
      .post('/')
      .set('Content-Type', 'application/json')
      .send('  \n')
      .expect(400, '[entity.parse.failed] ' + parseError(' \n'), done)
  }
```

#### should 400 when invalid content-length

```ts
it('should 400 when invalid content-length', function (done) {
    var app = express()

    app.use(function (req, res, next) {
      req.headers['content-length'] = '20' // bad length
      next()
    })

    app.use(express.json())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"str":')
      .expect(400, /content length/, done)
  }
```

#### should handle duplicated middleware

```ts
it('should handle duplicated middleware', function (done) {
    var app = express()

    app.use(express.json())
    app.use(express.json())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{"user":"tobi"}')
      .expect(200, '{"user":"tobi"}', done)
  }
```

#### should 400 for bad token

```ts
it('should 400 for bad token', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{:')
        .expect(400, '[entity.parse.failed] ' + parseError('{:'), done)
    }
```

#### should 400 for incomplete

```ts
it('should 400 for incomplete', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user"')
        .expect(400, '[entity.parse.failed] ' + parseError('{"user"'), done)
    }
```

#### should include original body on error object

```ts
it('should include original body on error object', function (done) {
      request(this.app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('X-Error-Property', 'body')
        .send(' {"user"')
        .expect(400, ' {"user"', done)
    }
```

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'application/json')
        .set('Content-Length', '1034')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, '[entity.too.large] request entity too large', done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1024, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'application/json')
      test.set('Transfer-Encoding', 'chunked')
      test.write('{"str":')
      test.write('"' + buf.toString() + '"}')
      test.expect(413, done)
    }
```

#### should 413 when inflated body over limit

```ts
it('should 413 when inflated body over limit', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000aab562a2e2952b252d21b05a360148c58a0540b0066f7ce1e0a040000', 'hex'))
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1024, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done)
    }
```

#### should not hang response

```ts
it('should not hang response', function (done) {
      var buf = Buffer.alloc(10240, '.')
      var app = createApp({ limit: '8kb' })
      var test = request(app).post('/')
      test.set('Content-Type', 'application/json')
      test.write(buf)
      test.write(buf)
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not error when inflating

```ts
it('should not error when inflating', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000aab562a2e2952b252d21b05a360148c58a0540b0066f7ce1e0a0400', 'hex'))
      test.expect(413, done)
    }
```

#### should not accept content-encoding

```ts
it('should not accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/json')
        test.write(Buffer.from('1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
        test.expect(415, '[encoding.unsupported] content encoding unsupported', done)
      }
```

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/json')
        test.write(Buffer.from('1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
        test.expect(200, '{"name":"论"}', done)
      }
```

#### should 400 on primitives

```ts
it('should 400 on primitives', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('true')
          .expect(400, '[entity.parse.failed] ' + parseError('#rue').replace(/#/g, 't'), done)
      }
```

#### should parse primitives

```ts
it('should parse primitives', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('true')
          .expect(200, 'true', done)
      }
```

#### should not parse primitives

```ts
it('should not parse primitives', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('true')
          .expect(400, '[entity.parse.failed] ' + parseError('#rue').replace(/#/g, 't'), done)
      }
```

#### should not parse primitives with leading whitespaces

```ts
it('should not parse primitives with leading whitespaces', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('    true')
          .expect(400, '[entity.parse.failed] ' + parseError('    #rue').replace(/#/g, 't'), done)
      }
```

#### should allow leading whitespaces in JSON

```ts
it('should allow leading whitespaces in JSON', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('   { "user": "tobi" }')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should include correct message in stack trace

```ts
it('should include correct message in stack trace', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .set('X-Error-Property', 'stack')
          .send('true')
          .expect(400)
          .expect(shouldContainInBody(parseError('#rue').replace(/#/g, 't')))
          .end(done)
      }
```

#### should parse JSON for custom type

```ts
it('should parse JSON for custom type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/vnd.api+json')
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should ignore standard type

```ts
it('should ignore standard type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('{"user":"tobi"}')
          .expect(200, '', done)
      }
```

#### should parse JSON for "application/json"

```ts
it('should parse JSON for "application/json"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/json')
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should parse JSON for "application/vnd.api+json"

```ts
it('should parse JSON for "application/vnd.api+json"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/vnd.api+json')
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should ignore "application/x-json"

```ts
it('should ignore "application/x-json"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-json')
          .send('{"user":"tobi"}')
          .expect(200, '', done)
      }
```

#### should parse when truthy value returned

```ts
it('should parse when truthy value returned', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return req.headers['content-type'] === 'application/vnd.api+json'
        }

        request(app)
          .post('/')
          .set('Content-Type', 'application/vnd.api+json')
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should work without content-type

```ts
it('should work without content-type', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return true
        }

        var test = request(app).post('/')
        test.write('{"user":"tobi"}')
        test.expect(200, '{"user":"tobi"}', done)
      }
```

#### should not invoke without a body

```ts
it('should not invoke without a body', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          throw new Error('oops!')
        }

        request(app)
          .get('/')
          .expect(404, done)
      }
```

#### should assert value if function

```ts
it('should assert value if function', function () {
      assert.throws(createApp.bind(null, { verify: 'lol' }),
        /TypeError: option verify must be function/)
    }
```

#### should error from verify

```ts
it('should error from verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error('no arrays')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('["tobi"]')
        .expect(403, '[entity.verify.failed] no arrays', done)
    }
```

#### should allow custom codes

```ts
it('should allow custom codes', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x5b) return
          var err = new Error('no arrays')
          err.status = 400
          throw err
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('["tobi"]')
        .expect(400, '[entity.verify.failed] no arrays', done)
    }
```

#### should allow custom type

```ts
it('should allow custom type', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x5b) return
          var err = new Error('no arrays')
          err.type = 'foo.bar'
          throw err
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('["tobi"]')
        .expect(403, '[foo.bar] no arrays', done)
    }
```

#### should include original body on error object

```ts
it('should include original body on error object', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error('no arrays')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .set('X-Error-Property', 'body')
        .send('["tobi"]')
        .expect(403, '["tobi"]', done)
    }
```

#### should allow pass-through

```ts
it('should allow pass-through', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error('no arrays')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/json')
        .send('{"user":"tobi"}')
        .expect(200, '{"user":"tobi"}', done)
    }
```

#### should work with different charsets

```ts
it('should work with different charsets', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error('no arrays')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/json; charset=utf-16')
      test.write(Buffer.from('feff007b0022006e0061006d00650022003a00228bba0022007d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should 415 on unknown charset prior to verify

```ts
it('should 415 on unknown charset prior to verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          throw new Error('unexpected verify call')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/json; charset=x-bogus')
      test.write(Buffer.from('00000000', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done)
    }
```

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

#### should parse utf-8

```ts
it('should parse utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json; charset=utf-8')
      test.write(Buffer.from('7b226e616d65223a22e8aeba227d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should parse utf-16

```ts
it('should parse utf-16', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json; charset=utf-16')
      test.write(Buffer.from('feff007b0022006e0061006d00650022003a00228bba0022007d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should parse when content-length != char length

```ts
it('should parse when content-length != char length', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json; charset=utf-8')
      test.set('Content-Length', '13')
      test.write(Buffer.from('7b2274657374223a22c3a5227d', 'hex'))
      test.expect(200, '{"test":"å"}', done)
    }
```

#### should default to utf-8

```ts
it('should default to utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('7b226e616d65223a22e8aeba227d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should fail on unknown charset

```ts
it('should fail on unknown charset', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json; charset=koi8-r')
      test.write(Buffer.from('7b226e616d65223a22cec5d4227d', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "KOI8-R"', done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('7b226e616d65223a22e8aeba227d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('7b226e616d65223a22e8aeba227d', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('789cab56ca4bcc4d55b2527ab16e97522d00274505ac', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should 415 on unknown encoding

```ts
it('should 415 on unknown encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'nulls')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('000000000000', 'hex'))
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done)
    }
```

#### should 400 on malformed encoding

```ts
it('should 400 on malformed encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bab56cc4d55b2527ab16e97522d00515be1cc0e000000', 'hex'))
      test.expect(400, done)
    }
```

#### should 413 when inflated value exceeds limit

```ts
it('should 413 when inflated value exceeds limit', function (done) {
      // gzip'd data exceeds 1kb, but deflated below 1kb
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/json')
      test.write(Buffer.from('1f8b080000000000000bedc1010d000000c2a0f74f6d0f071400000000000000', 'hex'))
      test.write(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'))
      test.write(Buffer.from('0000000000000000004f0625b3b71650c30000', 'hex'))
      test.expect(413, done)
    })
  })
})

function createApp (options) {
  var app = express()

  app.use(express.json(options))

  app.use(function (err, req, res, next) {
    // console.log(err)
    res.status(err.status || 500)
    res.send(String(req.headers['x-error-property']
      ? err[req.headers['x-error-property']]
      : ('[' + err.type + '] ' + err.message)))
  })

  app.post('/', function (req, res) {
    res.json(req.body)
  })

  return app
}

function parseError (str) {
  try {
    JSON.parse(str); throw new SyntaxError('strict violation')
  } catch (e) {
    return e.message
  }
}

function shouldContainInBody (str) {
  return function (res) {
    assert.ok(res.text.indexOf(str) !== -1,
      'expected \'' + res.text + '\' to contain \'' + str + '\'')
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.text.js

#### should parse text/plain

```ts
it('should parse text/plain', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'text/plain')
      .send('user is tobi')
      .expect(200, '"user is tobi"', done)
  }
```

#### should 400 when invalid content-length

```ts
it('should 400 when invalid content-length', function (done) {
    var app = express()

    app.use(function (req, res, next) {
      req.headers['content-length'] = '20' // bad length
      next()
    })

    app.use(express.text())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'text/plain')
      .send('user')
      .expect(400, /content length/, done)
  }
```

#### should handle Content-Length: 0

```ts
it('should handle Content-Length: 0', function (done) {
    request(createApp({ limit: '1kb' }))
      .post('/')
      .set('Content-Type', 'text/plain')
      .set('Content-Length', '0')
      .expect(200, '""', done)
  }
```

#### should handle empty message-body

```ts
it('should handle empty message-body', function (done) {
    request(createApp({ limit: '1kb' }))
      .post('/')
      .set('Content-Type', 'text/plain')
      .set('Transfer-Encoding', 'chunked')
      .send('')
      .expect(200, '""', done)
  }
```

#### should handle duplicated middleware

```ts
it('should handle duplicated middleware', function (done) {
    var app = express()

    app.use(express.text())
    app.use(express.text())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'text/plain')
      .send('user is tobi')
      .expect(200, '"user is tobi"', done)
  }
```

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

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1028, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'text/plain')
        .set('Content-Length', '1028')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1028, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'text/plain')
      test.set('Transfer-Encoding', 'chunked')
      test.write(buf.toString())
      test.expect(413, done)
    }
```

#### should 413 when inflated body over limit

```ts
it('should 413 when inflated body over limit', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000ad3d31b05a360148c64000087e5a14704040000', 'hex'))
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1028, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1028, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(buf.toString())
        .expect(413, done)
    }
```

#### should not hang response

```ts
it('should not hang response', function (done) {
      var app = createApp({ limit: '8kb' })
      var buf = Buffer.alloc(10240, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(buf)
      test.write(buf)
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not error when inflating

```ts
it('should not error when inflating', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000ad3d31b05a360148c64000087e5a1470404', 'hex'))
      setTimeout(function () {
        test.expect(413, done)
      }, 100)
    }
```

#### should not accept content-encoding

```ts
it('should not accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'text/plain')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
        test.expect(415, '[encoding.unsupported] content encoding unsupported', done)
      }
```

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'text/plain')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
        test.expect(200, '"name is 论"', done)
      }
```

#### should parse for custom type

```ts
it('should parse for custom type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'text/html')
          .send('<b>tobi</b>')
          .expect(200, '"<b>tobi</b>"', done)
      }
```

#### should ignore standard type

```ts
it('should ignore standard type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'text/plain')
          .send('user is tobi')
          .expect(200, '', done)
      }
```

#### should parse "text/html"

```ts
it('should parse "text/html"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'text/html')
          .send('<b>tobi</b>')
          .expect(200, '"<b>tobi</b>"', done)
      }
```

#### should parse "text/plain"

```ts
it('should parse "text/plain"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'text/plain')
          .send('tobi')
          .expect(200, '"tobi"', done)
      }
```

#### should ignore "text/xml"

```ts
it('should ignore "text/xml"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'text/xml')
          .send('<user>tobi</user>')
          .expect(200, '', done)
      }
```

#### should parse when truthy value returned

```ts
it('should parse when truthy value returned', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return req.headers['content-type'] === 'text/vnd.something'
        }

        request(app)
          .post('/')
          .set('Content-Type', 'text/vnd.something')
          .send('user is tobi')
          .expect(200, '"user is tobi"', done)
      }
```

#### should work without content-type

```ts
it('should work without content-type', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return true
        }

        var test = request(app).post('/')
        test.write('user is tobi')
        test.expect(200, '"user is tobi"', done)
      }
```

#### should not invoke without a body

```ts
it('should not invoke without a body', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          throw new Error('oops!')
        }

        request(app)
          .get('/')
          .expect(404, done)
      }
```

#### should assert value is function

```ts
it('should assert value is function', function () {
      assert.throws(createApp.bind(null, { verify: 'lol' }),
        /TypeError: option verify must be function/)
    }
```

#### should error from verify

```ts
it('should error from verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x20) throw new Error('no leading space')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(' user is tobi')
        .expect(403, '[entity.verify.failed] no leading space', done)
    }
```

#### should allow custom codes

```ts
it('should allow custom codes', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x20) return
          var err = new Error('no leading space')
          err.status = 400
          throw err
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send(' user is tobi')
        .expect(400, '[entity.verify.failed] no leading space', done)
    }
```

#### should allow pass-through

```ts
it('should allow pass-through', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x20) throw new Error('no leading space')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'text/plain')
        .send('user is tobi')
        .expect(200, '"user is tobi"', done)
    }
```

#### should 415 on unknown charset prior to verify

```ts
it('should 415 on unknown charset prior to verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          throw new Error('unexpected verify call')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'text/plain; charset=x-bogus')
      test.write(Buffer.from('00000000', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done)
    }
```

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

#### should parse utf-8

```ts
it('should parse utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=utf-8')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should parse codepage charsets

```ts
it('should parse codepage charsets', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=koi8-r')
      test.write(Buffer.from('6e616d6520697320cec5d4', 'hex'))
      test.expect(200, '"name is нет"', done)
    }
```

#### should parse when content-length != char length

```ts
it('should parse when content-length != char length', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=utf-8')
      test.set('Content-Length', '11')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should default to utf-8

```ts
it('should default to utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should 415 on unknown charset

```ts
it('should 415 on unknown charset', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain; charset=x-bogus')
      test.write(Buffer.from('00000000', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('6e616d6520697320e8aeba', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('789ccb4bcc4d55c82c5678b16e17001a6f050e', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000', 'hex'))
      test.expect(200, '"name is 论"', done)
    }
```

#### should 415 on unknown encoding

```ts
it('should 415 on unknown encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'nulls')
      test.set('Content-Type', 'text/plain')
      test.write(Buffer.from('000000000000', 'hex'))
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.protocol.js

#### should return the protocol string

```ts
it('should return the protocol string', function(done){
      var app = express();

      app.use(function(req, res){
        res.end(req.protocol);
      });

      request(app)
      .get('/')
      .expect('http', done);
    }
```

#### should respect X-Forwarded-Proto

```ts
it('should respect X-Forwarded-Proto', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.protocol);
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect('https', done);
      }
```

#### should default to the socket addr if X-Forwarded-Proto not present

```ts
it('should default to the socket addr if X-Forwarded-Proto not present', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          req.socket.encrypted = true;
          res.end(req.protocol);
        });

        request(app)
        .get('/')
        .expect('https', done);
      }
```

#### should ignore X-Forwarded-Proto if socket addr not trusted

```ts
it('should ignore X-Forwarded-Proto if socket addr not trusted', function(done){
        var app = express();

        app.set('trust proxy', '10.0.0.1');

        app.use(function(req, res){
          res.end(req.protocol);
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect('http', done);
      }
```

#### should default to http

```ts
it('should default to http', function(done){
        var app = express();

        app.enable('trust proxy');

        app.use(function(req, res){
          res.end(req.protocol);
        });

        request(app)
        .get('/')
        .expect('http', done);
      }
```

#### should respect X-Forwarded-Proto

```ts
it('should respect X-Forwarded-Proto', function (done) {
          var app = express();

          app.set('trust proxy', 1);

          app.use(function (req, res) {
            res.end(req.protocol);
          });

          request(app)
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect('https', done);
        }
```

#### should ignore X-Forwarded-Proto

```ts
it('should ignore X-Forwarded-Proto', function(done){
        var app = express();

        app.use(function(req, res){
          res.end(req.protocol);
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect('http', done);
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.accepts.js

#### should return true when Accept is not present

```ts
it('should return true when Accept is not present', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts('json') ? 'yes' : 'no');
      });

      request(app)
      .get('/')
      .expect('yes', done);
    }
```

#### should return true when present

```ts
it('should return true when present', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts('json') ? 'yes' : 'no');
      });

      request(app)
      .get('/')
      .set('Accept', 'application/json')
      .expect('yes', done);
    }
```

#### should return false otherwise

```ts
it('should return false otherwise', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts('json') ? 'yes' : 'no');
      });

      request(app)
      .get('/')
      .set('Accept', 'text/html')
      .expect('no', done);
    }
```

#### should accept an argument list of type names

```ts
it('should accept an argument list of type names', function(done){
    var app = express();

    app.use(function(req, res, next){
      res.end(req.accepts('json', 'html'));
    });

    request(app)
    .get('/')
    .set('Accept', 'application/json')
    .expect('json', done);
  }
```

#### should return the first when Accept is not present

```ts
it('should return the first when Accept is not present', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts(['json', 'html']));
      });

      request(app)
      .get('/')
      .expect('json', done);
    }
```

#### should return the first acceptable type

```ts
it('should return the first acceptable type', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts(['json', 'html']));
      });

      request(app)
      .get('/')
      .set('Accept', 'text/html')
      .expect('html', done);
    }
```

#### should return false when no match is made

```ts
it('should return false when no match is made', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts(['text/html', 'application/json']) ? 'yup' : 'nope');
      });

      request(app)
      .get('/')
      .set('Accept', 'foo/bar, bar/baz')
      .expect('nope', done);
    }
```

#### should take quality into account

```ts
it('should take quality into account', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts(['text/html', 'application/json']));
      });

      request(app)
      .get('/')
      .set('Accept', '*/html; q=.5, application/json')
      .expect('application/json', done);
    }
```

#### should return the first acceptable type with canonical mime types

```ts
it('should return the first acceptable type with canonical mime types', function(done){
      var app = express();

      app.use(function(req, res, next){
        res.end(req.accepts(['application/json', 'text/html']));
      });

      request(app)
      .get('/')
      .set('Accept', '*/html')
      .expect('text/html', done);
    }
```

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

#### should default to application/octet-stream

```ts
it('should default to application/octet-stream', function(done){
      var app = express();

      app.use(function(req, res){
        res.type('rawr').end('var name = "tj";');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/octet-stream', done);
    }
```

#### should set the Content-Type with type/subtype

```ts
it('should set the Content-Type with type/subtype', function(done){
      var app = express();

      app.use(function(req, res){
        res.type('application/vnd.amazon.ebook')
          .end('var name = "tj";');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'application/vnd.amazon.ebook', done);
    }
```

#### should handle empty string gracefully

```ts
it('should handle empty string gracefully', function(done){
        var app = express();

        app.use(function(req, res){
          res.type('').end('test');
        });

        request(app)
        .get('/')
        .expect('Content-Type', 'application/octet-stream')
        .end(done);
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

### ../../.sbomtest/repos/f3c62de455-express/test/req.secure.js

#### should return false when http

```ts
it('should return false when http', function(done){
        var app = express();

        app.get('/', function(req, res){
          res.send(req.secure ? 'yes' : 'no');
        });

        request(app)
        .get('/')
        .expect('no', done)
      }
```

#### should return false when http

```ts
it('should return false when http', function(done){
        var app = express();

        app.get('/', function(req, res){
          res.send(req.secure ? 'yes' : 'no');
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect('no', done)
      }
```

#### should return true when "trust proxy" is enabled

```ts
it('should return true when "trust proxy" is enabled', function(done){
        var app = express();

        app.enable('trust proxy');

        app.get('/', function(req, res){
          res.send(req.secure ? 'yes' : 'no');
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https')
        .expect('yes', done)
      }
```

#### should return false when initial proxy is http

```ts
it('should return false when initial proxy is http', function(done){
        var app = express();

        app.enable('trust proxy');

        app.get('/', function(req, res){
          res.send(req.secure ? 'yes' : 'no');
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'http, https')
        .expect('no', done)
      }
```

#### should return true when initial proxy is https

```ts
it('should return true when initial proxy is https', function(done){
        var app = express();

        app.enable('trust proxy');

        app.get('/', function(req, res){
          res.send(req.secure ? 'yes' : 'no');
        });

        request(app)
        .get('/')
        .set('X-Forwarded-Proto', 'https, http')
        .expect('yes', done)
      }
```

#### should respect X-Forwarded-Proto

```ts
it('should respect X-Forwarded-Proto', function (done) {
          var app = express();

          app.set('trust proxy', 1);

          app.get('/', function (req, res) {
            res.send(req.secure ? 'yes' : 'no');
          });

          request(app)
          .get('/')
          .set('X-Forwarded-Proto', 'https')
          .expect('yes', done)
        }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.urlencoded.js

#### should parse x-www-form-urlencoded

```ts
it('should parse x-www-form-urlencoded', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('user=tobi')
      .expect(200, '{"user":"tobi"}', done)
  }
```

#### should 400 when invalid content-length

```ts
it('should 400 when invalid content-length', function (done) {
    var app = express()

    app.use(function (req, res, next) {
      req.headers['content-length'] = '20' // bad length
      next()
    })

    app.use(express.urlencoded())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('str=')
      .expect(400, /content length/, done)
  }
```

#### should handle Content-Length: 0

```ts
it('should handle Content-Length: 0', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Content-Length', '0')
      .send('')
      .expect(200, '{}', done)
  }
```

#### should handle empty message-body

```ts
it('should handle empty message-body', function (done) {
    request(createApp({ limit: '1kb' }))
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Transfer-Encoding', 'chunked')
      .send('')
      .expect(200, '{}', done)
  }
```

#### should handle duplicated middleware

```ts
it('should handle duplicated middleware', function (done) {
    var app = express()

    app.use(express.urlencoded())
    app.use(express.urlencoded())

    app.post('/', function (req, res) {
      res.json(req.body)
    })

    request(app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('user=tobi')
      .expect(200, '{"user":"tobi"}', done)
  }
```

#### should not parse extended syntax

```ts
it('should not parse extended syntax', function (done) {
    request(this.app)
      .post('/')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('user[name][first]=Tobi')
      .expect(200, '{"user[name][first]":"Tobi"}', done)
  }
```

#### should not parse extended syntax

```ts
it('should not parse extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user[name][first]=Tobi')
          .expect(200, '{"user[name][first]":"Tobi"}', done)
      }
```

#### should parse multiple key instances

```ts
it('should parse multiple key instances', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user=Tobi&user=Loki')
          .expect(200, '{"user":["Tobi","Loki"]}', done)
      }
```

#### should parse extended syntax

```ts
it('should parse extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user[name][first]=Tobi')
          .expect(200, '{"user":{"name":{"first":"Tobi"}}}', done)
      }
```

#### should parse parameters with dots

```ts
it('should parse parameters with dots', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user.name=Tobi')
          .expect(200, '{"user.name":"Tobi"}', done)
      }
```

#### should parse fully-encoded extended syntax

```ts
it('should parse fully-encoded extended syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user%5Bname%5D%5Bfirst%5D=Tobi')
          .expect(200, '{"user":{"name":{"first":"Tobi"}}}', done)
      }
```

#### should parse array index notation

```ts
it('should parse array index notation', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('foo[0]=bar&foo[1]=baz')
          .expect(200, '{"foo":["bar","baz"]}', done)
      }
```

#### should parse array index notation with large array

```ts
it('should parse array index notation with large array', function (done) {
        var str = 'f[0]=0'

        for (var i = 1; i < 500; i++) {
          str += '&f[' + i + ']=' + i.toString(16)
        }

        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(str)
          .expect(function (res) {
            var obj = JSON.parse(res.text)
            assert.strictEqual(Object.keys(obj).length, 1)
            assert.strictEqual(Array.isArray(obj.f), true)
            assert.strictEqual(obj.f.length, 500)
          })
          .expect(200, done)
      }
```

#### should parse array of objects syntax

```ts
it('should parse array of objects syntax', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('foo[0][bar]=baz&foo[0][fizz]=buzz&foo[]=done!')
          .expect(200, '{"foo":[{"bar":"baz","fizz":"buzz"},"done!"]}', done)
      }
```

#### should parse deep object

```ts
it('should parse deep object', function (done) {
        var str = 'foo'

        for (var i = 0; i < 32; i++) {
          str += '[p]'
        }

        str += '=bar'

        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(str)
          .expect(function (res) {
            var obj = JSON.parse(res.text)
            assert.strictEqual(Object.keys(obj).length, 1)
            assert.strictEqual(typeof obj.foo, 'object')

            var depth = 0
            var ref = obj.foo
            while ((ref = ref.p)) { depth++ }
            assert.strictEqual(depth, 32)
          })
          .expect(200, done)
      }
```

#### should not accept content-encoding

```ts
it('should not accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/x-www-form-urlencoded')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
        test.expect(415, '[encoding.unsupported] content encoding unsupported', done)
      }
```

#### should accept content-encoding

```ts
it('should accept content-encoding', function (done) {
        var test = request(this.app).post('/')
        test.set('Content-Encoding', 'gzip')
        test.set('Content-Type', 'application/x-www-form-urlencoded')
        test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
        test.expect(200, '{"name":"论"}', done)
      }
```

#### should 413 when over limit with Content-Length

```ts
it('should 413 when over limit with Content-Length', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: '1kb' }))
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Content-Length', '1028')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should 413 when over limit with chunked encoding

```ts
it('should 413 when over limit with chunked encoding', function (done) {
      var app = createApp({ limit: '1kb' })
      var buf = Buffer.alloc(1024, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.set('Transfer-Encoding', 'chunked')
      test.write('str=')
      test.write(buf.toString())
      test.expect(413, done)
    }
```

#### should 413 when inflated body over limit

```ts
it('should 413 when inflated body over limit', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000a2b2e29b2d51b05a360148c580000a0351f9204040000', 'hex'))
      test.expect(413, done)
    }
```

#### should accept number of bytes

```ts
it('should accept number of bytes', function (done) {
      var buf = Buffer.alloc(1024, '.')
      request(createApp({ limit: 1024 }))
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should not change when options altered

```ts
it('should not change when options altered', function (done) {
      var buf = Buffer.alloc(1024, '.')
      var options = { limit: '1kb' }
      var app = createApp(options)

      options.limit = '100kb'

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('str=' + buf.toString())
        .expect(413, done)
    }
```

#### should not hang response

```ts
it('should not hang response', function (done) {
      var app = createApp({ limit: '8kb' })
      var buf = Buffer.alloc(10240, '.')
      var test = request(app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(buf)
      test.write(buf)
      test.write(buf)
      test.expect(413, done)
    }
```

#### should not error when inflating

```ts
it('should not error when inflating', function (done) {
      var app = createApp({ limit: '1kb' })
      var test = request(app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000a2b2e29b2d51b05a360148c580000a0351f92040400', 'hex'))
      test.expect(413, done)
    }
```

#### should reject 0

```ts
it('should reject 0', function () {
        assert.throws(createApp.bind(null, { extended: false, parameterLimit: 0 }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should reject string

```ts
it('should reject string', function () {
        assert.throws(createApp.bind(null, { extended: false, parameterLimit: 'beep' }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should 413 if over limit

```ts
it('should 413 if over limit', function (done) {
        request(createApp({ extended: false, parameterLimit: 10 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, '[parameters.too.many] too many parameters', done)
      }
```

#### should work when at the limit

```ts
it('should work when at the limit', function (done) {
        request(createApp({ extended: false, parameterLimit: 10 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(10))
          .expect(expectKeyCount(10))
          .expect(200, done)
      }
```

#### should work if number is floating point

```ts
it('should work if number is floating point', function (done) {
        request(createApp({ extended: false, parameterLimit: 10.1 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, /too many parameters/, done)
      }
```

#### should work with large limit

```ts
it('should work with large limit', function (done) {
        request(createApp({ extended: false, parameterLimit: 5000 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(5000))
          .expect(expectKeyCount(5000))
          .expect(200, done)
      }
```

#### should work with Infinity limit

```ts
it('should work with Infinity limit', function (done) {
        request(createApp({ extended: false, parameterLimit: Infinity }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(10000))
          .expect(expectKeyCount(10000))
          .expect(200, done)
      }
```

#### should reject 0

```ts
it('should reject 0', function () {
        assert.throws(createApp.bind(null, { extended: true, parameterLimit: 0 }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should reject string

```ts
it('should reject string', function () {
        assert.throws(createApp.bind(null, { extended: true, parameterLimit: 'beep' }),
          /TypeError: option parameterLimit must be a positive number/)
      }
```

#### should 413 if over limit

```ts
it('should 413 if over limit', function (done) {
        request(createApp({ extended: true, parameterLimit: 10 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, '[parameters.too.many] too many parameters', done)
      }
```

#### should work when at the limit

```ts
it('should work when at the limit', function (done) {
        request(createApp({ extended: true, parameterLimit: 10 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(10))
          .expect(expectKeyCount(10))
          .expect(200, done)
      }
```

#### should work if number is floating point

```ts
it('should work if number is floating point', function (done) {
        request(createApp({ extended: true, parameterLimit: 10.1 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(11))
          .expect(413, /too many parameters/, done)
      }
```

#### should work with large limit

```ts
it('should work with large limit', function (done) {
        request(createApp({ extended: true, parameterLimit: 5000 }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(5000))
          .expect(expectKeyCount(5000))
          .expect(200, done)
      }
```

#### should work with Infinity limit

```ts
it('should work with Infinity limit', function (done) {
        request(createApp({ extended: true, parameterLimit: Infinity }))
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(createManyParams(10000))
          .expect(expectKeyCount(10000))
          .expect(200, done)
      }
```

#### should parse for custom type

```ts
it('should parse for custom type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/vnd.x-www-form-urlencoded')
          .send('user=tobi')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should ignore standard type

```ts
it('should ignore standard type', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user=tobi')
          .expect(200, '', done)
      }
```

#### should parse "application/x-www-form-urlencoded"

```ts
it('should parse "application/x-www-form-urlencoded"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send('user=tobi')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should parse "application/x-pairs"

```ts
it('should parse "application/x-pairs"', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-pairs')
          .send('user=tobi')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should ignore application/x-foo

```ts
it('should ignore application/x-foo', function (done) {
        request(this.app)
          .post('/')
          .set('Content-Type', 'application/x-foo')
          .send('user=tobi')
          .expect(200, '', done)
      }
```

#### should parse when truthy value returned

```ts
it('should parse when truthy value returned', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return req.headers['content-type'] === 'application/vnd.something'
        }

        request(app)
          .post('/')
          .set('Content-Type', 'application/vnd.something')
          .send('user=tobi')
          .expect(200, '{"user":"tobi"}', done)
      }
```

#### should work without content-type

```ts
it('should work without content-type', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          return true
        }

        var test = request(app).post('/')
        test.write('user=tobi')
        test.expect(200, '{"user":"tobi"}', done)
      }
```

#### should not invoke without a body

```ts
it('should not invoke without a body', function (done) {
        var app = createApp({ type: accept })

        function accept (req) {
          throw new Error('oops!')
        }

        request(app)
          .get('/')
          .expect(404, done)
      }
```

#### should assert value if function

```ts
it('should assert value if function', function () {
      assert.throws(createApp.bind(null, { verify: 'lol' }),
        /TypeError: option verify must be function/)
    }
```

#### should error from verify

```ts
it('should error from verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x20) throw new Error('no leading space')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(' user=tobi')
        .expect(403, '[entity.verify.failed] no leading space', done)
    }
```

#### should allow custom codes

```ts
it('should allow custom codes', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x20) return
          var err = new Error('no leading space')
          err.status = 400
          throw err
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(' user=tobi')
        .expect(400, '[entity.verify.failed] no leading space', done)
    }
```

#### should allow custom type

```ts
it('should allow custom type', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x20) return
          var err = new Error('no leading space')
          err.type = 'foo.bar'
          throw err
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(' user=tobi')
        .expect(403, '[foo.bar] no leading space', done)
    }
```

#### should allow pass-through

```ts
it('should allow pass-through', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error('no arrays')
        }
      })

      request(app)
        .post('/')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('user=tobi')
        .expect(200, '{"user":"tobi"}', done)
    }
```

#### should 415 on unknown charset prior to verify

```ts
it('should 415 on unknown charset prior to verify', function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          throw new Error('unexpected verify call')
        }
      })

      var test = request(app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded; charset=x-bogus')
      test.write(Buffer.from('00000000', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done)
    }
```

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

#### should parse utf-8

```ts
it('should parse utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should parse when content-length != char length

```ts
it('should parse when content-length != char length', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8')
      test.set('Content-Length', '7')
      test.write(Buffer.from('746573743dc3a5', 'hex'))
      test.expect(200, '{"test":"å"}', done)
    }
```

#### should default to utf-8

```ts
it('should default to utf-8', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should fail on unknown charset

```ts
it('should fail on unknown charset', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded; charset=koi8-r')
      test.write(Buffer.from('6e616d653dcec5d4', 'hex'))
      test.expect(415, '[charset.unsupported] unsupported charset "KOI8-R"', done)
    }
```

#### should parse without encoding

```ts
it('should parse without encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support identity encoding

```ts
it('should support identity encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'identity')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('6e616d653de8aeba', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support gzip encoding

```ts
it('should support gzip encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'gzip')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should support deflate encoding

```ts
it('should support deflate encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'deflate')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('789ccb4bcc4db57db16e17001068042f', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should be case-insensitive

```ts
it('should be case-insensitive', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'GZIP')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('1f8b080000000000000bcb4bcc4db57db16e170099a4bad608000000', 'hex'))
      test.expect(200, '{"name":"论"}', done)
    }
```

#### should 415 on unknown encoding

```ts
it('should 415 on unknown encoding', function (done) {
      var test = request(this.app).post('/')
      test.set('Content-Encoding', 'nulls')
      test.set('Content-Type', 'application/x-www-form-urlencoded')
      test.write(Buffer.from('000000000000', 'hex'))
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done)
    }
```

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

#### should return the addr after trusted proxy based on list

```ts
it('should return the addr after trusted proxy based on list', function (done) {
          var app = express()

          app.set('trust proxy', '10.0.0.1, 10.0.0.2, 127.0.0.1, ::1')

          app.get('/', function (req, res) {
            res.send(req.ip)
          })

          request(app)
            .get('/')
            .set('X-Forwarded-For', '10.0.0.2, 10.0.0.3, 10.0.0.1', '10.0.0.4')
            .expect('10.0.0.3', done)
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

### ../../.sbomtest/repos/f3c62de455-express/test/res.set.js

#### should set the response header field

```ts
it('should set the response header field', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('Content-Type', 'text/x-foo; charset=utf-8').end();
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/x-foo; charset=utf-8')
      .end(done);
    }
```

#### should coerce to a string

```ts
it('should coerce to a string', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set('X-Number', 123);
        res.end(typeof res.get('X-Number'));
      });

      request(app)
      .get('/')
      .expect('X-Number', '123')
      .expect(200, 'string', done);
    }
```

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

#### should coerce to an array of strings

```ts
it('should coerce to an array of strings', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set('X-Numbers', [123, 456]);
        res.end(JSON.stringify(res.get('X-Numbers')));
      });

      request(app)
      .get('/')
      .expect('X-Numbers', '123, 456')
      .expect(200, '["123","456"]', done);
    }
```

#### should not set a charset of one is already set

```ts
it('should not set a charset of one is already set', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set('Content-Type', 'text/html; charset=lol');
        res.end();
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/html; charset=lol')
      .expect(200, done);
    }
```

#### should throw when Content-Type is an array

```ts
it('should throw when Content-Type is an array', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.set('Content-Type', ['text/html'])
        res.end()
      });

      request(app)
      .get('/')
      .expect(500, /TypeError: Content-Type cannot be set to an Array/, done)
    }
```

#### should set multiple fields

```ts
it('should set multiple fields', function(done){
      var app = express();

      app.use(function(req, res){
        res.set({
          'X-Foo': 'bar',
          'X-Bar': 'baz'
        }).end();
      });

      request(app)
      .get('/')
      .expect('X-Foo', 'bar')
      .expect('X-Bar', 'baz')
      .end(done);
    }
```

#### should coerce to a string

```ts
it('should coerce to a string', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.set({ 'X-Number': 123 });
        res.end(typeof res.get('X-Number'));
      });

      request(app)
      .get('/')
      .expect('X-Number', '123')
      .expect(200, 'string', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.range.js

#### should return parsed ranges

```ts
it('should return parsed ranges', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.range(120))
      })

      request(app)
      .get('/')
      .set('Range', 'bytes=0-50,51-100')
      .expect(200, '[{"start":0,"end":50},{"start":51,"end":100}]', done)
    }
```

#### should cap to the given size

```ts
it('should cap to the given size', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.range(75))
      })

      request(app)
      .get('/')
      .set('Range', 'bytes=0-100')
      .expect(200, '[{"start":0,"end":74}]', done)
    }
```

#### should cap to the given size when open-ended

```ts
it('should cap to the given size when open-ended', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.range(75))
      })

      request(app)
      .get('/')
      .set('Range', 'bytes=0-')
      .expect(200, '[{"start":0,"end":74}]', done)
    }
```

#### should have a .type

```ts
it('should have a .type', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.range(120).type)
      })

      request(app)
      .get('/')
      .set('Range', 'bytes=0-100')
      .expect(200, '"bytes"', done)
    }
```

#### should accept any type

```ts
it('should accept any type', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.json(req.range(120).type)
      })

      request(app)
      .get('/')
      .set('Range', 'users=0-2')
      .expect(200, '"users"', done)
    }
```

#### should return undefined if no range

```ts
it('should return undefined if no range', function (done) {
      var app = express()

      app.use(function (req, res) {
        res.send(String(req.range(120)))
      })

      request(app)
      .get('/')
      .expect(200, 'undefined', done)
    }
```

#### should return combined ranges

```ts
it('should return combined ranges', function (done) {
        var app = express()

        app.use(function (req, res) {
          res.json(req.range(120, {
            combine: true
          }))
        })

        request(app)
        .get('/')
        .set('Range', 'bytes=0-50,51-100')
        .expect(200, '[{"start":0,"end":100}]', done)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.query.js

#### should default to {}

```ts
it('should default to {}', function(done){
      var app = createApp();

      request(app)
      .get('/')
      .expect(200, '{}', done);
    }
```

#### should default to parse simple keys

```ts
it('should default to parse simple keys', function (done) {
      var app = createApp();

      request(app)
      .get('/?user[name]=tj')
      .expect(200, '{"user[name]":"tj"}', done);
    }
```

#### should parse complex keys

```ts
it('should parse complex keys', function (done) {
        var app = createApp('extended');

        request(app)
        .get('/?foo[0][bar]=baz&foo[0][fizz]=buzz&foo[]=done!')
        .expect(200, '{"foo":[{"bar":"baz","fizz":"buzz"},"done!"]}', done);
      }
```

#### should parse parameters with dots

```ts
it('should parse parameters with dots', function (done) {
        var app = createApp('extended');

        request(app)
        .get('/?user.name=tj')
        .expect(200, '{"user.name":"tj"}', done);
      }
```

#### should not parse complex keys

```ts
it('should not parse complex keys', function (done) {
        var app = createApp('simple');

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"user[name]":"tj"}', done);
      }
```

#### should parse using function

```ts
it('should parse using function', function (done) {
        var app = createApp(function (str) {
          return {'length': (str || '').length};
        });

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"length":17}', done);
      }
```

#### should not parse query

```ts
it('should not parse query', function (done) {
        var app = createApp(false);

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{}', done);
      }
```

#### should not parse complex keys

```ts
it('should not parse complex keys', function (done) {
        var app = createApp(true);

        request(app)
        .get('/?user%5Bname%5D=tj')
        .expect(200, '{"user[name]":"tj"}', done);
      }
```

#### should throw

```ts
it('should throw', function () {
        assert.throws(createApp.bind(null, 'bogus'),
          /unknown value.*query parser/)
      }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.append.js

#### should append multiple headers

```ts
it('should append multiple headers', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.append('Set-Cookie', 'foo=bar')
        next()
      })

      app.use(function (req, res) {
        res.append('Set-Cookie', 'fizz=buzz')
        res.end()
      })

      request(app)
        .get('/')
        .expect(200)
        .expect(shouldHaveHeaderValues('Set-Cookie', ['foo=bar', 'fizz=buzz']))
        .end(done)
    }
```

#### should accept array of values

```ts
it('should accept array of values', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.append('Set-Cookie', ['foo=bar', 'fizz=buzz'])
        res.end()
      })

      request(app)
        .get('/')
        .expect(200)
        .expect(shouldHaveHeaderValues('Set-Cookie', ['foo=bar', 'fizz=buzz']))
        .end(done)
    }
```

#### should get reset by res.set(field, val)

```ts
it('should get reset by res.set(field, val)', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.append('Set-Cookie', 'foo=bar')
        res.append('Set-Cookie', 'fizz=buzz')
        next()
      })

      app.use(function (req, res) {
        res.set('Set-Cookie', 'pet=tobi')
        res.end()
      });

      request(app)
        .get('/')
        .expect(200)
        .expect(shouldHaveHeaderValues('Set-Cookie', ['pet=tobi']))
        .end(done)
    }
```

#### should work with res.set(field, val) first

```ts
it('should work with res.set(field, val) first', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.set('Set-Cookie', 'foo=bar')
        next()
      })

      app.use(function(req, res){
        res.append('Set-Cookie', 'fizz=buzz')
        res.end()
      })

      request(app)
        .get('/')
        .expect(200)
        .expect(shouldHaveHeaderValues('Set-Cookie', ['foo=bar', 'fizz=buzz']))
        .end(done)
    }
```

#### should work together with res.cookie

```ts
it('should work together with res.cookie', function (done) {
      var app = express()

      app.use(function (req, res, next) {
        res.cookie('foo', 'bar')
        next()
      })

      app.use(function (req, res) {
        res.append('Set-Cookie', 'fizz=buzz')
        res.end()
      })

      request(app)
        .get('/')
        .expect(200)
        .expect(shouldHaveHeaderValues('Set-Cookie', ['foo=bar; Path=/', 'fizz=buzz']))
        .end(done)
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.attachment.js

#### should Content-Disposition to attachment

```ts
it('should Content-Disposition to attachment', function(done){
      var app = express();

      app.use(function(req, res){
        res.attachment().send('foo');
      });

      request(app)
      .get('/')
      .expect('Content-Disposition', 'attachment', done);
    }
```

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

#### should add the filename and filename* params

```ts
it('should add the filename and filename* params', function(done){
      var app = express();

      app.use(function(req, res){
        res.attachment('/locales/日本語.txt');
        res.send('japanese');
      });

      request(app)
      .get('/')
      .expect('Content-Disposition', 'attachment; filename="???.txt"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC%E8%AA%9E.txt')
      .expect(200, done);
    }
```

#### should set the Content-Type

```ts
it('should set the Content-Type', function(done){
      var app = express();

      app.use(function(req, res){
        res.attachment('/locales/日本語.txt');
        res.send('japanese');
      });

      request(app)
      .get('/')
      .expect('Content-Type', 'text/plain; charset=utf-8', done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.vary.js

#### should throw error

```ts
it('should throw error', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.vary();
        res.end();
      });

      request(app)
      .get('/')
      .expect(500, /field.*required/, done)
    }
```

#### should not set Vary

```ts
it('should not set Vary', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.vary([]);
        res.end();
      });

      request(app)
      .get('/')
      .expect(utils.shouldNotHaveHeader('Vary'))
      .expect(200, done);
    }
```

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

#### should set the value

```ts
it('should set the value', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.vary('Accept');
        res.end();
      });

      request(app)
      .get('/')
      .expect('Vary', 'Accept')
      .expect(200, done);
    }
```

#### should not add it again

```ts
it('should not add it again', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.vary('Accept');
        res.vary('Accept-Encoding');
        res.vary('Accept-Encoding');
        res.vary('Accept-Encoding');
        res.vary('Accept');
        res.end();
      });

      request(app)
      .get('/')
      .expect('Vary', 'Accept, Accept-Encoding')
      .expect(200, done);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.fresh.js

#### should return true when the resource is not modified

```ts
it('should return true when the resource is not modified', function(done){
      var app = express();
      var etag = '"12345"';

      app.use(function(req, res){
        res.set('ETag', etag);
        res.send(req.fresh);
      });

      request(app)
      .get('/')
      .set('If-None-Match', etag)
      .expect(304, done);
    }
```

#### should return false when the resource is modified

```ts
it('should return false when the resource is modified', function(done){
      var app = express();

      app.use(function(req, res){
        res.set('ETag', '"123"');
        res.send(req.fresh);
      });

      request(app)
      .get('/')
      .set('If-None-Match', '"12345"')
      .expect(200, 'false', done);
    }
```

#### should return false without response headers

```ts
it('should return false without response headers', function(done){
      var app = express();

      app.disable('x-powered-by')
      app.use(function(req, res){
        res.send(req.fresh);
      });

      request(app)
      .get('/')
      .expect(200, 'false', done);
    }
```

#### should ignore "If-Modified-Since" when "If-None-Match" is present

```ts
it('should ignore "If-Modified-Since" when "If-None-Match" is present', function(done) {
      var app = express();
      const etag = '"FooBar"'
      const now = Date.now()

      app.disable('x-powered-by')
      app.use(function(req, res) {
        res.set('Etag', etag)
        res.set('Last-Modified', new Date(now).toUTCString())
        res.send(req.fresh);
      });

      request(app)
        .get('/')
        .set('If-Modified-Since', new Date(now - 1000).toUTCString)
        .set('If-None-Match', etag)
        .expect(304, done);
    }
```

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

