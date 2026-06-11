# External tests for server-row-menu.tsx

**Arquivo:** `packages/app/src/components/server/server-row-menu.tsx`

## Checklist

- [ ] @opencode-ai/ui/v2/icon
- [ ] @opencode-ai/ui/v2/icon-button-v2
- [ ] @opencode-ai/ui/v2/menu-v2
- [ ] solid-js
- [ ] @/components/dialog-select-server
- [ ] @/context/language
- [ ] @/context/server

## @opencode-ai/ui/v2/icon

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/v2/icon-button-v2

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/v2/menu-v2

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

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

## @/components/dialog-select-server

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

## @/context/server

**Consultas usadas no Horsebox:** `key`, `@/context/server key`, `/context/server key`, `server key`, `builtin`, `@/context/server builtin`, `/context/server builtin`, `server builtin`, `ServerConnection`, `@/context/server ServerConnection`, `/context/server ServerConnection`, `server ServerConnection`

**Arquivos de teste encontrados:** 53

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/web-service.js

#### should respond with 401 unauthorized

```ts
it('should respond with 401 unauthorized', function(done){
        request(app)
        .get('/api/users?api-key=rawr')
        .expect(401, done);
      }
```

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

#### should respond with 401 unauthorized

```ts
it('should respond with 401 unauthorized', function(done){
        request(app)
        .get('/api/user/loki/repos?api-key=rawr')
        .expect(401, done);
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

#### should 404 with unknown user

```ts
it('should 404 with unknown user', function(done){
        request(app)
        .get('/api/user/bob/repos?api-key=foo')
        .expect(404, done)
      }
```

#### should respond with 404 json

```ts
it('should respond with 404 json', function(done){
      request(app)
        .get('/api/something?api-key=bar')
        .expect('Content-Type', /json/)
        .expect(404, '{"error":"Sorry, can\'t find that"}', done)
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

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

#### memoize

```ts
test('memoize', function(assert) {
    var fib = function(n) {
      return n < 2 ? n : fib(n - 1) + fib(n - 2);
    };
    assert.equal(fib(10), 55, 'a memoized version of fibonacci produces identical results');
    fib = _.memoize(fib); // Redefine `fib` for memoization
    assert.equal(fib(10), 55, 'a memoized version of fibonacci produces identical results');

    var o = function(str) {
      return str;
    };
    var fastO = _.memoize(o);
    assert.equal(o('toString'), 'toString', 'checks hasOwnProperty');
    assert.equal(fastO('toString'), 'toString', 'checks hasOwnProperty');

    // Expose the cache.
    var upper = _.memoize(function(s) {
      return s.toUpperCase();
    });
    assert.equal(upper('foo'), 'FOO');
    assert.equal(upper('bar'), 'BAR');
    assert.deepEqual(upper.cache, {foo: 'FOO', bar: 'BAR'});
    upper.cache = {foo: 'BAR', bar: 'FOO'};
    assert.equal(upper('foo'), 'BAR');
    assert.equal(upper('bar'), 'FOO');

    var hashed = _.memoize(function(key) {
      //https://github.com/jashkenas/underscore/pull/1679#discussion_r13736209
      assert.ok(/[a-z]+/.test(key), 'hasher doesn\'t change keys');
      return key;
    }, function(key) {
      return key.toUpperCase();
    });
    hashed('yep');
    assert.deepEqual(hashed.cache, {YEP: 'yep'}, 'takes a hasher');

    // Test that the hash function can be used to swizzle the key.
    var objCacher = _.memoize(function(value, key) {
      return {key: key, value: value};
    }, function(value, key) {
      return key;
    });
    var myObj = objCacher('a', 'alpha');
    var myObjAlias = objCacher('b', 'alpha');
    assert.notStrictEqual(myObj, void 0, 'object is created if second argument used as key');
    assert.strictEqual(myObj, myObjAlias, 'object is cached if second argument used as key');
    assert.strictEqual(myObj.value, 'a', 'object is not modified if second argument used as key');
  }
```

#### iteratee

```ts
test('iteratee', function(assert) {
    var identity = _.iteratee();
    assert.equal(identity, _.identity, '_.iteratee is exposed as an external function.');

    function fn() {
      return arguments;
    }
    _.each([_.iteratee(fn), _.iteratee(fn, {})], function(cb) {
      assert.equal(cb().length, 0);
      assert.deepEqual(_.toArray(cb(1, 2, 3)), _.range(1, 4));
      assert.deepEqual(_.toArray(cb(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)), _.range(1, 11));
    });

    // Test custom iteratee
    var builtinIteratee = _.iteratee;
    _.iteratee = function(value) {
      // RegEx values return a function that returns the number of matches
      if (_.isRegExp(value)) return function(obj) {
        return (obj.match(value) || []).length;
      };
      return value;
    };

    var collection = ['foo', 'bar', 'bbiz'];

    // Test all methods that claim to be transformed through `_.iteratee`
    assert.deepEqual(_.countBy(collection, /b/g), {0: 1, 1: 1, 2: 1});
    assert.equal(_.every(collection, /b/g), false);
    assert.deepEqual(_.filter(collection, /b/g), ['bar', 'bbiz']);
    assert.equal(_.find(collection, /b/g), 'bar');
    assert.equal(_.findIndex(collection, /b/g), 1);
    assert.equal(_.findKey(collection, /b/g), 1);
    assert.equal(_.findLastIndex(collection, /b/g), 2);
    assert.deepEqual(_.groupBy(collection, /b/g), {0: ['foo'], 1: ['bar'], 2: ['bbiz']});
    assert.deepEqual(_.indexBy(collection, /b/g), {0: 'foo', 1: 'bar', 2: 'bbiz'});
    assert.deepEqual(_.map(collection, /b/g), [0, 1, 2]);
    assert.equal(_.max(collection, /b/g), 'bbiz');
    assert.equal(_.min(collection, /b/g), 'foo');
    assert.deepEqual(_.partition(collection, /b/g), [['bar', 'bbiz'], ['foo']]);
    assert.deepEqual(_.reject(collection, /b/g), ['foo']);
    assert.equal(_.some(collection, /b/g), true);
    assert.deepEqual(_.sortBy(collection, /b/g), ['foo', 'bar', 'bbiz']);
    assert.equal(_.sortedIndex(collection, 'blah', /b/g), 1);
    assert.deepEqual(_.uniq(collection, /b/g), ['foo', 'bar', 'bbiz']);

    var objCollection = {a: 'foo', b: 'bar', c: 'bbiz'};
    assert.deepEqual(_.mapObject(objCollection, /b/g), {a: 0, b: 1, c: 2});

    // Restore the builtin iteratee
    _.iteratee = builtinIteratee;
  }
```

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

#### `_.' + methodName + '` should create an object from the same realm as `value`

```ts
test('`_.' + methodName + '` should create an object from the same realm as `value`', function(assert) {
        assert.expect(1);

        var props = [];

        var objects = lodashStable.transform(_, function(result, value, key) {
          if (lodashStable.startsWith(key, '_') && lodashStable.isObject(value) &&
              !lodashStable.isArguments(value) && !lodashStable.isElement(value) &&
              !lodashStable.isFunction(value)) {
            props.push(lodashStable.capitalize(lodashStable.camelCase(key)));
            result.push(value);
          }
        }, []);

        var expected = lodashStable.map(objects, stubTrue);

        var actual = lodashStable.map(objects, function(object) {
          var Ctor = object.constructor,
              result = func(object);

          return result !== object && ((result instanceof Ctor) || !(new Ctor instanceof Ctor));
        });

        assert.deepEqual(actual, expected, props.join(', '));
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

#### should transform keys by `iteratee`

```ts
test('should transform keys by `iteratee`', function(assert) {
      assert.expect(1);

      var actual = _.countBy(array, Math.floor);
      assert.deepEqual(actual, { '4': 1, '6': 2 });
    }
```

#### should assign properties that shadow those of `prototype`

```ts
test('should assign properties that shadow those of `prototype`', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      var object = _.create(new Foo, { 'a': 1 });
      assert.deepEqual(lodashStable.keys(object), ['a']);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [{ 'a': 1 }, { 'a': 1 }, { 'a': 1 }],
          expected = lodashStable.map(array, stubTrue),
          objects = lodashStable.map(array, _.create);

      var actual = lodashStable.map(objects, function(object) {
        return object.a === 1 && !_.keys(object).length;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      var expected = ({
        'find': 1,
        'findIndex': 0,
        'findKey': '0',
        'findLast': 4,
        'findLastIndex': 3,
        'findLastKey': '3'
      })[methodName];

      if (!isNpm) {
        assert.strictEqual(_(array)[methodName](), expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should work with an object for `collection`

```ts
test('`_.' + methodName + '` should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = func({ 'a': 1, 'b': 2, 'c': 3 }, function(n) {
        return n < 3;
      });

      var expected = ({
        'find': 1,
        'findKey': 'a',
        'findLast': 2,
        'findLastKey': 'b'
      })[methodName];

      assert.strictEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with ' + key + ' and a positive `fromIndex`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and a positive `fromIndex`', function(assert) {
        assert.expect(1);

        var expected = [
          isIncludes || values[2],
          isIncludes ? false : undefined
        ];

        var actual = [
          func(collection, resolve(values[2]), 2),
          func(collection, resolve(values[1]), 2)
        ];

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should work with ' + key + ' and a `fromIndex` >= `length`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and a `fromIndex` >= `length`', function(assert) {
        assert.expect(1);

        var indexes = [4, 6, Math.pow(2, 32), Infinity];

        var expected = lodashStable.map(indexes, function() {
          var result = isIncludes ? false : undefined;
          return [result, result, result];
        });

        var actual = lodashStable.map(indexes, function(fromIndex) {
          return [
            func(collection, resolve(1), fromIndex),
            func(collection, resolve(undefined), fromIndex),
            func(collection, resolve(''), fromIndex)
          ];
        });

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should work with ' + key + ' and treat falsey `fromIndex` values as `0`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and treat falsey `fromIndex` values as `0`', function(assert) {
        assert.expect(1);

        var expected = lodashStable.map(falsey, lodashStable.constant(isIncludes || values[0]));

        var actual = lodashStable.map(falsey, function(fromIndex) {
          return func(collection, resolve(values[0]), fromIndex);
        });

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should work with ' + key + ' and coerce `fromIndex` to an integer

```ts
test('`_.' + methodName + '` should work with ' + key + ' and coerce `fromIndex` to an integer', function(assert) {
        assert.expect(1);

        var expected = [
          isIncludes || values[0],
          isIncludes || values[0],
          isIncludes ? false : undefined
        ];

        var actual = [
          func(collection, resolve(values[0]), 0.1),
          func(collection, resolve(values[0]), NaN),
          func(collection, resolve(values[0]), '1')
        ];

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should work with ' + key + ' and a negative `fromIndex`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and a negative `fromIndex`', function(assert) {
        assert.expect(1);

        var expected = [
          isIncludes || values[2],
          isIncludes ? false : undefined
        ];

        var actual = [
          func(collection, resolve(values[2]), -1),
          func(collection, resolve(values[1]), -1)
        ];

        assert.deepEqual(actual, expected);
      }
```

#### `_.' + methodName + '` should work with ' + key + ' and a negative `fromIndex` <= `-length`

```ts
test('`_.' + methodName + '` should work with ' + key + ' and a negative `fromIndex` <= `-length`', function(assert) {
        assert.expect(1);

        var indexes = [-4, -6, -Infinity],
            expected = lodashStable.map(indexes, lodashStable.constant(isIncludes || values[0]));

        var actual = lodashStable.map(indexes, function(fromIndex) {
          return func(collection, resolve(values[0]), fromIndex);
        });

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and a positive `fromIndex`

```ts
test('should work with ' + key + ' and a positive `fromIndex`', function(assert) {
        assert.expect(1);

        var expected = [
          values[1],
          undefined
        ];

        var actual = [
          _.findLast(collection, resolve(values[1]), 1),
          _.findLast(collection, resolve(values[2]), 1)
        ];

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and a `fromIndex` >= `length`

```ts
test('should work with ' + key + ' and a `fromIndex` >= `length`', function(assert) {
        assert.expect(1);

        var indexes = [4, 6, Math.pow(2, 32), Infinity];

        var expected = lodashStable.map(indexes, lodashStable.constant([values[0], undefined, undefined]));

        var actual = lodashStable.map(indexes, function(fromIndex) {
          return [
            _.findLast(collection, resolve(1), fromIndex),
            _.findLast(collection, resolve(undefined), fromIndex),
            _.findLast(collection, resolve(''), fromIndex)
          ];
        });

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and treat falsey `fromIndex` values correctly

```ts
test('should work with ' + key + ' and treat falsey `fromIndex` values correctly', function(assert) {
        assert.expect(1);

        var expected = lodashStable.map(falsey, function(value) {
          return value === undefined ? values[3] : undefined;
        });

        var actual = lodashStable.map(falsey, function(fromIndex) {
          return _.findLast(collection, resolve(values[3]), fromIndex);
        });

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and coerce `fromIndex` to an integer

```ts
test('should work with ' + key + ' and coerce `fromIndex` to an integer', function(assert) {
        assert.expect(1);

        var expected = [
          values[0],
          values[0],
          undefined
        ];

        var actual = [
          _.findLast(collection, resolve(values[0]), 0.1),
          _.findLast(collection, resolve(values[0]), NaN),
          _.findLast(collection, resolve(values[2]), '1')
        ];

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and a negative `fromIndex`

```ts
test('should work with ' + key + ' and a negative `fromIndex`', function(assert) {
        assert.expect(1);

        var expected = [
          values[1],
          undefined
        ];

        var actual = [
          _.findLast(collection, resolve(values[1]), -2),
          _.findLast(collection, resolve(values[2]), -2)
        ];

        assert.deepEqual(actual, expected);
      }
```

#### should work with ' + key + ' and a negative `fromIndex` <= `-length`

```ts
test('should work with ' + key + ' and a negative `fromIndex` <= `-length`', function(assert) {
        assert.expect(1);

        var indexes = [-4, -6, -Infinity],
            expected = lodashStable.map(indexes, lodashStable.constant(values[0]));

        var actual = lodashStable.map(indexes, function(fromIndex) {
          return _.findLast(collection, resolve(values[0]), fromIndex);
        });

        assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` iterates over inherited string keyed properties

```ts
test('`_.' + methodName + '` iterates over inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var keys = [];
      func(new Foo, function(value, key) { keys.push(key); });
      assert.deepEqual(keys.sort(), ['a', 'b']);
    }
```

#### `_.' + methodName + '` should not iterate custom properties on arrays

```ts
test('`_.' + methodName + '` should not iterate custom properties on arrays', function(assert) {
        assert.expect(1);

        if (func) {
          var keys = [];
          func(array, function(value, key) {
            keys.push(key);
            return isEvery;
          });

          assert.notOk(lodashStable.includes(keys, 'a'));
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` iterates over own string keyed properties of objects

```ts
test('`_.' + methodName + '` iterates over own string keyed properties of objects', function(assert) {
        assert.expect(1);

        function Foo() {
          this.a = 1;
        }
        Foo.prototype.b = 2;

        if (func) {
          var values = [];
          func(new Foo, function(value) { values.push(value); });
          assert.deepEqual(values, [1]);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` should assign own ' + (isAssign ? '' : 'and inherited ') + 'string keyed source properties

```ts
test('`_.' + methodName + '` should assign own ' + (isAssign ? '' : 'and inherited ') + 'string keyed source properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isAssign ? { 'a': 1 } : { 'a': 1, 'b': 2 };
      assert.deepEqual(func({}, new Foo), expected);
    }
```

#### should work with the "__proto__" key in internal data objects

```ts
test('should work with the "__proto__" key in internal data objects', function(assert) {
      assert.expect(4);

      var stringLiteral = '__proto__',
          stringObject = Object(stringLiteral),
          expected = [stringLiteral, stringObject];

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, function(count) {
        return isEven(count) ? stringLiteral : stringObject;
      });

      assert.deepEqual(_.difference(largeArray, largeArray), []);
      assert.deepEqual(_.intersection(largeArray, largeArray), expected);
      assert.deepEqual(_.uniq(largeArray), expected);
      assert.deepEqual(_.without.apply(_, [largeArray].concat(largeArray)), []);
    }
```

#### should treat "__proto__" as a regular key in assignments

```ts
test('should treat "__proto__" as a regular key in assignments', function(assert) {
      assert.expect(2);

      var methods = [
        'assign',
        'assignIn',
        'defaults',
        'defaultsDeep',
        'merge'
      ];

      var source = create(null);
      source.__proto__ = [];

      var expected = lodashStable.map(methods, stubFalse);

      var actual = lodashStable.map(methods, function(methodName) {
        var result = _[methodName]({}, source);
        return result instanceof Array;
      });

      assert.deepEqual(actual, expected);

      actual = _.groupBy([{ 'a': '__proto__' }], 'a');
      assert.notOk(actual instanceof Array);
    }
```

#### should not indirectly merge builtin prototype properties

```ts
test('should not indirectly merge builtin prototype properties', function(assert) {
      assert.expect(2);

      _.merge({}, { 'toString': { 'constructor': { 'prototype': { 'a': 1 } } } });

      var actual = 'a' in funcProto;
      delete funcProto.a;

      assert.notOk(actual);

      _.merge({}, { 'constructor': { 'prototype': { 'a': 1 } } });

      actual = 'a' in objectProto;
      delete objectProto.a;

      assert.notOk(actual);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array = lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
          return ['key' + index, index];
        });

        var actual = _(array).fromPairs().map(square).filter(isEven).take().value();

        assert.deepEqual(actual, _.take(_.filter(_.map(_.fromPairs(array), square), isEven)));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should transform keys by `iteratee`

```ts
test('should transform keys by `iteratee`', function(assert) {
      assert.expect(1);

      var actual = _.groupBy(array, Math.floor);
      assert.deepEqual(actual, { '4': [4.2], '6': [6.1, 6.3] });
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': 'a', '0': 'b' },
          props = [-0, Object(-0), 0, Object(0)],
          expected = lodashStable.map(props, stubTrue);

      var actual = lodashStable.map(props, function(key) {
        return func(object, key);
      });

      assert.deepEqual(actual, expected);
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

#### should work with ' + key + ' and  return `true` for  matched values

```ts
test('should work with ' + key + ' and  return `true` for  matched values', function(assert) {
        assert.expect(1);

        assert.strictEqual(_.includes(collection, 3), true);
      }
```

#### should work with ' + key + ' and  return `false` for unmatched values

```ts
test('should work with ' + key + ' and  return `false` for unmatched values', function(assert) {
        assert.expect(1);

        assert.strictEqual(_.includes(collection, 5), false);
      }
```

#### should work with ' + key + ' and floor `position` values

```ts
test('should work with ' + key + ' and floor `position` values', function(assert) {
        assert.expect(1);

        assert.strictEqual(_.includes(collection, 2, 1.2), true);
      }
```

#### should work with ' + key + ' and return an unwrapped value implicitly when chaining

```ts
test('should work with ' + key + ' and return an unwrapped value implicitly when chaining', function(assert) {
        assert.expect(1);

        if (!isNpm) {
          assert.strictEqual(_(collection).includes(3), true);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### should work with ' + key + ' and return a wrapped value when explicitly chaining

```ts
test('should work with ' + key + ' and return a wrapped value when explicitly chaining', function(assert) {
        assert.expect(1);

        if (!isNpm) {
          assert.ok(_(collection).chain().includes(3) instanceof _);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### should work with a string ' + key + ' for `collection`

```ts
test('should work with a string ' + key + ' for `collection`', function(assert) {
        assert.expect(2);

        assert.strictEqual(_.includes(collection, 'bc'), true);
        assert.strictEqual(_.includes(collection, 'd'), false);
      }
```

#### should work with values that shadow keys on `Object.prototype`

```ts
test('should work with values that shadow keys on `Object.prototype`', function(assert) {
      assert.expect(1);

      var object = { 'a': 'hasOwnProperty', 'b': 'constructor' };
      assert.deepEqual(_.invert(object), { 'hasOwnProperty': 'a', 'constructor': 'b' });
    }
```

#### should transform keys by `iteratee`

```ts
test('should transform keys by `iteratee`', function(assert) {
      assert.expect(1);

      var expected = { 'group1': ['a', 'c'], 'group2': ['b'] };

      var actual = _.invertBy(object, function(value) {
        return 'group' + value;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': stubA, '0': stubB },
          props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        return _.invoke(object, key);
      });

      assert.deepEqual(actual, ['a', 'a', 'b', 'b']);
    }
```

#### should compare objects regardless of key order

```ts
test('should compare objects regardless of key order', function(assert) {
      assert.expect(1);

      var object1 = { 'a': 1, 'b': 2, 'c': 3 },
          object2 = { 'c': 3, 'a': 1, 'b': 2 };

      assert.strictEqual(_.isEqual(object1, object2), true);
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

#### should work with typed arrays from another realm

```ts
test('should work with typed arrays from another realm', function(assert) {
      assert.expect(1);

      if (realm.object) {
        var props = lodashStable.invokeMap(typedArrays, 'toLowerCase');

        var expected = lodashStable.map(props, function(key) {
          return realm[key] !== undefined;
        });

        var actual = lodashStable.map(props, function(key) {
          var value = realm[key];
          return value ? _.isTypedArray(value) : false;
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.findKey` should use `_.iteratee` internally

```ts
test('`_.findKey` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = getPropB;
        assert.strictEqual(_.findKey(objects), '2');
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.findLastKey` should use `_.iteratee` internally

```ts
test('`_.findLastKey` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = getPropB;
        assert.strictEqual(_.findLastKey(objects), '2');
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.keyBy` should use `_.iteratee` internally

```ts
test('`_.keyBy` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = getLength;
        assert.deepEqual(_.keyBy(array), { '3': 'two', '5': 'three' });
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.mapKeys` should use `_.iteratee` internally

```ts
test('`_.mapKeys` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = getPropB;
        assert.deepEqual(_.mapKeys({ 'a': { 'b': 2 } }), { '2':  { 'b': 2 } });
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should transform keys by `iteratee`

```ts
test('should transform keys by `iteratee`', function(assert) {
      assert.expect(1);

      var expected = { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } };

      var actual = _.keyBy(array, function(object) {
        return String.fromCharCode(object.code);
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

#### should work with `_.property` shorthands

```ts
test('should work with `_.property` shorthands', function(assert) {
      assert.expect(1);

      var expected = { 'left': { 'dir': 'left', 'code': 97 }, 'right': { 'dir': 'right', 'code': 100 } },
          actual = _.keyBy(array, 'dir');

      assert.deepEqual(actual, expected);
    }
```

#### should only add values to own, not inherited, properties

```ts
test('should only add values to own, not inherited, properties', function(assert) {
      assert.expect(2);

      var actual = _.keyBy([6.1, 4.2, 6.3], function(n) {
        return Math.floor(n) > 4 ? 'hasOwnProperty' : 'constructor';
      });

      assert.deepEqual(actual.constructor, 4.2);
      assert.deepEqual(actual.hasOwnProperty, 6.3);
    }
```

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.keyBy(array, 0), { '1': [1, 'a'], '2': [2, 'b'] });
      assert.deepEqual(_.keyBy(array, 1), { 'a': [2, 'a'], 'b': [2, 'b'] });
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = _.keyBy({ 'a': 6.1, 'b': 4.2, 'c': 6.3 }, Math.floor);
      assert.deepEqual(actual, { '4': 4.2, '6': 6.3 });
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE).concat(
          lodashStable.range(Math.floor(LARGE_ARRAY_SIZE / 2), LARGE_ARRAY_SIZE),
          lodashStable.range(Math.floor(LARGE_ARRAY_SIZE / 1.5), LARGE_ARRAY_SIZE)
        );

        var actual = _(array).keyBy().map(square).filter(isEven).take().value();

        assert.deepEqual(actual, _.take(_.filter(_.map(_.keyBy(array), square), isEven)));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return the string keyed property names of `object`

```ts
test('`_.' + methodName + '` should return the string keyed property names of `object`', function(assert) {
      assert.expect(1);

      var actual = func({ 'a': 1, 'b': 1 }).sort();

      assert.deepEqual(actual, ['a', 'b']);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isKeys ? ['a'] : ['a', 'b'],
          actual = func(new Foo).sort();

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return keys for custom properties on arrays

```ts
test('`_.' + methodName + '` should return keys for custom properties on arrays', function(assert) {
      assert.expect(1);

      var array = [1];
      array.a = 1;

      var actual = func(array).sort();

      assert.deepEqual(actual, ['0', 'a']);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of arrays

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of arrays', function(assert) {
      assert.expect(1);

      arrayProto.a = 1;

      var expected = isKeys ? ['0'] : ['0', 'a'],
          actual = func([1]).sort();

      assert.deepEqual(actual, expected);

      delete arrayProto.a;
    }
```

#### `_.' + methodName + '` should return keys for custom properties on `arguments` objects

```ts
test('`_.' + methodName + '` should return keys for custom properties on `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant(['0', '1', '2', 'a']));

      var actual = lodashStable.map(values, function(value) {
        value.a = 1;
        var result = func(value).sort();
        delete value.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of `arguments` objects

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant(isKeys ? ['0', '1', '2'] : ['0', '1', '2', 'a']));

      var actual = lodashStable.map(values, function(value) {
        objectProto.a = 1;
        var result = func(value).sort();
        delete objectProto.a;
        return result;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return keys for custom properties on string objects

```ts
test('`_.' + methodName + '` should return keys for custom properties on string objects', function(assert) {
      assert.expect(1);

      var object = Object('a');
      object.a = 1;

      var actual = func(object).sort();

      assert.deepEqual(actual, ['0', 'a']);
    }
```

#### `_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of string objects

```ts
test('`_.' + methodName + '` should ' + (isKeys ? 'not ' : '') + 'include inherited string keyed properties of string objects', function(assert) {
      assert.expect(1);

      stringProto.a = 1;

      var expected = isKeys ? ['0'] : ['0', 'a'],
          actual = func(Object('a')).sort();

      assert.deepEqual(actual, expected);

      delete stringProto.a;
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

#### should deep clone array/typed-array/plain-object source values

```ts
test('should deep clone array/typed-array/plain-object source values', function(assert) {
      assert.expect(1);

      var typedArray = Uint8Array
        ? new Uint8Array([1])
        : { 'buffer': [1] };

      var props = ['0', 'buffer', 'a'],
          values = [[{ 'a': 1 }], typedArray, { 'a': [1] }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value, index) {
        var key = props[index],
            object = _.merge({}, { 'value': value }),
            subValue = value[key],
            newValue = object.value,
            newSubValue = newValue[key];

        return (
          newValue !== value &&
          newSubValue !== subValue &&
          lodashStable.isEqual(newValue, value)
        );
      });

      assert.deepEqual(actual, expected);
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

#### should sort by nested key in array format

```ts
test('should sort by nested key in array format', function(assert) {
      assert.expect(1);

      var actual = _.orderBy(
        nestedObj,
        [['address', 'zipCode'], ['address.streetName']],
        ['asc', 'desc']
      );
      assert.deepEqual(actual, [nestedObj[2], nestedObj[3], nestedObj[1], nestedObj[0], nestedObj[4]]);
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

#### `_.' + methodName + '` should create an object with omitted string keyed properties

```ts
test('`_.' + methodName + '` should create an object with omitted string keyed properties', function(assert) {
      assert.expect(2);

      assert.deepEqual(func(object, resolve(object, 'a')), { 'b': 2, 'c': 3, 'd': 4 });
      assert.deepEqual(func(object, resolve(object, ['a', 'c'])), expected);
    }
```

#### `_.' + methodName + '` should include inherited string keyed properties

```ts
test('`_.' + methodName + '` should include inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype = object;

      assert.deepEqual(func(new Foo, resolve(object, ['a', 'c'])), expected);
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': 'a', '0': 'b' },
          props = [-0, Object(-0), 0, Object(0)],
          expected = [{ '0': 'b' }, { '0': 'b' }, { '-0': 'a' }, { '-0': 'a' }];

      var actual = lodashStable.map(props, function(key) {
        return func(object, resolve(object, key));
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work with combinations of bound and partial functions

```ts
test('should work with combinations of bound and partial functions', function(assert) {
      assert.expect(3);

      var fn = function() {
        var result = [this.a];
        push.apply(result, arguments);
        return result;
      };

      var expected = [1, 2, 3, 4],
          object = { 'a': 1, 'fn': fn };

      var a = _.bindKey(object, 'fn'),
          b = _.partialRight(a, 4),
          c = _.partial(b, 2);

      assert.deepEqual(c(3), expected);

      a = _.bind(fn, object);
      b = _.partialRight(a, 4);
      c = _.partial(b, 2);

      assert.deepEqual(c(3), expected);

      a = _.partial(fn, 2);
      b = _.bind(a, object);
      c = _.partialRight(b, 4);

      assert.deepEqual(c(3), expected);
    }
```

#### should work with combinations of functions with placeholders

```ts
test('should work with combinations of functions with placeholders', function(assert) {
      assert.expect(3);

      var expected = [1, 2, 3, 4, 5, 6],
          object = { 'fn': fn };

      var a = _.bindKey(object, 'fn', ph2, 2),
          b = _.partialRight(a, ph4, 6),
          c = _.partial(b, 1, ph3, 4);

      assert.deepEqual(c(3, 5), expected);

      a = _.bind(fn, object, ph1, 2);
      b = _.partialRight(a, ph4, 6);
      c = _.partial(b, 1, ph3, 4);

      assert.deepEqual(c(3, 5), expected);

      a = _.partial(fn, ph3, 2);
      b = _.bind(a, object, 1, ph1, 4);
      c = _.partialRight(b, ph4, 6);

      assert.deepEqual(c(3, 5), expected);
    }
```

#### should work with combinations of functions with overlapping placeholders

```ts
test('should work with combinations of functions with overlapping placeholders', function(assert) {
      assert.expect(3);

      var expected = [1, 2, 3, 4],
          object = { 'fn': fn };

      var a = _.bindKey(object, 'fn', ph2, 2),
          b = _.partialRight(a, ph4, 4),
          c = _.partial(b, ph3, 3);

      assert.deepEqual(c(1), expected);

      a = _.bind(fn, object, ph1, 2);
      b = _.partialRight(a, ph4, 4);
      c = _.partial(b, ph3, 3);

      assert.deepEqual(c(1), expected);

      a = _.partial(fn, ph3, 2);
      b = _.bind(a, object, ph1, 3);
      c = _.partialRight(b, ph4, 4);

      assert.deepEqual(c(1), expected);
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

#### should not treat keys with dots as deep paths

```ts
test('should not treat keys with dots as deep paths', function(assert) {
      assert.expect(1);

      var object = { 'a.b.c': 1 },
          actual = _.pickBy(object, stubTrue);

      assert.deepEqual(actual, { 'a.b.c': 1 });
    }
```

#### `_.' + methodName + '` should create an object of picked string keyed properties

```ts
test('`_.' + methodName + '` should create an object of picked string keyed properties', function(assert) {
      assert.expect(2);

      assert.deepEqual(func(object, resolve(object, 'a')), { 'a': 1 });
      assert.deepEqual(func(object, resolve(object, ['a', 'c'])), expected);
    }
```

#### `_.' + methodName + '` should pick inherited string keyed properties

```ts
test('`_.' + methodName + '` should pick inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.prototype = object;

      var foo = new Foo;
      assert.deepEqual(func(foo, resolve(foo, ['a', 'c'])), expected);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': 'a', '0': 'b' },
          props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        var prop = _.property(key);
        return prop(object);
      });

      assert.deepEqual(actual, ['a', 'a', 'b', 'b']);
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

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': 'a', '0': 'b' },
          props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        var propOf = _.propertyOf(object);
        return propOf(key);
      });

      assert.deepEqual(actual, ['a', 'a', 'b', 'b']);
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

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        var array = [-1];
        array['-0'] = -2;
        return _.pullAt(array, key);
      });

      assert.deepEqual(actual, [[-2], [-2], [-1], [-1]]);
    }
```

#### should work with a falsey `array` when keys are given

```ts
test('should work with a falsey `array` when keys are given', function(assert) {
      assert.expect(1);

      var values = falsey.slice(),
          expected = lodashStable.map(values, lodashStable.constant(Array(4)));

      var actual = lodashStable.map(values, function(array) {
        try {
          return _.pullAt(array, 0, 1, 'pop', 'push');
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` should work in a lazy sequence

```ts
test('`_.' + methodName + '` should work in a lazy sequence', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            predicate = function(value) { return isFilter ? isEven(value) : !isEven(value); };

        var object = lodashStable.zipObject(lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
          return ['key' + index, index];
        }));

        var actual = _(array).slice(1).map(square)[methodName](predicate).value();
        assert.deepEqual(actual, _[methodName](lodashStable.map(array.slice(1), square), predicate));

        actual = _(object).mapValues(square)[methodName](predicate).value();
        assert.deepEqual(actual, _[methodName](lodashStable.mapValues(object, square), predicate));
      }
      else {
        skipAssert(assert, 2);
      }
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

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var object = { '-0': 'a', '0': 'b' },
          props = [-0, Object(-0), 0, Object(0)];

      var actual = lodashStable.map(props, function(key) {
        return func(object, key);
      });

      assert.deepEqual(actual, ['a', 'a', 'b', 'b']);
    }
```

#### `_.' + methodName + '` should get symbol keyed property values

```ts
test('`_.' + methodName + '` should get symbol keyed property values', function(assert) {
      assert.expect(1);

      if (Symbol) {
        var object = {};
        object[symbol] = 1;

        assert.strictEqual(func(object, symbol), 1);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)],
          expected = lodashStable.map(props, lodashStable.constant(value));

      var actual = lodashStable.map(props, function(key) {
        var object = { '-0': 'a', '0': 'b' };
        func(object, key, updater);
        return object[lodashStable.toString(key)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should unset symbol keyed property values

```ts
test('`_.' + methodName + '` should unset symbol keyed property values', function(assert) {
      assert.expect(2);

      if (Symbol) {
        var object = {};
        object[symbol] = 1;

        assert.strictEqual(_.unset(object, symbol), true);
        assert.notOk(symbol in object);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should return the number of own enumerable string keyed properties of an object

```ts
test('should return the number of own enumerable string keyed properties of an object', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.size({ 'one': 1, 'two': 2, 'three': 3 }), 3);
    }
```

#### should evaluate JavaScript in "evaluate" delimiters

```ts
test('should evaluate JavaScript in "evaluate" delimiters', function(assert) {
      assert.expect(1);

      var compiled = _.template(
        '<ul><%\
        for (var key in collection) {\
          %><li><%= collection[key] %></li><%\
        } %></ul>'
      );

      var data = { 'collection': { 'a': 'A', 'b': 'B' } },
          actual = compiled(data);

      assert.strictEqual(actual, '<ul><li>A</li><li>B</li></ul>');
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

#### should ignore `null` delimiters

```ts
test('should ignore `null` delimiters', function(assert) {
      assert.expect(3);

      var delimiter = {
        'escape': /\{\{-([\s\S]+?)\}\}/g,
        'evaluate': /\{\{([\s\S]+?)\}\}/g,
        'interpolate': /\{\{=([\s\S]+?)\}\}/g
      };

      lodashStable.forOwn({
        'escape': '{{- a }}',
        'evaluate': '{{ print(a) }}',
        'interpolate': '{{= a }}'
      },
      function(value, key) {
        var settings = { 'escape': null, 'evaluate': null, 'interpolate': null };
        settings[key] = delimiter[key];

        var expected = '1 <%- a %> <% print(a) %> <%= a %>',
            compiled = _.template(value + ' <%- a %> <% print(a) %> <%= a %>', settings),
            data = { 'a': 1 };

        assert.strictEqual(compiled(data), expected);
      });
    }
```

#### should not execute code via malicious imports key names

```ts
test('should not execute code via malicious imports key names', function(assert) {
      assert.expect(2);

      // Default-parameter injection via imports key
      var executed = false;
      var key = 'a = (global.templateTest1 = true, 1)';
      var imports = {};
      imports[key] = undefined;

      try { _.template('hello', { 'imports': imports }); } catch (e) {}
      executed = root.templateTest1 === true;
      delete root.templateTest1;

      assert.strictEqual(executed, false, 'should not execute default-parameter expression in imports key');

      // Same without spaces
      var executed2 = false;
      var key2 = 'a=(global.templateTest2=true,1)';
      var imports2 = {};
      imports2[key2] = undefined;

      try { _.template('hello', { 'imports': imports2 }); } catch (e) {}
      executed2 = root.templateTest2 === true;
      delete root.templateTest2;

      assert.strictEqual(executed2, false, 'should not execute compact default-parameter expression in imports key');
    }
```

#### should not enumerate inherited keys from imports sources

```ts
test('should not enumerate inherited keys from imports sources', function(assert) {
      assert.expect(1);

      // Simulate prototype pollution: inherited key with code injection
      var executed = false;
      var payload = 'a = (global.templateTest3 = true, 1)';
      var polluted = Object.create({ [payload]: undefined });
      polluted._ = _;

      try { _.template('hello', { 'imports': polluted }); } catch (e) {}
      executed = root.templateTest3 === true;
      delete root.templateTest3;

      assert.strictEqual(executed, false, 'should not execute code from inherited imports keys');
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE + 1);

        var object = lodashStable.zipObject(lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
          return ['key' + index, index];
        }));

        var actual = _(array).slice(1).map(String).toArray().value();
        assert.deepEqual(actual, lodashStable.map(array.slice(1), String));

        actual = _(object).toArray().slice(1).map(String).value();
        assert.deepEqual(actual, _.map(_.toArray(object).slice(1), String));
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### `_.' + methodName + '` should create an array of string keyed-value pairs

```ts
test('`_.' + methodName + '` should create an array of string keyed-value pairs', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          actual = lodashStable.sortBy(func(object), 0);

      assert.deepEqual(actual, [['a', 1], ['b', 2]]);
    }
```

#### `_.' + methodName + '` should ' + (isToPairs ? 'not ' : '') + 'include inherited string keyed property values

```ts
test('`_.' + methodName + '` should ' + (isToPairs ? 'not ' : '') + 'include inherited string keyed property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isToPairs ? [['a', 1]] : [['a', 1], ['b', 2]],
          actual = lodashStable.sortBy(func(new Foo), 0);

      assert.deepEqual(actual, expected);
    }
```

#### should flatten inherited string keyed properties

```ts
test('should flatten inherited string keyed properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.b = 2;
      }
      Foo.prototype.c = 3;

      var actual = lodashStable.assign({ 'a': 1 }, _.toPlainObject(new Foo));
      assert.deepEqual(actual, { 'a': 1, 'b': 2, 'c': 3 });
    }
```

#### should create an object with the same `[[Prototype]]` as `object` when `accumulator` is nullish

```ts
test('should create an object with the same `[[Prototype]]` as `object` when `accumulator` is nullish', function(assert) {
      assert.expect(4);

      var accumulators = [, null, undefined],
          object = new Foo,
          expected = lodashStable.map(accumulators, stubTrue);

      var iteratee = function(result, value, key) {
        result[key] = square(value);
      };

      var mapper = function(accumulator, index) {
        return index ? _.transform(object, iteratee, accumulator) : _.transform(object, iteratee);
      };

      var results = lodashStable.map(accumulators, mapper);

      var actual = lodashStable.map(results, function(result) {
        return result instanceof Foo;
      });

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(accumulators, lodashStable.constant({ 'a': 1, 'b': 4, 'c': 9 }));
      actual = lodashStable.map(results, lodashStable.toPlainObject);

      assert.deepEqual(actual, expected);

      object = { 'a': 1, 'b': 2, 'c': 3 };
      actual = lodashStable.map(accumulators, mapper);

      assert.deepEqual(actual, expected);

      object = [1, 2, 3];
      expected = lodashStable.map(accumulators, lodashStable.constant([1, 4, 9]));
      actual = lodashStable.map(accumulators, mapper);

      assert.deepEqual(actual, expected);
    }
```

#### should support an `accumulator` value

```ts
test('should support an `accumulator` value', function(assert) {
      assert.expect(6);

      var values = [new Foo, [1, 2, 3], { 'a': 1, 'b': 2, 'c': 3 }],
          expected = lodashStable.map(values, lodashStable.constant([1, 4, 9]));

      var actual = lodashStable.map(values, function(value) {
        return _.transform(value, function(result, value) {
          result.push(square(value));
        }, []);
      });

      assert.deepEqual(actual, expected);

      var object = { 'a': 1, 'b': 4, 'c': 9 },
      expected = [object, { '0': 1, '1': 4, '2': 9 }, object];

      actual = lodashStable.map(values, function(value) {
        return _.transform(value, function(result, value, key) {
          result[key] = square(value);
        }, {});
      });

      assert.deepEqual(actual, expected);

      lodashStable.each([[], {}], function(accumulator) {
        var actual = lodashStable.map(values, function(value) {
          return _.transform(value, noop, accumulator);
        });

        assert.ok(lodashStable.every(actual, function(result) {
          return result === accumulator;
        }));

        assert.strictEqual(_.transform(null, null, accumulator), accumulator);
      });
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

#### should account for astral symbols

```ts
test('should account for astral symbols', function(assert) {
      assert.expect(34);

      var allHearts = _.repeat(hearts, 10),
          chars = hearts + comboGlyph,
          string = 'A ' + leafs + ', ' + comboGlyph + ', and ' + rocket,
          trimChars = comboGlyph + hearts,
          trimString = trimChars + string + trimChars;

      assert.strictEqual(_.camelCase(hearts + ' the ' + leafs), hearts + 'The' + leafs);
      assert.strictEqual(_.camelCase(string), 'a' + leafs + comboGlyph + 'And' + rocket);
      assert.strictEqual(_.capitalize(rocket), rocket);

      assert.strictEqual(_.pad(string, 16), ' ' + string + '  ');
      assert.strictEqual(_.padStart(string, 16), '   ' + string);
      assert.strictEqual(_.padEnd(string, 16), string + '   ');

      assert.strictEqual(_.pad(string, 16, chars), hearts + string + chars);
      assert.strictEqual(_.padStart(string, 16, chars), chars + hearts + string);
      assert.strictEqual(_.padEnd(string, 16, chars), string + chars + hearts);

      assert.strictEqual(_.size(string), 13);
      assert.deepEqual(_.split(string, ' '), ['A', leafs + ',', comboGlyph + ',', 'and', rocket]);
      assert.deepEqual(_.split(string, ' ', 3), ['A', leafs + ',', comboGlyph + ',']);
      assert.deepEqual(_.split(string, undefined), [string]);
      assert.deepEqual(_.split(string, undefined, -1), [string]);
      assert.deepEqual(_.split(string, undefined, 0), []);

      var expected = ['A', ' ', leafs, ',', ' ', comboGlyph, ',', ' ', 'a', 'n', 'd', ' ', rocket];

      assert.deepEqual(_.split(string, ''), expected);
      assert.deepEqual(_.split(string, '', 6), expected.slice(0, 6));
      assert.deepEqual(_.toArray(string), expected);

      assert.strictEqual(_.trim(trimString, chars), string);
      assert.strictEqual(_.trimStart(trimString, chars), string + trimChars);
      assert.strictEqual(_.trimEnd(trimString, chars), trimChars + string);

      assert.strictEqual(_.truncate(string, { 'length': 13 }), string);
      assert.strictEqual(_.truncate(string, { 'length': 6 }), 'A ' + leafs + '...');

      assert.deepEqual(_.words(string), ['A', leafs, comboGlyph, 'and', rocket]);
      assert.deepEqual(_.toArray(hashKeycap), [hashKeycap]);
      assert.deepEqual(_.toArray(noMic), [noMic]);

      lodashStable.times(2, function(index) {
        var separator = index ? RegExp(hearts) : hearts,
            options = { 'length': 4, 'separator': separator },
            actual = _.truncate(string, options);

        assert.strictEqual(actual, 'A...');
        assert.strictEqual(actual.length, 4);

        actual = _.truncate(allHearts, options);
        assert.strictEqual(actual, hearts + '...');
        assert.strictEqual(actual.length, 5);
      });
    }
```

#### `_.' + methodName + '` should work with ' + key + ' for `iteratee`

```ts
test('`_.' + methodName + '` should work with ' + key + ' for `iteratee`', function(assert) {
        assert.expect(1);

        var actual = func([['a'], ['a'], ['b']], iteratee);
        assert.deepEqual(actual, [['a'], ['b']]);
      }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var props = [-0, Object(-0), 0, Object(0)],
          expected = lodashStable.map(props, lodashStable.constant([true, false]));

      var actual = lodashStable.map(props, function(key) {
        var object = { '-0': 'a', '0': 'b' };
        return [_.unset(object, key), lodashStable.toString(key) in object];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should unset symbol keyed property values

```ts
test('should unset symbol keyed property values', function(assert) {
      assert.expect(2);

      if (Symbol) {
        var object = {};
        object[symbol] = 1;

        assert.strictEqual(_.unset(object, symbol), true);
        assert.notOk(symbol in object);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### Security: _.unset should not allow deleting static methods from constructors

```ts
test('Security: _.unset should not allow deleting static methods from constructors', function(assert) {
      assert.expect(8);

      assert.strictEqual(typeof Object.keys, 'function', 'Object.keys should exist before unset');

      _.unset({}, ['constructor', 'keys']);
      _.unset({}, 'constructor.keys');
      _.unset({}, [['constructor'], ['keys']]);

      assert.strictEqual(typeof Object.keys, 'function', 'Object.keys should not be deletable via constructor traversal');

      assert.strictEqual(typeof Array.isArray, 'function', 'Array.isArray should exist before unset');

      _.unset([], [ 'constructor', 'isArray']);

      assert.strictEqual(typeof Array.isArray, 'function', 'Array.isArray should not be deletable via constructor traversal');

      assert.strictEqual(typeof String.fromCharCode, 'function', 'String.fromCharCode should exist before unset');

      _.unset('', [ 'constructor', 'fromCharCode']);
      _.unset({ foo: 'bar' }, ['foo', 'constructor', 'fromCharCode']);

      assert.strictEqual(typeof String.fromCharCode, 'function', 'String.fromCharCode should not be deletable via constructor traversal');

      assert.strictEqual(typeof Number.isFinite, 'function', 'Number.isFinite should exist before unset');

      _.unset(0, ['constructor', 'isFinite']);
      _.unset(0, 'constructor.isFinite');

      assert.strictEqual(typeof Number.isFinite, 'function', 'Number.isFinite should not be deletable via primitive constructor traversal');
    }
```

#### `_.' + methodName + '` should get string keyed values of `object`

```ts
test('`_.' + methodName + '` should get string keyed values of `object`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2 },
          actual = func(object).sort();

      assert.deepEqual(actual, [1, 2]);
    }
```

#### `_.' + methodName + '` should ' + (isValues ? 'not ' : '') + 'include inherited string keyed property values

```ts
test('`_.' + methodName + '` should ' + (isValues ? 'not ' : '') + 'include inherited string keyed property values', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var expected = isValues ? [1] : [1, 2],
          actual = func(new Foo).sort();

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should zip together key/value arrays into an object

```ts
test('`_.' + methodName + '` should zip together key/value arrays into an object', function(assert) {
      assert.expect(1);

      var actual = func(['barney', 'fred'], [36, 40]);
      assert.deepEqual(actual, object);
    }
```

#### `_.' + methodName + '` should assign `undefined` values for extra `keys`

```ts
test('`_.' + methodName + '` should assign `undefined` values for extra `keys`', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(['a', 'b'], [1]), { 'a': 1, 'b': undefined });
    }
```

#### `_.' + methodName + '` should work in a lazy sequence

```ts
test('`_.' + methodName + '` should work in a lazy sequence', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var values = lodashStable.range(LARGE_ARRAY_SIZE),
            props = lodashStable.map(values, function(value) { return 'key' + value; }),
            actual = _(props)[methodName](values).map(square).filter(isEven).take().value();

        assert.deepEqual(actual, _.take(_.filter(_.map(func(props, values), square), isEven)));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### zipObjectDeep is not setting ' + keyToTest + ' on global

```ts
test('zipObjectDeep is not setting ' + keyToTest + ' on global', function(assert) {
      assert.expect(1);

      _.zipObjectDeep([keyToTest + '.a'], ['newValue']);
      // Can't access plain `a` as it's not defined and test fails
      assert.notEqual(root.a, 'newValue');
    }
```

#### zipObjectDeep is not overwriting ' + keyToTest + ' on vars

```ts
test('zipObjectDeep is not overwriting ' + keyToTest + ' on vars', function(assert) {
      assert.expect(3);

      const b = 'oldValue';
      _.zipObjectDeep([keyToTest + '.b'], ['newValue']);
      assert.equal(b, 'oldValue');
      assert.notEqual(root.b, 'newValue');

      // ensure nothing was created
      assert.notOk(root.b);
    }
```

#### zipObjectDeep is not overwriting global.' + keyToTest, function(assert) {
      assert.expect(2);

      _.zipObjectDeep([root + '.' + keyToTest + '.c'], ['newValue']);
      assert.notEqual(root.c, 'newValue');

      // ensure nothing was created
      assert.notOk(root.c);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.zipWith');

  (function() {
    QUnit.test('should zip arrays combining grouped elements with `iteratee`

```ts
test('zipObjectDeep is not overwriting global.' + keyToTest, function(assert) {
      assert.expect(2);

      _.zipObjectDeep([root + '.' + keyToTest + '.c'], ['newValue']);
      assert.notEqual(root.c, 'newValue');

      // ensure nothing was created
      assert.notOk(root.c);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.zipWith');

  (function() {
    QUnit.test('should zip arrays combining grouped elements with `iteratee`', function(assert) {
      assert.expect(2);

      var array1 = [1, 2, 3],
          array2 = [4, 5, 6],
          array3 = [7, 8, 9];

      var actual = _.zipWith(array1, array2, array3, function(a, b, c) {
        return a + b + c;
      });

      assert.deepEqual(actual, [12, 15, 18]);

      var actual = _.zipWith(array1, [], function(a, b) {
        return a + (b || 0);
      });

      assert.deepEqual(actual, [1, 2, 3]);
    }
```

#### `_.' + methodName + '` should work with ' + key, function(assert) {
        assert.expect(2);

        var actual = func(pair[0]);
        assert.deepEqual(actual, pair[1]);
        assert.deepEqual(func(actual), actual.length ? pair[0] : []);
      });
    });

    QUnit.test('`_.' + methodName + '` should work with tuples of different lengths

```ts
test('`_.' + methodName + '` should work with ' + key, function(assert) {
        assert.expect(2);

        var actual = func(pair[0]);
        assert.deepEqual(actual, pair[1]);
        assert.deepEqual(func(actual), actual.length ? pair[0] : []);
      });
    });

    QUnit.test('`_.' + methodName + '` should work with tuples of different lengths', function(assert) {
      assert.expect(4);

      var pair = [
        [['barney', 36], ['fred', 40, false]],
        [['barney', 'fred'], [36, 40], [undefined, false]]
      ];

      var actual = func(pair[0]);
      assert.ok('0' in actual[2]);
      assert.deepEqual(actual, pair[1]);

      actual = func(actual);
      assert.ok('2' in actual[0]);
      assert.deepEqual(actual, [['barney', 36, undefined], ['fred', 40, false]]);
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

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

#### invert

```ts
test('invert', function(assert) {
    var obj = {first: 'Moe', second: 'Larry', third: 'Curly'};
    assert.deepEqual(_.keys(_.invert(obj)), ['Moe', 'Larry', 'Curly'], 'can invert an object');
    assert.deepEqual(_.invert(_.invert(obj)), obj, 'two inverts gets you back where you started');

    obj = {length: 3};
    assert.equal(_.invert(obj)['3'], 'length', 'can invert an object with "length"');
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

#### isEmpty

```ts
test('isEmpty', function(assert) {
    assert.notOk(_([1]).isEmpty(), '[1] is not empty');
    assert.ok(_.isEmpty([]), '[] is empty');
    assert.notOk(_.isEmpty({one: 1}), '{one: 1} is not empty');
    assert.ok(_.isEmpty({}), '{} is empty');
    assert.ok(_.isEmpty(new RegExp('')), 'objects with prototype properties are empty');
    assert.ok(_.isEmpty(null), 'null is empty');
    assert.ok(_.isEmpty(), 'undefined is empty');
    assert.ok(_.isEmpty(''), 'the empty string is empty');
    assert.notOk(_.isEmpty('moe'), 'but other strings are not');

    var obj = {one: 1};
    delete obj.one;
    assert.ok(_.isEmpty(obj), 'deleting all the keys from an object empties it');

    var args = function(){ return arguments; };
    assert.ok(_.isEmpty(args()), 'empty arguments object is empty');
    assert.notOk(_.isEmpty(args('')), 'non-empty arguments object is not empty');

    // covers collecting non-enumerable properties in IE < 9
    var nonEnumProp = {toString: 5};
    assert.notOk(_.isEmpty(nonEnumProp), 'non-enumerable property is not empty');
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

### ../../.sbomtest/repos/901466a5bb-lodash/test/test-fp.js

#### should have >= arity of `aryMethod` designation

```ts
test('should have >= arity of `aryMethod` designation', function(assert) {
      assert.expect(4);

      _.times(4, function(index) {
        var aryCap = index + 1;

        var methodNames = _.filter(mapping.aryMethod[aryCap], function(methodName) {
          var key = _.get(mapping.remap, methodName, methodName),
              arity = _[key].length;

          return arity != 0 && arity < aryCap;
        });

        assert.deepEqual(methodNames, [], '`aryMethod[' + aryCap + ']`');
      });
    }
```

#### should have a cap of 2

```ts
test('should have a cap of 2', function(assert) {
      assert.expect(1);

      var funcMethods = [
        'after', 'ary', 'before', 'bind', 'bindKey', 'curryN', 'debounce',
        'delay', 'overArgs', 'partial', 'partialRight', 'rearg', 'throttle',
        'wrap'
      ];

      var exceptions = _.without(funcMethods.concat('matchesProperty'), 'delay'),
          expected = _.map(mapping.aryMethod[2], _.constant(true));

      var actual = _.map(mapping.aryMethod[2], function(methodName) {
        var args = _.includes(funcMethods, methodName) ? [methodName == 'curryN' ? 1 : _.noop, _.noop] : [1, []],
            result = _.attempt(function() { return fp[methodName](args[0])(args[1]); });

        if (_.includes(exceptions, methodName)
              ? typeof result == 'function'
              : typeof result != 'function'
            ) {
          return true;
        }
        console.log(methodName, result);
        return false;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should provide the correct `iteratee` arguments

```ts
test('should provide the correct `iteratee` arguments', function(assert) {
      assert.expect(4);

      var args,
          array = [1, 2, 3],
          object = { 'a': 1, 'b': 2 },
          isFIFO = _.keys(object)[0] == 'a',
          map = convert('map', _.map),
          reduce = convert('reduce', _.reduce);

      map(function() {
        args || (args = slice.call(arguments));
      })(array);

      assert.deepEqual(args, [1]);

      args = undefined;
      map(function() {
        args || (args = slice.call(arguments));
      })(object);

      assert.deepEqual(args, isFIFO ? [1] : [2]);

      args = undefined;
      reduce(function() {
        args || (args = slice.call(arguments));
      })(0)(array);

      assert.deepEqual(args, [0, 1]);

      args = undefined;
      reduce(function() {
        args || (args = slice.call(arguments));
      })(0)(object);

      assert.deepEqual(args, isFIFO ? [0, 1] : [0, 2]);
    }
```

#### should only provide `key` to `iteratee`

```ts
test('should only provide `key` to `iteratee`', function(assert) {
      assert.expect(1);

      var args;

      fp.mapKeys(function() {
        args || (args = slice.call(arguments));
      }, { 'a': 1 });

      assert.deepEqual(args, ['a']);
    }
```

#### should not export to the global when `source` is not an object

```ts
test('should not export to the global when `source` is not an object', function(assert) {
      assert.expect(2);

      var props = _.without(_.keys(_), '_');

      _.times(2, function(index) {
        fp.mixin.apply(fp, index ? [1] : []);

        assert.ok(_.every(props, function(key) {
          return root[key] !== fp[key];
        }));

        _.each(props, function(key) {
          if (root[key] === fp[key]) {
            delete root[key];
          }
        });
      });
    }
```

#### `fp.' + methodName + '` should provide `value` and `key` to `iteratee`

```ts
test('`fp.' + methodName + '` should provide `value` and `key` to `iteratee`', function(assert) {
      assert.expect(1);

      var args;

      func(function() {
        args || (args = slice.call(arguments));
      })({ 'a': 1 });

      assert.deepEqual(args, [1, 'a']);
    }
```

#### `fp.' + methodName + '` should provide the correct `iteratee` arguments when iterating an object

```ts
test('`fp.' + methodName + '` should provide the correct `iteratee` arguments when iterating an object', function(assert) {
      assert.expect(1);

      var args,
          object = { 'a': 1, 'b': 2 },
          isFIFO = _.keys(object)[0] == 'a';

      var expected = isFIFO
        ? (isReduce ? [0, 1] : [2, 0])
        : (isReduce ? [0, 2] : [1, 0]);

      func(function() {
        args || (args = slice.call(arguments));
      })(0)(object);

      assert.deepEqual(args, expected);
    }
```

#### should zip together key/value arrays into an object

```ts
test('should zip together key/value arrays into an object', function(assert) {
      assert.expect(1);

      assert.deepEqual(fp.zipObject(['a', 'b'])([1, 2]), { 'a': 1, 'b': 2 });
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

#### sortedIndex

```ts
test('sortedIndex', function(assert) {
    var numbers = [10, 20, 30, 40, 50];
    var indexFor35 = _.sortedIndex(numbers, 35);
    assert.equal(indexFor35, 3, 'finds the index at which a value should be inserted to retain order');
    var indexFor30 = _.sortedIndex(numbers, 30);
    assert.equal(indexFor30, 2, 'finds the smallest index at which a value could be inserted to retain order');

    var objects = [{x: 10}, {x: 20}, {x: 30}, {x: 40}];
    var iterator = function(obj){ return obj.x; };
    assert.strictEqual(_.sortedIndex(objects, {x: 25}, iterator), 2, 'uses the result of `iterator` for order comparisons');
    assert.strictEqual(_.sortedIndex(objects, {x: 35}, 'x'), 3, 'when `iterator` is a string, uses that key for order comparisons');

    var context = {1: 2, 2: 3, 3: 4};
    iterator = function(obj){ return this[obj]; };
    assert.strictEqual(_.sortedIndex([1, 3], 2, iterator, context), 1, 'can execute its iterator in the given context');

    var values = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 131071, 262143, 524287,
        1048575, 2097151, 4194303, 8388607, 16777215, 33554431, 67108863, 134217727, 268435455, 536870911, 1073741823, 2147483647];
    var largeArray = Array(Math.pow(2, 32) - 1);
    var length = values.length;
    // Sparsely populate `array`
    while (length--) {
      largeArray[values[length]] = values[length];
    }
    assert.equal(_.sortedIndex(largeArray, 2147483648), 2147483648, 'works with large indexes');
  }
```

#### uniq

```ts
test('uniq', function(assert) {
    var list = [1, 2, 1, 3, 1, 4];
    assert.deepEqual(_.uniq(list), [1, 2, 3, 4], 'can find the unique values of an unsorted array');
    list = [1, 1, 1, 2, 2, 3];
    assert.deepEqual(_.uniq(list, true), [1, 2, 3], 'can find the unique values of a sorted array faster');

    list = [{name: 'Moe'}, {name: 'Curly'}, {name: 'Larry'}, {name: 'Curly'}];
    var expected = [{name: 'Moe'}, {name: 'Curly'}, {name: 'Larry'}];
    var iterator = function(stooge) { return stooge.name; };
    assert.deepEqual(_.uniq(list, false, iterator), expected, 'uses the result of `iterator` for uniqueness comparisons (unsorted case)');
    assert.deepEqual(_.uniq(list, iterator), expected, '`sorted` argument defaults to false when omitted');
    assert.deepEqual(_.uniq(list, 'name'), expected, 'when `iterator` is a string, uses that key for comparisons (unsorted case)');

    list = [{score: 8}, {score: 10}, {score: 10}];
    expected = [{score: 8}, {score: 10}];
    iterator = function(item) { return item.score; };
    assert.deepEqual(_.uniq(list, true, iterator), expected, 'uses the result of `iterator` for uniqueness comparisons (sorted case)');
    assert.deepEqual(_.uniq(list, true, 'score'), expected, 'when `iterator` is a string, uses that key for comparisons (sorted case)');

    assert.deepEqual(_.uniq([{0: 1}, {0: 1}, {0: 1}, {0: 2}], 0), [{0: 1}, {0: 2}], 'can use falsey pluck like iterator');

    var result = (function(){ return _.uniq(arguments); }(1, 2, 1, 3, 1, 4));
    assert.deepEqual(result, [1, 2, 3, 4], 'works on an arguments object');

    var a = {}, b = {}, c = {};
    assert.deepEqual(_.uniq([a, b, a, b, c]), [a, b, c], 'works on values that can be tested for equivalency but not ordered');

    assert.deepEqual(_.uniq(null), [], 'returns an empty array when `array` is not iterable');

    var context = {};
    list = [3];
    _.uniq(list, function(value, index, array) {
      assert.strictEqual(this, context, 'executes its iterator in the given context');
      assert.strictEqual(value, 3, 'passes its iterator the value');
      assert.strictEqual(index, 0, 'passes its iterator the index');
      assert.strictEqual(array, list, 'passes its iterator the entire array');
    }, context);

  }
```

#### findIndex

```ts
test('findIndex', function(assert) {
    var objects = [
      {a: 0, b: 0},
      {a: 1, b: 1},
      {a: 2, b: 2},
      {a: 0, b: 0}
    ];

    assert.equal(_.findIndex(objects, function(obj) {
      return obj.a === 0;
    }), 0);

    assert.equal(_.findIndex(objects, function(obj) {
      return obj.b * obj.a === 4;
    }), 2);

    assert.equal(_.findIndex(objects, 'a'), 1, 'Uses lookupIterator');

    assert.equal(_.findIndex(objects, function(obj) {
      return obj.b * obj.a === 5;
    }), -1);

    assert.equal(_.findIndex(null, _.noop), -1);
    assert.strictEqual(_.findIndex(objects, function(a) {
      return a.foo === null;
    }), -1);
    _.findIndex([{a: 1}], function(a, key, obj) {
      assert.equal(key, 0);
      assert.deepEqual(obj, [{a: 1}]);
      assert.strictEqual(this, objects, 'called with context');
    }, objects);

    var sparse = [];
    sparse[20] = {a: 2, b: 2};
    assert.equal(_.findIndex(sparse, function(obj) {
      return obj && obj.b * obj.a === 4;
    }), 20, 'Works with sparse arrays');

    var array = [1, 2, 3, 4];
    array.match = 55;
    assert.strictEqual(_.findIndex(array, function(x) { return x === 55; }), -1, 'doesn\'t match array-likes keys');
  }
```

#### findLastIndex

```ts
test('findLastIndex', function(assert) {
    var objects = [
      {a: 0, b: 0},
      {a: 1, b: 1},
      {a: 2, b: 2},
      {a: 0, b: 0}
    ];

    assert.equal(_.findLastIndex(objects, function(obj) {
      return obj.a === 0;
    }), 3);

    assert.equal(_.findLastIndex(objects, function(obj) {
      return obj.b * obj.a === 4;
    }), 2);

    assert.equal(_.findLastIndex(objects, 'a'), 2, 'Uses lookupIterator');

    assert.equal(_.findLastIndex(objects, function(obj) {
      return obj.b * obj.a === 5;
    }), -1);

    assert.equal(_.findLastIndex(null, _.noop), -1);
    assert.strictEqual(_.findLastIndex(objects, function(a) {
      return a.foo === null;
    }), -1);
    _.findLastIndex([{a: 1}], function(a, key, obj) {
      assert.equal(key, 0);
      assert.deepEqual(obj, [{a: 1}]);
      assert.strictEqual(this, objects, 'called with context');
    }, objects);

    var sparse = [];
    sparse[20] = {a: 2, b: 2};
    assert.equal(_.findLastIndex(sparse, function(obj) {
      return obj && obj.b * obj.a === 4;
    }), 20, 'Works with sparse arrays');

    var array = [1, 2, 3, 4];
    array.match = 55;
    assert.strictEqual(_.findLastIndex(array, function(x) { return x === 55; }), -1, 'doesn\'t match array-likes keys');
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

#### Iterating objects with sketchy length properties

```ts
test('Iterating objects with sketchy length properties', function(assert) {
    var functions = [
      'each', 'map', 'filter', 'find',
      'some', 'every', 'max', 'min',
      'groupBy', 'countBy', 'partition', 'indexBy'
    ];
    var reducers = ['reduce', 'reduceRight'];

    var tricks = [
      {length: '5'},
      {length: {valueOf: _.constant(5)}},
      {length: Math.pow(2, 53) + 1},
      {length: Math.pow(2, 53)},
      {length: null},
      {length: -2},
      {length: new Number(15)}
    ];

    assert.expect(tricks.length * (functions.length + reducers.length + 4));

    _.each(tricks, function(trick) {
      var length = trick.length;
      assert.strictEqual(_.size(trick), 1, 'size on obj with length: ' + length);
      assert.deepEqual(_.toArray(trick), [length], 'toArray on obj with length: ' + length);
      assert.deepEqual(_.shuffle(trick), [length], 'shuffle on obj with length: ' + length);
      assert.deepEqual(_.sample(trick), length, 'sample on obj with length: ' + length);


      _.each(functions, function(method) {
        _[method](trick, function(val, key) {
          assert.strictEqual(key, 'length', method + ': ran with length = ' + val);
        });
      });

      _.each(reducers, function(method) {
        assert.strictEqual(_[method](trick), trick.length, method);
      });
    });
  }
```

#### Resistant to collection length and properties changing while iterating

```ts
test('Resistant to collection length and properties changing while iterating', function(assert) {

    var collection = [
      'each', 'map', 'filter', 'find',
      'some', 'every', 'max', 'min', 'reject',
      'groupBy', 'countBy', 'partition', 'indexBy',
      'reduce', 'reduceRight'
    ];
    var array = [
      'findIndex', 'findLastIndex'
    ];
    var object = [
      'mapObject', 'findKey', 'pick', 'omit'
    ];

    _.each(collection.concat(array), function(method) {
      var sparseArray = [1, 2, 3];
      sparseArray.length = 100;
      var answers = 0;
      _[method](sparseArray, function(){
        ++answers;
        return method === 'every' ? true : null;
      }, {});
      assert.equal(answers, 100, method + ' enumerates [0, length)');

      var growingCollection = [1, 2, 3], count = 0;
      _[method](growingCollection, function() {
        if (count < 10) growingCollection.push(count++);
        return method === 'every' ? true : null;
      }, {});
      assert.equal(count, 3, method + ' is resistant to length changes');
    });

    _.each(collection.concat(object), function(method) {
      var changingObject = {0: 0, 1: 1}, count = 0;
      _[method](changingObject, function(val) {
        if (count < 10) changingObject[++count] = val + 1;
        return method === 'every' ? true : null;
      }, {});

      assert.equal(count, 2, method + ' is resistant to property changes');
    });
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

#### partition

```ts
test('partition', function(assert) {
    var list = [0, 1, 2, 3, 4, 5];
    assert.deepEqual(_.partition(list, function(x) { return x < 4; }), [[0, 1, 2, 3], [4, 5]], 'handles bool return values');
    assert.deepEqual(_.partition(list, function(x) { return x & 1; }), [[1, 3, 5], [0, 2, 4]], 'handles 0 and 1 return values');
    assert.deepEqual(_.partition(list, function(x) { return x - 3; }), [[0, 1, 2, 4, 5], [3]], 'handles other numeric return values');
    assert.deepEqual(_.partition(list, function(x) { return x > 1 ? null : true; }), [[0, 1], [2, 3, 4, 5]], 'handles null return values');
    assert.deepEqual(_.partition(list, function(x) { if (x < 2) return true; }), [[0, 1], [2, 3, 4, 5]], 'handles undefined return values');
    assert.deepEqual(_.partition({a: 1, b: 2, c: 3}, function(x) { return x > 1; }), [[2, 3], [1]], 'handles objects');

    assert.deepEqual(_.partition(list, function(x, index) { return index % 2; }), [[1, 3, 5], [0, 2, 4]], 'can reference the array index');
    assert.deepEqual(_.partition(list, function(x, index, arr) { return x === arr.length - 1; }), [[5], [0, 1, 2, 3, 4]], 'can reference the collection');

    // Default iterator
    assert.deepEqual(_.partition([1, false, true, '']), [[1, true], [false, '']], 'Default iterator');
    assert.deepEqual(_.partition([{x: 1}, {x: 0}, {x: 1}], 'x'), [[{x: 1}, {x: 1}], [{x: 0}]], 'Takes a string');

    // Context
    var predicate = function(x){ return x === this.x; };
    assert.deepEqual(_.partition([1, 2, 3], predicate, {x: 2}), [[2], [1, 3]], 'partition takes a context argument');

    assert.deepEqual(_.partition([{a: 1}, {b: 2}, {a: 1, b: 2}], {a: 1}), [[{a: 1}, {a: 1, b: 2}], [{b: 2}]], 'predicate can be object');

    var object = {a: 1};
    _.partition(object, function(val, key, obj) {
      assert.equal(val, 1);
      assert.equal(key, 'a');
      assert.equal(obj, object);
      assert.equal(this, predicate);
    }, predicate);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/utility.js

#### template

```ts
test('template', function(assert) {
    var basicTemplate = _.template("<%= thing %> is gettin' on my noives!");
    var result = basicTemplate({thing: 'This'});
    assert.equal(result, "This is gettin' on my noives!", 'can do basic attribute interpolation');

    var sansSemicolonTemplate = _.template('A <% this %> B');
    assert.equal(sansSemicolonTemplate(), 'A  B');

    var backslashTemplate = _.template('<%= thing %> is \\ridanculous');
    assert.equal(backslashTemplate({thing: 'This'}), 'This is \\ridanculous');

    var escapeTemplate = _.template('<%= a ? "checked=\\"checked\\"" : "" %>');
    assert.equal(escapeTemplate({a: true}), 'checked="checked"', 'can handle slash escapes in interpolations.');

    var fancyTemplate = _.template('<ul><% ' +
    '  for (var key in people) { ' +
    '%><li><%= people[key] %></li><% } %></ul>');
    result = fancyTemplate({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var escapedCharsInJavascriptTemplate = _.template('<ul><% _.each(numbers.split("\\n"), function(item) { %><li><%= item %></li><% }) %></ul>');
    result = escapedCharsInJavascriptTemplate({numbers: 'one\ntwo\nthree\nfour'});
    assert.equal(result, '<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>', 'Can use escaped characters (e.g. \\n) in JavaScript');

    var namespaceCollisionTemplate = _.template('<%= pageCount %> <%= thumbnails[pageCount] %> <% _.each(thumbnails, function(p) { %><div class="thumbnail" rel="<%= p %>"></div><% }); %>');
    result = namespaceCollisionTemplate({
      pageCount: 3,
      thumbnails: {
        1: 'p1-thumbnail.gif',
        2: 'p2-thumbnail.gif',
        3: 'p3-thumbnail.gif'
      }
    });
    assert.equal(result, '3 p3-thumbnail.gif <div class="thumbnail" rel="p1-thumbnail.gif"></div><div class="thumbnail" rel="p2-thumbnail.gif"></div><div class="thumbnail" rel="p3-thumbnail.gif"></div>');

    var noInterpolateTemplate = _.template('<div><p>Just some text. Hey, I know this is silly but it aids consistency.</p></div>');
    result = noInterpolateTemplate();
    assert.equal(result, '<div><p>Just some text. Hey, I know this is silly but it aids consistency.</p></div>');

    var quoteTemplate = _.template("It's its, not it's");
    assert.equal(quoteTemplate({}), "It's its, not it's");

    var quoteInStatementAndBody = _.template('<% ' +
    "  if(foo == 'bar'){ " +
    "%>Statement quotes and 'quotes'.<% } %>");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    var withNewlinesAndTabs = _.template('This\n\t\tis: <%= x %>.\n\tok.\nend.');
    assert.equal(withNewlinesAndTabs({x: 'that'}), 'This\n\t\tis: that.\n\tok.\nend.');

    var template = _.template('<i><%- value %></i>');
    result = template({value: '<script>'});
    assert.equal(result, '<i>&lt;script&gt;</i>');

    var stooge = {
      name: 'Moe',
      template: _.template("I'm <%= this.name %>")
    };
    assert.equal(stooge.template(), "I'm Moe");

    template = _.template('\n ' +
    '  <%\n ' +
    '  // a comment\n ' +
    '  if (data) { data += 12345; }; %>\n ' +
    '  <li><%= data %></li>\n '
    );
    assert.equal(template({data: 12345}).replace(/\s/g, ''), '<li>24690</li>');

    _.templateSettings = {
      evaluate: /\{\{([\s\S]+?)\}\}/g,
      interpolate: /\{\{=([\s\S]+?)\}\}/g
    };

    var custom = _.template('<ul>{{ for (var key in people) { }}<li>{{= people[key] }}</li>{{ } }}</ul>');
    result = custom({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var customQuote = _.template("It's its, not it's");
    assert.equal(customQuote({}), "It's its, not it's");

    quoteInStatementAndBody = _.template("{{ if(foo == 'bar'){ }}Statement quotes and 'quotes'.{{ } }}");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    _.templateSettings = {
      evaluate: /<\?([\s\S]+?)\?>/g,
      interpolate: /<\?=([\s\S]+?)\?>/g
    };

    var customWithSpecialChars = _.template('<ul><? for (var key in people) { ?><li><?= people[key] ?></li><? } ?></ul>');
    result = customWithSpecialChars({people: {moe: 'Moe', larry: 'Larry', curly: 'Curly'}});
    assert.equal(result, '<ul><li>Moe</li><li>Larry</li><li>Curly</li></ul>', 'can run arbitrary javascript in templates');

    var customWithSpecialCharsQuote = _.template("It's its, not it's");
    assert.equal(customWithSpecialCharsQuote({}), "It's its, not it's");

    quoteInStatementAndBody = _.template("<? if(foo == 'bar'){ ?>Statement quotes and 'quotes'.<? } ?>");
    assert.equal(quoteInStatementAndBody({foo: 'bar'}), "Statement quotes and 'quotes'.");

    _.templateSettings = {
      interpolate: /\{\{(.+?)\}\}/g
    };

    var mustache = _.template('Hello {{planet}}!');
    assert.equal(mustache({planet: 'World'}), 'Hello World!', 'can mimic mustache.js');

    var templateWithNull = _.template('a null undefined {{planet}}');
    assert.equal(templateWithNull({planet: 'world'}), 'a null undefined world', 'can handle missing escape and evaluate settings');
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.jsonp.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/express.urlencoded.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### underscore methods

```ts
test('underscore methods', function(assert) {
    assert.expect(5);
    var model = new Backbone.Model({foo: 'a', bar: 'b', baz: 'c'});
    var model2 = model.clone();
    assert.deepEqual(model.keys(), ['foo', 'bar', 'baz']);
    assert.deepEqual(model.values(), ['a', 'b', 'c']);
    assert.deepEqual(model.invert(), {a: 'foo', b: 'bar', c: 'baz'});
    assert.deepEqual(model.pick('foo', 'baz'), {foo: 'a', baz: 'c'});
    assert.deepEqual(model.omit('foo', 'bar'), {baz: 'c'});
  }
```

#### `hasChanged` for falsey keys

```ts
test('`hasChanged` for falsey keys', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model();
    model.set({x: true}, {silent: true});
    assert.ok(!model.hasChanged(0));
    assert.ok(!model.hasChanged(''));
  }
```

#### `previous` for falsey keys

```ts
test('`previous` for falsey keys', function(assert) {
    assert.expect(2);
    var model = new Backbone.Model({'0': true, '': true});
    model.set({'0': false, '': false}, {silent: true});
    assert.equal(model.previous(0), true);
    assert.equal(model.previous(''), true);
  }
```

#### #1943 change calculations should use _.isEqual

```ts
test('#1943 change calculations should use _.isEqual', function(assert) {
    var model = new Backbone.Model({a: {key: 'value'}});
    model.set('a', {key: 'value'}, {silent: true});
    assert.equal(model.changedAttributes(), false);
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

