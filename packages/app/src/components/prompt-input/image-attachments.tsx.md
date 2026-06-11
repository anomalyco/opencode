# External tests for image-attachments.tsx

**Arquivo:** `packages/app/src/components/prompt-input/image-attachments.tsx`

## Checklist

- [ ] solid-js
- [ ] @opencode-ai/ui/icon
- [ ] @opencode-ai/ui/tooltip
- [ ] @/context/prompt

## solid-js

**Consultas usadas no Horsebox:** `Component`, `solid-js Component`, `For`, `solid-js For`, `Show`, `solid-js Show`

**Arquivos de teste encontrados:** 18

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.status.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/utils.js

#### should handle a type with a malformed parameter and break the loop in acceptParams

```ts
it('should handle a type with a malformed parameter and break the loop in acceptParams', () => {
    const result = utils.normalizeType('text/plain;invalid');
    assert.deepEqual(result,{
      value: 'text/plain',
      quality: 1,
      params: {} // No parameters are added since "invalid" has no "="
    });
  }
```

#### should return generateETag for true

```ts
it('should return generateETag for true', function () {
    const fn = utils.compileETag(true);
    assert.strictEqual(fn('express!'), utils.wetag('express!'));
  }
```

#### should return undefined for false

```ts
it('should return undefined for false', function () {
    assert.strictEqual(utils.compileETag(false), undefined);
  }
```

#### should return generateETag for string values "strong" and "weak"

```ts
it('should return generateETag for string values "strong" and "weak"', function () {
    assert.strictEqual(utils.compileETag('strong')("express"), utils.etag("express"));
    assert.strictEqual(utils.compileETag('weak')("express"), utils.wetag("express"));
  }
```

#### should throw for unknown string values

```ts
it('should throw for unknown string values', function () {
    assert.throws(() => utils.compileETag('foo'), TypeError);
  }
```

#### should throw for unsupported types like arrays and objects

```ts
it('should throw for unsupported types like arrays and objects', function () {
    assert.throws(() => utils.compileETag([]), TypeError);
    assert.throws(() => utils.compileETag({}), TypeError);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

#### first

```ts
test('first', function(assert) {
    assert.equal(_.first([1, 2, 3]), 1, 'can pull out the first element of an array');
    assert.equal(_([1, 2, 3]).first(), 1, 'can perform OO-style "first()"');
    assert.deepEqual(_.first([1, 2, 3], 0), [], 'returns an empty array when n <= 0 (0 case)');
    assert.deepEqual(_.first([1, 2, 3], -1), [], 'returns an empty array when n <= 0 (negative case)');
    assert.deepEqual(_.first([1, 2, 3], 2), [1, 2], 'can fetch the first n elements');
    assert.deepEqual(_.first([1, 2, 3], 5), [1, 2, 3], 'returns the whole array if n > length');
    var result = (function(){ return _.first(arguments); }(4, 3, 2, 1));
    assert.equal(result, 4, 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.first);
    assert.deepEqual(result, [1, 1], 'works well with _.map');
    assert.equal(_.first(null), void 0, 'returns undefined when called on null');

    Array.prototype[0] = 'boo';
    assert.equal(_.first([]), void 0, 'return undefined when called on a empty array');
    delete Array.prototype[0];
  }
```

#### head

```ts
test('head', function(assert) {
    assert.strictEqual(_.head, _.first, 'is an alias for first');
  }
```

#### take

```ts
test('take', function(assert) {
    assert.strictEqual(_.take, _.first, 'is an alias for first');
  }
```

#### tail

```ts
test('tail', function(assert) {
    assert.strictEqual(_.tail, _.rest, 'is an alias for rest');
  }
```

#### drop

```ts
test('drop', function(assert) {
    assert.strictEqual(_.drop, _.rest, 'is an alias for rest');
  }
```

#### last

```ts
test('last', function(assert) {
    assert.equal(_.last([1, 2, 3]), 3, 'can pull out the last element of an array');
    assert.equal(_([1, 2, 3]).last(), 3, 'can perform OO-style "last()"');
    assert.deepEqual(_.last([1, 2, 3], 0), [], 'returns an empty array when n <= 0 (0 case)');
    assert.deepEqual(_.last([1, 2, 3], -1), [], 'returns an empty array when n <= 0 (negative case)');
    assert.deepEqual(_.last([1, 2, 3], 2), [2, 3], 'can fetch the last n elements');
    assert.deepEqual(_.last([1, 2, 3], 5), [1, 2, 3], 'returns the whole array if n > length');
    var result = (function(){ return _(arguments).last(); }(1, 2, 3, 4));
    assert.equal(result, 4, 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.last);
    assert.deepEqual(result, [3, 3], 'works well with _.map');
    assert.equal(_.last(null), void 0, 'returns undefined when called on null');

    var arr = [];
    arr[-1] = 'boo';
    assert.equal(_.last(arr), void 0, 'return undefined when called on a empty array');
  }
```

#### flatten

```ts
test('flatten', function(assert) {
    assert.deepEqual(_.flatten(null), [], 'supports null');
    assert.deepEqual(_.flatten(void 0), [], 'supports undefined');

    assert.deepEqual(_.flatten([[], [[]], []]), [], 'supports empty arrays');
    assert.deepEqual(_.flatten([[], [[]], []], true), [[]], 'can shallowly flatten empty arrays');

    var list = [1, [2], [3, [[[4]]]]];
    assert.deepEqual(_.flatten(list), [1, 2, 3, 4], 'can flatten nested arrays');
    assert.deepEqual(_.flatten(list, true), [1, 2, 3, [[[4]]]], 'can shallowly flatten nested arrays');
    var result = (function(){ return _.flatten(arguments); }(1, [2], [3, [[[4]]]]));
    assert.deepEqual(result, [1, 2, 3, 4], 'works on an arguments object');
    list = [[1], [2], [3], [[4]]];
    assert.deepEqual(_.flatten(list, true), [1, 2, 3, [4]], 'can shallowly flatten arrays containing only other arrays');

    assert.equal(_.flatten([_.range(10), _.range(10), 5, 1, 3], true).length, 23, 'can flatten medium length arrays');
    assert.equal(_.flatten([_.range(10), _.range(10), 5, 1, 3]).length, 23, 'can shallowly flatten medium length arrays');
    assert.equal(_.flatten([new Array(1000000), _.range(56000), 5, 1, 3]).length, 1056003, 'can handle massive arrays');
    assert.equal(_.flatten([new Array(1000000), _.range(56000), 5, 1, 3], true).length, 1056003, 'can handle massive arrays in shallow mode');

    var x = _.range(100000);
    for (var i = 0; i < 1000; i++) x = [x];
    assert.deepEqual(_.flatten(x), _.range(100000), 'can handle very deep arrays');
    assert.deepEqual(_.flatten(x, true), x[0], 'can handle very deep arrays in shallow mode');
  }
```

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

#### unique

```ts
test('unique', function(assert) {
    assert.strictEqual(_.unique, _.uniq, 'is an alias for uniq');
  }
```

#### intersection

```ts
test('intersection', function(assert) {
    var stooges = ['moe', 'curly', 'larry'], leaders = ['moe', 'groucho'];
    assert.deepEqual(_.intersection(stooges, leaders), ['moe'], 'can find the set intersection of two arrays');
    assert.deepEqual(_(stooges).intersection(leaders), ['moe'], 'can perform an OO-style intersection');
    var result = (function(){ return _.intersection(arguments, leaders); }('moe', 'curly', 'larry'));
    assert.deepEqual(result, ['moe'], 'works on an arguments object');
    var theSixStooges = ['moe', 'moe', 'curly', 'curly', 'larry', 'larry'];
    assert.deepEqual(_.intersection(theSixStooges, leaders), ['moe'], 'returns a duplicate-free array');
    result = _.intersection([2, 4, 3, 1], [1, 2, 3]);
    assert.deepEqual(result, [2, 3, 1], 'preserves the order of the first array');
    result = _.intersection(null, [1, 2, 3]);
    assert.deepEqual(result, [], 'returns an empty array when passed null as the first argument');
    result = _.intersection([1, 2, 3], null);
    assert.deepEqual(result, [], 'returns an empty array when passed null as an argument beyond the first');
  }
```

#### union

```ts
test('union', function(assert) {
    var result = _.union([1, 2, 3], [2, 30, 1], [1, 40]);
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'can find the union of a list of arrays');

    result = _([1, 2, 3]).union([2, 30, 1], [1, 40]);
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'can perform an OO-style union');

    result = _.union([1, 2, 3], [2, 30, 1], [1, 40, [1]]);
    assert.deepEqual(result, [1, 2, 3, 30, 40, [1]], 'can find the union of a list of nested arrays');

    result = _.union([10, 20], [1, 30, 10], [0, 40]);
    assert.deepEqual(result, [10, 20, 1, 30, 0, 40], 'orders values by their first encounter');

    result = (function(){ return _.union(arguments, [2, 30, 1], [1, 40]); }(1, 2, 3));
    assert.deepEqual(result, [1, 2, 3, 30, 40], 'works on an arguments object');

    assert.deepEqual(_.union([1, 2, 3], 4), [1, 2, 3], 'restricts the union to arrays only');
  }
```

#### difference

```ts
test('difference', function(assert) {
    var result = _.difference([1, 2, 3], [2, 30, 40]);
    assert.deepEqual(result, [1, 3], 'can find the difference of two arrays');

    result = _([1, 2, 3]).difference([2, 30, 40]);
    assert.deepEqual(result, [1, 3], 'can perform an OO-style difference');

    result = _.difference([1, 2, 3, 4], [2, 30, 40], [1, 11, 111]);
    assert.deepEqual(result, [3, 4], 'can find the difference of three arrays');

    result = _.difference([8, 9, 3, 1], [3, 8]);
    assert.deepEqual(result, [9, 1], 'preserves the order of the first array');

    result = (function(){ return _.difference(arguments, [2, 30, 40]); }(1, 2, 3));
    assert.deepEqual(result, [1, 3], 'works on an arguments object');

    result = _.difference([1, 2, 3], 1);
    assert.deepEqual(result, [1, 2, 3], 'restrict the difference to arrays only');
  }
```

#### lastIndexOf

```ts
test('lastIndexOf', function(assert) {
    var numbers = [1, 0, 1];
    var falsey = [void 0, '', 0, false, NaN, null, void 0];
    assert.equal(_.lastIndexOf(numbers, 1), 2);

    numbers = [1, 0, 1, 0, 0, 1, 0, 0, 0];
    numbers.lastIndexOf = null;
    assert.equal(_.lastIndexOf(numbers, 1), 5, 'can compute lastIndexOf, even without the native function');
    assert.equal(_.lastIndexOf(numbers, 0), 8, 'lastIndexOf the other element');
    var result = (function(){ return _.lastIndexOf(arguments, 1); }(1, 0, 1, 0, 0, 1, 0, 0, 0));
    assert.equal(result, 5, 'works on an arguments object');

    _.each([null, void 0, [], false], function(val) {
      var msg = 'Handles: ' + (_.isArray(val) ? '[]' : val);
      assert.equal(_.lastIndexOf(val, 2), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, -1), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, -20), -1, msg);
      assert.equal(_.lastIndexOf(val, 2, 15), -1, msg);
    });

    numbers = [1, 2, 3, 1, 2, 3, 1, 2, 3];
    var index = _.lastIndexOf(numbers, 2, 2);
    assert.equal(index, 1, 'supports the fromIndex argument');

    var array = [1, 2, 3, 1, 2, 3];

    assert.strictEqual(_.lastIndexOf(array, 1, 0), 0, 'starts at the correct from idx');
    assert.strictEqual(_.lastIndexOf(array, 3), 5, 'should return the index of the last matched value');
    assert.strictEqual(_.lastIndexOf(array, 4), -1, 'should return `-1` for an unmatched value');

    assert.strictEqual(_.lastIndexOf(array, 1, 2), 0, 'should work with a positive `fromIndex`');

    _.each([6, 8, Math.pow(2, 32), Infinity], function(fromIndex) {
      assert.strictEqual(_.lastIndexOf(array, void 0, fromIndex), -1);
      assert.strictEqual(_.lastIndexOf(array, 1, fromIndex), 3);
      assert.strictEqual(_.lastIndexOf(array, '', fromIndex), -1);
    });

    var expected = _.map(falsey, function(value) {
      return typeof value == 'number' ? -1 : 5;
    });

    var actual = _.map(falsey, function(fromIndex) {
      return _.lastIndexOf(array, 3, fromIndex);
    });

    assert.deepEqual(actual, expected, 'should treat falsey `fromIndex` values, except `0` and `NaN`, as `array.length`');
    assert.strictEqual(_.lastIndexOf(array, 3, '1'), 5, 'should treat non-number `fromIndex` values as `array.length`');
    assert.strictEqual(_.lastIndexOf(array, 3, true), 5, 'should treat non-number `fromIndex` values as `array.length`');

    assert.strictEqual(_.lastIndexOf(array, 2, -3), 1, 'should work with a negative `fromIndex`');
    assert.strictEqual(_.lastIndexOf(array, 1, -3), 3, 'neg `fromIndex` starts at the right index');

    assert.deepEqual(_.map([-6, -8, -Infinity], function(fromIndex) {
      return _.lastIndexOf(array, 1, fromIndex);
    }), [0, -1, -1]);
  }
```

#### chunk

```ts
test('chunk', function(assert) {
    assert.deepEqual(_.chunk([], 2), [], 'chunk for empty array returns an empty array');

    assert.deepEqual(_.chunk([1, 2, 3], 0), [], 'chunk into parts of 0 elements returns empty array');
    assert.deepEqual(_.chunk([1, 2, 3], -1), [], 'chunk into parts of negative amount of elements returns an empty array');
    assert.deepEqual(_.chunk([1, 2, 3]), [], 'defaults to empty array (chunk size 0)');

    assert.deepEqual(_.chunk([1, 2, 3], 1), [[1], [2], [3]], 'chunk into parts of 1 elements returns original array');

    assert.deepEqual(_.chunk([1, 2, 3], 3), [[1, 2, 3]], 'chunk into parts of current array length elements returns the original array');
    assert.deepEqual(_.chunk([1, 2, 3], 5), [[1, 2, 3]], 'chunk into parts of more then current array length elements returns the original array');

    assert.deepEqual(_.chunk([10, 20, 30, 40, 50, 60, 70], 2), [[10, 20], [30, 40], [50, 60], [70]], 'chunk into parts of less then current array length elements');
    assert.deepEqual(_.chunk([10, 20, 30, 40, 50, 60, 70], 3), [[10, 20, 30], [40, 50, 60], [70]], 'chunk into parts of less then current array length elements');
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/config.js

#### should return undefined for prototype values

```ts
it('should return undefined for prototype values', function () {
      var app = express()
      assert.strictEqual(app.set('hasOwnProperty'), undefined)
    }
```

#### should default to false for prototype values

```ts
it('should default to false for prototype values', function () {
      var app = express()
      assert.strictEqual(app.enabled('hasOwnProperty'), false)
    }
```

#### should default to true for prototype values

```ts
it('should default to true for prototype values', function () {
      var app = express()
      assert.strictEqual(app.disabled('hasOwnProperty'), true)
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

#### should get the original value after cycling through all case methods

```ts
test('should get the original value after cycling through all case methods', function(assert) {
      assert.expect(1);

      var funcs = [_.camelCase, _.kebabCase, _.lowerCase, _.snakeCase, _.startCase, _.lowerCase, _.camelCase];

      var actual = lodashStable.reduce(funcs, function(result, func) {
        return func(result);
      }, 'enable 6h format');

      assert.strictEqual(actual, 'enable6HFormat');
    }
```

#### should work with numbers

```ts
test('should work with numbers', function(assert) {
      assert.expect(6);

      assert.strictEqual(_.camelCase('12 feet'), '12Feet');
      assert.strictEqual(_.camelCase('enable 6h format'), 'enable6HFormat');
      assert.strictEqual(_.camelCase('enable 24H format'), 'enable24HFormat');
      assert.strictEqual(_.camelCase('too legit 2 quit'), 'tooLegit2Quit');
      assert.strictEqual(_.camelCase('walk 500 miles'), 'walk500Miles');
      assert.strictEqual(_.camelCase('xhr2 request'), 'xhr2Request');
    }
```

#### should enable chaining for methods that return unwrapped values

```ts
test('should enable chaining for methods that return unwrapped values', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var array = ['c', 'b', 'a'];

        assert.ok(_.chain(array).head() instanceof _);
        assert.ok(_(array).chain().head() instanceof _);

        assert.ok(_.chain(array).isArray() instanceof _);
        assert.ok(_(array).chain().isArray() instanceof _);

        assert.ok(_.chain(array).sortBy().head() instanceof _);
        assert.ok(_(array).chain().sortBy().head() instanceof _);
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([[1, 2], [3, 4]], _.chunk);
      assert.deepEqual(actual, [[[1], [2]], [[3], [4]]]);
    }
```

#### `_.clone` should perform a shallow clone

```ts
test('`_.clone` should perform a shallow clone', function(assert) {
      assert.expect(2);

      var array = [{ 'a': 0 }, { 'b': 1 }],
          actual = _.clone(array);

      assert.deepEqual(actual, array);
      assert.ok(actual !== array && actual[0] === array[0]);
    }
```

#### `_.' + methodName + '` should ensure `value` constructor is a function before using its `[[Prototype]]`

```ts
test('`_.' + methodName + '` should ensure `value` constructor is a function before using its `[[Prototype]]`', function(assert) {
        assert.expect(1);

        Foo.prototype.constructor = null;
        assert.notOk(func(new Foo) instanceof Foo);
        Foo.prototype.constructor = Foo;
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

#### `_.' + methodName + '` should perform a ' + (isDeep ? 'deep' : 'shallow') + ' clone when used as an iteratee for methods like `_.map`

```ts
test('`_.' + methodName + '` should perform a ' + (isDeep ? 'deep' : 'shallow') + ' clone when used as an iteratee for methods like `_.map`', function(assert) {
        assert.expect(2);

        var expected = [{ 'a': [0] }, { 'b': [1] }],
            actual = lodashStable.map(expected, func);

        assert.deepEqual(actual, expected);

        if (isDeep) {
          assert.ok(actual[0] !== expected[0] && actual[0].a !== expected[0].a && actual[1].b !== expected[1].b);
        } else {
          assert.ok(actual[0] !== expected[0] && actual[0].a === expected[0].a && actual[1].b === expected[1].b);
        }
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

#### should use `this` binding of function for `pairs`

```ts
test('should use `this` binding of function for `pairs`', function(assert) {
      assert.expect(1);

      var cond = _.cond([
        [function(a) { return this[a]; }, function(a, b) { return this[b]; }]
      ]);

      var object = { 'cond': cond, 'a': 1, 'b': 2 };
      assert.strictEqual(object.cond('a', 'b'), 2);
    }
```

#### should not change behavior if `source` is modified

```ts
test('should not change behavior if `source` is modified', function(assert) {
      assert.expect(2);

      var object = { 'a': 2 },
          source = { 'a': function(value) { return value > 1; } },
          par = _.conforms(source);

      assert.strictEqual(par(object), true);

      source.a = function(value) { return value < 2; };
      assert.strictEqual(par(object), true);
    }
```

#### `_.' + methodName + '` should check if `object` conforms to `source`

```ts
test('`_.' + methodName + '` should check if `object` conforms to `source`', function(assert) {
      assert.expect(2);

      var objects = [
        { 'a': 1, 'b': 8 },
        { 'a': 2, 'b': 4 },
        { 'a': 3, 'b': 16 }
      ];

      var par = conforms({
        'b': function(value) { return value > 4; }
      });

      var actual = lodashStable.filter(objects, par);
      assert.deepEqual(actual, [objects[0], objects[2]]);

      par = conforms({
        'b': function(value) { return value > 8; },
        'a': function(value) { return value > 1; }
      });

      actual = lodashStable.filter(objects, par);
      assert.deepEqual(actual, [objects[2]]);
    }
```

#### `_.' + methodName + '` should not match by inherited `source` properties

```ts
test('`_.' + methodName + '` should not match by inherited `source` properties', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = function(value) {
          return value > 1;
        };
      }
      Foo.prototype.b = function(value) {
        return value > 8;
      };

      var objects = [
        { 'a': 1, 'b': 8 },
        { 'a': 2, 'b': 4 },
        { 'a': 3, 'b': 16 }
      ];

      var par = conforms(new Foo),
          actual = lodashStable.filter(objects, par);

      assert.deepEqual(actual, [objects[1], objects[2]]);
    }
```

#### `_.' + methodName + '` should not invoke `source` predicates for missing `object` properties

```ts
test('`_.' + methodName + '` should not invoke `source` predicates for missing `object` properties', function(assert) {
      assert.expect(2);

      var count = 0;

      var par = conforms({
        'a': function() { count++; return true; }
      });

      assert.strictEqual(par({}), false);
      assert.strictEqual(count, 0);
    }
```

#### `_.' + methodName + '` should work with a function for `object`

```ts
test('`_.' + methodName + '` should work with a function for `object`', function(assert) {
      assert.expect(2);

      function Foo() {}
      Foo.a = 1;

      function Bar() {}
      Bar.a = 2;

      var par = conforms({
        'a': function(value) { return value > 1; }
      });

      assert.strictEqual(par(Foo), false);
      assert.strictEqual(par(Bar), true);
    }
```

#### `_.' + methodName + '` should work with a function for `source`

```ts
test('`_.' + methodName + '` should work with a function for `source`', function(assert) {
      assert.expect(1);

      function Foo() {}
      Foo.a = function(value) { return value > 1; };

      var objects = [{ 'a': 1 }, { 'a': 2 }],
          actual = lodashStable.filter(objects, conforms(Foo));

      assert.deepEqual(actual, [objects[1]]);
    }
```

#### `_.' + methodName + '` should work with a non-plain `object`

```ts
test('`_.' + methodName + '` should work with a non-plain `object`', function(assert) {
      assert.expect(1);

      function Foo() {
        this.a = 1;
      }
      Foo.prototype.b = 2;

      var par = conforms({
        'b': function(value) { return value > 1; }
      });

      assert.strictEqual(par(new Foo), true);
    }
```

#### `_.' + methodName + '` should return `false` when `object` is nullish

```ts
test('`_.' + methodName + '` should return `false` when `object` is nullish', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubFalse);

      var par = conforms({
        'a': function(value) { return value > 1; }
      });

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `true` when comparing an empty `source` to a nullish `object`

```ts
test('`_.' + methodName + '` should return `true` when comparing an empty `source` to a nullish `object`', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubTrue),
          par = conforms({});

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? par(value) : par();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `true` when comparing an empty `source`

```ts
test('`_.' + methodName + '` should return `true` when comparing an empty `source`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1 },
          expected = lodashStable.map(empties, stubTrue);

      var actual = lodashStable.map(empties, function(value) {
        var par = conforms(value);
        return par(object);
      });

      assert.deepEqual(actual, expected);
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

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.countBy(array, 0), { '1': 1, '2': 2 });
      assert.deepEqual(_.countBy(array, 1), { 'a': 2, 'b': 1 });
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = _.countBy({ 'a': 6.1, 'b': 4.2, 'c': 6.3 }, Math.floor);
      assert.deepEqual(actual, { '4': 1, '6': 2 });
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

#### `_.' + methodName + '` should work for function names that shadow those on `Object.prototype`

```ts
test('`_.' + methodName + '` should work for function names that shadow those on `Object.prototype`', function(assert) {
      assert.expect(1);

      var curried = _.curry(function hasOwnProperty(a, b, c) {
        return [a, b, c];
      });

      var expected = [1, 2, 3];

      assert.deepEqual(curried(1)(2)(3), expected);
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.map`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(2);

      var array = [fn, fn, fn],
          object = { 'a': fn, 'b': fn, 'c': fn };

      lodashStable.each([array, object], function(collection) {
        var curries = lodashStable.map(collection, func),
            expected = lodashStable.map(collection, lodashStable.constant(isCurry ? ['a', 'b'] : ['b', 'a']));

        var actual = lodashStable.map(curries, function(curried) {
          return curried('a')('b');
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### should queue a trailing call for subsequent debounced calls after `maxWait`

```ts
test('should queue a trailing call for subsequent debounced calls after `maxWait`', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var callCount = 0;

      var debounced = _.debounce(function() {
        ++callCount;
      }, 200, { 'maxWait': 200 });

      debounced();

      setTimeout(debounced, 190);
      setTimeout(debounced, 200);
      setTimeout(debounced, 210);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 500);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.drop);

      assert.deepEqual(actual, [[2, 3], [5, 6], [8, 9]]);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.dropRight);

      assert.deepEqual(actual, [[1, 2], [4, 5], [7, 8]]);
    }
```

#### should perform a `SameValueZero` comparison of two values

```ts
test('should perform a `SameValueZero` comparison of two values', function(assert) {
      assert.expect(11);

      assert.strictEqual(_.eq(), true);
      assert.strictEqual(_.eq(undefined), true);
      assert.strictEqual(_.eq(0, -0), true);
      assert.strictEqual(_.eq(NaN, NaN), true);
      assert.strictEqual(_.eq(1, 1), true);

      assert.strictEqual(_.eq(null, undefined), false);
      assert.strictEqual(_.eq(1, Object(1)), false);
      assert.strictEqual(_.eq(1, '1'), false);
      assert.strictEqual(_.eq(1, '1'), false);

      var object = { 'a': 1 };
      assert.strictEqual(_.eq(object, object), true);
      assert.strictEqual(_.eq(object, { 'a': 1 }), false);
    }
```

#### should return an empty string for empty values

```ts
test('should return an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, stubString);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.escapeRegExp(value) : _.escapeRegExp();
      });

      assert.deepEqual(actual, expected);
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

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([[1]], _.every);
      assert.deepEqual(actual, [true]);
    }
```

#### should use `undefined` for `value` if not given

```ts
test('should use `undefined` for `value` if not given', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = _.fill(array);

      assert.deepEqual(actual, Array(3));
      assert.ok(lodashStable.every(actual, function(value, index) {
        return index in actual;
      }));
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2], [3, 4]],
          actual = lodashStable.map(array, _.fill);

      assert.deepEqual(actual, [[0, 0], [1, 1]]);
    }
```

#### should return elements `predicate` returns truthy for

```ts
test('should return elements `predicate` returns truthy for', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.filter(array, isEven), [2]);
    }
```

#### `_.' + methodName + '` should return `' + expected[1] + '` for empty collections

```ts
test('`_.' + methodName + '` should return `' + expected[1] + '` for empty collections', function(assert) {
      assert.expect(1);

      var emptyValues = lodashStable.endsWith(methodName, 'Index') ? lodashStable.reject(empties, lodashStable.isPlainObject) : empties,
          expecting = lodashStable.map(emptyValues, lodashStable.constant(expected[1]));

      var actual = lodashStable.map(emptyValues, function(value) {
        try {
          return func(value, { 'a': 3 });
        } catch (e) {}
      });

      assert.deepEqual(actual, expecting);
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

#### `_.' + methodName + '` should treat number values for `collection` as empty

```ts
test('`_.' + methodName + '` should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(1), []);
    }
```

#### should return an empty array for non array-like objects

```ts
test('should return an empty array for non array-like objects', function(assert) {
      assert.expect(3);

      var expected = [],
          nonArray = { '0': 'a' };

      assert.deepEqual(_.flatten(nonArray), expected);
      assert.deepEqual(_.flattenDeep(nonArray), expected);
      assert.deepEqual(_.flattenDepth(nonArray, 2), expected);
    }
```

#### should be aliased

```ts
test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.each, _.forEach);
    }
```

#### should be aliased

```ts
test('should be aliased', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.eachRight, _.forEachRight);
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.reduce`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.reduce`', function(assert) {
      assert.expect(2);

      var array = [{ 'a': 1 }, { 'b': 2 }, { 'c': 3 }],
          expected = { 'a': isDefaults ? 0 : 1, 'b': 2, 'c': 3 };

      function fn() {};
      fn.a = array[0];
      fn.b = array[1];
      fn.c = array[2];

      assert.deepEqual(lodashStable.reduce(array, func, { 'a': 0 }), expected);
      assert.deepEqual(lodashStable.reduce(fn, func, { 'a': 0 }), expected);
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

#### should work with a number for `iteratee`

```ts
test('should work with a number for `iteratee`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 'a'],
        [2, 'a'],
        [2, 'b']
      ];

      assert.deepEqual(_.groupBy(array, 0), { '1': [[1, 'a']], '2': [[2, 'a'], [2, 'b']] });
      assert.deepEqual(_.groupBy(array, 1), { 'a': [[1, 'a'], [2, 'a']], 'b': [[2, 'b']] });
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = _.groupBy({ 'a': 6.1, 'b': 4.2, 'c': 6.3 }, Math.floor);
      assert.deepEqual(actual, { '4': [4.2], '6': [6.1, 6.3] });
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

#### `_.' + methodName + '` should return `true` for indexes of sparse values

```ts
test('`_.' + methodName + '` should return `true` for indexes of sparse values', function(assert) {
      assert.expect(1);

      var values = [sparseArgs, sparseArray, sparseString],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return func(value, 0);
      });

      assert.deepEqual(actual, expected);
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

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.head);

      assert.deepEqual(actual, [1, 4, 7]);
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

#### should work with a string ' + key + ' for `collection`

```ts
test('should work with a string ' + key + ' for `collection`', function(assert) {
        assert.expect(2);

        assert.strictEqual(_.includes(collection, 'bc'), true);
        assert.strictEqual(_.includes(collection, 'd'), false);
      }
```

#### should return `false` for empty collections

```ts
test('should return `false` for empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubFalse);

      var actual = lodashStable.map(empties, function(value) {
        try {
          return _.includes(value);
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work as an iteratee for methods like `_.every`

```ts
test('should work as an iteratee for methods like `_.every`', function(assert) {
      assert.expect(1);

      var array = [2, 3, 1],
          values = [1, 2, 3];

      assert.ok(lodashStable.every(values, lodashStable.partial(_.includes, array)));
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.initial);

      assert.deepEqual(actual, [[1, 2], [4, 5], [7, 8]]);
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

#### should work with a function for `methodName`

```ts
test('should work with a function for `methodName`', function(assert) {
      assert.expect(1);

      var array = ['a', 'b', 'c'];

      var actual = _.invokeMap(array, function(left, right) {
        return left + this.toUpperCase() + right;
      }, '(', ')');

      assert.deepEqual(actual, ['(A)', '(B)', '(C)']);
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          actual = _.invokeMap(object, 'toFixed', 1);

      assert.deepEqual(actual, ['1.0', '2.0', '3.0']);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.invokeMap(1), []);
    }
```

#### should return `true` for `arguments` objects

```ts
test('should return `true` for `arguments` objects', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isArguments(args), true);
      assert.strictEqual(_.isArguments(strictArgs), true);
    }
```

#### should return `false` for non `arguments` objects

```ts
test('should return `false` for non `arguments` objects', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isArguments(value) : _.isArguments();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isArguments([1, 2, 3]), false);
      assert.strictEqual(_.isArguments(true), false);
      assert.strictEqual(_.isArguments(new Date), false);
      assert.strictEqual(_.isArguments(new Error), false);
      assert.strictEqual(_.isArguments(_), false);
      assert.strictEqual(_.isArguments(slice), false);
      assert.strictEqual(_.isArguments({ '0': 1, 'callee': noop, 'length': 1 }), false);
      assert.strictEqual(_.isArguments(1), false);
      assert.strictEqual(_.isArguments(/x/), false);
      assert.strictEqual(_.isArguments('a'), false);
      assert.strictEqual(_.isArguments(symbol), false);
    }
```

#### should return `true` for arrays

```ts
test('should return `true` for arrays', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isArray([1, 2, 3]), true);
    }
```

#### should return `false` for non-arrays

```ts
test('should return `false` for non-arrays', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isArray(value) : _.isArray();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isArray(args), false);
      assert.strictEqual(_.isArray(true), false);
      assert.strictEqual(_.isArray(new Date), false);
      assert.strictEqual(_.isArray(new Error), false);
      assert.strictEqual(_.isArray(_), false);
      assert.strictEqual(_.isArray(slice), false);
      assert.strictEqual(_.isArray({ '0': 1, 'length': 1 }), false);
      assert.strictEqual(_.isArray(1), false);
      assert.strictEqual(_.isArray(/x/), false);
      assert.strictEqual(_.isArray('a'), false);
      assert.strictEqual(_.isArray(symbol), false);
    }
```

#### should return `true` for array buffers

```ts
test('should return `true` for array buffers', function(assert) {
      assert.expect(1);

      if (ArrayBuffer) {
        assert.strictEqual(_.isArrayBuffer(arrayBuffer), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non array buffers

```ts
test('should return `false` for non array buffers', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isArrayBuffer(value) : _.isArrayBuffer();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isArrayBuffer(args), false);
      assert.strictEqual(_.isArrayBuffer([1]), false);
      assert.strictEqual(_.isArrayBuffer(true), false);
      assert.strictEqual(_.isArrayBuffer(new Date), false);
      assert.strictEqual(_.isArrayBuffer(new Error), false);
      assert.strictEqual(_.isArrayBuffer(_), false);
      assert.strictEqual(_.isArrayBuffer(slice), false);
      assert.strictEqual(_.isArrayBuffer({ 'a': 1 }), false);
      assert.strictEqual(_.isArrayBuffer(1), false);
      assert.strictEqual(_.isArrayBuffer(/x/), false);
      assert.strictEqual(_.isArrayBuffer('a'), false);
      assert.strictEqual(_.isArrayBuffer(symbol), false);
    }
```

#### should return `true` for array-like values

```ts
test('should return `true` for array-like values', function(assert) {
      assert.expect(1);

      var values = [args, [1, 2, 3], { '0': 'a', 'length': 1 }, 'a'],
          expected = lodashStable.map(values, stubTrue),
          actual = lodashStable.map(values, _.isArrayLike);

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-arrays

```ts
test('should return `false` for non-arrays', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return value === '';
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isArrayLike(value) : _.isArrayLike();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isArrayLike(true), false);
      assert.strictEqual(_.isArrayLike(new Date), false);
      assert.strictEqual(_.isArrayLike(new Error), false);
      assert.strictEqual(_.isArrayLike(_), false);
      assert.strictEqual(_.isArrayLike(asyncFunc), false);
      assert.strictEqual(_.isArrayLike(genFunc), false);
      assert.strictEqual(_.isArrayLike(slice), false);
      assert.strictEqual(_.isArrayLike({ 'a': 1 }), false);
      assert.strictEqual(_.isArrayLike(1), false);
      assert.strictEqual(_.isArrayLike(/x/), false);
      assert.strictEqual(_.isArrayLike(symbol), false);
    }
```

#### should return `true` for booleans

```ts
test('should return `true` for booleans', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.isBoolean(true), true);
      assert.strictEqual(_.isBoolean(false), true);
      assert.strictEqual(_.isBoolean(Object(true)), true);
      assert.strictEqual(_.isBoolean(Object(false)), true);
    }
```

#### should return `false` for non-booleans

```ts
test('should return `false` for non-booleans', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return value === false;
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isBoolean(value) : _.isBoolean();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isBoolean(args), false);
      assert.strictEqual(_.isBoolean([1, 2, 3]), false);
      assert.strictEqual(_.isBoolean(new Date), false);
      assert.strictEqual(_.isBoolean(new Error), false);
      assert.strictEqual(_.isBoolean(_), false);
      assert.strictEqual(_.isBoolean(slice), false);
      assert.strictEqual(_.isBoolean({ 'a': 1 }), false);
      assert.strictEqual(_.isBoolean(1), false);
      assert.strictEqual(_.isBoolean(/x/), false);
      assert.strictEqual(_.isBoolean('a'), false);
      assert.strictEqual(_.isBoolean(symbol), false);
    }
```

#### should return `true` for buffers

```ts
test('should return `true` for buffers', function(assert) {
      assert.expect(1);

      if (Buffer) {
        assert.strictEqual(_.isBuffer(new Buffer(2)), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non-buffers

```ts
test('should return `false` for non-buffers', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isBuffer(value) : _.isBuffer();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isBuffer(args), false);
      assert.strictEqual(_.isBuffer([1]), false);
      assert.strictEqual(_.isBuffer(true), false);
      assert.strictEqual(_.isBuffer(new Date), false);
      assert.strictEqual(_.isBuffer(new Error), false);
      assert.strictEqual(_.isBuffer(_), false);
      assert.strictEqual(_.isBuffer(slice), false);
      assert.strictEqual(_.isBuffer({ 'a': 1 }), false);
      assert.strictEqual(_.isBuffer(1), false);
      assert.strictEqual(_.isBuffer(/x/), false);
      assert.strictEqual(_.isBuffer('a'), false);
      assert.strictEqual(_.isBuffer(symbol), false);
    }
```

#### should return `true` for dates

```ts
test('should return `true` for dates', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isDate(new Date), true);
    }
```

#### should return `false` for non-dates

```ts
test('should return `false` for non-dates', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isDate(value) : _.isDate();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isDate(args), false);
      assert.strictEqual(_.isDate([1, 2, 3]), false);
      assert.strictEqual(_.isDate(true), false);
      assert.strictEqual(_.isDate(new Error), false);
      assert.strictEqual(_.isDate(_), false);
      assert.strictEqual(_.isDate(slice), false);
      assert.strictEqual(_.isDate({ 'a': 1 }), false);
      assert.strictEqual(_.isDate(1), false);
      assert.strictEqual(_.isDate(/x/), false);
      assert.strictEqual(_.isDate('a'), false);
      assert.strictEqual(_.isDate(symbol), false);
    }
```

#### should return `true` for elements

```ts
test('should return `true` for elements', function(assert) {
      assert.expect(1);

      if (document) {
        assert.strictEqual(_.isElement(body), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` for non-plain objects

```ts
test('should return `true` for non-plain objects', function(assert) {
      assert.expect(1);

      function Foo() {
        this.nodeType = 1;
      }

      assert.strictEqual(_.isElement(new Foo), true);
    }
```

#### should return `false` for non DOM elements

```ts
test('should return `false` for non DOM elements', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isElement(value) : _.isElement();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isElement(args), false);
      assert.strictEqual(_.isElement([1, 2, 3]), false);
      assert.strictEqual(_.isElement(true), false);
      assert.strictEqual(_.isElement(new Date), false);
      assert.strictEqual(_.isElement(new Error), false);
      assert.strictEqual(_.isElement(_), false);
      assert.strictEqual(_.isElement(slice), false);
      assert.strictEqual(_.isElement({ 'a': 1 }), false);
      assert.strictEqual(_.isElement(1), false);
      assert.strictEqual(_.isElement(/x/), false);
      assert.strictEqual(_.isElement('a'), false);
      assert.strictEqual(_.isElement(symbol), false);
    }
```

#### should return `false` for plain objects

```ts
test('should return `false` for plain objects', function(assert) {
      assert.expect(6);

      assert.strictEqual(_.isElement({ 'nodeType': 1 }), false);
      assert.strictEqual(_.isElement({ 'nodeType': Object(1) }), false);
      assert.strictEqual(_.isElement({ 'nodeType': true }), false);
      assert.strictEqual(_.isElement({ 'nodeType': [1] }), false);
      assert.strictEqual(_.isElement({ 'nodeType': '1' }), false);
      assert.strictEqual(_.isElement({ 'nodeType': '001' }), false);
    }
```

#### should return `true` for empty values

```ts
test('should return `true` for empty values', function(assert) {
      assert.expect(10);

      var expected = lodashStable.map(empties, stubTrue),
          actual = lodashStable.map(empties, _.isEmpty);

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isEmpty(true), true);
      assert.strictEqual(_.isEmpty(slice), true);
      assert.strictEqual(_.isEmpty(1), true);
      assert.strictEqual(_.isEmpty(NaN), true);
      assert.strictEqual(_.isEmpty(/x/), true);
      assert.strictEqual(_.isEmpty(symbol), true);
      assert.strictEqual(_.isEmpty(), true);

      if (Buffer) {
        assert.strictEqual(_.isEmpty(new Buffer(0)), true);
        assert.strictEqual(_.isEmpty(new Buffer(1)), false);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should return `false` for non-empty values

```ts
test('should return `false` for non-empty values', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.isEmpty([0]), false);
      assert.strictEqual(_.isEmpty({ 'a': 0 }), false);
      assert.strictEqual(_.isEmpty('a'), false);
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

#### should have transitive equivalence for circular references of arrays

```ts
test('should have transitive equivalence for circular references of arrays', function(assert) {
      assert.expect(3);

      var array1 = [],
          array2 = [array1],
          array3 = [array2];

      array1[0] = array1;

      assert.strictEqual(_.isEqual(array1, array2), true);
      assert.strictEqual(_.isEqual(array2, array3), true);
      assert.strictEqual(_.isEqual(array1, array3), true);
    }
```

#### should have transitive equivalence for circular references of objects

```ts
test('should have transitive equivalence for circular references of objects', function(assert) {
      assert.expect(3);

      var object1 = {},
          object2 = { 'a': object1 },
          object3 = { 'a': object2 };

      object1.a = object1;

      assert.strictEqual(_.isEqual(object1, object2), true);
      assert.strictEqual(_.isEqual(object2, object3), true);
      assert.strictEqual(_.isEqual(object1, object3), true);
    }
```

#### should work as an iteratee for `_.every`

```ts
test('should work as an iteratee for `_.every`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.every([1, 1, 1], lodashStable.partial(_.isEqual, 1));
      assert.ok(actual);
    }
```

#### should return `true` for like-objects from different documents

```ts
test('should return `true` for like-objects from different documents', function(assert) {
      assert.expect(4);

      if (realm.object) {
        assert.strictEqual(_.isEqual([1], realm.array), true);
        assert.strictEqual(_.isEqual([2], realm.array), false);
        assert.strictEqual(_.isEqual({ 'a': 1 }, realm.object), true);
        assert.strictEqual(_.isEqual({ 'a': 2 }, realm.object), false);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should return `false` for objects with custom `toString` methods

```ts
test('should return `false` for objects with custom `toString` methods', function(assert) {
      assert.expect(1);

      var primitive,
          object = { 'toString': function() { return primitive; } },
          values = [true, null, 1, 'a', undefined],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        primitive = value;
        return _.isEqual(object, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should call `customizer` for values maps and sets

```ts
test('should call `customizer` for values maps and sets', function(assert) {
      assert.expect(2);

      var value = { 'a': { 'b': 2 } };

      if (Map) {
        var map1 = new Map;
        map1.set('a', value);

        var map2 = new Map;
        map2.set('a', value);
      }
      if (Set) {
        var set1 = new Set;
        set1.add(value);

        var set2 = new Set;
        set2.add(value);
      }
      lodashStable.each([[map1, map2], [set1, set2]], function(pair, index) {
        if (pair[0]) {
          var argsList = [],
              array = lodashStable.toArray(pair[0]);

          var expected = [
            [pair[0], pair[1]],
            [array[0], array[0], 0, array, array],
            [array[0][0], array[0][0], 0, array[0], array[0]],
            [array[0][1], array[0][1], 1, array[0], array[0]]
          ];

          if (index) {
            expected.length = 2;
          }
          _.isEqualWith(pair[0], pair[1], function() {
            var length = arguments.length,
                args = slice.call(arguments, 0, length - (length > 2 ? 1 : 0));

            argsList.push(args);
          });

          assert.deepEqual(argsList, expected, index ? 'Set' : 'Map');
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should return `true` for error objects

```ts
test('should return `true` for error objects', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(errors, stubTrue);

      var actual = lodashStable.map(errors, function(error) {
        return _.isError(error) === true;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for subclassed values

```ts
test('should return `true` for subclassed values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isError(new CustomError('x')), true);
    }
```

#### should return `false` for non error objects

```ts
test('should return `false` for non error objects', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isError(value) : _.isError();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isError(args), false);
      assert.strictEqual(_.isError([1, 2, 3]), false);
      assert.strictEqual(_.isError(true), false);
      assert.strictEqual(_.isError(new Date), false);
      assert.strictEqual(_.isError(_), false);
      assert.strictEqual(_.isError(slice), false);
      assert.strictEqual(_.isError({ 'a': 1 }), false);
      assert.strictEqual(_.isError(1), false);
      assert.strictEqual(_.isError(/x/), false);
      assert.strictEqual(_.isError('a'), false);
      assert.strictEqual(_.isError(symbol), false);
    }
```

#### should return `false` for plain objects

```ts
test('should return `false` for plain objects', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isError({ 'name': 'Error', 'message': '' }), false);
    }
```

#### should return `true` for finite values

```ts
test('should return `true` for finite values', function(assert) {
      assert.expect(1);

      var values = [0, 1, 3.14, -1],
          expected = lodashStable.map(values, stubTrue),
          actual = lodashStable.map(values, _.isFinite);

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-finite values

```ts
test('should return `false` for non-finite values', function(assert) {
      assert.expect(1);

      var values = [NaN, Infinity, -Infinity, Object(1)],
          expected = lodashStable.map(values, stubFalse),
          actual = lodashStable.map(values, _.isFinite);

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-numeric values

```ts
test('should return `false` for non-numeric values', function(assert) {
      assert.expect(10);

      var values = [undefined, [], true, '', ' ', '2px'],
          expected = lodashStable.map(values, stubFalse),
          actual = lodashStable.map(values, _.isFinite);

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isFinite(args), false);
      assert.strictEqual(_.isFinite([1, 2, 3]), false);
      assert.strictEqual(_.isFinite(true), false);
      assert.strictEqual(_.isFinite(new Date), false);
      assert.strictEqual(_.isFinite(new Error), false);
      assert.strictEqual(_.isFinite({ 'a': 1 }), false);
      assert.strictEqual(_.isFinite(/x/), false);
      assert.strictEqual(_.isFinite('a'), false);
      assert.strictEqual(_.isFinite(symbol), false);
    }
```

#### should return `false` for numeric string values

```ts
test('should return `false` for numeric string values', function(assert) {
      assert.expect(1);

      var values = ['2', '0', '08'],
          expected = lodashStable.map(values, stubFalse),
          actual = lodashStable.map(values, _.isFinite);

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for functions

```ts
test('should return `true` for functions', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isFunction(_), true);
      assert.strictEqual(_.isFunction(slice), true);
    }
```

#### should return `true` for async functions

```ts
test('should return `true` for async functions', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isFunction(asyncFunc), typeof asyncFunc == 'function');
    }
```

#### should return `true` for generator functions

```ts
test('should return `true` for generator functions', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isFunction(genFunc), typeof genFunc == 'function');
    }
```

#### should return `true` for the `Proxy` constructor

```ts
test('should return `true` for the `Proxy` constructor', function(assert) {
      assert.expect(1);

      if (Proxy) {
        assert.strictEqual(_.isFunction(Proxy), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` for array view constructors

```ts
test('should return `true` for array view constructors', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(arrayViews, function(type) {
        return objToString.call(root[type]) == funcTag;
      });

      var actual = lodashStable.map(arrayViews, function(type) {
        return _.isFunction(root[type]);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-functions

```ts
test('should return `false` for non-functions', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isFunction(value) : _.isFunction();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isFunction(args), false);
      assert.strictEqual(_.isFunction([1, 2, 3]), false);
      assert.strictEqual(_.isFunction(true), false);
      assert.strictEqual(_.isFunction(new Date), false);
      assert.strictEqual(_.isFunction(new Error), false);
      assert.strictEqual(_.isFunction({ 'a': 1 }), false);
      assert.strictEqual(_.isFunction(1), false);
      assert.strictEqual(_.isFunction(/x/), false);
      assert.strictEqual(_.isFunction('a'), false);
      assert.strictEqual(_.isFunction(symbol), false);

      if (document) {
        assert.strictEqual(_.isFunction(document.getElementsByTagName('body')), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return `true` for integer values

```ts
test('`_.' + methodName + '` should return `true` for integer values', function(assert) {
      assert.expect(2);

      var values = [-1, 0, 1],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return func(value);
      });

      assert.deepEqual(actual, expected);
      assert.strictEqual(func(MAX_INTEGER), !isSafe);
    }
```

#### should return `false` for non-integer number values

```ts
test('should return `false` for non-integer number values', function(assert) {
      assert.expect(1);

      var values = [NaN, Infinity, -Infinity, Object(1), 3.14],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        return func(value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for lengths

```ts
test('should return `true` for lengths', function(assert) {
      assert.expect(1);

      var values = [0, 3, MAX_SAFE_INTEGER],
          expected = lodashStable.map(values, stubTrue),
          actual = lodashStable.map(values, _.isLength);

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-lengths

```ts
test('should return `false` for non-lengths', function(assert) {
      assert.expect(1);

      var values = [-1, '1', 1.1, MAX_SAFE_INTEGER + 1],
          expected = lodashStable.map(values, stubFalse),
          actual = lodashStable.map(values, _.isLength);

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for maps

```ts
test('should return `true` for maps', function(assert) {
      assert.expect(1);

      if (Map) {
        assert.strictEqual(_.isMap(map), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non-maps

```ts
test('should return `false` for non-maps', function(assert) {
      assert.expect(14);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isMap(value) : _.isMap();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isMap(args), false);
      assert.strictEqual(_.isMap([1, 2, 3]), false);
      assert.strictEqual(_.isMap(true), false);
      assert.strictEqual(_.isMap(new Date), false);
      assert.strictEqual(_.isMap(new Error), false);
      assert.strictEqual(_.isMap(_), false);
      assert.strictEqual(_.isMap(slice), false);
      assert.strictEqual(_.isMap({ 'a': 1 }), false);
      assert.strictEqual(_.isMap(1), false);
      assert.strictEqual(_.isMap(/x/), false);
      assert.strictEqual(_.isMap('a'), false);
      assert.strictEqual(_.isMap(symbol), false);
      assert.strictEqual(_.isMap(weakMap), false);
    }
```

#### should work for objects with a non-function `constructor` (test in IE 11)

```ts
test('should work for objects with a non-function `constructor` (test in IE 11)', function(assert) {
      assert.expect(1);

      var values = [false, true],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        return _.isMap({ 'constructor': value });
      });

      assert.deepEqual(actual, expected);
    }
```

#### should call `customizer` for values maps and sets

```ts
test('should call `customizer` for values maps and sets', function(assert) {
      assert.expect(2);

      var value = { 'a': { 'b': 2 } };

      if (Map) {
        var map1 = new Map;
        map1.set('a', value);

        var map2 = new Map;
        map2.set('a', value);
      }
      if (Set) {
        var set1 = new Set;
        set1.add(value);

        var set2 = new Set;
        set2.add(value);
      }
      lodashStable.each([[map1, map2], [set1, set2]], function(pair, index) {
        if (pair[0]) {
          var argsList = [],
              array = lodashStable.toArray(pair[0]),
              object1 = { 'a': pair[0] },
              object2 = { 'a': pair[1] };

          var expected = [
            [pair[0], pair[1], 'a', object1, object2],
            [array[0], array[0], 0, array, array],
            [array[0][0], array[0][0], 0, array[0], array[0]],
            [array[0][1], array[0][1], 1, array[0], array[0]]
          ];

          if (index) {
            expected.length = 2;
          }
          _.isMatchWith({ 'a': pair[0] }, { 'a': pair[1] }, function() {
            argsList.push(slice.call(arguments, 0, -1));
          });

          assert.deepEqual(argsList, expected, index ? 'Set' : 'Map');
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should return `true` for NaNs

```ts
test('should return `true` for NaNs', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isNaN(NaN), true);
      assert.strictEqual(_.isNaN(Object(NaN)), true);
    }
```

#### should return `false` for non-NaNs

```ts
test('should return `false` for non-NaNs', function(assert) {
      assert.expect(14);

      var expected = lodashStable.map(falsey, function(value) {
        return value !== value;
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNaN(value) : _.isNaN();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNaN(args), false);
      assert.strictEqual(_.isNaN([1, 2, 3]), false);
      assert.strictEqual(_.isNaN(true), false);
      assert.strictEqual(_.isNaN(new Date), false);
      assert.strictEqual(_.isNaN(new Error), false);
      assert.strictEqual(_.isNaN(_), false);
      assert.strictEqual(_.isNaN(slice), false);
      assert.strictEqual(_.isNaN({ 'a': 1 }), false);
      assert.strictEqual(_.isNaN(1), false);
      assert.strictEqual(_.isNaN(Object(1)), false);
      assert.strictEqual(_.isNaN(/x/), false);
      assert.strictEqual(_.isNaN('a'), false);
      assert.strictEqual(_.isNaN(symbol), false);
    }
```

#### should return `true` for native methods

```ts
test('should return `true` for native methods', function(assert) {
      assert.expect(1);

      var values = [Array, body && body.cloneNode, create, root.encodeURI, Promise, slice, Uint8Array],
          expected = lodashStable.map(values, Boolean),
          actual = lodashStable.map(values, _.isNative);

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non-native methods

```ts
test('should return `false` for non-native methods', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNative(value) : _.isNative();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNative(args), false);
      assert.strictEqual(_.isNative([1, 2, 3]), false);
      assert.strictEqual(_.isNative(true), false);
      assert.strictEqual(_.isNative(new Date), false);
      assert.strictEqual(_.isNative(new Error), false);
      assert.strictEqual(_.isNative(_), false);
      assert.strictEqual(_.isNative({ 'a': 1 }), false);
      assert.strictEqual(_.isNative(1), false);
      assert.strictEqual(_.isNative(/x/), false);
      assert.strictEqual(_.isNative('a'), false);
      assert.strictEqual(_.isNative(symbol), false);
    }
```

#### should return `true` for nullish values

```ts
test('should return `true` for nullish values', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.isNil(null), true);
      assert.strictEqual(_.isNil(), true);
      assert.strictEqual(_.isNil(undefined), true);
    }
```

#### should return `false` for non-nullish values

```ts
test('should return `false` for non-nullish values', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, function(value) {
        return value == null;
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNil(value) : _.isNil();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNil(args), false);
      assert.strictEqual(_.isNil([1, 2, 3]), false);
      assert.strictEqual(_.isNil(true), false);
      assert.strictEqual(_.isNil(new Date), false);
      assert.strictEqual(_.isNil(new Error), false);
      assert.strictEqual(_.isNil(_), false);
      assert.strictEqual(_.isNil(slice), false);
      assert.strictEqual(_.isNil({ 'a': 1 }), false);
      assert.strictEqual(_.isNil(1), false);
      assert.strictEqual(_.isNil(/x/), false);
      assert.strictEqual(_.isNil('a'), false);

      if (Symbol) {
        assert.strictEqual(_.isNil(symbol), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` for `null` values

```ts
test('should return `true` for `null` values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isNull(null), true);
    }
```

#### should return `false` for non `null` values

```ts
test('should return `false` for non `null` values', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, function(value) {
        return value === null;
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNull(value) : _.isNull();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNull(args), false);
      assert.strictEqual(_.isNull([1, 2, 3]), false);
      assert.strictEqual(_.isNull(true), false);
      assert.strictEqual(_.isNull(new Date), false);
      assert.strictEqual(_.isNull(new Error), false);
      assert.strictEqual(_.isNull(_), false);
      assert.strictEqual(_.isNull(slice), false);
      assert.strictEqual(_.isNull({ 'a': 1 }), false);
      assert.strictEqual(_.isNull(1), false);
      assert.strictEqual(_.isNull(/x/), false);
      assert.strictEqual(_.isNull('a'), false);
      assert.strictEqual(_.isNull(symbol), false);
    }
```

#### should return `true` for numbers

```ts
test('should return `true` for numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.isNumber(0), true);
      assert.strictEqual(_.isNumber(Object(0)), true);
      assert.strictEqual(_.isNumber(NaN), true);
    }
```

#### should return `false` for non-numbers

```ts
test('should return `false` for non-numbers', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return typeof value == 'number';
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isNumber(value) : _.isNumber();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isNumber(args), false);
      assert.strictEqual(_.isNumber([1, 2, 3]), false);
      assert.strictEqual(_.isNumber(true), false);
      assert.strictEqual(_.isNumber(new Date), false);
      assert.strictEqual(_.isNumber(new Error), false);
      assert.strictEqual(_.isNumber(_), false);
      assert.strictEqual(_.isNumber(slice), false);
      assert.strictEqual(_.isNumber({ 'a': 1 }), false);
      assert.strictEqual(_.isNumber(/x/), false);
      assert.strictEqual(_.isNumber('a'), false);
      assert.strictEqual(_.isNumber(symbol), false);
    }
```

#### should return `true` for objects

```ts
test('should return `true` for objects', function(assert) {
      assert.expect(13);

      assert.strictEqual(_.isObject(args), true);
      assert.strictEqual(_.isObject([1, 2, 3]), true);
      assert.strictEqual(_.isObject(Object(false)), true);
      assert.strictEqual(_.isObject(new Date), true);
      assert.strictEqual(_.isObject(new Error), true);
      assert.strictEqual(_.isObject(_), true);
      assert.strictEqual(_.isObject(slice), true);
      assert.strictEqual(_.isObject({ 'a': 1 }), true);
      assert.strictEqual(_.isObject(Object(0)), true);
      assert.strictEqual(_.isObject(/x/), true);
      assert.strictEqual(_.isObject(Object('a')), true);

      if (document) {
        assert.strictEqual(_.isObject(body), true);
      }
      else {
        skipAssert(assert);
      }
      if (Symbol) {
        assert.strictEqual(_.isObject(Object(symbol)), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non-objects

```ts
test('should return `false` for non-objects', function(assert) {
      assert.expect(1);

      var values = falsey.concat(true, 1, 'a', symbol),
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.isObject(value) : _.isObject();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for objects

```ts
test('should return `true` for objects', function(assert) {
      assert.expect(9);

      assert.strictEqual(_.isObjectLike(args), true);
      assert.strictEqual(_.isObjectLike([1, 2, 3]), true);
      assert.strictEqual(_.isObjectLike(Object(false)), true);
      assert.strictEqual(_.isObjectLike(new Date), true);
      assert.strictEqual(_.isObjectLike(new Error), true);
      assert.strictEqual(_.isObjectLike({ 'a': 1 }), true);
      assert.strictEqual(_.isObjectLike(Object(0)), true);
      assert.strictEqual(_.isObjectLike(/x/), true);
      assert.strictEqual(_.isObjectLike(Object('a')), true);
    }
```

#### should return `false` for non-objects

```ts
test('should return `false` for non-objects', function(assert) {
      assert.expect(1);

      var values = falsey.concat(true, _, slice, 1, 'a', symbol),
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.isObjectLike(value) : _.isObjectLike();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for objects with a `[[Prototype]]` of `null`

```ts
test('should return `true` for objects with a `[[Prototype]]` of `null`', function(assert) {
      assert.expect(2);

      var object = create(null);
      assert.strictEqual(_.isPlainObject(object), true);

      object.constructor = objectProto.constructor;
      assert.strictEqual(_.isPlainObject(object), true);
    }
```

#### should return `true` for objects with a `valueOf` property

```ts
test('should return `true` for objects with a `valueOf` property', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isPlainObject({ 'valueOf': 0 }), true);
    }
```

#### should return `true` for objects with a writable `Symbol.toStringTag` property

```ts
test('should return `true` for objects with a writable `Symbol.toStringTag` property', function(assert) {
      assert.expect(1);

      if (Symbol && Symbol.toStringTag) {
        var object = {};
        object[Symbol.toStringTag] = 'X';

        assert.deepEqual(_.isPlainObject(object), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for objects with a custom `[[Prototype]]`

```ts
test('should return `false` for objects with a custom `[[Prototype]]`', function(assert) {
      assert.expect(1);

      var object = create({ 'a': 1 });
      assert.strictEqual(_.isPlainObject(object), false);
    }
```

#### should return `false` for DOM elements

```ts
test('should return `false` for DOM elements', function(assert) {
      assert.expect(1);

      if (element) {
        assert.strictEqual(_.isPlainObject(element), false);
      } else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non-Object objects

```ts
test('should return `false` for non-Object objects', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.isPlainObject(arguments), false);
      assert.strictEqual(_.isPlainObject(Error), false);
      assert.strictEqual(_.isPlainObject(Math), false);
    }
```

#### should return `false` for non-objects

```ts
test('should return `false` for non-objects', function(assert) {
      assert.expect(4);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isPlainObject(value) : _.isPlainObject();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isPlainObject(true), false);
      assert.strictEqual(_.isPlainObject('a'), false);
      assert.strictEqual(_.isPlainObject(symbol), false);
    }
```

#### should return `false` for objects with a read-only `Symbol.toStringTag` property

```ts
test('should return `false` for objects with a read-only `Symbol.toStringTag` property', function(assert) {
      assert.expect(1);

      if (Symbol && Symbol.toStringTag) {
        var object = {};
        defineProperty(object, Symbol.toStringTag, {
          'configurable': true,
          'enumerable': false,
          'writable': false,
          'value': 'X'
        });

        assert.deepEqual(_.isPlainObject(object), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` for regexes

```ts
test('should return `true` for regexes', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isRegExp(/x/), true);
      assert.strictEqual(_.isRegExp(RegExp('x')), true);
    }
```

#### should return `false` for non-regexes

```ts
test('should return `false` for non-regexes', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isRegExp(value) : _.isRegExp();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isRegExp(args), false);
      assert.strictEqual(_.isRegExp([1, 2, 3]), false);
      assert.strictEqual(_.isRegExp(true), false);
      assert.strictEqual(_.isRegExp(new Date), false);
      assert.strictEqual(_.isRegExp(new Error), false);
      assert.strictEqual(_.isRegExp(_), false);
      assert.strictEqual(_.isRegExp(slice), false);
      assert.strictEqual(_.isRegExp({ 'a': 1 }), false);
      assert.strictEqual(_.isRegExp(1), false);
      assert.strictEqual(_.isRegExp('a'), false);
      assert.strictEqual(_.isRegExp(symbol), false);
    }
```

#### should return `true` for sets

```ts
test('should return `true` for sets', function(assert) {
      assert.expect(1);

      if (Set) {
        assert.strictEqual(_.isSet(set), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non-sets

```ts
test('should return `false` for non-sets', function(assert) {
      assert.expect(14);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isSet(value) : _.isSet();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isSet(args), false);
      assert.strictEqual(_.isSet([1, 2, 3]), false);
      assert.strictEqual(_.isSet(true), false);
      assert.strictEqual(_.isSet(new Date), false);
      assert.strictEqual(_.isSet(new Error), false);
      assert.strictEqual(_.isSet(_), false);
      assert.strictEqual(_.isSet(slice), false);
      assert.strictEqual(_.isSet({ 'a': 1 }), false);
      assert.strictEqual(_.isSet(1), false);
      assert.strictEqual(_.isSet(/x/), false);
      assert.strictEqual(_.isSet('a'), false);
      assert.strictEqual(_.isSet(symbol), false);
      assert.strictEqual(_.isSet(weakSet), false);
    }
```

#### should return `true` for strings

```ts
test('should return `true` for strings', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isString('a'), true);
      assert.strictEqual(_.isString(Object('a')), true);
    }
```

#### should return `false` for non-strings

```ts
test('should return `false` for non-strings', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, function(value) {
        return value === '';
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isString(value) : _.isString();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isString(args), false);
      assert.strictEqual(_.isString([1, 2, 3]), false);
      assert.strictEqual(_.isString(true), false);
      assert.strictEqual(_.isString(new Date), false);
      assert.strictEqual(_.isString(new Error), false);
      assert.strictEqual(_.isString(_), false);
      assert.strictEqual(_.isString(slice), false);
      assert.strictEqual(_.isString({ '0': 1, 'length': 1 }), false);
      assert.strictEqual(_.isString(1), false);
      assert.strictEqual(_.isString(/x/), false);
      assert.strictEqual(_.isString(symbol), false);
    }
```

#### should return `true` for symbols

```ts
test('should return `true` for symbols', function(assert) {
      assert.expect(2);

      if (Symbol) {
        assert.strictEqual(_.isSymbol(symbol), true);
        assert.strictEqual(_.isSymbol(Object(symbol)), true);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should return `false` for non-symbols

```ts
test('should return `false` for non-symbols', function(assert) {
      assert.expect(12);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isSymbol(value) : _.isSymbol();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isSymbol(args), false);
      assert.strictEqual(_.isSymbol([1, 2, 3]), false);
      assert.strictEqual(_.isSymbol(true), false);
      assert.strictEqual(_.isSymbol(new Date), false);
      assert.strictEqual(_.isSymbol(new Error), false);
      assert.strictEqual(_.isSymbol(_), false);
      assert.strictEqual(_.isSymbol(slice), false);
      assert.strictEqual(_.isSymbol({ '0': 1, 'length': 1 }), false);
      assert.strictEqual(_.isSymbol(1), false);
      assert.strictEqual(_.isSymbol(/x/), false);
      assert.strictEqual(_.isSymbol('a'), false);
    }
```

#### should return `true` for typed arrays

```ts
test('should return `true` for typed arrays', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(typedArrays, function(type) {
        return type in root;
      });

      var actual = lodashStable.map(typedArrays, function(type) {
        var Ctor = root[type];
        return Ctor ? _.isTypedArray(new Ctor(new ArrayBuffer(8))) : false;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `false` for non typed arrays

```ts
test('should return `false` for non typed arrays', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isTypedArray(value) : _.isTypedArray();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isTypedArray(args), false);
      assert.strictEqual(_.isTypedArray([1, 2, 3]), false);
      assert.strictEqual(_.isTypedArray(true), false);
      assert.strictEqual(_.isTypedArray(new Date), false);
      assert.strictEqual(_.isTypedArray(new Error), false);
      assert.strictEqual(_.isTypedArray(_), false);
      assert.strictEqual(_.isTypedArray(slice), false);
      assert.strictEqual(_.isTypedArray({ 'a': 1 }), false);
      assert.strictEqual(_.isTypedArray(1), false);
      assert.strictEqual(_.isTypedArray(/x/), false);
      assert.strictEqual(_.isTypedArray('a'), false);
      assert.strictEqual(_.isTypedArray(symbol), false);
    }
```

#### should return `true` for `undefined` values

```ts
test('should return `true` for `undefined` values', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.isUndefined(), true);
      assert.strictEqual(_.isUndefined(undefined), true);
    }
```

#### should return `false` for non `undefined` values

```ts
test('should return `false` for non `undefined` values', function(assert) {
      assert.expect(13);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined;
      });

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isUndefined(value) : _.isUndefined();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isUndefined(args), false);
      assert.strictEqual(_.isUndefined([1, 2, 3]), false);
      assert.strictEqual(_.isUndefined(true), false);
      assert.strictEqual(_.isUndefined(new Date), false);
      assert.strictEqual(_.isUndefined(new Error), false);
      assert.strictEqual(_.isUndefined(_), false);
      assert.strictEqual(_.isUndefined(slice), false);
      assert.strictEqual(_.isUndefined({ 'a': 1 }), false);
      assert.strictEqual(_.isUndefined(1), false);
      assert.strictEqual(_.isUndefined(/x/), false);
      assert.strictEqual(_.isUndefined('a'), false);

      if (Symbol) {
        assert.strictEqual(_.isUndefined(symbol), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` for weak maps

```ts
test('should return `true` for weak maps', function(assert) {
      assert.expect(1);

      if (WeakMap) {
        assert.strictEqual(_.isWeakMap(weakMap), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non weak maps

```ts
test('should return `false` for non weak maps', function(assert) {
      assert.expect(14);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isWeakMap(value) : _.isWeakMap();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isWeakMap(args), false);
      assert.strictEqual(_.isWeakMap([1, 2, 3]), false);
      assert.strictEqual(_.isWeakMap(true), false);
      assert.strictEqual(_.isWeakMap(new Date), false);
      assert.strictEqual(_.isWeakMap(new Error), false);
      assert.strictEqual(_.isWeakMap(_), false);
      assert.strictEqual(_.isWeakMap(slice), false);
      assert.strictEqual(_.isWeakMap({ 'a': 1 }), false);
      assert.strictEqual(_.isWeakMap(map), false);
      assert.strictEqual(_.isWeakMap(1), false);
      assert.strictEqual(_.isWeakMap(/x/), false);
      assert.strictEqual(_.isWeakMap('a'), false);
      assert.strictEqual(_.isWeakMap(symbol), false);
    }
```

#### should work for objects with a non-function `constructor` (test in IE 11)

```ts
test('should work for objects with a non-function `constructor` (test in IE 11)', function(assert) {
      assert.expect(1);

      var values = [false, true],
          expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        return _.isWeakMap({ 'constructor': value });
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `true` for weak sets

```ts
test('should return `true` for weak sets', function(assert) {
      assert.expect(1);

      if (WeakSet) {
        assert.strictEqual(_.isWeakSet(weakSet), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `false` for non weak sets

```ts
test('should return `false` for non weak sets', function(assert) {
      assert.expect(14);

      var expected = lodashStable.map(falsey, stubFalse);

      var actual = lodashStable.map(falsey, function(value, index) {
        return index ? _.isWeakSet(value) : _.isWeakSet();
      });

      assert.deepEqual(actual, expected);

      assert.strictEqual(_.isWeakSet(args), false);
      assert.strictEqual(_.isWeakSet([1, 2, 3]), false);
      assert.strictEqual(_.isWeakSet(true), false);
      assert.strictEqual(_.isWeakSet(new Date), false);
      assert.strictEqual(_.isWeakSet(new Error), false);
      assert.strictEqual(_.isWeakSet(_), false);
      assert.strictEqual(_.isWeakSet(slice), false);
      assert.strictEqual(_.isWeakSet({ 'a': 1 }), false);
      assert.strictEqual(_.isWeakSet(1), false);
      assert.strictEqual(_.isWeakSet(/x/), false);
      assert.strictEqual(_.isWeakSet('a'), false);
      assert.strictEqual(_.isWeakSet(set), false);
      assert.strictEqual(_.isWeakSet(symbol), false);
    }
```

#### should return `false` for subclassed values

```ts
test('should return `false` for subclassed values', function(assert) {
      assert.expect(7);

      var funcs = [
        'isArray', 'isBoolean', 'isDate', 'isFunction',
        'isNumber', 'isRegExp', 'isString'
      ];

      lodashStable.each(funcs, function(methodName) {
        function Foo() {}
        Foo.prototype = root[methodName.slice(2)].prototype;

        var object = new Foo;
        if (objToString.call(object) == objectTag) {
          assert.strictEqual(_[methodName](object), false, '`_.' + methodName + '` returns `false`');
        }
        else {
          skipAssert(assert);
        }
      });
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

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var fn = function() { return this instanceof Number; },
          array = [fn, fn, fn],
          iteratees = lodashStable.map(array, _.iteratee),
          expected = lodashStable.map(array, stubFalse);

      var actual = lodashStable.map(iteratees, function(iteratee) {
        return iteratee();
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.transform` should use `_.iteratee` internally

```ts
test('`_.transform` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = function() {
          return function(result, object) {
            result.sum += object.a;
          };
        };

        assert.deepEqual(_.transform(objects, undefined, { 'sum': 0 }), { 'sum': 2 });
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

#### should defer to `customizer` for non `undefined` results

```ts
test('should defer to `customizer` for non `undefined` results', function(assert) {
      assert.expect(1);

      var actual = _.mergeWith({ 'a': { 'b': [0, 1] } }, { 'a': { 'b': [2] } }, function(a, b) {
        return lodashStable.isArray(a) ? a.concat(b) : undefined;
      });

      assert.deepEqual(actual, { 'a': { 'b': [0, 1, 2] } });
    }
```

#### should pop the stack of sources for each sibling property

```ts
test('should pop the stack of sources for each sibling property', function(assert) {
      assert.expect(1);

      var array = ['b', 'c'],
          object = { 'a': ['a'] },
          source = { 'a': array, 'b': array };

      var actual = _.mergeWith(object, source, function(a, b) {
        return lodashStable.isArray(a) ? a.concat(b) : undefined;
      });

      assert.deepEqual(actual, { 'a': ['a', 'b', 'c'], 'b': ['b', 'c'] });
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

#### should return `undefined` for empty collections

```ts
test('should return `undefined` for empty collections', function(assert) {
      assert.expect(1);

      var values = falsey.concat([[]]),
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(value, index) {
        try {
          return index ? _.min(value) : _.min();
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not error for non-object `options` values

```ts
test('should not error for non-object `options` values', function(assert) {
      assert.expect(2);

      var pass = true;

      try {
        _.mixin({}, source, 1);
      } catch (e) {
        pass = false;
      }
      assert.ok(pass);

      pass = true;

      try {
        _.mixin(source, 1);
      } catch (e) {
        pass = false;
      }
      assert.ok(pass);

      reset(_);
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

#### should transform each argument

```ts
test('should transform each argument', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, doubled, square);
      assert.deepEqual(over(5, 10), [10, 100]);
    }
```

#### should flatten `transforms`

```ts
test('should flatten `transforms`', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, [doubled, square], String);
      assert.deepEqual(over(5, 10, 15), [10, 100, '15']);
    }
```

#### should not transform any argument greater than the number of transforms

```ts
test('should not transform any argument greater than the number of transforms', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn, doubled, square);
      assert.deepEqual(over(5, 10, 18), [10, 100, 18]);
    }
```

#### should not transform any arguments if no transforms are given

```ts
test('should not transform any arguments if no transforms are given', function(assert) {
      assert.expect(1);

      var over = _.overArgs(fn);
      assert.deepEqual(over(5, 10, 18), [5, 10, 18]);
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

#### should use `this` binding of function for `transforms`

```ts
test('should use `this` binding of function for `transforms`', function(assert) {
      assert.expect(1);

      var over = _.overArgs(function(x) {
        return this[x];
      }, function(x) {
        return this === x;
      });

      var object = { 'over': over, 'true': 1 };
      assert.strictEqual(object.over(object), 1);
    }
```

#### should return `undefined` for empty arrays

```ts
test('should return `undefined` for empty arrays', function(assert) {
      assert.expect(1);

      var values = [null, undefined, []],
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(array) {
        return _.nth(array, 1);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `undefined` for non-indexes

```ts
test('should return `undefined` for non-indexes', function(assert) {
      assert.expect(1);

      var array = [1, 2],
          values = [Infinity, array.length],
          expected = lodashStable.map(values, noop);

      array[-1] = 3;

      var actual = lodashStable.map(values, function(n) {
        return _.nth(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return `undefined` for empty arrays

```ts
test('should return `undefined` for empty arrays', function(assert) {
      assert.expect(1);

      var func = _.nthArg(1);
      assert.strictEqual(func(), undefined);
    }
```

#### should return `undefined` for non-indexes

```ts
test('should return `undefined` for non-indexes', function(assert) {
      assert.expect(1);

      var values = [Infinity, args.length],
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(n) {
        var func = _.nthArg(n);
        return func.apply(undefined, args);
      });

      assert.deepEqual(actual, expected);
    }
```

#### Security: _.omit should not allow modifying prototype or constructor properties

```ts
test('Security: _.omit should not allow modifying prototype or constructor properties', function(assert) {
      assert.expect(3);

      var testObj1 = {};
      assert.strictEqual(typeof testObj1.toString, 'function', 'Object.toString should work before omit');

      _.omit({}, ['__proto__.toString']);
      _.omit({}, ['constructor.prototype.toString']);
      _.omit({}, [['constructor'], ['prototype'], ['toString']]);

      var testObj2 = {};
      assert.strictEqual(typeof testObj2.toString, 'function', 'Object.toString should still work after omit');
      assert.strictEqual(objectProto.toString.call({}), '[object Object]', 'Object.toString should behave as expected');
    }
```

#### should use `this` binding of function for `iteratees`

```ts
test('should use `this` binding of function for `iteratees`', function(assert) {
      assert.expect(1);

      var over = _.over(function() { return this.b; }, function() { return this.a; }),
          object = { 'over': over, 'a': 1, 'b': 2 };

      assert.deepEqual(object.over(), [2, 1]);
    }
```

#### should use `this` binding of function for `predicates`

```ts
test('should use `this` binding of function for `predicates`', function(assert) {
      assert.expect(2);

      var over = _.overEvery(function() { return this.b; }, function() { return this.a; }),
          object = { 'over': over, 'a': 1, 'b': 2 };

      assert.strictEqual(object.over(), true);

      object.a = 0;
      assert.strictEqual(object.over(), false);
    }
```

#### should use `this` binding of function for `predicates`

```ts
test('should use `this` binding of function for `predicates`', function(assert) {
      assert.expect(2);

      var over = _.overSome(function() { return this.b; }, function() { return this.a; }),
          object = { 'over': over, 'a': 1, 'b': 2 };

      assert.strictEqual(object.over(), true);

      object.a = object.b = 0;
      assert.strictEqual(object.over(), false);
    }
```

#### should use a radix of `10`, for non-hexadecimals, if `radix` is `undefined` or `0`

```ts
test('should use a radix of `10`, for non-hexadecimals, if `radix` is `undefined` or `0`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.parseInt('10'), 10);
      assert.strictEqual(_.parseInt('10', 0), 10);
      assert.strictEqual(_.parseInt('10', 10), 10);
      assert.strictEqual(_.parseInt('10', undefined), 10);
    }
```

#### should use a radix of `16`, for hexadecimals, if `radix` is `undefined` or `0`

```ts
test('should use a radix of `16`, for hexadecimals, if `radix` is `undefined` or `0`', function(assert) {
      assert.expect(8);

      lodashStable.each(['0x20', '0X20'], function(string) {
        assert.strictEqual(_.parseInt(string), 32);
        assert.strictEqual(_.parseInt(string, 0), 32);
        assert.strictEqual(_.parseInt(string, 16), 32);
        assert.strictEqual(_.parseInt(string, undefined), 32);
      });
    }
```

#### should use a radix of `10` for string with leading zeros

```ts
test('should use a radix of `10` for string with leading zeros', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.parseInt('08'), 8);
      assert.strictEqual(_.parseInt('08', 10), 8);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(2);

      var strings = lodashStable.map(['6', '08', '10'], Object),
          actual = lodashStable.map(strings, _.parseInt);

      assert.deepEqual(actual, [6, 8, 10]);

      actual = lodashStable.map('123', _.parseInt);
      assert.deepEqual(actual, [1, 2, 3]);
    }
```

#### `_.' + methodName + '` should clone metadata for created functions

```ts
test('`_.' + methodName + '` should clone metadata for created functions', function(assert) {
      assert.expect(3);

      function greet(greeting, name) {
        return greeting + ' ' + name;
      }

      var par1 = func(greet, 'hi'),
          par2 = func(par1, 'barney'),
          par3 = func(par1, 'pebbles');

      assert.strictEqual(par1('fred'), isPartial ? 'hi fred' : 'fred hi');
      assert.strictEqual(par2(), isPartial ? 'hi barney'  : 'barney hi');
      assert.strictEqual(par3(), isPartial ? 'hi pebbles' : 'pebbles hi');
    }
```

#### should work with a number for `predicate`

```ts
test('should work with a number for `predicate`', function(assert) {
      assert.expect(2);

      var array = [
        [1, 0],
        [0, 1],
        [1, 0]
      ];

      assert.deepEqual(_.partition(array, 0), [[array[0], array[2]], [array[1]]]);
      assert.deepEqual(_.partition(array, 1), [[array[1]], [array[0], array[2]]]);
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = _.partition({ 'a': 1.1, 'b': 0.2, 'c': 1.3 }, Math.floor);
      assert.deepEqual(actual, [[1.1, 1.3], [0.2]]);
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

#### should work with the same value for `array` and `values`

```ts
test('should work with the same value for `array` and `values`', function(assert) {
      assert.expect(1);

      var array = [{ 'a': 1 }, { 'b': 2 }],
          actual = _.pullAll(array, array);

      assert.deepEqual(actual, []);
    }
```

#### should use `undefined` for nonexistent indexes

```ts
test('should use `undefined` for nonexistent indexes', function(assert) {
      assert.expect(2);

      var array = ['a', 'b', 'c'],
          actual = _.pullAt(array, [2, 4, 0]);

      assert.deepEqual(array, ['b']);
      assert.deepEqual(actual, ['c', undefined, 'a']);
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

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [1, 2, 3],
          expected = lodashStable.map(array, stubTrue),
          randoms = lodashStable.map(array, _.random);

      var actual = lodashStable.map(randoms, function(result, index) {
        return result >= 0 && result <= array[index] && (result % 1) == 0;
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.map`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          object = { 'a': 1, 'b': 2, 'c': 3 },
          expected = lodashStable.map([[0], [0, 1], [0, 1, 2]], resolve);

      lodashStable.each([array, object], function(collection) {
        var actual = lodashStable.map(collection, func);
        assert.deepEqual(actual, expected);
      });
    }
```

#### should use `undefined` for nonexistent indexes

```ts
test('should use `undefined` for nonexistent indexes', function(assert) {
      assert.expect(1);

      var rearged = _.rearg(fn, [1, 4]);
      assert.deepEqual(rearged('b', 'a', 'c'), ['a', undefined, 'c']);
    }
```

#### should use `undefined` for non-index values

```ts
test('should use `undefined` for non-index values', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(empties, function(value) {
        return (value === 0) || lodashStable.isArray(value);
      }).concat(-1, 1.1);

      var expected = lodashStable.map(values, lodashStable.constant([undefined, 'b', 'c']));

      var actual = lodashStable.map(values, function(value) {
        var rearged = _.rearg(fn, [value]);
        return rearged('a', 'b', 'c');
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return `undefined` for empty collections when no `accumulator` is given (test in IE > 9 and modern browsers)

```ts
test('`_.' + methodName + '` should return `undefined` for empty collections when no `accumulator` is given (test in IE > 9 and modern browsers)', function(assert) {
      assert.expect(2);

      var array = [],
          object = { '0': 1, 'length': 0 };

      if ('__proto__' in array) {
        array.__proto__ = object;
        assert.strictEqual(func(array, noop), undefined);
      }
      else {
        skipAssert(assert);
      }
      assert.strictEqual(func(object, noop), undefined);
    }
```

#### should return elements the `predicate` returns falsey for

```ts
test('should return elements the `predicate` returns falsey for', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.reject(array, isEven), [1, 3]);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(['a', 'b', 'c'], _.repeat);
      assert.deepEqual(actual, ['a', 'b', 'c']);
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

#### should treat `start` as `0` for `NaN` or negative values

```ts
test('should treat `start` as `0` for `NaN` or negative values', function(assert) {
      assert.expect(1);

      var values = [-1, NaN, 'a'],
          expected = lodashStable.map(values, lodashStable.constant([[1, 2, 3, 4]]));

      var actual = lodashStable.map(values, function(value) {
        var rest = _.rest(fn, value);
        return rest(1, 2, 3, 4);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should not return `NaN` for large `precision` values

```ts
test('`_.' + methodName + '` should not return `NaN` for large `precision` values', function(assert) {
      assert.expect(1);

      var results = [
        _.round(10.0000001, 1000),
        _.round(MAX_SAFE_INTEGER, 293)
      ];

      var expected = lodashStable.map(results, stubFalse),
          actual = lodashStable.map(results, lodashStable.isNaN);

      assert.deepEqual(actual, expected);
    }
```

#### should return `undefined` when sampling empty collections

```ts
test('should return `undefined` when sampling empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, noop);

      var actual = lodashStable.transform(empties, function(result, value) {
        try {
          result.push(_.sample(value));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return an empty array for empty collections

```ts
test('should return an empty array for empty collections', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubArray);

      var actual = lodashStable.transform(empties, function(result, value) {
        try {
          result.push(_.sampleSize(value, 1));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([['a']], _.sampleSize);
      assert.deepEqual(actual, [['a']]);
    }
```

#### `_.' + methodName + '` should not create an array for missing non-index property names that start with numbers

```ts
test('`_.' + methodName + '` should not create an array for missing non-index property names that start with numbers', function(assert) {
      assert.expect(1);

      var object = {};

      func(object, ['1a', '2b', '3c'], updater);
      assert.deepEqual(object, { '1a': { '2b': { '3c': value } } });
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.shuffle(1), []);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(2);

      var array = [[1], [2, 3]],
          actual = lodashStable.map(array, _.slice);

      assert.deepEqual(actual, array);
      assert.notStrictEqual(actual, array);
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

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([[1]], _.some);
      assert.deepEqual(actual, [true]);
    }
```

#### should work with an object for `collection`

```ts
test('should work with an object for `collection`', function(assert) {
      assert.expect(1);

      var actual = _.sortBy({ 'a': 1, 'b': 2, 'c': 3 }, Math.sin);
      assert.deepEqual(actual, [3, 1, 2]);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.sortBy(1), []);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map([[2, 1, 3], [3, 2, 1]], _.sortBy);
      assert.deepEqual(actual, [[1, 2, 3], [1, 2, 3]]);
    }
```

#### `_.' + methodName + '` should perform a stable sort (test in IE > 8 and V8)

```ts
test('`_.' + methodName + '` should perform a stable sort (test in IE > 8 and V8)', function(assert) {
      assert.expect(2);

      lodashStable.each([stableArray, stableObject], function(value, index) {
        var actual = func(value, ['a', 'c']);
        assert.deepEqual(actual, stableArray, index ? 'object' : 'array');
      });
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.reduce`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.reduce`', function(assert) {
      assert.expect(3);

      var objects = [
        { 'a': 'x', '0': 3 },
        { 'a': 'y', '0': 4 },
        { 'a': 'x', '0': 1 },
        { 'a': 'y', '0': 2 }
      ];

      var funcs = [func, lodashStable.partialRight(func, 'bogus')];

      lodashStable.each(['a', 0, [0]], function(props, index) {
        var expected = lodashStable.map(funcs, lodashStable.constant(
          index
            ? [objects[2], objects[3], objects[0], objects[1]]
            : [objects[0], objects[2], objects[1], objects[3]]
        ));

        var actual = lodashStable.map(funcs, function(func) {
          return lodashStable.reduce([props], func, objects);
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should align with `_.sortBy` for nulls

```ts
test('`_.' + methodName + '` should align with `_.sortBy` for nulls', function(assert) {
      assert.expect(3);

      var array = [null, null];

      assert.strictEqual(func(array, null), isSortedIndex ? 0 : 2);
      assert.strictEqual(func(array, 1), 0);
      assert.strictEqual(func(array, 'a'), 0);
    }
```

#### `_.' + methodName + '` should align with `_.sortBy` for symbols

```ts
test('`_.' + methodName + '` should align with `_.sortBy` for symbols', function(assert) {
      assert.expect(3);

      var symbol1 = Symbol ? Symbol('a') : null,
          symbol2 = Symbol ? Symbol('b') : null,
          symbol3 = Symbol ? Symbol('c') : null,
          array = [symbol1, symbol2];

      assert.strictEqual(func(array, symbol3), isSortedIndex ? 0 : 2);
      assert.strictEqual(func(array, 1), 0);
      assert.strictEqual(func(array, 'a'), 0);
    }
```

#### `_.' + methodName + '` should perform a binary search

```ts
test('`_.' + methodName + '` should perform a binary search', function(assert) {
      assert.expect(1);

      var sorted = [4, 4, 5, 5, 6, 6];
      assert.deepEqual(func(sorted, 5), isSortedIndexOf ? 2 : 3);
    }
```

#### should return an array containing an empty string for empty values

```ts
test('should return an array containing an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, lodashStable.constant(['']));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.split(value) : _.split();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var strings = ['abc', 'def', 'ghi'],
          actual = lodashStable.map(strings, _.split);

      assert.deepEqual(actual, [['abc'], ['def'], ['ghi']]);
    }
```

#### should treat `start` as `0` for negative or `NaN` values

```ts
test('should treat `start` as `0` for negative or `NaN` values', function(assert) {
      assert.expect(1);

      var values = [-1, NaN, 'a'],
          expected = lodashStable.map(values, lodashStable.constant([1, 2]));

      var actual = lodashStable.map(values, function(value) {
        var spread = _.spread(fn, value);
        return spread([1, 2]);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
          actual = lodashStable.map(array, _.take);

      assert.deepEqual(actual, [[1], [4], [7]]);
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

#### should forbid code injection through the "variable" options

```ts
test('should forbid code injection through the "variable" options', function(assert) {
      assert.expect(1);

      assert.raises(function() {
        _.template('', { 'variable': '){console.log(process.env)}; with(obj' });
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

#### should match delimiters before escaping text

```ts
test('should match delimiters before escaping text', function(assert) {
      assert.expect(1);

      var compiled = _.template('<<\n a \n>>', { 'evaluate': /<<(.*?)>>/g });
      assert.strictEqual(compiled(), '<<\n a \n>>');
    }
```

#### should return an empty string for empty values

```ts
test('should return an empty string for empty values', function(assert) {
      assert.expect(1);

      var values = [, null, undefined, ''],
          expected = lodashStable.map(values, stubString),
          data = { 'a': 1 };

      var actual = lodashStable.map(values, function(value, index) {
        var compiled = index ? _.template(value) : _.template();
        return compiled(data);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not error for non-object `data` and `options` values

```ts
test('should not error for non-object `data` and `options` values', function(assert) {
      assert.expect(2);

      _.template('')(1);
      assert.ok(true, '`data` value');

      _.template('', 1)(1);
      assert.ok(true, '`options` value');
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = ['<%= a %>', '<%- b %>', '<% print(c) %>'],
          compiles = lodashStable.map(array, _.template),
          data = { 'a': 'one', 'b': '"two"', 'c': 'three' };

      var actual = lodashStable.map(compiles, function(compiled) {
        return compiled(data);
      });

      assert.deepEqual(actual, ['one', '&quot;two&quot;', 'three']);
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

#### `_.' + methodName + '` should not error for non-object `options` values

```ts
test('`_.' + methodName + '` should not error for non-object `options` values', function(assert) {
      assert.expect(1);

      func(noop, 32, 1);
      assert.ok(true);
    }
```

#### should return an empty array for falsey and negative `n` values

```ts
test('should return an empty array for falsey and negative `n` values', function(assert) {
      assert.expect(1);

      var values = falsey.concat(-1, -Infinity),
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.times(value) : _.times();
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with a node list for `collection`

```ts
test('`_.' + methodName + '` should work with a node list for `collection`', function(assert) {
      assert.expect(1);

      if (document) {
        try {
          var actual = func(document.getElementsByTagName('body'));
        } catch (e) {}

        assert.deepEqual(actual, [body]);
      }
      else {
        skipAssert(assert);
      }
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

#### should create regular arrays from typed arrays

```ts
test('should create regular arrays from typed arrays', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(typedArrays, stubTrue);

      var actual = lodashStable.map(typedArrays, function(type) {
        var Ctor = root[type],
            array = Ctor ? new Ctor(new ArrayBuffer(24)) : [];

        return lodashStable.isArray(_.transform(array, noop));
      });

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

#### should treat sparse arrays as dense

```ts
test('should treat sparse arrays as dense', function(assert) {
      assert.expect(1);

      var actual = _.transform(Array(1), function(result, value, index) {
        result[index] = String(value);
      });

      assert.deepEqual(actual, ['undefined']);
    }
```

#### should work without an `iteratee`

```ts
test('should work without an `iteratee`', function(assert) {
      assert.expect(1);

      assert.ok(_.transform(new Foo) instanceof Foo);
    }
```

#### should ensure `object` is an object before using its `[[Prototype]]`

```ts
test('should ensure `object` is an object before using its `[[Prototype]]`', function(assert) {
      assert.expect(2);

      var Ctors = [Boolean, Boolean, Number, Number, Number, String, String],
          values = [false, true, 0, 1, NaN, '', 'a'],
          expected = lodashStable.map(values, stubObject);

      var results = lodashStable.map(values, function(value) {
        return _.transform(value);
      });

      assert.deepEqual(results, expected);

      expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(results, function(value, index) {
        return value instanceof Ctors[index];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should ensure `object` constructor is a function before using its `[[Prototype]]`

```ts
test('should ensure `object` constructor is a function before using its `[[Prototype]]`', function(assert) {
      assert.expect(1);

      Foo.prototype.constructor = null;
      assert.notOk(_.transform(new Foo) instanceof Foo);
      Foo.prototype.constructor = Foo;
    }
```

#### should create an empty object when given a falsey `object`

```ts
test('should create an empty object when given a falsey `object`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubObject);

      var actual = lodashStable.map(falsey, function(object, index) {
        return index ? _.transform(object) : _.transform();
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

#### `_.' + methodName + '` should return an empty string for empty values and `chars`

```ts
test('`_.' + methodName + '` should return an empty string for empty values and `chars`', function(assert) {
      assert.expect(6);

      lodashStable.each([null, '_-'], function(chars) {
        assert.strictEqual(func(null, chars), '');
        assert.strictEqual(func(undefined, chars), '');
        assert.strictEqual(func('', chars), '');
      });
    }
```

#### `_.' + methodName + '` should work with `undefined` or empty string values for `chars`

```ts
test('`_.' + methodName + '` should work with `undefined` or empty string values for `chars`', function(assert) {
      assert.expect(2);

      var string = whitespace + 'a b c' + whitespace,
          expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

      assert.strictEqual(func(string, undefined), expected);
      assert.strictEqual(func(string, ''), string);
    }
```

#### `_.' + methodName + '` should work as an iteratee for methods like `_.map`

```ts
test('`_.' + methodName + '` should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var string = Object(whitespace + 'a b c' + whitespace),
          trimmed = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : ''),
          actual = lodashStable.map([string, string, string], func);

      assert.deepEqual(actual, [trimmed, trimmed, trimmed]);
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

#### should account for combining diacritical marks

```ts
test('should account for combining diacritical marks', function(assert) {
      assert.expect(1);

      var values = lodashStable.map(comboMarks, function(mark) {
        return 'o' + mark;
      });

      var expected = lodashStable.map(values, function(value) {
        return [1, [value], [value]];
      });

      var actual = lodashStable.map(values, function(value) {
        return [_.size(value), _.toArray(value), _.words(value)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should account for fitzpatrick modifiers

```ts
test('should account for fitzpatrick modifiers', function(assert) {
      assert.expect(1);

      var values = lodashStable.map(fitzModifiers, function(modifier) {
        return thumbsUp + modifier;
      });

      var expected = lodashStable.map(values, function(value) {
        return [1, [value], [value]];
      });

      var actual = lodashStable.map(values, function(value) {
        return [_.size(value), _.toArray(value), _.words(value)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should account for regional symbols

```ts
test('should account for regional symbols', function(assert) {
      assert.expect(6);

      var pair = flag.match(/\ud83c[\udde6-\uddff]/g),
          regionals = pair.join(' ');

      assert.strictEqual(_.size(flag), 1);
      assert.strictEqual(_.size(regionals), 3);

      assert.deepEqual(_.toArray(flag), [flag]);
      assert.deepEqual(_.toArray(regionals), [pair[0], ' ', pair[1]]);

      assert.deepEqual(_.words(flag), [flag]);
      assert.deepEqual(_.words(regionals), [pair[0], pair[1]]);
    }
```

#### should account for variation selectors

```ts
test('should account for variation selectors', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.size(heart), 1);
      assert.deepEqual(_.toArray(heart), [heart]);
      assert.deepEqual(_.words(heart), [heart]);
    }
```

#### should account for variation selectors with fitzpatrick modifiers

```ts
test('should account for variation selectors with fitzpatrick modifiers', function(assert) {
      assert.expect(1);

      var values = lodashStable.map(fitzModifiers, function(modifier) {
        return raisedHand + modifier;
      });

      var expected = lodashStable.map(values, function(value) {
        return [1, [value], [value]];
      });

      var actual = lodashStable.map(values, function(value) {
        return [_.size(value), _.toArray(value), _.words(value)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not force a minimum argument count

```ts
test('should not force a minimum argument count', function(assert) {
      assert.expect(1);

      var capped = _.unary(fn);
      assert.deepEqual(capped(), []);
    }
```

#### should perform an unsorted uniq when used as an iteratee for methods like `_.map`

```ts
test('should perform an unsorted uniq when used as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var array = [[2, 1, 2], [1, 2, 1]],
          actual = lodashStable.map(array, lodashStable.uniq);

      assert.deepEqual(actual, [[2, 1], [1, 2]]);
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

#### should return `false` for non-configurable properties

```ts
test('should return `false` for non-configurable properties', function(assert) {
      assert.expect(1);

      var object = {};

      if (!isStrict) {
        defineProperty(object, 'a', {
          'configurable': false,
          'enumerable': true,
          'writable': true,
          'value': 1,
        });
        assert.strictEqual(_.unset(object, 'a'), false);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### Security: _.unset should not allow modifying prototype or constructor properties

```ts
test('Security: _.unset should not allow modifying prototype or constructor properties', function(assert) {
      assert.expect(6);

      var testStr1 = 'ABC';
      assert.strictEqual(typeof testStr1.toLowerCase, 'function', 'String.toLowerCase should exist before unset');

      _.unset({ foo: 'bar' }, 'foo.__proto__.toLowerCase');
      _.unset({ foo: 'bar' }, 'foo.constructor.prototype.toLowerCase');
      _.unset({ foo: 'bar' }, [['foo'], ['__proto__'], ['toLowerCase']]);
      _.unset({ foo: 'bar' }, [['foo'], ['constructor'], ['prototype'], ['toLowerCase']]);
      _.unset({ foo: 'bar' }, ['foo', ['__proto__'], 'toLowerCase']);

      var testStr2 = 'ABC';
      assert.strictEqual(typeof testStr2.toLowerCase, 'function', 'String.toLowerCase should still exist after unset');
      assert.strictEqual(testStr2.toLowerCase(), 'abc', 'String.toLowerCase should work as expected');

      objectProto.foo = 'bar';
      _.unset({}, [['__proto__'], ['foo']]);
      assert.strictEqual(objectProto.foo, 'bar', '__proto__ access via array-wrapped segments should be blocked');
      delete objectProto.foo;

      assert.strictEqual(typeof funcProto.apply, 'function', 'Function.prototype.apply should exist before unset');

      _.unset(0, 'constructor.prototype.toString.constructor.prototype.apply');
      _.unset(0, ['constructor', 'prototype', 'toString', 'constructor', 'prototype', 'apply']);

      assert.strictEqual(typeof funcProto.apply, 'function', 'Function.prototype.apply should not be deletable via deep constructor.prototype chain');
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

#### should perform a basic unzip when `iteratee` is nullish

```ts
test('should perform a basic unzip when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array = [[1, 3], [2, 4]],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant(_.unzip(array)));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.unzipWith(array, value) : _.unzipWith(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work with compound words

```ts
test('should work with compound words', function(assert) {
      assert.expect(12);

      assert.deepEqual(_.words('12ft'), ['12', 'ft']);
      assert.deepEqual(_.words('aeiouAreVowels'), ['aeiou', 'Are', 'Vowels']);
      assert.deepEqual(_.words('enable 6h format'), ['enable', '6', 'h', 'format']);
      assert.deepEqual(_.words('enable 24H format'), ['enable', '24', 'H', 'format']);
      assert.deepEqual(_.words('isISO8601'), ['is', 'ISO', '8601']);
      assert.deepEqual(_.words('LETTERSAeiouAreVowels'), ['LETTERS', 'Aeiou', 'Are', 'Vowels']);
      assert.deepEqual(_.words('tooLegit2Quit'), ['too', 'Legit', '2', 'Quit']);
      assert.deepEqual(_.words('walk500Miles'), ['walk', '500', 'Miles']);
      assert.deepEqual(_.words('xhr2Request'), ['xhr', '2', 'Request']);
      assert.deepEqual(_.words('XMLHttp'), ['XML', 'Http']);
      assert.deepEqual(_.words('XmlHTTP'), ['Xml', 'HTTP']);
      assert.deepEqual(_.words('XmlHttp'), ['Xml', 'Http']);
    }
```

#### should work as an iteratee for methods like `_.map`

```ts
test('should work as an iteratee for methods like `_.map`', function(assert) {
      assert.expect(1);

      var strings = lodashStable.map(['a', 'b', 'c'], Object),
          actual = lodashStable.map(strings, _.words);

      assert.deepEqual(actual, [['a'], ['b'], ['c']]);
    }
```

#### `_.' + methodName + '` should work when in a lazy sequence before `head` or `last`

```ts
test('`_.' + methodName + '` should work when in a lazy sequence before `head` or `last`', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE + 1),
            wrapped = _(array).slice(1)[methodName]([LARGE_ARRAY_SIZE, LARGE_ARRAY_SIZE + 1]);

        var actual = lodashStable.map(['head', 'last'], function(methodName) {
          return wrapped[methodName]();
        });

        assert.deepEqual(actual, [1, LARGE_ARRAY_SIZE + 1]);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should assign `undefined` values for extra `keys`

```ts
test('`_.' + methodName + '` should assign `undefined` values for extra `keys`', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(['a', 'b'], [1]), { 'a': 1, 'b': undefined });
    }
```

#### should perform a basic zip when `iteratee` is nullish

```ts
test('should perform a basic zip when `iteratee` is nullish', function(assert) {
      assert.expect(1);

      var array1 = [1, 2],
          array2 = [3, 4],
          values = [, null, undefined],
          expected = lodashStable.map(values, lodashStable.constant(_.zip(array1, array2)));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.zipWith(array1, array2, value) : _.zipWith(array1, array2);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should reset the iterator correctly ' + chainType, function(assert) {
      assert.expect(4);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.deepEqual(lodashStable.toArray(wrapped), array);
        assert.deepEqual(lodashStable.toArray(wrapped), [], 'produces an empty array for exhausted iterator');

        var other = wrapped.filter();
        assert.deepEqual(lodashStable.toArray(other), array, 'reset for new chain segments');
        assert.deepEqual(lodashStable.toArray(wrapped), [], 'iterator is still exhausted');
      }
      else {
        skipAssert(assert, 4);
      }
    });

    QUnit.test('should work in a lazy sequence ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            wrapped = chain(array);

        assert.deepEqual(lodashStable.toArray(wrapped), array);

        wrapped = wrapped.filter(predicate);
        assert.deepEqual(lodashStable.toArray(wrapped), _.filter(array, isEven), 'reset for new lazy chain segments');
        assert.deepEqual(values, array, 'memoizes iterator values');
      }
      else {
        skipAssert(assert, 3);
      }
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash(...).plant');

  (function() {
    QUnit.test('should clone the chained sequence planting `value` as the wrapped value

```ts
test('should reset the iterator correctly ' + chainType, function(assert) {
      assert.expect(4);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.deepEqual(lodashStable.toArray(wrapped), array);
        assert.deepEqual(lodashStable.toArray(wrapped), [], 'produces an empty array for exhausted iterator');

        var other = wrapped.filter();
        assert.deepEqual(lodashStable.toArray(other), array, 'reset for new chain segments');
        assert.deepEqual(lodashStable.toArray(wrapped), [], 'iterator is still exhausted');
      }
      else {
        skipAssert(assert, 4);
      }
    });

    QUnit.test('should work in a lazy sequence ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            wrapped = chain(array);

        assert.deepEqual(lodashStable.toArray(wrapped), array);

        wrapped = wrapped.filter(predicate);
        assert.deepEqual(lodashStable.toArray(wrapped), _.filter(array, isEven), 'reset for new lazy chain segments');
        assert.deepEqual(values, array, 'memoizes iterator values');
      }
      else {
        skipAssert(assert, 3);
      }
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash(...).plant');

  (function() {
    QUnit.test('should clone the chained sequence planting `value` as the wrapped value', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array1 = [5, null, 3, null, 1],
            array2 = [10, null, 8, null, 6],
            wrapped1 = _(array1).thru(_.compact).map(square).takeRight(2).sort(),
            wrapped2 = wrapped1.plant(array2);

        assert.deepEqual(wrapped2.value(), [36, 64]);
        assert.deepEqual(wrapped1.value(), [1, 9]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### `_.' + methodName + '` should return an empty string for empty values

```ts
test('`_.' + methodName + '` should return an empty string for empty values', function(assert) {
        assert.expect(1);

        var values = [, null, undefined, ''],
            expected = lodashStable.map(values, stubString);

        var actual = lodashStable.map(values, function(value, index) {
          return index ? func(value) : func();
        });

        assert.deepEqual(actual, expected);
      }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(316);

      var arrays = lodashStable.map(falsey, stubArray);

      lodashStable.each(acceptFalsey, function(methodName) {
        var expected = arrays,
            func = _[methodName];

        var actual = lodashStable.map(falsey, function(value, index) {
          return index ? func(value) : func();
        });

        if (methodName == 'noConflict') {
          root._ = oldDash;
        }
        else if (methodName == 'pull' || methodName == 'pullAll') {
          expected = falsey;
        }
        if (lodashStable.includes(returnArrays, methodName) && methodName != 'sample') {
          assert.deepEqual(actual, expected, '_.' + methodName + ' returns an array');
        }
        assert.ok(true, '`_.' + methodName + '` accepts falsey arguments');
      });

      // Skip tests for missing methods of modularized builds.
      lodashStable.each(['chain', 'noConflict', 'runInContext'], function(methodName) {
        if (!_[methodName]) {
          skipAssert(assert);
        }
      });
    }
```

#### should throw an error for falsey arguments

```ts
test('should throw an error for falsey arguments', function(assert) {
      assert.expect(24);

      lodashStable.each(rejectFalsey, function(methodName) {
        var expected = lodashStable.map(falsey, stubTrue),
            func = _[methodName];

        var actual = lodashStable.map(falsey, function(value, index) {
          var pass = !index && /^(?:backflow|compose|cond|flow(Right)?|over(?:Every|Some)?)$/.test(methodName);

          try {
            index ? func(value) : func();
          } catch (e) {
            pass = !pass && (e instanceof TypeError) &&
              (!lodashStable.includes(checkFuncs, methodName) || (e.message == FUNC_ERROR_TEXT));
          }
          return pass;
        });

        assert.deepEqual(actual, expected, '`_.' + methodName + '` rejects falsey arguments');
      });
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

#### methods

```ts
test('methods', function(assert) {
    assert.strictEqual(_.methods, _.functions, 'is an alias for functions');
  }
```

#### assign

```ts
test('assign', function(assert) {
    assert.strictEqual(_.assign, _.extendOwn, 'is an alias for extendOwn');
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

#### matches

```ts
test('matches', function(assert) {
    assert.strictEqual(_.matches, _.matcher, 'is an alias for matcher');
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

### ../../.sbomtest/repos/f3c62de455-express/test/res.json.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/res.links.js

#### should set Link header field for multiple calls

```ts
it('should set Link header field for multiple calls', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.links({
          next: 'http://api.example.com/users?page=2',
          last: 'http://api.example.com/users?page=5'
        });

        res.links({
          prev: 'http://api.example.com/users?page=1'
        });

        res.end();
      });

      request(app)
      .get('/')
      .expect('Link', '<http://api.example.com/users?page=2>; rel="next", <http://api.example.com/users?page=5>; rel="last", <http://api.example.com/users?page=1>; rel="prev"')
      .expect(200, done);
    }
```

#### should set multiple links for single rel

```ts
it('should set multiple links for single rel', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.links({
          next: 'http://api.example.com/users?page=2',
          last: ['http://api.example.com/users?page=5', 'http://api.example.com/users?page=1']
        });

        res.end();
      });

      request(app)
      .get('/')
      .expect('Link', '<http://api.example.com/users?page=2>; rel="next", <http://api.example.com/users?page=5>; rel="last", <http://api.example.com/users?page=1>; rel="last"')
      .expect(200, done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/utility.js

#### property

```ts
test('property', function(assert) {
    var stooge = {name: 'moe'};
    assert.equal(_.property('name')(stooge), 'moe', 'should return the property with the given name');
    assert.equal(_.property('name')(null), void 0, 'should return undefined for null values');
    assert.equal(_.property('name')(void 0), void 0, 'should return undefined for undefined values');
  }
```

#### propertyOf

```ts
test('propertyOf', function(assert) {
    var stoogeRanks = _.propertyOf({curly: 2, moe: 1, larry: 3});
    assert.equal(stoogeRanks('curly'), 2, 'should return the property with the given name');
    assert.equal(stoogeRanks(null), void 0, 'should return undefined for null values');
    assert.equal(stoogeRanks(void 0), void 0, 'should return undefined for undefined values');

    function MoreStooges() { this.shemp = 87; }
    MoreStooges.prototype = {curly: 2, moe: 1, larry: 3};
    var moreStoogeRanks = _.propertyOf(new MoreStooges());
    assert.equal(moreStoogeRanks('curly'), 2, 'should return properties from further up the prototype chain');

    var nullPropertyOf = _.propertyOf(null);
    assert.equal(nullPropertyOf('curly'), void 0, 'should return undefined when obj is null');

    var undefPropertyOf = _.propertyOf(void 0);
    assert.equal(undefPropertyOf('curly'), void 0, 'should return undefined when obj is undefined');
  }
```

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/collections.js

#### forEach

```ts
test('forEach', function(assert) {
    assert.strictEqual(_.forEach, _.each, 'is an alias for each');
  }
```

#### collect

```ts
test('collect', function(assert) {
    assert.strictEqual(_.collect, _.map, 'is an alias for map');
  }
```

#### foldl

```ts
test('foldl', function(assert) {
    assert.strictEqual(_.foldl, _.reduce, 'is an alias for reduce');
  }
```

#### inject

```ts
test('inject', function(assert) {
    assert.strictEqual(_.inject, _.reduce, 'is an alias for reduce');
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

#### foldr

```ts
test('foldr', function(assert) {
    assert.strictEqual(_.foldr, _.reduceRight, 'is an alias for reduceRight');
  }
```

#### detect

```ts
test('detect', function(assert) {
    assert.strictEqual(_.detect, _.find, 'is an alias for find');
  }
```

#### select

```ts
test('select', function(assert) {
    assert.strictEqual(_.select, _.filter, 'is an alias for filter');
  }
```

#### all

```ts
test('all', function(assert) {
    assert.strictEqual(_.all, _.every, 'is an alias for every');
  }
```

#### any

```ts
test('any', function(assert) {
    assert.strictEqual(_.any, _.some, 'is an alias for some');
  }
```

#### include

```ts
test('include', function(assert) {
    assert.strictEqual(_.include, _.includes, 'is an alias for includes');
  }
```

#### contains

```ts
test('contains', function(assert) {
    assert.strictEqual(_.contains, _.includes, 'is an alias for includes');

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

#### groupBy

```ts
test('groupBy', function(assert) {
    var parity = _.groupBy([1, 2, 3, 4, 5, 6], function(num){ return num % 2; });
    assert.ok('0' in parity && '1' in parity, 'created a group for each value');
    assert.deepEqual(parity[0], [2, 4, 6], 'put each even number in the right group');

    var list = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    var grouped = _.groupBy(list, 'length');
    assert.deepEqual(grouped['3'], ['one', 'two', 'six', 'ten']);
    assert.deepEqual(grouped['4'], ['four', 'five', 'nine']);
    assert.deepEqual(grouped['5'], ['three', 'seven', 'eight']);

    var context = {};
    _.groupBy([{}], function(){ assert.strictEqual(this, context); }, context);

    grouped = _.groupBy([4.2, 6.1, 6.4], function(num) {
      return Math.floor(num) > 4 ? 'hasOwnProperty' : 'constructor';
    });
    assert.equal(grouped.constructor.length, 1);
    assert.equal(grouped.hasOwnProperty.length, 2);

    var array = [{}];
    _.groupBy(array, function(value, index, obj){ assert.strictEqual(obj, array); });

    array = [1, 2, 1, 2, 3];
    grouped = _.groupBy(array);
    assert.equal(grouped['1'].length, 2);
    assert.equal(grouped['3'].length, 1);

    var matrix = [
      [1, 2],
      [1, 3],
      [2, 3]
    ];
    assert.deepEqual(_.groupBy(matrix, 0), {1: [[1, 2], [1, 3]], 2: [[2, 3]]});
    assert.deepEqual(_.groupBy(matrix, 1), {2: [[1, 2]], 3: [[1, 3], [2, 3]]});
  }
```

#### shuffle

```ts
test('shuffle', function(assert) {
    assert.deepEqual(_.shuffle([1]), [1], 'behaves correctly on size 1 arrays');
    var numbers = _.range(20);
    var shuffled = _.shuffle(numbers);
    assert.notDeepEqual(numbers, shuffled, 'does change the order'); // Chance of false negative: 1 in ~2.4*10^18
    assert.notStrictEqual(numbers, shuffled, 'original object is unmodified');
    assert.deepEqual(numbers, _.sortBy(shuffled), 'contains the same members before and after shuffle');

    shuffled = _.shuffle({a: 1, b: 2, c: 3, d: 4});
    assert.equal(shuffled.length, 4);
    assert.deepEqual(shuffled.sort(), [1, 2, 3, 4], 'works on objects');
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

### ../../.sbomtest/repos/f3c62de455-express/test/acceptance/auth.js

#### should render login form

```ts
it('should render login form', function(done){
      request(app)
      .get('/login')
      .expect(200, /<form/, done)
    }
```

#### should display login error for bad user

```ts
it('should display login error for bad user', function (done) {
      request(app)
      .post('/login')
      .type('urlencoded')
      .send('username=not-tj&password=foobar')
      .expect('Location', '/login')
      .expect(302, function(err, res){
        if (err) return done(err)
        request(app)
        .get('/login')
        .set('Cookie', getCookie(res))
        .expect(200, /Authentication failed/, done)
      })
    }
```

#### should display login error for bad password

```ts
it('should display login error for bad password', function (done) {
      request(app)
        .post('/login')
        .type('urlencoded')
        .send('username=tj&password=nogood')
        .expect('Location', '/login')
        .expect(302, function (err, res) {
          if (err) return done(err)
          request(app)
            .get('/login')
            .set('Cookie', getCookie(res))
            .expect(200, /Authentication failed/, done)
        })
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### routes via navigate for backwards-compatibility

```ts
test('routes via navigate for backwards-compatibility', function(assert) {
    assert.expect(2);
    Backbone.history.navigate('search/manhattan/p20', true);
    assert.equal(router.query, 'manhattan');
    assert.equal(router.page, '20');
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

#### #3123 - History#navigate decodes before comparison.

```ts
test('#3123 - History#navigate decodes before comparison.', function(assert) {
    assert.expect(1);
    Backbone.history.stop();
    location.replace('http://example.com/shop/search?keyword=short%20dress');
    Backbone.history = _.extend(new Backbone.History, {
      location: location,
      history: {
        pushState: function() { assert.ok(false); },
        replaceState: function() { assert.ok(false); }
      }
    });
    Backbone.history.start({pushState: true});
    Backbone.history.navigate('shop/search?keyword=short%20dress', true);
    assert.strictEqual(Backbone.history.fragment, 'shop/search?keyword=short dress');
  }
```

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

## @opencode-ai/ui/icon

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/ui/tooltip

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @/context/prompt

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

