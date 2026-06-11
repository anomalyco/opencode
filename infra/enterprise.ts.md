# External tests for enterprise.ts

**Arquivo:** `infra/enterprise.ts`

## Checklist

- [ ] ./secret
- [ ] ./stage

## ./secret

**Consultas usadas no Horsebox:** `R2AccessKey.value`, `value`, `./secret value`, `secret value`, `R2AccessKey`, `./secret R2AccessKey`, `secret R2AccessKey`, `R2SecretKey.value`, `R2SecretKey`, `./secret R2SecretKey`, `secret R2SecretKey`, `SECRET`, `./secret SECRET`, `secret SECRET`

**Arquivos de teste encontrados:** 31

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/chaining.js

#### map/flatten/reduce

```ts
test('map/flatten/reduce', function(assert) {
    var lyrics = [
      'I\'m a lumberjack and I\'m okay',
      'I sleep all night and I work all day',
      'He\'s a lumberjack and he\'s okay',
      'He sleeps all night and he works all day'
    ];
    var counts = _(lyrics).chain()
      .map(function(line) { return line.split(''); })
      .flatten()
      .reduce(function(hash, l) {
        hash[l] = hash[l] || 0;
        hash[l]++;
        return hash;
      }, {})
      .value();
    assert.equal(counts.a, 16, 'counted all the letters in the song');
    assert.equal(counts.e, 10, 'counted all the letters in the song');
  }
```

#### select/reject/sortBy

```ts
test('select/reject/sortBy', function(assert) {
    var numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    numbers = _(numbers).chain().select(function(n) {
      return n % 2 === 0;
    }).reject(function(n) {
      return n % 4 === 0;
    }).sortBy(function(n) {
      return -n;
    }).value();
    assert.deepEqual(numbers, [10, 6, 2], 'filtered and reversed the numbers');
  }
```

#### select/reject/sortBy in functional style

```ts
test('select/reject/sortBy in functional style', function(assert) {
    var numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    numbers = _.chain(numbers).select(function(n) {
      return n % 2 === 0;
    }).reject(function(n) {
      return n % 4 === 0;
    }).sortBy(function(n) {
      return -n;
    }).value();
    assert.deepEqual(numbers, [10, 6, 2], 'filtered and reversed the numbers');
  }
```

#### reverse/concat/unshift/pop/map

```ts
test('reverse/concat/unshift/pop/map', function(assert) {
    var numbers = [1, 2, 3, 4, 5];
    numbers = _(numbers).chain()
      .reverse()
      .concat([5, 5, 5])
      .unshift(17)
      .pop()
      .map(function(n){ return n * 2; })
      .value();
    assert.deepEqual(numbers, [34, 10, 8, 6, 4, 2, 10, 10], 'can chain together array functions.');
  }
```

#### splice

```ts
test('splice', function(assert) {
    var instance = _([1, 2, 3, 4, 5]).chain();
    assert.deepEqual(instance.splice(1, 3).value(), [1, 5]);
    assert.deepEqual(instance.splice(1, 0).value(), [1, 5]);
    assert.deepEqual(instance.splice(1, 1).value(), [1]);
    assert.deepEqual(instance.splice(0, 1).value(), [], '#397 Can create empty array');
  }
```

#### shift

```ts
test('shift', function(assert) {
    var instance = _([1, 2, 3]).chain();
    assert.deepEqual(instance.shift().value(), [2, 3]);
    assert.deepEqual(instance.shift().value(), [3]);
    assert.deepEqual(instance.shift().value(), [], '#397 Can create empty array');
  }
```

#### pop

```ts
test('pop', function(assert) {
    var instance = _([1, 2, 3]).chain();
    assert.deepEqual(instance.pop().value(), [1, 2]);
    assert.deepEqual(instance.pop().value(), [1]);
    assert.deepEqual(instance.pop().value(), [], '#397 Can create empty array');
  }
```

#### chaining works in small stages

```ts
test('chaining works in small stages', function(assert) {
    var o = _([1, 2, 3, 4]).chain();
    assert.deepEqual(o.filter(function(i) { return i < 3; }).value(), [1, 2]);
    assert.deepEqual(o.filter(function(i) { return i > 2; }).value(), [3, 4]);
  }
```

#### #1562: Engine proxies for chained functions

```ts
test('#1562: Engine proxies for chained functions', function(assert) {
    var wrapped = _(512);
    assert.strictEqual(wrapped.toJSON(), 512);
    assert.strictEqual(wrapped.valueOf(), 512);
    assert.strictEqual(+wrapped, 512);
    assert.strictEqual(wrapped.toString(), '512');
    assert.strictEqual('' + wrapped, '512');
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

#### should wrap non-array items in an array

```ts
test('should wrap non-array items in an array', function(assert) {
      assert.expect(1);

      var values = falsey.concat(true, 1, 'a', { 'a': 1 }),
          expected = lodashStable.map(values, function(value) { return [value]; }),
          actual = lodashStable.map(values, _.castArray);

      assert.deepEqual(actual, expected);
    }
```

#### should return array values by reference

```ts
test('should return array values by reference', function(assert) {
      assert.expect(1);

      var array = [1];
      assert.strictEqual(_.castArray(array), array);
    }
```

#### should return a wrapped value

```ts
test('should return a wrapped value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = _.chain({ 'a': 0 });
        assert.ok(actual instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return existing wrapped values

```ts
test('should return existing wrapped values', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _({ 'a': 0 });
        assert.strictEqual(_.chain(wrapped), wrapped);
        assert.strictEqual(wrapped.chain(), wrapped);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should chain multiple methods

```ts
test('should chain multiple methods', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        lodashStable.times(2, function(index) {
          var array = ['one two three four', 'five six seven eight', 'nine ten eleven twelve'],
              expected = { ' ': 9, 'e': 14, 'f': 2, 'g': 1, 'h': 2, 'i': 4, 'l': 2, 'n': 6, 'o': 3, 'r': 2, 's': 2, 't': 5, 'u': 1, 'v': 4, 'w': 2, 'x': 1 },
              wrapped = index ? _(array).chain() : _.chain(array);

          var actual = wrapped
            .chain()
            .map(function(value) { return value.split(''); })
            .flatten()
            .reduce(function(object, chr) {
              object[chr] || (object[chr] = 0);
              object[chr]++;
              return object;
            }, {})
            .value();

          assert.deepEqual(actual, expected);

          array = [1, 2, 3, 4, 5, 6];
          wrapped = index ? _(array).chain() : _.chain(array);
          actual = wrapped
            .chain()
            .filter(function(n) { return n % 2 != 0; })
            .reject(function(n) { return n % 3 == 0; })
            .sortBy(function(n) { return -n; })
            .value();

          assert.deepEqual(actual, [5, 1]);

          array = [3, 4];
          wrapped = index ? _(array).chain() : _.chain(array);
          actual = wrapped
            .reverse()
            .concat([2, 1])
            .unshift(5)
            .tap(function(value) { value.pop(); })
            .map(square)
            .value();

          assert.deepEqual(actual, [25, 16, 9, 4]);
        });
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should treat falsey `size` values, except `undefined`, as `0`

```ts
test('should treat falsey `size` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? [[0], [1], [2], [3], [4], [5]] : [];
      });

      var actual = lodashStable.map(falsey, function(size, index) {
        return index ? _.chunk(array, size) : _.chunk(array);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should ensure the minimum `size` is `0`

```ts
test('should ensure the minimum `size` is `0`', function(assert) {
      assert.expect(1);

      var values = lodashStable.reject(falsey, lodashStable.isUndefined).concat(-1, -Infinity),
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(n) {
        return _.chunk(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should clone expando properties

```ts
test('`_.' + methodName + '` should clone expando properties', function(assert) {
        assert.expect(1);

        var values = lodashStable.map([false, true, 1, 'a'], function(value) {
          var object = Object(value);
          object.a = 1;
          return object;
        });

        var expected = lodashStable.map(values, stubTrue);

        var actual = lodashStable.map(values, function(value) {
          return func(value).a === 1;
        });

        assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` should clone properties that shadow those on `Object.prototype`

```ts
test('`_.' + methodName + '` should clone properties that shadow those on `Object.prototype`', function(assert) {
        assert.expect(2);

        var object = {
          'constructor': objectProto.constructor,
          'hasOwnProperty': objectProto.hasOwnProperty,
          'isPrototypeOf': objectProto.isPrototypeOf,
          'propertyIsEnumerable': objectProto.propertyIsEnumerable,
          'toLocaleString': objectProto.toLocaleString,
          'toString': objectProto.toString,
          'valueOf': objectProto.valueOf
        };

        var actual = func(object);

        assert.deepEqual(actual, object);
        assert.notStrictEqual(actual, object);
      }
```

#### `_.' + methodName + '` should clone symbol properties

```ts
test('`_.' + methodName + '` should clone symbol properties', function(assert) {
        assert.expect(7);

        function Foo() {
          this[symbol] = { 'c': 1 };
        }

        if (Symbol) {
          var symbol2 = Symbol('b');
          Foo.prototype[symbol2] = 2;

          var symbol3 = Symbol('c');
          defineProperty(Foo.prototype, symbol3, {
            'configurable': true,
            'enumerable': false,
            'writable': true,
            'value': 3
          });

          var object = { 'a': { 'b': new Foo } };
          object[symbol] = { 'b': 1 };

          var actual = func(object);
          if (isDeep) {
            assert.notStrictEqual(actual[symbol], object[symbol]);
            assert.notStrictEqual(actual.a, object.a);
          } else {
            assert.strictEqual(actual[symbol], object[symbol]);
            assert.strictEqual(actual.a, object.a);
          }
          assert.deepEqual(actual[symbol], object[symbol]);
          assert.deepEqual(getSymbols(actual.a.b), [symbol]);
          assert.deepEqual(actual.a.b[symbol], object.a.b[symbol]);
          assert.deepEqual(actual.a.b[symbol2], object.a.b[symbol2]);
          assert.deepEqual(actual.a.b[symbol3], object.a.b[symbol3]);
        }
        else {
          skipAssert(assert, 7);
        }
      }
```

#### `_.' + methodName + '` should clone symbol objects

```ts
test('`_.' + methodName + '` should clone symbol objects', function(assert) {
        assert.expect(4);

        if (Symbol) {
          assert.strictEqual(func(symbol), symbol);

          var object = Object(symbol),
              actual = func(object);

          assert.strictEqual(typeof actual, 'object');
          assert.strictEqual(typeof actual.valueOf(), 'symbol');
          assert.notStrictEqual(actual, object);
        }
        else {
          skipAssert(assert, 4);
        }
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

#### `_.' + methodName + '` should return a unwrapped value when chaining

```ts
test('`_.' + methodName + '` should return a unwrapped value when chaining', function(assert) {
        assert.expect(2);

        if (!isNpm) {
          var object = objects.objects,
              actual = _(object)[methodName]();

          assert.deepEqual(actual, object);
          assert.notStrictEqual(actual, object);
        }
        else {
          skipAssert(assert, 2);
        }
      }
```

#### `_.' + methodName + '` should clone ' + type + ' values

```ts
test('`_.' + methodName + '` should clone ' + type + ' values', function(assert) {
          assert.expect(10);

          var Ctor = root[type];

          lodashStable.times(2, function(index) {
            if (Ctor) {
              var buffer = new ArrayBuffer(24),
                  view = index ? new Ctor(buffer, 8, 1) : new Ctor(buffer),
                  actual = func(view);

              assert.deepEqual(actual, view);
              assert.notStrictEqual(actual, view);
              assert.strictEqual(actual.buffer === view.buffer, !isDeep);
              assert.strictEqual(actual.byteOffset, view.byteOffset);
              assert.strictEqual(actual.length, view.length);
            }
            else {
              skipAssert(assert, 5);
            }
          });
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

#### should filter falsey values

```ts
test('should filter falsey values', function(assert) {
      assert.expect(1);

      var array = ['0', '1', '2'];
      assert.deepEqual(_.compact(falsey.concat(array)), array);
    }
```

#### should work when in-between lazy operators

```ts
test('should work when in-between lazy operators', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var actual = _(falsey).thru(_.slice).compact().thru(_.slice).value();
        assert.deepEqual(actual, []);

        actual = _(falsey).thru(_.slice).push(true, 1).compact().push('a').value();
        assert.deepEqual(actual, [true, 1, 'a']);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = _(largeArray).slice(1).compact().reverse().take().value();
        assert.deepEqual(actual, _.take(_.compact(_.slice(largeArray, 1)).reverse()));
      }
      else {
        skipAssert(assert);
      }
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

#### should concat arrays and values

```ts
test('should concat arrays and values', function(assert) {
      assert.expect(2);

      var array = [1],
          actual = _.concat(array, 2, [3], [[4]]);

      assert.deepEqual(actual, [1, 2, 3, [4]]);
      assert.deepEqual(array, [1]);
    }
```

#### should cast non-array `array` values to arrays

```ts
test('should cast non-array `array` values to arrays', function(assert) {
      assert.expect(2);

      var values = [, null, undefined, false, true, 1, NaN, 'a'];

      var expected = lodashStable.map(values, function(value, index) {
        return index ? [value] : [];
      });

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.concat(value) : _.concat();
      });

      assert.deepEqual(actual, expected);

      expected = lodashStable.map(values, function(value) {
        return [value, 2, [3]];
      });

      actual = lodashStable.map(values, function(value) {
        return _.concat(value, [2], [[3]]);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return a new wrapped array

```ts
test('should return a new wrapped array', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = [1],
            wrapped = _(array).concat([2, 3]),
            actual = wrapped.value();

        assert.deepEqual(array, [1]);
        assert.deepEqual(actual, [1, 2, 3]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should throw a TypeError if `pairs` is not composed of functions

```ts
test('should throw a TypeError if `pairs` is not composed of functions', function(assert) {
      assert.expect(2);

      lodashStable.each([false, true], function(value) {
        assert.raises(function() { _.cond([[stubTrue, value]])(); }, TypeError);
      });
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

#### should create a function that returns `value`

```ts
test('should create a function that returns `value`', function(assert) {
      assert.expect(1);

      var object = { 'a': 1 },
          values = Array(2).concat(empties, true, 1, 'a'),
          constant = _.constant(object);

      var results = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? constant.call({}) : constant();
        }
        return constant(value);
      });

      assert.ok(lodashStable.every(results, function(result) {
        return result === object;
      }));
    }
```

#### should work with falsey values

```ts
test('should work with falsey values', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(value, index) {
        var constant = index ? _.constant(value) : _.constant(),
            result = constant();

        return (result === value) || (result !== result && value !== value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(true).constant();
        assert.ok(wrapped instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### should only add values to own, not inherited, properties

```ts
test('should only add values to own, not inherited, properties', function(assert) {
      assert.expect(2);

      var actual = _.countBy(array, function(n) {
        return Math.floor(n) > 4 ? 'hasOwnProperty' : 'constructor';
      });

      assert.deepEqual(actual.constructor, 1);
      assert.deepEqual(actual.hasOwnProperty, 2);
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

        var actual = _(array).countBy().map(square).filter(isEven).take().value();

        assert.deepEqual(actual, _.take(_.filter(_.map(_.countBy(array), square), isEven)));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should ignore a primitive `prototype` and use an empty object instead

```ts
test('should ignore a primitive `prototype` and use an empty object instead', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(primitives, stubTrue);

      var actual = lodashStable.map(primitives, function(value, index) {
        return lodashStable.isPlainObject(index ? _.create(value) : _.create());
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `arity` to an integer

```ts
test('should coerce `arity` to an integer', function(assert) {
      assert.expect(2);

      var values = ['0', 0.6, 'xyz'],
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(arity) {
        return _.curry(fn, arity)();
      });

      assert.deepEqual(actual, expected);
      assert.deepEqual(_.curry(fn, '2')(1)(2), [1, 2]);
    }
```

#### should ensure `new curried` is an instance of `func`

```ts
test('should ensure `new curried` is an instance of `func`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var curried = _.curry(Foo),
          object = {};

      assert.ok(new curried(false) instanceof Foo);
      assert.strictEqual(new curried(true), object);
    }
```

#### should use `this` binding of function

```ts
test('should use `this` binding of function', function(assert) {
      assert.expect(9);

      var fn = function(a, b, c) {
        var value = this || {};
        return [value[a], value[b], value[c]];
      };

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          expected = [1, 2, 3];

      assert.deepEqual(_.curry(_.bind(fn, object), 3)('a')('b')('c'), expected);
      assert.deepEqual(_.curry(_.bind(fn, object), 3)('a', 'b')('c'), expected);
      assert.deepEqual(_.curry(_.bind(fn, object), 3)('a', 'b', 'c'), expected);

      assert.deepEqual(_.bind(_.curry(fn), object)('a')('b')('c'), Array(3));
      assert.deepEqual(_.bind(_.curry(fn), object)('a', 'b')('c'), Array(3));
      assert.deepEqual(_.bind(_.curry(fn), object)('a', 'b', 'c'), expected);

      object.curried = _.curry(fn);
      assert.deepEqual(object.curried('a')('b')('c'), Array(3));
      assert.deepEqual(object.curried('a', 'b')('c'), Array(3));
      assert.deepEqual(object.curried('a', 'b', 'c'), expected);
    }
```

#### should coerce `arity` to an integer

```ts
test('should coerce `arity` to an integer', function(assert) {
      assert.expect(2);

      var values = ['0', 0.6, 'xyz'],
          expected = lodashStable.map(values, stubArray);

      var actual = lodashStable.map(values, function(arity) {
        return _.curryRight(fn, arity)();
      });

      assert.deepEqual(actual, expected);
      assert.deepEqual(_.curryRight(fn, '2')(1)(2), [2, 1]);
    }
```

#### should ensure `new curried` is an instance of `func`

```ts
test('should ensure `new curried` is an instance of `func`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var curried = _.curryRight(Foo),
          object = {};

      assert.ok(new curried(false) instanceof Foo);
      assert.strictEqual(new curried(true), object);
    }
```

#### should use `this` binding of function

```ts
test('should use `this` binding of function', function(assert) {
      assert.expect(9);

      var fn = function(a, b, c) {
        var value = this || {};
        return [value[a], value[b], value[c]];
      };

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          expected = [1, 2, 3];

      assert.deepEqual(_.curryRight(_.bind(fn, object), 3)('c')('b')('a'), expected);
      assert.deepEqual(_.curryRight(_.bind(fn, object), 3)('b', 'c')('a'), expected);
      assert.deepEqual(_.curryRight(_.bind(fn, object), 3)('a', 'b', 'c'), expected);

      assert.deepEqual(_.bind(_.curryRight(fn), object)('c')('b')('a'), Array(3));
      assert.deepEqual(_.bind(_.curryRight(fn), object)('b', 'c')('a'), Array(3));
      assert.deepEqual(_.bind(_.curryRight(fn), object)('a', 'b', 'c'), expected);

      object.curried = _.curryRight(fn);
      assert.deepEqual(object.curried('c')('b')('a'), Array(3));
      assert.deepEqual(object.curried('b', 'c')('a'), Array(3));
      assert.deepEqual(object.curried('a', 'b', 'c'), expected);
    }
```

#### should debounce a function

```ts
test('should debounce a function', function(assert) {
      assert.expect(6);

      var done = assert.async();

      var callCount = 0;

      var debounced = _.debounce(function(value) {
        ++callCount;
        return value;
      }, 32);

      var results = [debounced('a'), debounced('b'), debounced('c')];
      assert.deepEqual(results, [undefined, undefined, undefined]);
      assert.strictEqual(callCount, 0);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);

        var results = [debounced('d'), debounced('e'), debounced('f')];
        assert.deepEqual(results, ['c', 'c', 'c']);
        assert.strictEqual(callCount, 1);
      }, 128);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 256);
    }
```

#### should support a `maxWait` option

```ts
test('should support a `maxWait` option', function(assert) {
      assert.expect(4);

      var done = assert.async();

      var callCount = 0;

      var debounced = _.debounce(function(value) {
        ++callCount;
        return value;
      }, 32, { 'maxWait': 64 });

      debounced();
      debounced();
      assert.strictEqual(callCount, 0);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        debounced();
        debounced();
        assert.strictEqual(callCount, 1);
      }, 128);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 256);
    }
```

#### should invoke the trailing call with the correct arguments and `this` binding

```ts
test('should invoke the trailing call with the correct arguments and `this` binding', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var actual,
          callCount = 0,
          object = {};

      var debounced = _.debounce(function(value) {
        actual = [this];
        push.apply(actual, arguments);
        return ++callCount != 2;
      }, 32, { 'leading': true, 'maxWait': 64 });

      while (true) {
        if (!debounced.call(object, 'a')) {
          break;
        }
      }
      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        assert.deepEqual(actual, [object, 'a']);
        done();
      }, 64);
    }
```

#### should not overwrite `null` values

```ts
test('should not overwrite `null` values', function(assert) {
      assert.expect(1);

      var actual = _.defaults({ 'a': null }, { 'a': 1 });
      assert.strictEqual(actual.a, null);
    }
```

#### should overwrite `undefined` values

```ts
test('should overwrite `undefined` values', function(assert) {
      assert.expect(1);

      var actual = _.defaults({ 'a': undefined }, { 'a': 1 });
      assert.strictEqual(actual.a, 1);
    }
```

#### should assign `undefined` values

```ts
test('should assign `undefined` values', function(assert) {
      assert.expect(1);

      var source = { 'a': undefined, 'b': 1 },
          actual = _.defaults({}, source);

      assert.deepEqual(actual, { 'a': undefined, 'b': 1 });
    }
```

#### should assign properties that shadow those on `Object.prototype`

```ts
test('should assign properties that shadow those on `Object.prototype`', function(assert) {
      assert.expect(2);

      var object = {
        'constructor': objectProto.constructor,
        'hasOwnProperty': objectProto.hasOwnProperty,
        'isPrototypeOf': objectProto.isPrototypeOf,
        'propertyIsEnumerable': objectProto.propertyIsEnumerable,
        'toLocaleString': objectProto.toLocaleString,
        'toString': objectProto.toString,
        'valueOf': objectProto.valueOf
      };

      var source = {
        'constructor': 1,
        'hasOwnProperty': 2,
        'isPrototypeOf': 3,
        'propertyIsEnumerable': 4,
        'toLocaleString': 5,
        'toString': 6,
        'valueOf': 7
      };

      var expected = lodashStable.clone(source);
      assert.deepEqual(_.defaults({}, source), expected);

      expected = lodashStable.clone(object);
      assert.deepEqual(_.defaults({}, object, source), expected);
    }
```

#### should not overwrite `null` values

```ts
test('should not overwrite `null` values', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': null } },
          source = { 'a': { 'b': 2 } },
          actual = _.defaultsDeep(object, source);

      assert.strictEqual(actual.a.b, null);
    }
```

#### should not overwrite regexp values

```ts
test('should not overwrite regexp values', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': /x/ } },
          source = { 'a': { 'b': /y/ } },
          actual = _.defaultsDeep(object, source);

      assert.deepEqual(actual.a.b, /x/);
    }
```

#### should overwrite `undefined` values

```ts
test('should overwrite `undefined` values', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': undefined } },
          source = { 'a': { 'b': 2 } },
          actual = _.defaultsDeep(object, source);

      assert.strictEqual(actual.a.b, 2);
    }
```

#### should assign `undefined` values

```ts
test('should assign `undefined` values', function(assert) {
      assert.expect(1);

      var source = { 'a': undefined, 'b': { 'c': undefined, 'd': 1 } },
          expected = lodashStable.cloneDeep(source),
          actual = _.defaultsDeep({}, source);

      assert.deepEqual(actual, expected);
    }
```

#### should return a default value if `value` is `NaN` or nullish

```ts
test('should return a default value if `value` is `NaN` or nullish', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return (value == null || value !== value) ? 1 : value;
      });

      var actual = lodashStable.map(falsey, function(value) {
        return _.defaultTo(value, 1);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should treat `-0` as `0`

```ts
test('`_.' + methodName + '` should treat `-0` as `0`', function(assert) {
      assert.expect(2);

      var array = [-0, 0];

      var actual = lodashStable.map(array, function(value) {
        return func(array, [value]);
      });

      assert.deepEqual(actual, [[], []]);

      actual = lodashStable.map(func([-0, 1], [1]), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### `_.' + methodName + '` should work with large arrays of `-0` as `0`

```ts
test('`_.' + methodName + '` should work with large arrays of `-0` as `0`', function(assert) {
      assert.expect(2);

      var array = [-0, 0];

      var actual = lodashStable.map(array, function(value) {
        var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(value));
        return func(array, largeArray);
      });

      assert.deepEqual(actual, [[], []]);

      var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, stubOne);
      actual = lodashStable.map(func([-0, 1], largeArray), lodashStable.toString);
      assert.deepEqual(actual, ['0']);
    }
```

#### `_.' + methodName + '` should ignore values that are not array-like

```ts
test('`_.' + methodName + '` should ignore values that are not array-like', function(assert) {
      assert.expect(3);

      var array = [1, null, 3];

      assert.deepEqual(func(args, 3, { '0': 1 }), [1, 2, 3]);
      assert.deepEqual(func(null, array, 1), []);
      assert.deepEqual(func(array, args, null), [null]);
    }
```

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? [2, 3] : array;
      });

      var actual = lodashStable.map(falsey, function(n) {
        return _.drop(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 1),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            actual = _(array).drop(2).drop().value();

        assert.deepEqual(actual, array.slice(3));

        actual = _(array).filter(predicate).drop(2).drop().value();
        assert.deepEqual(values, array);
        assert.deepEqual(actual, _.drop(_.drop(_.filter(array, predicate), 2)));

        actual = _(array).drop(2).dropRight().drop().dropRight(2).value();
        assert.deepEqual(actual, _.dropRight(_.drop(_.dropRight(_.drop(array, 2))), 2));

        values = [];

        actual = _(array).drop().filter(predicate).drop(2).dropRight().drop().dropRight(2).value();
        assert.deepEqual(values, array.slice(1));
        assert.deepEqual(actual, _.dropRight(_.drop(_.dropRight(_.drop(_.filter(_.drop(array), predicate), 2))), 2));
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? [1, 2] : array;
      });

      var actual = lodashStable.map(falsey, function(n) {
        return _.dropRight(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 1),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            actual = _(array).dropRight(2).dropRight().value();

        assert.deepEqual(actual, array.slice(0, -3));

        actual = _(array).filter(predicate).dropRight(2).dropRight().value();
        assert.deepEqual(values, array);
        assert.deepEqual(actual, _.dropRight(_.dropRight(_.filter(array, predicate), 2)));

        actual = _(array).dropRight(2).drop().dropRight().drop(2).value();
        assert.deepEqual(actual, _.drop(_.dropRight(_.drop(_.dropRight(array, 2))), 2));

        values = [];

        actual = _(array).dropRight().filter(predicate).dropRight(2).drop().dropRight().drop(2).value();
        assert.deepEqual(values, array.slice(0, -1));
        assert.deepEqual(actual, _.drop(_.dropRight(_.drop(_.dropRight(_.filter(_.dropRight(array), predicate), 2))), 2));
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(array).dropRightWhile(function(n) {
          return n > 2;
        });

        assert.ok(wrapped instanceof _);
        assert.deepEqual(wrapped.value(), [1, 2]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 3),
            predicate = function(n) { return n < 3; },
            expected = _.dropWhile(array, predicate),
            wrapped = _(array).dropWhile(predicate);

        assert.deepEqual(wrapped.value(), expected);
        assert.deepEqual(wrapped.reverse().value(), expected.slice().reverse());
        assert.strictEqual(wrapped.last(), _.last(expected));
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### should work in a lazy sequence with `drop`

```ts
test('should work in a lazy sequence with `drop`', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 3);

        var actual = _(array)
          .dropWhile(function(n) { return n == 1; })
          .drop()
          .dropWhile(function(n) { return n == 3; })
          .value();

        assert.deepEqual(actual, array.slice(3));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should treat falsey `position` values, except `undefined`, as `0`

```ts
test('should treat falsey `position` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(position) {
        return _.endsWith(string, position === undefined ? 'c' : '', position);
      });

      assert.deepEqual(actual, expected);
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

#### should escape values

```ts
test('should escape values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.escape(unescaped), escaped);
    }
```

#### should escape values

```ts
test('should escape values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.escapeRegExp(unescaped + unescaped), escaped + escaped);
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

#### should return `false` as soon as `predicate` returns falsey

```ts
test('should return `false` as soon as `predicate` returns falsey', function(assert) {
      assert.expect(2);

      var count = 0;

      assert.strictEqual(_.every([true, null, true], function(value) {
        count++;
        return value;
      }), false);

      assert.strictEqual(count, 2);
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

#### should treat falsey `start` values as `0`

```ts
test('should treat falsey `start` values as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(['a', 'a', 'a']));

      var actual = lodashStable.map(falsey, function(start) {
        var array = [1, 2, 3];
        return _.fill(array, 'a', start);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat falsey `end` values, except `undefined`, as `0`

```ts
test('should treat falsey `end` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? ['a', 'a', 'a'] : [1, 2, 3];
      });

      var actual = lodashStable.map(falsey, function(end) {
        var array = [1, 2, 3];
        return _.fill(array, 'a', 0, end);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var array = [1, 2, 3],
            wrapped = _(array).fill('a'),
            actual = wrapped.value();

        assert.ok(wrapped instanceof _);
        assert.strictEqual(actual, array);
        assert.deepEqual(actual, ['a', 'a', 'a']);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### `_.' + methodName + '` should return the found value

```ts
test('`_.' + methodName + '` should return the found value', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(objects, function(object) { return object.a; }), expected[0]);
    }
```

#### `_.' + methodName + '` should return `' + expected[1] + '` if value is not found

```ts
test('`_.' + methodName + '` should return `' + expected[1] + '` if value is not found', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(objects, function(object) { return object.a === 3; }), expected[1]);
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

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).chain()[methodName]() instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should support shortcut fusion

```ts
test('`_.' + methodName + '` should support shortcut fusion', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var findCount = 0,
            mapCount = 0,
            array = lodashStable.range(1, LARGE_ARRAY_SIZE + 1),
            iteratee = function(value) { mapCount++; return square(value); },
            predicate = function(value) { findCount++; return isEven(value); },
            actual = _(array).map(iteratee)[methodName](predicate);

        assert.strictEqual(findCount, isFind ? 2 : 1);
        assert.strictEqual(mapCount, isFind ? 2 : 1);
        assert.strictEqual(actual, isFind ? 4 : square(LARGE_ARRAY_SIZE));
      }
      else {
        skipAssert(assert, 3);
      }
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

#### `_.' + methodName + '` should return the index of the first matched value

```ts
test('`_.' + methodName + '` should return the index of the first matched value', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(array, resolve(3)), 2);
    }
```

#### `_.' + methodName + '` should work with a `fromIndex` >= `length`

```ts
test('`_.' + methodName + '` should work with a `fromIndex` >= `length`', function(assert) {
      assert.expect(1);

      var values = [6, 8, Math.pow(2, 32), Infinity],
          expected = lodashStable.map(values, lodashStable.constant([-1, -1, -1]));

      var actual = lodashStable.map(values, function(fromIndex) {
        return [
          func(array, resolve(undefined), fromIndex),
          func(array, resolve(1), fromIndex),
          func(array, resolve(''), fromIndex)
        ];
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with a negative `fromIndex` <= `-length`

```ts
test('`_.' + methodName + '` should work with a negative `fromIndex` <= `-length`', function(assert) {
      assert.expect(1);

      var values = [-6, -8, -Infinity],
          expected = lodashStable.map(values, stubZero);

      var actual = lodashStable.map(values, function(fromIndex) {
        return func(array, resolve(1), fromIndex);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should treat falsey `fromIndex` values as `0`

```ts
test('`_.' + methodName + '` should treat falsey `fromIndex` values as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubZero);

      var actual = lodashStable.map(falsey, function(fromIndex) {
        return func(array, resolve(1), fromIndex);
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

#### `_.' + methodName + '` should map values in `array` to a new flattened array

```ts
test('`_.' + methodName + '` should map values in `array` to a new flattened array', function(assert) {
      assert.expect(1);

      var actual = func(array, duplicate),
          expected = lodashStable.flatten(lodashStable.map(array, duplicate));

      assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` should treat number values for `collection` as empty

```ts
test('`_.' + methodName + '` should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(1), []);
    }
```

#### should flatten objects with a truthy `Symbol.isConcatSpreadable` value

```ts
test('should flatten objects with a truthy `Symbol.isConcatSpreadable` value', function(assert) {
      assert.expect(1);

      if (Symbol && Symbol.isConcatSpreadable) {
        var object = { '0': 'a', 'length': 1 },
            array = [object],
            expected = lodashStable.map(methodNames, lodashStable.constant(['a']));

        object[Symbol.isConcatSpreadable] = true;

        var actual = lodashStable.map(methodNames, function(methodName) {
          return _[methodName](array);
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var wrapped = _(array),
            actual = wrapped.flatten();

        assert.ok(actual instanceof _);
        assert.deepEqual(actual.value(), [1, 2, [3, [4]], 5]);

        actual = wrapped.flattenDeep();

        assert.ok(actual instanceof _);
        assert.deepEqual(actual.value(), [1, 2, 3, 4, 5]);

        actual = wrapped.flattenDepth(2);

        assert.ok(actual instanceof _);
        assert.deepEqual(actual.value(), [1, 2, 3, [4], 5]);
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### `_.' + methodName + '` should supply each function with the return value of the previous

```ts
test('`_.' + methodName + '` should supply each function with the return value of the previous', function(assert) {
      assert.expect(1);

      var fixed = function(n) { return n.toFixed(1); },
          combined = isFlow ? func(add, square, fixed) : func(fixed, square, add);

      assert.strictEqual(combined(1, 2), '9.0');
    }
```

#### `_.' + methodName + '` should support shortcut fusion

```ts
test('`_.' + methodName + '` should support shortcut fusion', function(assert) {
      assert.expect(6);

      var filterCount,
          mapCount,
          array = lodashStable.range(LARGE_ARRAY_SIZE),
          iteratee = function(value) { mapCount++; return square(value); },
          predicate = function(value) { filterCount++; return isEven(value); };

      lodashStable.times(2, function(index) {
        var filter1 = _.filter,
            filter2 = _.curry(_.rearg(_.ary(_.filter, 2), 1, 0), 2),
            filter3 = (_.filter = index ? filter2 : filter1, filter2(predicate));

        var map1 = _.map,
            map2 = _.curry(_.rearg(_.ary(_.map, 2), 1, 0), 2),
            map3 = (_.map = index ? map2 : map1, map2(iteratee));

        var take1 = _.take,
            take2 = _.curry(_.rearg(_.ary(_.take, 2), 1, 0), 2),
            take3 = (_.take = index ? take2 : take1, take2(2));

        var combined = isFlow
          ? func(map3, filter3, _.compact, take3)
          : func(take3, _.compact, filter3, map3);

        filterCount = mapCount = 0;
        assert.deepEqual(combined(array), [4, 16]);

        if (!isNpm && WeakMap && WeakMap.name) {
          assert.strictEqual(filterCount, 5, 'filterCount');
          assert.strictEqual(mapCount, 5, 'mapCount');
        }
        else {
          skipAssert(assert, 2);
        }
        _.filter = filter1;
        _.map = map1;
        _.take = take1;
      });
    }
```

#### `_.' + methodName + '` should return a wrapped value when chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(noop)[methodName]();
        assert.ok(wrapped instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should iterate over `length` properties

```ts
test('`_.' + methodName + '` should iterate over `length` properties', function(assert) {
      assert.expect(1);

      var object = { '0': 'zero', '1': 'one', 'length': 2 },
          props = [];

      func(object, function(value, prop) { props.push(prop); });
      assert.deepEqual(props.sort(), ['0', '1', 'length']);
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

#### `_.' + methodName + '` should return a wrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when implicitly chaining', function(assert) {
        assert.expect(1);

        if (!(isBaseEach || isNpm)) {
          var wrapped = _(array)[methodName](noop);
          assert.ok(wrapped instanceof _);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
        assert.expect(1);

        if (!isNpm) {
          var actual = _(array)[methodName](noop);
          assert.notOk(actual instanceof _);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
        assert.expect(2);

        if (!isNpm) {
          var wrapped = _(array).chain(),
              actual = wrapped[methodName](noop);

          assert.ok(actual instanceof _);
          assert.notStrictEqual(actual, wrapped);
        }
        else {
          skipAssert(assert, 2);
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

#### `_.' + methodName + '` should use `isArrayLike` to determine whether a value is array-like

```ts
test('`_.' + methodName + '` should use `isArrayLike` to determine whether a value is array-like', function(assert) {
        assert.expect(3);

        if (func) {
          var isIteratedAsObject = function(object) {
            var result = false;
            func(object, function() { result = true; }, 0);
            return result;
          };

          var values = [-1, '1', 1.1, Object(1), MAX_SAFE_INTEGER + 1],
              expected = lodashStable.map(values, stubTrue);

          var actual = lodashStable.map(values, function(length) {
            return isIteratedAsObject({ 'length': length });
          });

          var Foo = function(a) {};
          Foo.a = 1;

          assert.deepEqual(actual, expected);
          assert.ok(isIteratedAsObject(Foo));
          assert.notOk(isIteratedAsObject({ 'length': 0 }));
        }
        else {
          skipAssert(assert, 3);
        }
      }
```

#### `_.' + methodName + '` should coerce primitives to objects

```ts
test('`_.' + methodName + '` should coerce primitives to objects', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(primitives, function(value) {
        var object = Object(value);
        object.a = 1;
        return object;
      });

      var actual = lodashStable.map(primitives, function(value) {
        return func(value, { 'a': 1 });
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should create an object when `object` is nullish

```ts
test('`_.' + methodName + '` should create an object when `object` is nullish', function(assert) {
      assert.expect(2);

      var source = { 'a': 1 },
          values = [null, undefined],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        var object = func(value, source);
        return object !== source && lodashStable.isEqual(object, source);
      });

      assert.deepEqual(actual, expected);

      actual = lodashStable.map(values, function(value) {
        return lodashStable.isEqual(func(value), {});
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should not return the existing wrapped value when chaining

```ts
test('`_.' + methodName + '` should not return the existing wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _({ 'a': 1 }),
            actual = wrapped[methodName]({ 'b': 2 });

        assert.notStrictEqual(actual, wrapped);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should not assign values that are the same as their destinations

```ts
test('`_.' + methodName + '` should not assign values that are the same as their destinations', function(assert) {
      assert.expect(4);

      lodashStable.each(['a', ['a'], { 'a': 1 }, NaN], function(value) {
        var object = {},
            pass = true;

        defineProperty(object, 'a', {
          'configurable': true,
          'enumerable': true,
          'get': lodashStable.constant(value),
          'set': function() { pass = false; }
        });

        func(object, { 'a': value });
        assert.ok(pass);
      });
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

#### `_.' + methodName + '` can exit early when iterating arrays

```ts
test('`_.' + methodName + '` can exit early when iterating arrays', function(assert) {
      assert.expect(1);

      if (func) {
        var array = [1, 2, 3],
            values = [];

        func(array, function(value, other) {
          values.push(lodashStable.isArray(value) ? other : value);
          return false;
        });

        assert.deepEqual(values, [lodashStable.endsWith(methodName, 'Right') ? 3 : 1]);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` can exit early when iterating objects

```ts
test('`_.' + methodName + '` can exit early when iterating objects', function(assert) {
      assert.expect(1);

      if (func) {
        var object = { 'a': 1, 'b': 2, 'c': 3 },
            values = [];

        func(object, function(value, other) {
          values.push(lodashStable.isArray(value) ? other : value);
          return false;
        });

        assert.strictEqual(values.length, 1);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should support consuming the return value of `_.toPairs`

```ts
test('should support consuming the return value of `_.toPairs`', function(assert) {
      assert.expect(1);

      var object = { 'a.b': 1 };
      assert.deepEqual(_.fromPairs(_.toPairs(object)), object);
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

#### should only add values to own, not inherited, properties

```ts
test('should only add values to own, not inherited, properties', function(assert) {
      assert.expect(2);

      var actual = _.groupBy(array, function(n) {
        return Math.floor(n) > 4 ? 'hasOwnProperty' : 'constructor';
      });

      assert.deepEqual(actual.constructor, [4.2]);
      assert.deepEqual(actual.hasOwnProperty, [6.1, 6.3]);
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

        var iteratee = function(value) { value.push(value[0]); return value; },
            predicate = function(value) { return isEven(value[0]); },
            actual = _(array).groupBy().map(iteratee).filter(predicate).take().value();

        assert.deepEqual(actual, _.take(_.filter(lodashStable.map(_.groupBy(array), iteratee), predicate)));
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return `true` if `value` > `other`

```ts
test('should return `true` if `value` > `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.gt(3, 1), true);
      assert.strictEqual(_.gt('def', 'abc'), true);
    }
```

#### should return `false` if `value` is <= `other`

```ts
test('should return `false` if `value` is <= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.gt(1, 3), false);
      assert.strictEqual(_.gt(3, 3), false);
      assert.strictEqual(_.gt('abc', 'def'), false);
      assert.strictEqual(_.gt('def', 'def'), false);
    }
```

#### should return `true` if `value` >= `other`

```ts
test('should return `true` if `value` >= `other`', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.gte(3, 1), true);
      assert.strictEqual(_.gte(3, 3), true);
      assert.strictEqual(_.gte('def', 'abc'), true);
      assert.strictEqual(_.gte('def', 'def'), true);
    }
```

#### should return `false` if `value` is less than `other`

```ts
test('should return `false` if `value` is less than `other`', function(assert) {
      assert.expect(2);

      assert.strictEqual(_.gte(1, 3), false);
      assert.strictEqual(_.gte('abc', 'def'), false);
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

#### should return an unwrapped value when implicitly chaining

```ts
test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(array);
        assert.strictEqual(wrapped.head(), 1);
        assert.strictEqual(wrapped.first(), 1);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(array).chain();
        assert.ok(wrapped.head() instanceof _);
        assert.ok(wrapped.first() instanceof _);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            values = [];

        var actual = _(array).initial().filter(function(value) {
          values.push(value);
          return false;
        })
        .value();

        assert.deepEqual(actual, []);
        assert.deepEqual(values, _.initial(array));

        values = [];

        actual = _(array).filter(function(value) {
          values.push(value);
          return isEven(value);
        })
        .initial()
        .value();

        assert.deepEqual(actual, _.initial(lodashStable.filter(array, isEven)));
        assert.deepEqual(values, array);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should treat falsey `start` as `0`

```ts
test('should treat falsey `start` as `0`', function(assert) {
      assert.expect(13);

      lodashStable.each(falsey, function(value, index) {
        if (index) {
          assert.strictEqual(_.inRange(0, value), false);
          assert.strictEqual(_.inRange(0, value, 1), true);
        } else {
          assert.strictEqual(_.inRange(0), false);
        }
      });
    }
```

#### should work with a floating point `n` value

```ts
test('should work with a floating point `n` value', function(assert) {
      assert.expect(4);

      assert.strictEqual(_.inRange(0.5, 5), true);
      assert.strictEqual(_.inRange(1.2, 1, 5), true);
      assert.strictEqual(_.inRange(5.2, 5), false);
      assert.strictEqual(_.inRange(0.5, 1, 5), false);
    }
```

#### `_.' + methodName + '` should return an array of unique values

```ts
test('`_.' + methodName + '` should return an array of unique values', function(assert) {
      assert.expect(1);

      var actual = func([1, 1, 3, 2, 2], [5, 2, 2, 1, 4], [2, 1, 1]);
      assert.deepEqual(actual, [1, 2]);
    }
```

#### `_.' + methodName + '` should treat `-0` as `0`

```ts
test('`_.' + methodName + '` should treat `-0` as `0`', function(assert) {
      assert.expect(1);

      var values = [-0, 0],
          expected = lodashStable.map(values, lodashStable.constant(['0']));

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.map(func(values, [value]), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with large arrays of `-0` as `0`

```ts
test('`_.' + methodName + '` should work with large arrays of `-0` as `0`', function(assert) {
      assert.expect(1);

      var values = [-0, 0],
          expected = lodashStable.map(values, lodashStable.constant(['0']));

      var actual = lodashStable.map(values, function(value) {
        var largeArray = lodashStable.times(LARGE_ARRAY_SIZE, lodashStable.constant(value));
        return lodashStable.map(func(values, largeArray), lodashStable.toString);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should treat values that are not arrays or `arguments` objects as empty

```ts
test('`_.' + methodName + '` should treat values that are not arrays or `arguments` objects as empty', function(assert) {
      assert.expect(3);

      var array = [0, 1, null, 3];
      assert.deepEqual(func(array, 3, { '0': 1 }, null), []);
      assert.deepEqual(func(null, array, null, [2, 3]), []);
      assert.deepEqual(func(array, null, args, null), []);
    }
```

#### `_.' + methodName + '` should return a wrapped value when chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _([1, 3, 2])[methodName]([5, 2, 1, 4]);
        assert.ok(wrapped instanceof _);
        assert.deepEqual(wrapped.value(), [1, 2]);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var object = { 'a': 1, 'b': 2 },
            wrapped = _(object).invert();

        assert.ok(wrapped instanceof _);
        assert.deepEqual(wrapped.value(), { '1': 'a', '2': 'b' });
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should only add multiple values to own, not inherited, properties

```ts
test('should only add multiple values to own, not inherited, properties', function(assert) {
      assert.expect(1);

      var object = { 'a': 'hasOwnProperty', 'b': 'constructor' },
          expected = { 'hasOwnProperty': ['a'], 'constructor': ['b'] };

      assert.ok(lodashStable.isEqual(_.invertBy(object), expected));
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(object).invertBy();

        assert.ok(wrapped instanceof _);
        assert.deepEqual(wrapped.value(), { '1': ['a', 'c'], '2': ['b'] });
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should not error on nullish elements

```ts
test('should not error on nullish elements', function(assert) {
      assert.expect(1);

      var values = [null, undefined],
          expected = lodashStable.map(values, noop);

      var actual = lodashStable.map(values, function(value) {
        try {
          return _.invoke(value, 'a.b', 1, 2);
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return an unwrapped value when implicitly chaining

```ts
test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var object = { 'a': stubOne };
        assert.strictEqual(_(object).invoke('a'), 1);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var object = { 'a': stubOne };
        assert.ok(_(object).chain().invoke('a') instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.invokeMap(1), []);
    }
```

#### should not error on elements with missing properties

```ts
test('should not error on elements with missing properties', function(assert) {
      assert.expect(1);

      var objects = lodashStable.map([null, undefined, stubOne], function(value) {
        return { 'a': value };
      });

      var expected = lodashStable.map(objects, function(object) {
        return object.a ? object.a() : undefined;
      });

      try {
        var actual = _.invokeMap(objects, 'a');
      } catch (e) {}

      assert.deepEqual(actual, expected);
    }
```

#### should return a wrapped value when chaining

```ts
test('should return a wrapped value when chaining', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = ['a', 'b', 'c'],
            wrapped = _(array),
            actual = wrapped.invokeMap('toUpperCase');

        assert.ok(actual instanceof _);
        assert.deepEqual(actual.valueOf(), ['A', 'B', 'C']);

        actual = wrapped.invokeMap(function(left, right) {
          return left + this.toUpperCase() + right;
        }, '(', ')');

        assert.ok(actual instanceof _);
        assert.deepEqual(actual.valueOf(), ['(A)', '(B)', '(C)']);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should support shortcut fusion

```ts
test('should support shortcut fusion', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var count = 0,
            method = function() { count++; return this.index; };

        var array = lodashStable.times(LARGE_ARRAY_SIZE, function(index) {
          return { 'index': index, 'method': method };
        });

        var actual = _(array).invokeMap('method').take(1).value();

        assert.strictEqual(count, 1);
        assert.deepEqual(actual, [0]);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should work with an array from another realm

```ts
test('should work with an array from another realm', function(assert) {
      assert.expect(1);

      if (realm.object) {
        var values = [realm.arguments, realm.array, realm.string],
            expected = lodashStable.map(values, stubTrue),
            actual = lodashStable.map(values, _.isArrayLike);

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
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

#### should return an unwrapped value when implicitly chaining

```ts
test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_({}).isEmpty(), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_({}).chain().isEmpty() instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### should compare objects with shared property values

```ts
test('should compare objects with shared property values', function(assert) {
      assert.expect(1);

      var object1 = {
        'a': [1, 2]
      };

      var object2 = {
        'a': [1, 2],
        'b': [1, 2]
      };

      object1.b = object1.a;

      assert.strictEqual(_.isEqual(object1, object2), true);
    }
```

#### should compare symbol properties

```ts
test('should compare symbol properties', function(assert) {
      assert.expect(3);

      if (Symbol) {
        var object1 = { 'a': 1 },
            object2 = { 'a': 1 };

        object1[symbol1] = { 'a': { 'b': 2 } };
        object2[symbol1] = { 'a': { 'b': 2 } };

        defineProperty(object2, symbol2, {
          'configurable': true,
          'enumerable': false,
          'writable': true,
          'value': 2
        });

        assert.strictEqual(_.isEqual(object1, object2), true);

        object2[symbol1] = { 'a': 1 };
        assert.strictEqual(_.isEqual(object1, object2), false);

        delete object2[symbol1];
        object2[Symbol('a')] = { 'a': { 'b': 2 } };
        assert.strictEqual(_.isEqual(object1, object2), false);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### should compare wrapped values

```ts
test('should compare wrapped values', function(assert) {
      assert.expect(32);

      var stamp = +new Date;

      var values = [
        [[1, 2], [1, 2], [1, 2, 3]],
        [true, true, false],
        [new Date(stamp), new Date(stamp), new Date(stamp - 100)],
        [{ 'a': 1, 'b': 2 }, { 'a': 1, 'b': 2 }, { 'a': 1, 'b': 1 }],
        [1, 1, 2],
        [NaN, NaN, Infinity],
        [/x/, /x/, /x/i],
        ['a', 'a', 'A']
      ];

      lodashStable.each(values, function(vals) {
        if (!isNpm) {
          var wrapped1 = _(vals[0]),
              wrapped2 = _(vals[1]),
              actual = wrapped1.isEqual(wrapped2);

          assert.strictEqual(actual, true);
          assert.strictEqual(_.isEqual(_(actual), _(true)), true);

          wrapped1 = _(vals[0]);
          wrapped2 = _(vals[2]);

          actual = wrapped1.isEqual(wrapped2);
          assert.strictEqual(actual, false);
          assert.strictEqual(_.isEqual(_(actual), _(false)), true);
        }
        else {
          skipAssert(assert, 4);
        }
      });
    }
```

#### should compare wrapped and non-wrapped values

```ts
test('should compare wrapped and non-wrapped values', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var object1 = _({ 'a': 1, 'b': 2 }),
            object2 = { 'a': 1, 'b': 2 };

        assert.strictEqual(object1.isEqual(object2), true);
        assert.strictEqual(_.isEqual(object1, object2), true);

        object1 = _({ 'a': 1, 'b': 2 });
        object2 = { 'a': 1, 'b': 1 };

        assert.strictEqual(object1.isEqual(object2), false);
        assert.strictEqual(_.isEqual(object1, object2), false);
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

#### should return an unwrapped value when implicitly chaining

```ts
test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_('a').isEqual('a'), true);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_('a').chain().isEqual('a') instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should not handle comparisons when `customizer` returns `true`

```ts
test('should not handle comparisons when `customizer` returns `true`', function(assert) {
      assert.expect(3);

      var customizer = function(value) {
        return _.isString(value) || undefined;
      };

      assert.strictEqual(_.isEqualWith('a', 'b', customizer), true);
      assert.strictEqual(_.isEqualWith(['a'], ['b'], customizer), true);
      assert.strictEqual(_.isEqualWith({ '0': 'a' }, { '0': 'b' }, customizer), true);
    }
```

#### should not handle comparisons when `customizer` returns `false`

```ts
test('should not handle comparisons when `customizer` returns `false`', function(assert) {
      assert.expect(3);

      var customizer = function(value) {
        return _.isString(value) ? false : undefined;
      };

      assert.strictEqual(_.isEqualWith('a', 'a', customizer), false);
      assert.strictEqual(_.isEqualWith(['a'], ['a'], customizer), false);
      assert.strictEqual(_.isEqualWith({ '0': 'a' }, { '0': 'a' }, customizer), false);
    }
```

#### should return a boolean value even when `customizer` does not

```ts
test('should return a boolean value even when `customizer` does not', function(assert) {
      assert.expect(2);

      var actual = _.isEqualWith('a', 'b', stubC);
      assert.strictEqual(actual, true);

      var values = _.without(falsey, undefined),
          expected = lodashStable.map(values, stubFalse);

      actual = [];
      lodashStable.each(values, function(value) {
        actual.push(_.isEqualWith('a', 'a', lodashStable.constant(value)));
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

#### should not handle comparisons when `customizer` returns `true`

```ts
test('should not handle comparisons when `customizer` returns `true`', function(assert) {
      assert.expect(2);

      var customizer = function(value) {
        return _.isString(value) || undefined;
      };

      assert.strictEqual(_.isMatchWith(['a'], ['b'], customizer), true);
      assert.strictEqual(_.isMatchWith({ '0': 'a' }, { '0': 'b' }, customizer), true);
    }
```

#### should not handle comparisons when `customizer` returns `false`

```ts
test('should not handle comparisons when `customizer` returns `false`', function(assert) {
      assert.expect(2);

      var customizer = function(value) {
        return _.isString(value) ? false : undefined;
      };

      assert.strictEqual(_.isMatchWith(['a'], ['a'], customizer), false);
      assert.strictEqual(_.isMatchWith({ '0': 'a' }, { '0': 'a' }, customizer), false);
    }
```

#### should return a boolean value even when `customizer` does not

```ts
test('should return a boolean value even when `customizer` does not', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 },
          actual = _.isMatchWith(object, { 'a': 1 }, stubA);

      assert.strictEqual(actual, true);

      var expected = lodashStable.map(falsey, stubFalse);

      actual = [];
      lodashStable.each(falsey, function(value) {
        actual.push(_.isMatchWith(object, { 'a': 2 }, lodashStable.constant(value)));
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

#### should work with native functions from another realm

```ts
test('should work with native functions from another realm', function(assert) {
      assert.expect(2);

      if (realm.element) {
        assert.strictEqual(_.isNative(realm.element.cloneNode), true);
      }
      else {
        skipAssert(assert);
      }
      if (realm.object) {
        assert.strictEqual(_.isNative(realm.object.valueOf), true);
      }
      else {
        skipAssert(assert);
      }
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

#### should return `true` for objects with a `valueOf` property

```ts
test('should return `true` for objects with a `valueOf` property', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.isPlainObject({ 'valueOf': 0 }), true);
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

#### should not mutate `value`

```ts
test('should not mutate `value`', function(assert) {
      assert.expect(2);

      if (Symbol && Symbol.toStringTag) {
        var proto = {};
        proto[Symbol.toStringTag] = undefined;
        var object = create(proto);

        assert.strictEqual(_.isPlainObject(object), false);
        assert.notOk(lodashStable.has(object, Symbol.toStringTag));
      }
      else {
        skipAssert(assert, 2);
      }
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

#### `_.mapValues` should use `_.iteratee` internally

```ts
test('`_.mapValues` should use `_.iteratee` internally', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        _.iteratee = getPropB;
        assert.deepEqual(_.mapValues({ 'a': { 'b': 2 } }), { 'a': 2 });
        _.iteratee = iteratee;
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return an unwrapped value when implicitly chaining

```ts
test('should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(array);
        assert.strictEqual(wrapped.join('~'), 'a~b~c');
        assert.strictEqual(wrapped.value(), array);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).chain().join('~') instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should work with `arguments` objects

```ts
test('`_.' + methodName + '` should work with `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant(['0', '1', '2']));

      var actual = lodashStable.map(values, function(value) {
        return func(value).sort();
      });

      assert.deepEqual(actual, expected);
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

#### should merge onto function `object` values

```ts
test('should merge onto function `object` values', function(assert) {
      assert.expect(2);

      function Foo() {}

      var source = { 'a': 1 },
          actual = _.merge(Foo, source);

      assert.strictEqual(actual, Foo);
      assert.strictEqual(Foo.a, 1);
    }
```

#### should not merge onto function values of sources

```ts
test('should not merge onto function values of sources', function(assert) {
      assert.expect(3);

      var source1 = { 'a': function() {} },
          source2 = { 'a': { 'b': 2 } },
          expected = { 'a': { 'b': 2 } },
          actual = _.merge({}, source1, source2);

      assert.deepEqual(actual, expected);
      assert.notOk('b' in source1.a);

      actual = _.merge(source1, source2);
      assert.deepEqual(actual, expected);
    }
```

#### should merge onto non-plain `object` values

```ts
test('should merge onto non-plain `object` values', function(assert) {
      assert.expect(2);

      function Foo() {}

      var object = new Foo,
          actual = _.merge(object, { 'a': 1 });

      assert.strictEqual(actual, object);
      assert.strictEqual(object.a, 1);
    }
```

#### should merge `arguments` objects

```ts
test('should merge `arguments` objects', function(assert) {
      assert.expect(7);

      var object1 = { 'value': args },
          object2 = { 'value': { '3': 4 } },
          expected = { '0': 1, '1': 2, '2': 3, '3': 4 },
          actual = _.merge(object1, object2);

      assert.notOk('3' in args);
      assert.notOk(_.isArguments(actual.value));
      assert.deepEqual(actual.value, expected);
      object1.value = args;

      actual = _.merge(object2, object1);
      assert.notOk(_.isArguments(actual.value));
      assert.deepEqual(actual.value, expected);

      expected = { '0': 1, '1': 2, '2': 3 };

      actual = _.merge({}, object1);
      assert.notOk(_.isArguments(actual.value));
      assert.deepEqual(actual.value, expected);
    }
```

#### should merge typed arrays

```ts
test('should merge typed arrays', function(assert) {
      assert.expect(4);

      var array1 = [0],
          array2 = [0, 0],
          array3 = [0, 0, 0, 0],
          array4 = [0, 0, 0, 0, 0, 0, 0, 0];

      var arrays = [array2, array1, array4, array3, array2, array4, array4, array3, array2],
          buffer = ArrayBuffer && new ArrayBuffer(8);

      var expected = lodashStable.map(typedArrays, function(type, index) {
        var array = arrays[index].slice();
        array[0] = 1;
        return root[type] ? { 'value': array } : false;
      });

      var actual = lodashStable.map(typedArrays, function(type) {
        var Ctor = root[type];
        return Ctor ? _.merge({ 'value': new Ctor(buffer) }, { 'value': [1] }) : false;
      });

      assert.ok(lodashStable.isArray(actual));
      assert.deepEqual(actual, expected);

      expected = lodashStable.map(typedArrays, function(type, index) {
        var array = arrays[index].slice();
        array.push(1);
        return root[type] ? { 'value': array } : false;
      });

      actual = lodashStable.map(typedArrays, function(type, index) {
        var Ctor = root[type],
            array = lodashStable.range(arrays[index].length);

        array.push(1);
        return Ctor ? _.merge({ 'value': array }, { 'value': new Ctor(buffer) }) : false;
      });

      assert.ok(lodashStable.isArray(actual));
      assert.deepEqual(actual, expected);
    }
```

#### should assign `null` values

```ts
test('should assign `null` values', function(assert) {
      assert.expect(1);

      var actual = _.merge({ 'a': 1 }, { 'a': null });
      assert.strictEqual(actual.a, null);
    }
```

#### should assign non array/buffer/typed-array/plain-object source values directly

```ts
test('should assign non array/buffer/typed-array/plain-object source values directly', function(assert) {
      assert.expect(1);

      function Foo() {}

      var values = [new Foo, new Boolean, new Date, Foo, new Number, new String, new RegExp],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        var object = _.merge({}, { 'a': value, 'b': { 'c': value } });
        return object.a === value && object.b.c === value;
      });

      assert.deepEqual(actual, expected);
    }
```

#### should clone buffer source values

```ts
test('should clone buffer source values', function(assert) {
      assert.expect(3);

      if (Buffer) {
        var buffer = new Buffer([1]),
            actual = _.merge({}, { 'value': buffer }).value;

        assert.ok(lodashStable.isBuffer(actual));
        assert.strictEqual(actual[0], buffer[0]);
        assert.notStrictEqual(actual, buffer);
      }
      else {
        skipAssert(assert, 3);
      }
    }
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

#### should not overwrite existing values with `undefined` values of object sources

```ts
test('should not overwrite existing values with `undefined` values of object sources', function(assert) {
      assert.expect(1);

      var actual = _.merge({ 'a': 1 }, { 'a': undefined, 'b': undefined });
      assert.deepEqual(actual, { 'a': 1, 'b': undefined });
    }
```

#### should not overwrite existing values with `undefined` values of array sources

```ts
test('should not overwrite existing values with `undefined` values of array sources', function(assert) {
      assert.expect(2);

      var array = [1];
      array[2] = 3;

      var actual = _.merge([4, 5, 6], array),
          expected = [1, 5, 3];

      assert.deepEqual(actual, expected);

      array = [1, , 3];
      array[1] = undefined;

      actual = _.merge([4, 5, 6], array);
      assert.deepEqual(actual, expected);
    }
```

#### should skip merging when `object` and `source` are the same value

```ts
test('should skip merging when `object` and `source` are the same value', function(assert) {
      assert.expect(1);

      var object = {},
          pass = true;

      defineProperty(object, 'a', {
        'configurable': true,
        'enumerable': true,
        'get': function() { pass = false; },
        'set': function() { pass = false; }
      });

      _.merge(object, object);
      assert.ok(pass);
    }
```

#### should convert values to arrays when merging arrays of `source`

```ts
test('should convert values to arrays when merging arrays of `source`', function(assert) {
      assert.expect(2);

      var object = { 'a': { '1': 'y', 'b': 'z', 'length': 2 } },
          actual = _.merge(object, { 'a': ['x'] });

      assert.deepEqual(actual, { 'a': ['x', 'y'] });

      actual = _.merge({ 'a': {} }, { 'a': [] });
      assert.deepEqual(actual, { 'a': [] });
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

#### should return the smallest value from a collection

```ts
test('should return the smallest value from a collection', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.min([1, 2, 3]), 1);
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

#### should work with non-numeric collection values

```ts
test('should work with non-numeric collection values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.min(['a', 'b']), 'a');
    }
```

#### `_.' + methodName + '` should work when chaining on an array with only one value

```ts
test('`_.' + methodName + '` should work when chaining on an array with only one value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = _([40])[methodName]();
        assert.strictEqual(actual, 40);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should work when `iteratee` returns +/-Infinity

```ts
test('`_.' + methodName + '` should work when `iteratee` returns +/-Infinity', function(assert) {
      assert.expect(1);

      var value = isMax ? -Infinity : Infinity,
          object = { 'a': value };

      var actual = func([object, { 'a': value }], function(object) {
        return object.a;
      });

      assert.strictEqual(actual, object);
    }
```

#### should mixin `source` methods into lodash

```ts
test('should mixin `source` methods into lodash', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        _.mixin(source);

        assert.strictEqual(_.a(array), 'a');
        assert.strictEqual(_(array).a().value(), 'a');
        assert.notOk('b' in _);
        assert.notOk('b' in _.prototype);

        reset(_);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should mixin chaining methods by reference

```ts
test('should mixin chaining methods by reference', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        _.mixin(source);
        _.a = stubB;

        assert.strictEqual(_.a(array), 'b');
        assert.strictEqual(_(array).a().value(), 'a');

        reset(_);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should accept a function `object`

```ts
test('should accept a function `object`', function(assert) {
      assert.expect(2);

      _.mixin(Wrapper, source);

      var wrapped = Wrapper(array),
          actual = wrapped.a();

      assert.strictEqual(actual.value(), 'a');
      assert.ok(actual instanceof Wrapper);

      reset(Wrapper);
    }
```

#### should accept an `options`

```ts
test('should accept an `options`', function(assert) {
      assert.expect(8);

      function message(func, chain) {
        return (func === _ ? 'lodash' : 'given') + ' function should ' + (chain ? '' : 'not ') + 'chain';
      }

      lodashStable.each([_, Wrapper], function(func) {
        lodashStable.each([{ 'chain': false }, { 'chain': true }], function(options) {
          if (!isNpm) {
            if (func === _) {
              _.mixin(source, options);
            } else {
              _.mixin(func, source, options);
            }
            var wrapped = func(array),
                actual = wrapped.a();

            if (options.chain) {
              assert.strictEqual(actual.value(), 'a', message(func, true));
              assert.ok(actual instanceof func, message(func, true));
            } else {
              assert.strictEqual(actual, 'a', message(func, false));
              assert.notOk(actual instanceof func, message(func, false));
            }
            reset(func);
          }
          else {
            skipAssert(assert, 2);
          }
        });
      });
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

#### should not return the existing wrapped value when chaining

```ts
test('should not return the existing wrapped value when chaining', function(assert) {
      assert.expect(2);

      lodashStable.each([_, Wrapper], function(func) {
        if (!isNpm) {
          if (func === _) {
            var wrapped = _(source),
                actual = wrapped.mixin();

            assert.strictEqual(actual.value(), _);
          }
          else {
            wrapped = _(func);
            actual = wrapped.mixin(source);
            assert.notStrictEqual(actual, wrapped);
          }
          reset(func);
        }
        else {
          skipAssert(assert);
        }
      });
    }
```

#### should produce methods that work in a lazy sequence

```ts
test('should produce methods that work in a lazy sequence', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        _.mixin({ 'a': _.countBy, 'b': _.filter });

        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            actual = _(array).a().map(square).b(isEven).take().value();

        assert.deepEqual(actual, _.take(_.b(_.map(_.a(array), square), isEven)));

        reset(_);
      }
      else {
        skipAssert(assert);
      }
    }
```

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

#### should get the nth element of `array`

```ts
test('should get the nth element of `array`', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(array, function(value, index) {
        return _.nth(array, index);
      });

      assert.deepEqual(actual, array);
    }
```

#### should coerce `n` to an integer

```ts
test('should coerce `n` to an integer', function(assert) {
      assert.expect(2);

      var values = falsey,
          expected = lodashStable.map(values, stubA);

      var actual = lodashStable.map(values, function(n) {
        return n ? _.nth(array, n) : _.nth(array);
      });

      assert.deepEqual(actual, expected);

      values = ['1', 1.6];
      expected = lodashStable.map(values, stubB);

      actual = lodashStable.map(values, function(n) {
        return _.nth(array, n);
      });

      assert.deepEqual(actual, expected);
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

#### should create a function that returns its nth argument

```ts
test('should create a function that returns its nth argument', function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(args, function(value, index) {
        var func = _.nthArg(index);
        return func.apply(undefined, args);
      });

      assert.deepEqual(actual, args);
    }
```

#### should coerce `n` to an integer

```ts
test('should coerce `n` to an integer', function(assert) {
      assert.expect(2);

      var values = falsey,
          expected = lodashStable.map(values, stubA);

      var actual = lodashStable.map(values, function(n) {
        var func = n ? _.nthArg(n) : _.nthArg();
        return func.apply(undefined, args);
      });

      assert.deepEqual(actual, expected);

      values = ['1', 1.6];
      expected = lodashStable.map(values, stubB);

      actual = lodashStable.map(values, function(n) {
        var func = _.nthArg(n);
        return func.apply(undefined, args);
      });

      assert.deepEqual(actual, expected);
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

#### should return an empty object when `object` is nullish

```ts
test('should return an empty object when `object` is nullish', function(assert) {
      assert.expect(2);

      lodashStable.each([null, undefined], function(value) {
        objectProto.a = 1;
        var actual = _.omit(value, 'valueOf');
        delete objectProto.a;
        assert.deepEqual(actual, {});
      });
    }
```

#### `_.' + methodName + '` should include symbols

```ts
test('`_.' + methodName + '` should include symbols', function(assert) {
      assert.expect(3);

      function Foo() {
        this.a = 0;
        this[symbol] = 1;
      }

      if (Symbol) {
        var symbol2 = Symbol('b');
        Foo.prototype[symbol2] = 2;

        var symbol3 = Symbol('c');
        defineProperty(Foo.prototype, symbol3, {
          'configurable': true,
          'enumerable': false,
          'writable': true,
          'value': 3
        });

        var foo = new Foo,
            actual = func(foo, resolve(foo, 'a'));

        assert.strictEqual(actual[symbol], 1);
        assert.strictEqual(actual[symbol2], 2);
        assert.notOk(symbol3 in actual);
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### `_.' + methodName + '` should create an object with omitted symbols

```ts
test('`_.' + methodName + '` should create an object with omitted symbols', function(assert) {
      assert.expect(8);

      function Foo() {
        this.a = 0;
        this[symbol] = 1;
      }

      if (Symbol) {
        var symbol2 = Symbol('b');
        Foo.prototype[symbol2] = 2;

        var symbol3 = Symbol('c');
        defineProperty(Foo.prototype, symbol3, {
          'configurable': true,
          'enumerable': false,
          'writable': true,
          'value': 3
        });

        var foo = new Foo,
            actual = func(foo, resolve(foo, symbol));

        assert.strictEqual(actual.a, 0);
        assert.notOk(symbol in actual);
        assert.strictEqual(actual[symbol2], 2);
        assert.notOk(symbol3 in actual);

        actual = func(foo, resolve(foo, symbol2));

        assert.strictEqual(actual.a, 0);
        assert.strictEqual(actual[symbol], 1);
        assert.notOk(symbol2 in actual);
        assert.notOk(symbol3 in actual);
      }
      else {
        skipAssert(assert, 8);
      }
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant(' abc  '));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.pad(string, 6, value) : _.pad(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.pad(value, 6) === ' abc  ';
      });

      assert.deepEqual(actual, expected);
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant('abc   '));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.padEnd(string, 6, value) : _.padEnd(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.padEnd(value, 6) === 'abc   ';
      });

      assert.deepEqual(actual, expected);
    }
```

#### should pad a string to a given length

```ts
test('should pad a string to a given length', function(assert) {
      assert.expect(1);

      var values = [, undefined],
          expected = lodashStable.map(values, lodashStable.constant('   abc'));

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.padStart(string, 6, value) : _.padStart(string, 6);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `string` to a string

```ts
test('should coerce `string` to a string', function(assert) {
      assert.expect(1);

      var values = [Object(string), { 'toString': lodashStable.constant(string) }],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return _.padStart(value, 6) === '   abc';
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should treat nullish values as empty strings

```ts
test('`_.' + methodName + '` should treat nullish values as empty strings', function(assert) {
      assert.expect(6);

      lodashStable.each([undefined, '_-'], function(chars) {
        var expected = chars ? (isPad ? '__' : chars) : '  ';
        assert.strictEqual(func(null, 2, chars), expected);
        assert.strictEqual(func(undefined, 2, chars), expected);
        assert.strictEqual(func('', 2, chars), expected);
      });
    }
```

#### `_.' + methodName + '` should return `string` when `chars` coerces to an empty string

```ts
test('`_.' + methodName + '` should return `string` when `chars` coerces to an empty string', function(assert) {
      assert.expect(1);

      var values = ['', Object('')],
          expected = lodashStable.map(values, lodashStable.constant(string));

      var actual = lodashStable.map(values, function(value) {
        return _.pad(string, 6, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `radix` to a number

```ts
test('should coerce `radix` to a number', function(assert) {
      assert.expect(2);

      var object = { 'valueOf': stubZero };
      assert.strictEqual(_.parseInt('08', object), 8);
      assert.strictEqual(_.parseInt('0x20', object), 32);
    }
```

#### `_.' + methodName + '` should ensure `new par` is an instance of `func`

```ts
test('`_.' + methodName + '` should ensure `new par` is an instance of `func`', function(assert) {
      assert.expect(2);

      function Foo(value) {
        return value && object;
      }

      var object = {},
          par = func(Foo);

      assert.ok(new par instanceof Foo);
      assert.strictEqual(new par(true), object);
    }
```

#### should work as a deep `_.defaults`

```ts
test('should work as a deep `_.defaults`', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': 2 } },
          source = { 'a': { 'b': 3, 'c': 3 } },
          expected = { 'a': { 'b': 2, 'c': 3 } };

      var defaultsDeep = _.partialRight(_.mergeWith, function deep(value, other) {
        return lodashStable.isObject(value) ? _.mergeWith(value, other, deep) : value;
      });

      assert.deepEqual(defaultsDeep(object, source), expected);
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

#### should return an empty object when `object` is nullish

```ts
test('should return an empty object when `object` is nullish', function(assert) {
      assert.expect(2);

      lodashStable.each([null, undefined], function(value) {
        assert.deepEqual(_.pick(value, 'valueOf'), {});
      });
    }
```

#### `_.' + methodName + '` should pick symbols

```ts
test('`_.' + methodName + '` should pick symbols', function(assert) {
      assert.expect(3);

      function Foo() {
        this[symbol] = 1;
      }

      if (Symbol) {
        var symbol2 = Symbol('b');
        Foo.prototype[symbol2] = 2;

        var symbol3 = Symbol('c');
        defineProperty(Foo.prototype, symbol3, {
          'configurable': true,
          'enumerable': false,
          'writable': true,
          'value': 3
        });

        var foo = new Foo,
            actual = func(foo, resolve(foo, [symbol, symbol2, symbol3]));

        assert.strictEqual(actual[symbol], 1);
        assert.strictEqual(actual[symbol2], 2);

        if (isPick) {
          assert.strictEqual(actual[symbol3], 3);
        } else {
          assert.notOk(symbol3 in actual);
        }
      }
      else {
        skipAssert(assert, 3);
      }
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

#### should work with the same value for `array` and `values`

```ts
test('should work with the same value for `array` and `values`', function(assert) {
      assert.expect(1);

      var array = [{ 'a': 1 }, { 'b': 2 }],
          actual = _.pullAll(array, array);

      assert.deepEqual(actual, []);
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

#### should support large integer values

```ts
test('should support large integer values', function(assert) {
      assert.expect(2);

      var min = Math.pow(2, 31),
          max = Math.pow(2, 62);

      assert.ok(lodashStable.every(array, function() {
        var result = _.random(min, max);
        return result >= min && result <= max;
      }));

      assert.ok(lodashStable.some(array, function() {
        return _.random(MAX_INTEGER);
      }));
    }
```

#### `_.' + methodName + '` should treat falsey `start` as `0`

```ts
test('`_.' + methodName + '` should treat falsey `start` as `0`', function(assert) {
      assert.expect(13);

      lodashStable.each(falsey, function(value, index) {
        if (index) {
          assert.deepEqual(func(value), []);
          assert.deepEqual(func(value, 1), [0]);
        } else {
          assert.deepEqual(func(), []);
        }
      });
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

#### `_.' + methodName + '` should reduce a collection to a single value

```ts
test('`_.' + methodName + '` should reduce a collection to a single value', function(assert) {
      assert.expect(1);

      var actual = func(['a', 'b', 'c'], function(accumulator, value) {
        return accumulator + value;
      }, '');

      assert.strictEqual(actual, isReduce ? 'abc' : 'cba');
    }
```

#### `_.' + methodName + '` should support empty collections without an initial `accumulator` value

```ts
test('`_.' + methodName + '` should support empty collections without an initial `accumulator` value', function(assert) {
      assert.expect(1);

      var actual = [],
          expected = lodashStable.map(empties, noop);

      lodashStable.each(empties, function(value) {
        try {
          actual.push(func(value, noop));
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should support empty collections with an initial `accumulator` value

```ts
test('`_.' + methodName + '` should support empty collections with an initial `accumulator` value', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, lodashStable.constant('x'));

      var actual = lodashStable.map(empties, function(value) {
        try {
          return func(value, noop, 'x');
        } catch (e) {}
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should handle an initial `accumulator` value of `undefined`

```ts
test('`_.' + methodName + '` should handle an initial `accumulator` value of `undefined`', function(assert) {
      assert.expect(1);

      var actual = func([], noop, undefined);
      assert.strictEqual(actual, undefined);
    }
```

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.strictEqual(_(array)[methodName](add), 6);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(array).chain()[methodName](add) instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should not modify the resulting value from within `predicate`

```ts
test('`_.' + methodName + '` should not modify the resulting value from within `predicate`', function(assert) {
      assert.expect(1);

      var actual = func([0], function(value, index, array) {
        array[index] = 1;
        return isFilter;
      });

      assert.deepEqual(actual, [0]);
    }
```

#### `_.' + methodName + '` should not modify wrapped values

```ts
test('`_.' + methodName + '` should not modify wrapped values', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _(array);

        var actual = wrapped[methodName](function(n) {
          return n < 3;
        });

        assert.deepEqual(actual.value(), isFilter ? [1, 2] : [3, 4]);

        actual = wrapped[methodName](function(n) {
          return n > 2;
        });

        assert.deepEqual(actual.value(), isFilter ? [3, 4] : [1, 2]);
      }
      else {
        skipAssert(assert, 2);
      }
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

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? string : '';
      });

      var actual = lodashStable.map(falsey, function(n, index) {
        return index ? _.repeat(string, n) : _.repeat(string);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should coerce `n` to an integer

```ts
test('should coerce `n` to an integer', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.repeat(string, '2'), 'abcabc');
      assert.strictEqual(_.repeat(string, 2.6), 'abcabc');
      assert.strictEqual(_.repeat('*', { 'valueOf': stubThree }), '***');
    }
```

#### should invoke function values

```ts
test('should invoke function values', function(assert) {
      assert.expect(1);

      assert.strictEqual(_.result(object, 'b'), 'b');
    }
```

#### should invoke default function values

```ts
test('should invoke default function values', function(assert) {
      assert.expect(1);

      var actual = _.result(object, 'c', object.b);
      assert.strictEqual(actual, 'b');
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

#### should invoke deep property methods with the correct `this` binding

```ts
test('should invoke deep property methods with the correct `this` binding', function(assert) {
      assert.expect(2);

      var value = { 'a': { 'b': function() { return this.c; }, 'c': 1 } };

      lodashStable.each(['a.b', ['a', 'b']], function(path) {
        assert.strictEqual(_.result(value, path), 1);
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

#### should return the wrapped reversed `array`

```ts
test('should return the wrapped reversed `array`', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        lodashStable.times(2, function(index) {
          var array = (index ? largeArray : smallArray).slice(),
              clone = array.slice(),
              wrapped = _(array).reverse(),
              actual = wrapped.value();

          assert.ok(wrapped instanceof _);
          assert.strictEqual(actual, array);
          assert.deepEqual(actual, clone.slice().reverse());
        });
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        lodashStable.times(2, function(index) {
          var array = (index ? largeArray : smallArray).slice(),
              expected = array.slice(),
              actual = _(array).slice(1).reverse().value();

          assert.deepEqual(actual, expected.slice(1).reverse());
          assert.deepEqual(array, expected);
        });
      }
      else {
        skipAssert(assert, 4);
      }
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

#### should track the `__chain__` value of a wrapper

```ts
test('should track the `__chain__` value of a wrapper', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        lodashStable.times(2, function(index) {
          var array = (index ? largeArray : smallArray).slice(),
              expected = array.slice().reverse(),
              wrapped = _(array).chain().reverse().head();

          assert.ok(wrapped instanceof _);
          assert.strictEqual(wrapped.value(), _.head(expected));
          assert.deepEqual(array, expected);
        });
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var values = [[0], [-0], ['0'], ['-0'], [0, 1], [-0, 1], ['0', 1], ['-0', 1]],
          expected = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];

      var actual = lodashStable.map(values, function(args) {
        return 1 / func.apply(undefined, args);
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

#### should treat falsey `size` values, except `undefined`, as `0`

```ts
test('should treat falsey `size` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? ['a'] : [];
      });

      var actual = lodashStable.map(falsey, function(size, index) {
        return index ? _.sampleSize(['a'], size) : _.sampleSize(['a']);
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

#### should sample an object

```ts
test('should sample an object', function(assert) {
      assert.expect(2);

      var object = { 'a': 1, 'b': 2, 'c': 3 },
          actual = _.sampleSize(object, 2);

      assert.strictEqual(actual.length, 2);
      assert.deepEqual(lodashStable.difference(actual, lodashStable.values(object)), []);
    }
```

#### should work with a `customizer` callback

```ts
test('should work with a `customizer` callback', function(assert) {
      assert.expect(1);

      var actual = _.setWith({ '0': {} }, '[0][1][2]', 3, function(value) {
        return lodashStable.isObject(value) ? undefined : {};
      });

      assert.deepEqual(actual, { '0': { '1': { '2': 3 } } });
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

#### `_.' + methodName + '` should not ignore empty brackets

```ts
test('`_.' + methodName + '` should not ignore empty brackets', function(assert) {
      assert.expect(1);

      var object = {};

      func(object, 'a[]', updater);
      assert.deepEqual(object, { 'a': { '': value } });
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

#### `_.' + methodName + '` should not error when `object` is nullish

```ts
test('`_.' + methodName + '` should not error when `object` is nullish', function(assert) {
      assert.expect(1);

      var values = [null, undefined],
          expected = [[null, null], [undefined, undefined]];

      var actual = lodashStable.map(values, function(value) {
        try {
          return [func(value, 'a.b', updater), func(value, ['a', 'b'], updater)];
        } catch (e) {
          return e.message;
        }
      });

      assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` should not assign values that are the same as their destinations

```ts
test('`_.' + methodName + '` should not assign values that are the same as their destinations', function(assert) {
      assert.expect(4);

      lodashStable.each(['a', ['a'], { 'a': 1 }, NaN], function(value) {
        var object = {},
            pass = true,
            updater = isUpdate ? lodashStable.constant(value) : value;

        defineProperty(object, 'a', {
          'configurable': true,
          'enumerable': true,
          'get': lodashStable.constant(value),
          'set': function() { pass = false; }
        });

        func(object, 'a', updater);
        assert.ok(pass);
      });
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.shuffle(1), []);
    }
```

#### should treat falsey `start` values as `0`

```ts
test('should treat falsey `start` values as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, lodashStable.constant(array));

      var actual = lodashStable.map(falsey, function(start) {
        return _.slice(array, start);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should treat falsey `end` values, except `undefined`, as `0`

```ts
test('should treat falsey `end` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? array : [];
      });

      var actual = lodashStable.map(falsey, function(end, index) {
        return index ? _.slice(array, 0, end) : _.slice(array, 0);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(38);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 1),
            length = array.length,
            wrapped = _(array);

        lodashStable.each(['map', 'filter'], function(methodName) {
          assert.deepEqual(wrapped[methodName]().slice(0, -1).value(), array.slice(0, -1));
          assert.deepEqual(wrapped[methodName]().slice(1).value(), array.slice(1));
          assert.deepEqual(wrapped[methodName]().slice(1, 3).value(), array.slice(1, 3));
          assert.deepEqual(wrapped[methodName]().slice(-1).value(), array.slice(-1));

          assert.deepEqual(wrapped[methodName]().slice(length).value(), array.slice(length));
          assert.deepEqual(wrapped[methodName]().slice(3, 2).value(), array.slice(3, 2));
          assert.deepEqual(wrapped[methodName]().slice(0, -length).value(), array.slice(0, -length));
          assert.deepEqual(wrapped[methodName]().slice(0, null).value(), array.slice(0, null));

          assert.deepEqual(wrapped[methodName]().slice(0, length).value(), array.slice(0, length));
          assert.deepEqual(wrapped[methodName]().slice(-length).value(), array.slice(-length));
          assert.deepEqual(wrapped[methodName]().slice(null).value(), array.slice(null));

          assert.deepEqual(wrapped[methodName]().slice(0, 1).value(), array.slice(0, 1));
          assert.deepEqual(wrapped[methodName]().slice(NaN, '1').value(), array.slice(NaN, '1'));

          assert.deepEqual(wrapped[methodName]().slice(0.1, 1.1).value(), array.slice(0.1, 1.1));
          assert.deepEqual(wrapped[methodName]().slice('0', 1).value(), array.slice('0', 1));
          assert.deepEqual(wrapped[methodName]().slice(0, '1').value(), array.slice(0, '1'));
          assert.deepEqual(wrapped[methodName]().slice('1').value(), array.slice('1'));
          assert.deepEqual(wrapped[methodName]().slice(NaN, 1).value(), array.slice(NaN, 1));
          assert.deepEqual(wrapped[methodName]().slice(1, NaN).value(), array.slice(1, NaN));
        });
      }
      else {
        skipAssert(assert, 38);
      }
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

#### should return `true` as soon as `predicate` returns truthy

```ts
test('should return `true` as soon as `predicate` returns truthy', function(assert) {
      assert.expect(2);

      var count = 0;

      assert.strictEqual(_.some([null, true, null], function(value) {
        count++;
        return value;
      }), true);

      assert.strictEqual(count, 2);
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

#### should move `NaN`, nullish, and symbol values to the end

```ts
test('should move `NaN`, nullish, and symbol values to the end', function(assert) {
      assert.expect(2);

      var symbol1 = Symbol ? Symbol('a') : null,
          symbol2 = Symbol ? Symbol('b') : null,
          array = [NaN, undefined, null, 4, symbol1, null, 1, symbol2, undefined, 3, NaN, 2],
          expected = [1, 2, 3, 4, symbol1, symbol2, null, null, undefined, undefined, NaN, NaN];

      assert.deepEqual(_.sortBy(array), expected);

      array = [NaN, undefined, symbol1, null, 'd', null, 'a', symbol2, undefined, 'c', NaN, 'b'];
      expected = ['a', 'b', 'c', 'd', symbol1, symbol2, null, null, undefined, undefined, NaN, NaN];

      assert.deepEqual(_.sortBy(array), expected);
    }
```

#### should treat number values for `collection` as empty

```ts
test('should treat number values for `collection` as empty', function(assert) {
      assert.expect(1);

      assert.deepEqual(_.sortBy(1), []);
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

#### `_.' + methodName + '` should return the insert index

```ts
test('`_.' + methodName + '` should return the insert index', function(assert) {
      assert.expect(1);

      var array = [30, 50],
          values = [30, 40, 50],
          expected = isSortedIndex ? [0, 1, 1] : [1, 1, 2];

      var actual = lodashStable.map(values, function(value) {
        return func(array, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should work with an array of strings

```ts
test('`_.' + methodName + '` should work with an array of strings', function(assert) {
      assert.expect(1);

      var array = ['a', 'c'],
          values = ['a', 'b', 'c'],
          expected = isSortedIndex ? [0, 1, 1] : [1, 1, 2];

      var actual = lodashStable.map(values, function(value) {
        return func(array, value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should accept a nullish `array` and a `value`

```ts
test('`_.' + methodName + '` should accept a nullish `array` and a `value`', function(assert) {
      assert.expect(1);

      var values = [null, undefined],
          expected = lodashStable.map(values, lodashStable.constant([0, 0, 0]));

      var actual = lodashStable.map(values, function(array) {
        return [func(array, 1), func(array, undefined), func(array, NaN)];
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should support arrays larger than `MAX_ARRAY_LENGTH / 2`

```ts
test('`_.' + methodName + '` should support arrays larger than `MAX_ARRAY_LENGTH / 2`', function(assert) {
      assert.expect(12);

      lodashStable.each([Math.ceil(MAX_ARRAY_LENGTH / 2), MAX_ARRAY_LENGTH], function(length) {
        var array = [],
            values = [MAX_ARRAY_LENGTH, NaN, undefined];

        array.length = length;

        lodashStable.each(values, function(value) {
          var steps = 0;

          var actual = func(array, value, function(value) {
            steps++;
            return value;
          });

          var expected = (isSortedIndexBy ? !lodashStable.isNaN(value) : lodashStable.isFinite(value))
            ? 0
            : Math.min(length, MAX_ARRAY_INDEX);

          assert.ok(steps == 32 || steps == 33);
          assert.strictEqual(actual, expected);
        });
      });
    }
```

#### should return unique values of a sorted array

```ts
test('should return unique values of a sorted array', function(assert) {
      assert.expect(3);

      var expected = [1, 2, 3];

      lodashStable.each([[1, 2, 3], [1, 1, 2, 2, 3], [1, 2, 3, 3, 3, 3, 3]], function(array) {
        assert.deepEqual(_.sortedUniq(array), expected);
      });
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

#### should treat falsey `position` values as `0`

```ts
test('should treat falsey `position` values as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubTrue);

      var actual = lodashStable.map(falsey, function(position) {
        return _.startsWith(string, 'a', position);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should return ' + pair[1], function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? func.call({}) : func();
        }
        return func(value);
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.subtract');

  (function() {
    QUnit.test('should subtract two numbers

```ts
test('`_.' + methodName + '` should return ' + pair[1], function(assert) {
      assert.expect(1);

      var actual = lodashStable.map(values, function(value, index) {
        if (index < 2) {
          return index ? func.call({}) : func();
        }
        return func(value);
      });

      assert.deepEqual(actual, expected);
    });
  });

  /*--------------------------------------------------------------------------*/

  QUnit.module('lodash.subtract');

  (function() {
    QUnit.test('should subtract two numbers', function(assert) {
      assert.expect(3);

      assert.strictEqual(_.subtract(6, 4), 2);
      assert.strictEqual(_.subtract(-6, 4), -10);
      assert.strictEqual(_.subtract(-6, -4), -2);
    }
```

#### `_.' + methodName + '` should preserve the sign of `0`

```ts
test('`_.' + methodName + '` should preserve the sign of `0`', function(assert) {
      assert.expect(2);

      var values = [0, '0', -0, '-0'],
          expected = [[0, Infinity], ['0', Infinity], [-0, -Infinity], ['-0', -Infinity]];

      lodashStable.times(2, function(index) {
        var actual = lodashStable.map(values, function(value) {
          var result = index ? func(undefined, value) : func(value);
          return [result, 1 / result];
        });

        assert.deepEqual(actual, expected);
      });
    }
```

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = _(1)[methodName](2);
        assert.notOk(actual instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var actual = _(1).chain()[methodName](2);
        assert.ok(actual instanceof _);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return `0` when passing empty `array` values

```ts
test('`_.' + methodName + '` should return `0` when passing empty `array` values', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(empties, stubZero);

      var actual = lodashStable.map(empties, function(value) {
        return func(value);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should skip `undefined` values

```ts
test('`_.' + methodName + '` should skip `undefined` values', function(assert) {
      assert.expect(1);

      assert.strictEqual(func([1, undefined]), 1);
    }
```

#### `_.' + methodName + '` should not skip `NaN` values

```ts
test('`_.' + methodName + '` should not skip `NaN` values', function(assert) {
      assert.expect(1);

      assert.deepEqual(func([1, NaN]), NaN);
    }
```

#### `_.' + methodName + '` should not coerce values to numbers

```ts
test('`_.' + methodName + '` should not coerce values to numbers', function(assert) {
      assert.expect(1);

      assert.strictEqual(func(['1', '2']), '12');
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            values = [];

        var actual = _(array).tail().filter(function(value) {
          values.push(value);
          return false;
        })
        .value();

        assert.deepEqual(actual, []);
        assert.deepEqual(values, array.slice(1));

        values = [];

        actual = _(array).filter(function(value) {
          values.push(value);
          return isEven(value);
        })
        .tail()
        .value();

        assert.deepEqual(actual, _.tail(_.filter(array, isEven)));
        assert.deepEqual(values, array);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should not execute subsequent iteratees on an empty array in a lazy sequence

```ts
test('should not execute subsequent iteratees on an empty array in a lazy sequence', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            iteratee = function() { pass = false; },
            pass = true,
            actual = _(array).slice(0, 1).tail().map(iteratee).value();

        assert.ok(pass);
        assert.deepEqual(actual, []);

        pass = true;
        actual = _(array).filter().slice(0, 1).tail().map(iteratee).value();

        assert.ok(pass);
        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? [1] : [];
      });

      var actual = lodashStable.map(falsey, function(n) {
        return _.take(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var array = lodashStable.range(1, LARGE_ARRAY_SIZE + 1),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            actual = _(array).take(2).take().value();

        assert.deepEqual(actual, _.take(_.take(array, 2)));

        actual = _(array).filter(predicate).take(2).take().value();
        assert.deepEqual(values, [1, 2]);
        assert.deepEqual(actual, _.take(_.take(_.filter(array, predicate), 2)));

        actual = _(array).take(6).takeRight(4).take(2).takeRight().value();
        assert.deepEqual(actual, _.takeRight(_.take(_.takeRight(_.take(array, 6), 4), 2)));

        values = [];

        actual = _(array).take(array.length - 1).filter(predicate).take(6).takeRight(4).take(2).takeRight().value();
        assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        assert.deepEqual(actual, _.takeRight(_.take(_.takeRight(_.take(_.filter(_.take(array, array.length - 1), predicate), 6), 4), 2)));
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should treat falsey `n` values, except `undefined`, as `0`

```ts
test('should treat falsey `n` values, except `undefined`, as `0`', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, function(value) {
        return value === undefined ? [3] : [];
      });

      var actual = lodashStable.map(falsey, function(n) {
        return _.takeRight(array, n);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(6);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            predicate = function(value) { values.push(value); return isEven(value); },
            values = [],
            actual = _(array).takeRight(2).takeRight().value();

        assert.deepEqual(actual, _.takeRight(_.takeRight(array)));

        actual = _(array).filter(predicate).takeRight(2).takeRight().value();
        assert.deepEqual(values, array);
        assert.deepEqual(actual, _.takeRight(_.takeRight(_.filter(array, predicate), 2)));

        actual = _(array).takeRight(6).take(4).takeRight(2).take().value();
        assert.deepEqual(actual, _.take(_.takeRight(_.take(_.takeRight(array, 6), 4), 2)));

        values = [];

        actual = _(array).filter(predicate).takeRight(6).take(4).takeRight(2).take().value();
        assert.deepEqual(values, array);
        assert.deepEqual(actual, _.take(_.takeRight(_.take(_.takeRight(_.filter(array, predicate), 6), 4), 2)));
      }
      else {
        skipAssert(assert, 6);
      }
    }
```

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            predicate = function(n) { return n > 2; },
            expected = _.takeRightWhile(array, predicate),
            wrapped = _(array).takeRightWhile(predicate);

        assert.deepEqual(wrapped.value(), expected);
        assert.deepEqual(wrapped.reverse().value(), expected.slice().reverse());
        assert.strictEqual(wrapped.last(), _.last(expected));
      }
      else {
        skipAssert(assert, 3);
      }
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

#### should work in a lazy sequence

```ts
test('should work in a lazy sequence', function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE),
            predicate = function(n) { return n < 3; },
            expected = _.takeWhile(array, predicate),
            wrapped = _(array).takeWhile(predicate);

        assert.deepEqual(wrapped.value(), expected);
        assert.deepEqual(wrapped.reverse().value(), expected.slice().reverse());
        assert.strictEqual(wrapped.last(), _.last(expected));
      }
      else {
        skipAssert(assert, 3);
      }
    }
```

#### should work in a lazy sequence with `take`

```ts
test('should work in a lazy sequence with `take`', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array = lodashStable.range(LARGE_ARRAY_SIZE);

        var actual = _(array)
          .takeWhile(function(n) { return n < 4; })
          .take(2)
          .takeWhile(function(n) { return n == 0; })
          .value();

        assert.deepEqual(actual, [0]);
      }
      else {
        skipAssert(assert);
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

#### should intercept and return the given value

```ts
test('should intercept and return the given value', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var intercepted,
            array = [1, 2, 3];

        var actual = _.tap(array, function(value) {
          intercepted = value;
        });

        assert.strictEqual(actual, array);
        assert.strictEqual(intercepted, array);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should intercept unwrapped values and return wrapped values when chaining

```ts
test('should intercept unwrapped values and return wrapped values when chaining', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var intercepted,
            array = [1, 2, 3];

        var wrapped = _(array).tap(function(value) {
          intercepted = value;
          value.pop();
        });

        assert.ok(wrapped instanceof _);

        wrapped.value();
        assert.strictEqual(intercepted, array);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should escape values in "escape" delimiters

```ts
test('should escape values in "escape" delimiters', function(assert) {
      assert.expect(1);

      var strings = ['<p><%- value %></p>', '<p><%-value%></p>', '<p><%-\nvalue\n%></p>'],
          expected = lodashStable.map(strings, lodashStable.constant('<p>&amp;&lt;&gt;&quot;&#39;/</p>')),
          data = { 'value': '&<>"\'/' };

      var actual = lodashStable.map(strings, function(string) {
        return _.template(string)(data);
      });

      assert.deepEqual(actual, expected);
    }
```

#### should support "evaluate" delimiters with single line comments (test production builds)

```ts
test('should support "evaluate" delimiters with single line comments (test production builds)', function(assert) {
      assert.expect(1);

      var compiled = _.template('<% // A code comment. %><% if (value) { %>yap<% } else { %>nope<% } %>'),
          data = { 'value': true };

      assert.strictEqual(compiled(data), 'yap');
    }
```

#### should support referencing variables declared in "evaluate" delimiters from other delimiters

```ts
test('should support referencing variables declared in "evaluate" delimiters from other delimiters', function(assert) {
      assert.expect(1);

      var compiled = _.template('<% var b = a; %><%= b.value %>'),
          data = { 'a': { 'value': 1 } };

      assert.strictEqual(compiled(data), '1');
    }
```

#### should support "interpolate" delimiters with escaped values

```ts
test('should support "interpolate" delimiters with escaped values', function(assert) {
      assert.expect(1);

      var compiled = _.template('<%= a ? "a=\\"A\\"" : "" %>'),
          data = { 'a': true };

      assert.strictEqual(compiled(data), 'a="A"');
    }
```

#### should support "interpolate" delimiters containing ternary operators

```ts
test('should support "interpolate" delimiters containing ternary operators', function(assert) {
      assert.expect(1);

      var compiled = _.template('<%= value ? value : "b" %>'),
          data = { 'value': 'a' };

      assert.strictEqual(compiled(data), 'a');
    }
```

#### should support "interpolate" delimiters containing global values

```ts
test('should support "interpolate" delimiters containing global values', function(assert) {
      assert.expect(1);

      var compiled = _.template('<%= typeof Math.abs %>');

      try {
        var actual = compiled();
      } catch (e) {}

      assert.strictEqual(actual, 'function');
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

#### should support ES6 template delimiters

```ts
test('should support ES6 template delimiters', function(assert) {
      assert.expect(2);

      var data = { 'value': 2 };
      assert.strictEqual(_.template('1${value}3')(data), '123');
      assert.strictEqual(_.template('${"{" + value + "\\}"}')(data), '{2}');
    }
```

#### should support the "variable" options

```ts
test('should support the "variable" options', function(assert) {
      assert.expect(1);

      var compiled = _.template(
        '<% _.each( data.a, function( value ) { %>' +
            '<%= value.valueOf() %>' +
        '<% }) %>', { 'variable': 'data' }
      );

      var data = { 'a': [1, 2, 3] };

      try {
        assert.strictEqual(compiled(data), '123');
      } catch (e) {
        assert.ok(false, e.message);
      }
    }
```

#### should support custom delimiters

```ts
test('should support custom delimiters', function(assert) {
      assert.expect(2);

      lodashStable.times(2, function(index) {
        var settingsClone = lodashStable.clone(_.templateSettings);

        var settings = lodashStable.assign(index ? _.templateSettings : {}, {
          'escape': /\{\{-([\s\S]+?)\}\}/g,
          'evaluate': /\{\{([\s\S]+?)\}\}/g,
          'interpolate': /\{\{=([\s\S]+?)\}\}/g
        });

        var expected = '<ul><li>0: a &amp; A</li><li>1: b &amp; B</li></ul>',
            compiled = _.template('<ul>{{ _.each(collection, function(value, index) {}}<li>{{= index }}: {{- value }}</li>{{}); }}</ul>', index ? null : settings),
            data = { 'collection': ['a & A', 'b & B'] };

        assert.strictEqual(compiled(data), expected);
        lodashStable.assign(_.templateSettings, settingsClone);
      });
    }
```

#### should support custom delimiters containing special characters

```ts
test('should support custom delimiters containing special characters', function(assert) {
      assert.expect(2);

      lodashStable.times(2, function(index) {
        var settingsClone = lodashStable.clone(_.templateSettings);

        var settings = lodashStable.assign(index ? _.templateSettings : {}, {
          'escape': /<\?-([\s\S]+?)\?>/g,
          'evaluate': /<\?([\s\S]+?)\?>/g,
          'interpolate': /<\?=([\s\S]+?)\?>/g
        });

        var expected = '<ul><li>0: a &amp; A</li><li>1: b &amp; B</li></ul>',
            compiled = _.template('<ul><? _.each(collection, function(value, index) { ?><li><?= index ?>: <?- value ?></li><? }); ?></ul>', index ? null : settings),
            data = { 'collection': ['a & A', 'b & B'] };

        assert.strictEqual(compiled(data), expected);
        lodashStable.assign(_.templateSettings, settingsClone);
      });
    }
```

#### should use a `with` statement by default

```ts
test('should use a `with` statement by default', function(assert) {
      assert.expect(1);

      var compiled = _.template('<%= index %><%= collection[index] %><% _.each(collection, function(value, index) { %><%= index %><% }); %>'),
          actual = compiled({ 'index': 1, 'collection': ['a', 'b', 'c'] });

      assert.strictEqual(actual, '1b012');
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

#### should work with templates containing newlines and comments

```ts
test('should work with templates containing newlines and comments', function(assert) {
      assert.expect(1);

      var compiled = _.template('<%\n\
        // A code comment.\n\
        if (value) { value += 3; }\n\
        %><p><%= value %></p>'
      );

      assert.strictEqual(compiled({ 'value': 3 }), '<p>6</p>');
    }
```

#### should evaluate delimiters once

```ts
test('should evaluate delimiters once', function(assert) {
      assert.expect(1);

      var actual = [],
          compiled = _.template('<%= func("a") %><%- func("b") %><% func("c") %>'),
          data = { 'func': function(value) { actual.push(value); } };

      compiled(data);
      assert.deepEqual(actual, ['a', 'b', 'c']);
    }
```

#### should resolve nullish values to an empty string

```ts
test('should resolve nullish values to an empty string', function(assert) {
      assert.expect(3);

      var compiled = _.template('<%= a %><%- a %>'),
          data = { 'a': null };

      assert.strictEqual(compiled(data), '');

      data = { 'a': undefined };
      assert.strictEqual(compiled(data), '');

      data = { 'a': {} };
      compiled = _.template('<%= a.b %><%- a.b %>');
      assert.strictEqual(compiled(data), '');
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

#### should parse delimiters without newlines

```ts
test('should parse delimiters without newlines', function(assert) {
      assert.expect(1);

      var expected = '<<\nprint("<p>" + (value ? "yes" : "no") + "</p>")\n>>',
          compiled = _.template(expected, { 'evaluate': /<<(.+?)>>/g }),
          data = { 'value': true };

      assert.strictEqual(compiled(data), expected);
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

#### should expose the source on compiled templates

```ts
test('should expose the source on compiled templates', function(assert) {
      assert.expect(1);

      var compiled = _.template('x'),
          values = [String(compiled), compiled.source],
          expected = lodashStable.map(values, stubTrue);

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.includes(value, '__p');
      });

      assert.deepEqual(actual, expected);
    }
```

#### should not include sourceURLs in the source

```ts
test('should not include sourceURLs in the source', function(assert) {
      assert.expect(1);

      var options = { 'sourceURL': '/a/b/c' },
          compiled = _.template('x', options),
          values = [compiled.source, undefined];

      try {
        _.template('<% if x %>', options);
      } catch (e) {
        values[1] = e.source;
      }
      var expected = lodashStable.map(values, stubFalse);

      var actual = lodashStable.map(values, function(value) {
        return lodashStable.includes(value, 'sourceURL');
      });

      assert.deepEqual(actual, expected);
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

#### should coerce `length` to an integer

```ts
test('should coerce `length` to an integer', function(assert) {
      assert.expect(4);

      lodashStable.each(['', NaN, 4.6, '4'], function(length, index) {
        var actual = index > 1 ? 'h...' : '...';
        assert.strictEqual(_.truncate(string, { 'length': { 'valueOf': lodashStable.constant(length) } }), actual);
      });
    }
```

#### should support a `trailing` option

```ts
test('should support a `trailing` option', function(assert) {
      assert.expect(6);

      var done = assert.async();

      var withCount = 0,
          withoutCount = 0;

      var withTrailing = _.throttle(function(value) {
        withCount++;
        return value;
      }, 64, { 'trailing': true });

      var withoutTrailing = _.throttle(function(value) {
        withoutCount++;
        return value;
      }, 64, { 'trailing': false });

      assert.strictEqual(withTrailing('a'), 'a');
      assert.strictEqual(withTrailing('b'), 'a');

      assert.strictEqual(withoutTrailing('a'), 'a');
      assert.strictEqual(withoutTrailing('b'), 'a');

      setTimeout(function() {
        assert.strictEqual(withCount, 2);
        assert.strictEqual(withoutCount, 1);
        done();
      }, 256);
    }
```

#### should work with a system time of `0`

```ts
test('should work with a system time of `0`', function(assert) {
      assert.expect(3);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount < 4 ? 0 : +new Date;
            }
          }
        });

        var throttled = lodash.throttle(function(value) {
          callCount++;
          return value;
        }, 32);

        var results = [throttled('a'), throttled('b'), throttled('c')];
        assert.deepEqual(results, ['a', 'a', 'a']);
        assert.strictEqual(callCount, 1);

        setTimeout(function() {
          assert.strictEqual(callCount, 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert, 3);
        done();
      }
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

#### should coerce non-finite `n` values to `0`

```ts
test('should coerce non-finite `n` values to `0`', function(assert) {
      assert.expect(3);

      lodashStable.each([-Infinity, NaN, Infinity], function(n) {
        assert.deepEqual(_.times(n), []);
      });
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

#### should return a wrapped value when explicitly chaining

```ts
test('should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        assert.ok(_(3).chain().times() instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should convert values to integers

```ts
test('`_.' + methodName + '` should convert values to integers', function(assert) {
      assert.expect(6);

      assert.strictEqual(func(-5.6), -5);
      assert.strictEqual(func('5.6'), 5);
      assert.strictEqual(func(), 0);
      assert.strictEqual(func(NaN), 0);

      var expected = isSafe ? MAX_SAFE_INTEGER : MAX_INTEGER;
      assert.strictEqual(func(Infinity), expected);
      assert.strictEqual(func(-Infinity), -expected);
    }
```

#### `_.' + methodName + '` should support `value` of `-0`

```ts
test('`_.' + methodName + '` should support `value` of `-0`', function(assert) {
      assert.expect(1);

      assert.strictEqual(1 / func(-0), -Infinity);
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

#### `_.' + methodName + '` should pass thru primitive number values

```ts
test('`_.' + methodName + '` should pass thru primitive number values', function(assert) {
      assert.expect(1);

      var values = [0, 1, NaN];

      var expected = lodashStable.map(values, function(value) {
        return (!isToNumber && value !== value) ? 0 : value;
      });

      var actual = lodashStable.map(values, func);

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should convert number primitives and objects to numbers

```ts
test('`_.' + methodName + '` should convert number primitives and objects to numbers', function(assert) {
      assert.expect(1);

      var values = [2, 1.2, MAX_SAFE_INTEGER, MAX_INTEGER, Infinity, NaN];

      var expected = lodashStable.map(values, function(value) {
        if (!isToNumber) {
          if (!isToFinite && value == 1.2) {
            value = 1;
          }
          else if (value == Infinity) {
            value = MAX_INTEGER;
          }
          else if (value !== value) {
            value = 0;
          }
          if (isToLength || isToSafeInteger) {
            value = Math.min(value, isToLength ? MAX_ARRAY_LENGTH : MAX_SAFE_INTEGER);
          }
        }
        var neg = isToLength ? 0 : -value;
        return [value, value, neg, neg];
      });

      var actual = lodashStable.map(values, function(value) {
        return [func(value), func(Object(value)), func(-value), func(Object(-value))];
      });

      assert.deepEqual(actual, expected);
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

#### `_.' + methodName + '` should convert symbols to `' + (isToNumber ? 'NaN' : '0') + '`

```ts
test('`_.' + methodName + '` should convert symbols to `' + (isToNumber ? 'NaN' : '0') + '`', function(assert) {
      assert.expect(1);

      if (Symbol) {
        var object1 = Object(symbol),
            object2 = Object(symbol),
            values = [symbol, object1, object2],
            expected = lodashStable.map(values, lodashStable.constant(isToNumber ? NaN : 0));

        object2.valueOf = undefined;
        var actual = lodashStable.map(values, func);

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should convert empty values to `0` or `NaN`

```ts
test('`_.' + methodName + '` should convert empty values to `0` or `NaN`', function(assert) {
      assert.expect(1);

      var values = falsey.concat(whitespace);

      var expected = lodashStable.map(values, function(value) {
        return (isToNumber && value !== whitespace) ? Number(value) : 0;
      });

      var actual = lodashStable.map(values, function(value, index) {
        return index ? func(value) : func();
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should coerce objects to numbers

```ts
test('`_.' + methodName + '` should coerce objects to numbers', function(assert) {
      assert.expect(1);

      var values = [
        {},
        [],
        [1],
        [1, 2],
        { 'valueOf': '1.1' },
        { 'valueOf': '1.1', 'toString': lodashStable.constant('2.2') },
        { 'valueOf': lodashStable.constant('1.1'), 'toString': '2.2' },
        { 'valueOf': lodashStable.constant('1.1'), 'toString': lodashStable.constant('2.2') },
        { 'valueOf': lodashStable.constant('-0x1a2b3c') },
        { 'toString': lodashStable.constant('-0x1a2b3c') },
        { 'valueOf': lodashStable.constant('0o12345') },
        { 'toString': lodashStable.constant('0o12345') },
        { 'valueOf': lodashStable.constant('0b101010') },
        { 'toString': lodashStable.constant('0b101010') }
      ];

      var expected = [
        NaN,  0,   1,   NaN,
        NaN,  2.2, 1.1, 1.1,
        NaN,  NaN,
        5349, 5349,
        42,   42
      ];

      if (isToFinite) {
        expected = [
          0,    0,    1,   0,
          0,    2.2,  1.1, 1.1,
          0,    0,
          5349, 5349,
          42,   42
        ];
      }
      else if (!isToNumber) {
        expected = [
          0,    0,    1, 0,
          0,    2,    1, 1,
          0,    0,
          5349, 5349,
          42,   42
        ];
      }
      var actual = lodashStable.map(values, func);

      assert.deepEqual(actual, expected);
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

#### should treat nullish values as empty strings

```ts
test('should treat nullish values as empty strings', function(assert) {
      assert.expect(1);

      var values = [, null, undefined],
          expected = lodashStable.map(values, stubString);

      var actual = lodashStable.map(values, function(value, index) {
        return index ? _.toString(value) : _.toString();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should preserve the sign of `0`

```ts
test('should preserve the sign of `0`', function(assert) {
      assert.expect(1);

      var values = [-0, Object(-0), 0, Object(0)],
          expected = ['-0', '-0', '0', '0'],
          actual = lodashStable.map(values, _.toString);

      assert.deepEqual(actual, expected);
    }
```

#### should preserve the sign of `0` in an array

```ts
test('should preserve the sign of `0` in an array', function(assert) {
      assert.expect(1);

      var values = [-0, Object(-0), 0, Object(0)];
      assert.deepEqual(_.toString(values), '-0,-0,0,0');
    }
```

#### should return the `toString` result of the wrapped value

```ts
test('should return the `toString` result of the wrapped value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _([1, 2, 3]);
        assert.strictEqual(wrapped.toString(), '1,2,3');
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_.' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var string = whitespace + 'a b c' + whitespace,
            expected = (index == 2 ? whitespace : '') + 'a b c' + (index == 1 ? whitespace : '');

        assert.strictEqual(_(string)[methodName](), expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var string = whitespace + 'a b c' + whitespace;
        assert.ok(_(string).chain()[methodName]() instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should ignore values that are not arrays or `arguments` objects

```ts
test('`_.' + methodName + '` should ignore values that are not arrays or `arguments` objects', function(assert) {
      assert.expect(3);

      var array = [0];
      assert.deepEqual(func(array, 3, { '0': 1 }, null), array);
      assert.deepEqual(func(null, array, null, [2, 1]), [0, 2, 1]);
      assert.deepEqual(func(array, null, args, null), [0, 1, 2, 3]);
    }
```

#### should output values from the first possible array

```ts
test('should output values from the first possible array', function(assert) {
      assert.expect(1);

      var actual = _.unionBy([{ 'x': 1, 'y': 1 }], [{ 'x': 1, 'y': 2 }], 'x');
      assert.deepEqual(actual, [{ 'x': 1, 'y': 1 }]);
    }
```

#### should output values from the first possible array

```ts
test('should output values from the first possible array', function(assert) {
      assert.expect(1);

      var objects = [{ 'x': 1, 'y': 1 }],
          others = [{ 'x': 1, 'y': 2 }];

      var actual = _.unionWith(objects, others, function(a, b) {
        return a.x == b.x;
      });

      assert.deepEqual(actual, [{ 'x': 1, 'y': 1 }]);
    }
```

#### `_.' + methodName + '` should return unique values of an unsorted array

```ts
test('`_.' + methodName + '` should return unique values of an unsorted array', function(assert) {
        assert.expect(1);

        var array = [2, 1, 2];
        assert.deepEqual(func(array), [2, 1]);
      }
```

#### `_.' + methodName + '` should return unique values of a sorted array

```ts
test('`_.' + methodName + '` should return unique values of a sorted array', function(assert) {
      assert.expect(1);

      var array = [1, 2, 2];
      assert.deepEqual(func(array), [1, 2]);
    }
```

#### `_.' + methodName + '` should work with large arrays

```ts
test('`_.' + methodName + '` should work with large arrays', function(assert) {
      assert.expect(1);

      var largeArray = [],
          expected = [0, {}, 'a'],
          count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

      lodashStable.each(expected, function(value) {
        lodashStable.times(count, function() {
          largeArray.push(value);
        });
      });

      assert.deepEqual(func(largeArray), expected);
    }
```

#### `_.' + methodName + '` should work with large arrays of boolean, `NaN`, and nullish values

```ts
test('`_.' + methodName + '` should work with large arrays of boolean, `NaN`, and nullish values', function(assert) {
      assert.expect(1);

      var largeArray = [],
          expected = [null, undefined, false, true, NaN],
          count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

      lodashStable.each(expected, function(value) {
        lodashStable.times(count, function() {
          largeArray.push(value);
        });
      });

      assert.deepEqual(func(largeArray), expected);
    }
```

#### `_.' + methodName + '` should work with large arrays of well-known symbols

```ts
test('`_.' + methodName + '` should work with large arrays of well-known symbols', function(assert) {
      assert.expect(1);

      // See http://www.ecma-international.org/ecma-262/6.0/#sec-well-known-symbols.
      if (Symbol) {
        var expected = [
          Symbol.hasInstance, Symbol.isConcatSpreadable, Symbol.iterator,
          Symbol.match, Symbol.replace, Symbol.search, Symbol.species,
          Symbol.split, Symbol.toPrimitive, Symbol.toStringTag, Symbol.unscopables
        ];

        var largeArray = [],
            count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

        expected = lodashStable.map(expected, function(symbol) {
          return symbol || {};
        });

        lodashStable.each(expected, function(value) {
          lodashStable.times(count, function() {
            largeArray.push(value);
          });
        });

        assert.deepEqual(func(largeArray), expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### `_.' + methodName + '` should distinguish between numbers and numeric strings

```ts
test('`_.' + methodName + '` should distinguish between numbers and numeric strings', function(assert) {
      assert.expect(1);

      var largeArray = [],
          expected = ['2', 2, Object('2'), Object(2)],
          count = Math.ceil(LARGE_ARRAY_SIZE / expected.length);

      lodashStable.each(expected, function(value) {
        lodashStable.times(count, function() {
          largeArray.push(value);
        });
      });

      assert.deepEqual(func(largeArray), expected);
    }
```

#### should return a string value when not providing a `prefix`

```ts
test('should return a string value when not providing a `prefix`', function(assert) {
      assert.expect(1);

      assert.strictEqual(typeof _.uniqueId(), 'string');
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

#### should not error when `object` is nullish

```ts
test('should not error when `object` is nullish', function(assert) {
      assert.expect(1);

      var values = [null, undefined],
          expected = [[true, true], [true, true]];

      var actual = lodashStable.map(values, function(value) {
        try {
          return [_.unset(value, 'a.b'), _.unset(value, ['a', 'b'])];
        } catch (e) {
          return e.message;
        }
      });

      assert.deepEqual(actual, expected);
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

#### should work with a `customizer` callback

```ts
test('should work with a `customizer` callback', function(assert) {
      assert.expect(1);

      var actual = _.updateWith({ '0': {} }, '[0][1][2]', stubThree, function(value) {
        return lodashStable.isObject(value) ? undefined : {};
      });

      assert.deepEqual(actual, { '0': { '1': { '2': 3 } } });
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

#### `_.' + methodName + '` should work with `arguments` objects

```ts
test('`_.' + methodName + '` should work with `arguments` objects', function(assert) {
      assert.expect(1);

      var values = [args, strictArgs],
          expected = lodashStable.map(values, lodashStable.constant([1, 2, 3]));

      var actual = lodashStable.map(values, function(value) {
        return func(value).sort();
      });

      assert.deepEqual(actual, expected);
    }
```

#### should return the difference of values

```ts
test('should return the difference of values', function(assert) {
      assert.expect(1);

      var actual = _.without([2, 1, 2, 3], 1, 2);
      assert.deepEqual(actual, [3]);
    }
```

#### should use strict equality to determine the values to reject

```ts
test('should use strict equality to determine the values to reject', function(assert) {
      assert.expect(2);

      var object1 = { 'a': 1 },
          object2 = { 'b': 2 },
          array = [object1, object2];

      assert.deepEqual(_.without(array, { 'a': 1 }), array);
      assert.deepEqual(_.without(array, object1), [object2]);
    }
```

#### should remove all occurrences of each value from an array

```ts
test('should remove all occurrences of each value from an array', function(assert) {
      assert.expect(1);

      var array = [1, 2, 3, 1, 2, 3];
      assert.deepEqual(_.without(array, 1, 2), [3, 3]);
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

#### `_.' + methodName + '` should return an array of unique values

```ts
test('`_.' + methodName + '` should return an array of unique values', function(assert) {
      assert.expect(2);

      var actual = func([1, 1, 2, 5], [2, 2, 3, 5], [3, 4, 5, 5]);
      assert.deepEqual(actual, [1, 4]);

      actual = func([1, 1]);
      assert.deepEqual(actual, [1]);
    }
```

#### `_.' + methodName + '` should ignore values that are not arrays or `arguments` objects

```ts
test('`_.' + methodName + '` should ignore values that are not arrays or `arguments` objects', function(assert) {
      assert.expect(3);

      var array = [1, 2];
      assert.deepEqual(func(array, 3, { '0': 1 }, null), array);
      assert.deepEqual(func(null, array, null, [2, 3]), [1, 3]);
      assert.deepEqual(func(array, null, args, null), [3]);
    }
```

#### `_.' + methodName + '` should return a wrapped value when chaining

```ts
test('`_.' + methodName + '` should return a wrapped value when chaining', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _([1, 2, 3])[methodName]([5, 2, 1, 4]);
        assert.ok(wrapped instanceof _);
      }
      else {
        skipAssert(assert);
      }
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

#### `_.' + methodName + '` should ignore extra `values`

```ts
test('`_.' + methodName + '` should ignore extra `values`', function(assert) {
      assert.expect(1);

      assert.deepEqual(func(['a'], [1, 2]), { 'a': 1 });
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

#### `_.' + methodName + '` should treat falsey values as empty arrays

```ts
test('`_.' + methodName + '` should treat falsey values as empty arrays', function(assert) {
      assert.expect(1);

      var expected = lodashStable.map(falsey, stubArray);

      var actual = lodashStable.map(falsey, function(value) {
        return func([value, value, value]);
      });

      assert.deepEqual(actual, expected);
    }
```

#### `_.' + methodName + '` should ignore values that are not arrays or `arguments` objects

```ts
test('`_.' + methodName + '` should ignore values that are not arrays or `arguments` objects', function(assert) {
      assert.expect(1);

      var array = [[1, 2], [3, 4], null, undefined, { '0': 1 }];
      assert.deepEqual(func(array), [[1, 3], [2, 4]]);
    }
```

#### `_.' + methodName + '` should support consuming its return value

```ts
test('`_.' + methodName + '` should support consuming its return value', function(assert) {
      assert.expect(1);

      var expected = [['barney', 'fred'], [36, 40]];
      assert.deepEqual(func(func(func(func(expected)))), expected);
    }
```

#### should execute the chained sequence and returns the wrapped result

```ts
test('should execute the chained sequence and returns the wrapped result', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = [1],
            wrapped = _(array).push(2).push(3);

        assert.deepEqual(array, [1]);

        var otherWrapper = wrapped.commit();
        assert.ok(otherWrapper instanceof _);
        assert.deepEqual(otherWrapper.value(), [1, 2, 3]);
        assert.deepEqual(wrapped.value(), [1, 2, 3, 2, 3]);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should track the `__chain__` value of a wrapper

```ts
test('should track the `__chain__` value of a wrapper', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var wrapped = _([1]).chain().commit().head();
        assert.ok(wrapped instanceof _);
        assert.strictEqual(wrapped.value(), 1);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should follow the iterator protocol ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var wrapped = chain([1, 2]);

        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 1 });
        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 2 });
        assert.deepEqual(wrapped.next(), { 'done': true,  'value': undefined });
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should act as an iterable ' + chainType, function(assert) {
      assert.expect(2);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.strictEqual(wrapped[Symbol.iterator](), wrapped);
        assert.deepEqual(lodashStable.toArray(wrapped), array);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should use `_.toArray` to generate the iterable result ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Array.from) {
        var hearts = '\ud83d\udc95

```ts
test('should follow the iterator protocol ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm) {
        var wrapped = chain([1, 2]);

        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 1 });
        assert.deepEqual(wrapped.next(), { 'done': false, 'value': 2 });
        assert.deepEqual(wrapped.next(), { 'done': true,  'value': undefined });
      }
      else {
        skipAssert(assert, 3);
      }
    });

    QUnit.test('should act as an iterable ' + chainType, function(assert) {
      assert.expect(2);

      if (!isNpm && Symbol && Symbol.iterator) {
        var array = [1, 2],
            wrapped = chain(array);

        assert.strictEqual(wrapped[Symbol.iterator](), wrapped);
        assert.deepEqual(lodashStable.toArray(wrapped), array);
      }
      else {
        skipAssert(assert, 2);
      }
    });

    QUnit.test('should use `_.toArray` to generate the iterable result ' + chainType, function(assert) {
      assert.expect(3);

      if (!isNpm && Array.from) {
        var hearts = '\ud83d\udc95',
            values = [[1], { 'a': 1 }
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

#### should clone `chainAll` settings

```ts
test('should clone `chainAll` settings', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var array1 = [2, 4],
            array2 = [6, 8],
            wrapped1 = _(array1).chain().map(square),
            wrapped2 = wrapped1.plant(array2);

        assert.deepEqual(wrapped2.head().value(), 36);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should remove elements from the end of `array`

```ts
test('should remove elements from the end of `array`', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var array = [1, 2],
            wrapped = _(array);

        assert.strictEqual(wrapped.pop(), 2);
        assert.deepEqual(wrapped.value(), [1]);
        assert.strictEqual(wrapped.pop(), 1);

        var actual = wrapped.value();
        assert.strictEqual(actual, array);
        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).pop() : _().pop();
            return result === undefined;
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should append elements to `array`

```ts
test('should append elements to `array`', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = [1],
            wrapped = _(array).push(2, 3),
            actual = wrapped.value();

        assert.strictEqual(actual, array);
        assert.deepEqual(actual, [1, 2, 3]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).push(1).value() : _().push(1).value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should remove elements from the front of `array`

```ts
test('should remove elements from the front of `array`', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var array = [1, 2],
            wrapped = _(array);

        assert.strictEqual(wrapped.shift(), 1);
        assert.deepEqual(wrapped.value(), [2]);
        assert.strictEqual(wrapped.shift(), 2);

        var actual = wrapped.value();
        assert.strictEqual(actual, array);
        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).shift() : _().shift();
            return result === undefined;
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should return the wrapped sorted `array`

```ts
test('should return the wrapped sorted `array`', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = [3, 1, 2],
            wrapped = _(array).sort(),
            actual = wrapped.value();

        assert.strictEqual(actual, array);
        assert.deepEqual(actual, [1, 2, 3]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).sort().value() : _().sort().value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should support removing and inserting elements

```ts
test('should support removing and inserting elements', function(assert) {
      assert.expect(5);

      if (!isNpm) {
        var array = [1, 2],
            wrapped = _(array);

        assert.deepEqual(wrapped.splice(1, 1, 3).value(), [2]);
        assert.deepEqual(wrapped.value(), [1, 3]);
        assert.deepEqual(wrapped.splice(0, 2).value(), [1, 3]);

        var actual = wrapped.value();
        assert.strictEqual(actual, array);
        assert.deepEqual(actual, []);
      }
      else {
        skipAssert(assert, 5);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).splice(0, 1).value() : _().splice(0, 1).value();
            return lodashStable.isEqual(result, []);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should prepend elements to `array`

```ts
test('should prepend elements to `array`', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var array = [3],
            wrapped = _(array).unshift(1, 2),
            actual = wrapped.value();

        assert.strictEqual(actual, array);
        assert.deepEqual(actual, [1, 2, 3]);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### should accept falsey arguments

```ts
test('should accept falsey arguments', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var expected = lodashStable.map(falsey, stubTrue);

        var actual = lodashStable.map(falsey, function(value, index) {
          try {
            var result = index ? _(value).unshift(1).value() : _().unshift(1).value();
            return lodashStable.eq(result, value);
          } catch (e) {}
        });

        assert.deepEqual(actual, expected);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should execute the chained sequence and extract the unwrapped value

```ts
test('should execute the chained sequence and extract the unwrapped value', function(assert) {
      assert.expect(4);

      if (!isNpm) {
        var array = [1],
            wrapped = _(array).push(2).push(3);

        assert.deepEqual(array, [1]);
        assert.deepEqual(wrapped.value(), [1, 2, 3]);
        assert.deepEqual(wrapped.value(), [1, 2, 3, 2, 3]);
        assert.deepEqual(array, [1, 2, 3, 2, 3]);
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should return the `valueOf` result of the wrapped value

```ts
test('should return the `valueOf` result of the wrapped value', function(assert) {
      assert.expect(1);

      if (!isNpm) {
        var wrapped = _(123);
        assert.strictEqual(Number(wrapped), 123);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should stringify the wrapped value when used by `JSON.stringify`

```ts
test('should stringify the wrapped value when used by `JSON.stringify`', function(assert) {
      assert.expect(1);

      if (!isNpm && JSON) {
        var wrapped = _([1, 2, 3]);
        assert.strictEqual(JSON.stringify(wrapped), '[1,2,3]');
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should be aliased

```ts
test('should be aliased', function(assert) {
      assert.expect(2);

      if (!isNpm) {
        var expected = _.prototype.value;
        assert.strictEqual(_.prototype.toJSON, expected);
        assert.strictEqual(_.prototype.valueOf, expected);
      }
      else {
        skipAssert(assert, 2);
      }
    }
```

#### `_(...).' + methodName + '` should return a new wrapped value

```ts
test('`_(...).' + methodName + '` should return a new wrapped value', function(assert) {
        assert.expect(2);

        if (!isNpm) {
          var value = methodName == 'split' ? 'abc' : [1, 2, 3],
              wrapped = _(value),
              actual = wrapped[methodName]();

          assert.ok(actual instanceof _);
          assert.notStrictEqual(actual, wrapped);
        }
        else {
          skipAssert(assert, 2);
        }
      }
```

#### `_(...).' + methodName + '` should return an unwrapped value when implicitly chaining

```ts
test('`_(...).' + methodName + '` should return an unwrapped value when implicitly chaining', function(assert) {
        assert.expect(1);

        if (!isNpm) {
          var actual = _()[methodName]();
          assert.notOk(actual instanceof _);
        }
        else {
          skipAssert(assert);
        }
      }
```

#### `_(...).' + methodName + '` should return a wrapped value when explicitly chaining

```ts
test('`_(...).' + methodName + '` should return a wrapped value when explicitly chaining', function(assert) {
        assert.expect(1);

        if (!isNpm) {
          var actual = _().chain()[methodName]();
          assert.ok(actual instanceof _);
        }
        else {
          skipAssert(assert);
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

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

#### throttle arguments

```ts
test('throttle arguments', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var value = 0;
    var update = function(val){ value = val; };
    var throttledUpdate = _.throttle(update, 32);
    throttledUpdate(1); throttledUpdate(2);
    _.delay(function(){ throttledUpdate(3); }, 64);
    assert.equal(value, 1, 'updated to latest value');
    _.delay(function(){ assert.equal(value, 3, 'updated to latest value'); done(); }, 96);
  }
```

#### throttle once

```ts
test('throttle once', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var counter = 0;
    var incr = function(){ return ++counter; };
    var throttledIncr = _.throttle(incr, 32);
    var result = throttledIncr();
    _.delay(function(){
      assert.equal(result, 1, 'throttled functions return their value');
      assert.equal(counter, 1, 'incr was called once'); done();
    }, 64);
  }
```

#### throttle re-entrant

```ts
test('throttle re-entrant', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var sequence = [
      ['b1', 'b2'],
      ['c1', 'c2']
    ];
    var value = '';
    var throttledAppend;
    var append = function(arg){
      value += this + arg;
      var args = sequence.pop();
      if (args) {
        throttledAppend.call(args[0], args[1]);
      }
    };
    throttledAppend = _.throttle(append, 32);
    throttledAppend.call('a1', 'a2');
    assert.equal(value, 'a1a2');
    _.delay(function(){
      assert.equal(value, 'a1a2c1c2b1b2', 'append was throttled successfully');
      done();
    }, 100);
  }
```

#### debounce re-entrant

```ts
test('debounce re-entrant', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var sequence = [
      ['b1', 'b2']
    ];
    var value = '';
    var debouncedAppend;
    var append = function(arg){
      value += this + arg;
      var args = sequence.pop();
      if (args) {
        debouncedAppend.call(args[0], args[1]);
      }
    };
    debouncedAppend = _.debounce(append, 32);
    debouncedAppend.call('a1', 'a2');
    assert.equal(value, '');
    _.delay(function(){
      assert.equal(value, 'a1a2b1b2', 'append was debounced successfully');
      done();
    }, 100);
  }
```

#### once

```ts
test('once', function(assert) {
    var num = 0;
    var increment = _.once(function(){ return ++num; });
    increment();
    increment();
    assert.equal(num, 1);

    assert.equal(increment(), 1, 'stores a memo to the last value');
  }
```

#### before

```ts
test('before', function(assert) {
    var testBefore = function(beforeAmount, timesCalled) {
      var beforeCalled = 0;
      var before = _.before(beforeAmount, function() { beforeCalled++; });
      while (timesCalled--) before();
      return beforeCalled;
    };

    assert.equal(testBefore(5, 5), 4, 'before(N) should not fire after being called N times');
    assert.equal(testBefore(5, 4), 4, 'before(N) should fire before being called N times');
    assert.equal(testBefore(0, 0), 0, 'before(0) should not fire immediately');
    assert.equal(testBefore(0, 1), 0, 'before(0) should not fire when first invoked');

    var context = {num: 0};
    var increment = _.before(3, function(){ return ++this.num; });
    _.times(10, increment, context);
    assert.equal(increment(), 2, 'stores a memo to the last value');
    assert.equal(context.num, 2, 'provides context');
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

### ../../.sbomtest/repos/901466a5bb-lodash/test/test-fp.js

#### should accept a variety of options

```ts
test('should accept a variety of options', function(assert) {
      assert.expect(8);

      var array = [1, 2, 3, 4],
          value = _.clone(array),
          remove = convert('remove', _.remove, { 'cap': false }),
          actual = remove(isEvenIndex)(value);

      assert.deepEqual(value, [1, 2, 3, 4]);
      assert.deepEqual(actual, [2, 4]);

      remove = convert('remove', _.remove, { 'curry': false });
      actual = remove(isEven);

      assert.deepEqual(actual, []);

      var trim = convert('trim', _.trim, { 'fixed': false });
      assert.strictEqual(trim('_-abc-_', '_-'), 'abc');

      value = _.clone(array);
      remove = convert('remove', _.remove, { 'immutable': false });
      actual = remove(isEven)(value);

      assert.deepEqual(value, [1, 3]);
      assert.deepEqual(actual, [2, 4]);

      value = _.clone(array);
      remove = convert('remove', _.remove, { 'rearg': false });
      actual = remove(value)(isEven);

      assert.deepEqual(value, [1, 2, 3, 4]);
      assert.deepEqual(actual, [1, 3]);
    }
```

#### should not support shortcut fusion

```ts
test('should not support shortcut fusion', function(assert) {
      assert.expect(3);

      var array = fp.range(0, LARGE_ARRAY_SIZE),
          filterCount = 0,
          mapCount = 0;

      var iteratee = function(value) {
        mapCount++;
        return value * value;
      };

      var predicate = function(value) {
        filterCount++;
        return isEven(value);
      };

      var map1 = convert('map', _.map),
          filter1 = convert('filter', _.filter),
          take1 = convert('take', _.take);

      var filter2 = filter1(predicate),
          map2 = map1(iteratee),
          take2 = take1(2);

      var combined = fp.flow(map2, filter2, fp.compact, take2);

      assert.deepEqual(combined(array), [4, 16]);
      assert.strictEqual(filterCount, 200, 'filterCount');
      assert.strictEqual(mapCount, 200, 'mapCount');
    }
```

#### should only clone objects in `path`

```ts
test('should only clone objects in `path`', function(assert) {
      assert.expect(11);

      var object = { 'a': { 'b': 2, 'c': 3 }, 'd': { 'e': 4 } },
          value = _.cloneDeep(object),
          actual = fp.set('a.b.c.d', 5, value);

      assert.ok(_.isObject(actual.a.b), 'fp.set');
      assert.ok(_.isNumber(actual.a.b), 'fp.set');

      assert.strictEqual(actual.a.b.c.d, 5, 'fp.set');
      assert.strictEqual(actual.d, value.d, 'fp.set');

      value = _.cloneDeep(object);
      actual = fp.setWith(Object)('[0][1]')('a')(value);

      assert.deepEqual(actual[0], { '1': 'a' }, 'fp.setWith');

      value = _.cloneDeep(object);
      actual = fp.unset('a.b')(value);

      assert.notOk('b' in actual.a, 'fp.unset');
      assert.strictEqual(actual.a.c, value.a.c, 'fp.unset');

      value = _.cloneDeep(object);
      actual = fp.update('a.b')(square)(value);

      assert.strictEqual(actual.a.b, 4, 'fp.update');
      assert.strictEqual(actual.d, value.d, 'fp.update');

      value = _.cloneDeep(object);
      actual = fp.updateWith(Object)('[0][1]')(_.constant('a'))(value);

      assert.deepEqual(actual[0], { '1': 'a' }, 'fp.updateWith');
      assert.strictEqual(actual.d, value.d, 'fp.updateWith');
    }
```

#### `fp.' + methodName + '` should not mutate values

```ts
test('`fp.' + methodName + '` should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 },
          actual = func(object)({ 'b': 2 });

      assert.deepEqual(object, { 'a': 1 });
      assert.deepEqual(actual, { 'a': 1, 'b': 2 });
    }
```

#### `fp.' + methodName + '` should not mutate values

```ts
test('`fp.' + methodName + '` should not mutate values', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'b': 2 }],
          actual = func(objects);

      assert.deepEqual(objects[0], { 'a': 1 });
      assert.deepEqual(actual, { 'a': 1, 'b': 2 });
    }
```

#### `fp.' + methodName + '` should not mutate values

```ts
test('`fp.' + methodName + '` should not mutate values', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'b': 2 }],
          actual = func(_.noop)(objects);

      assert.deepEqual(objects[0], { 'a': 1 });
      assert.deepEqual(actual, { 'a': 1, 'b': 2 });
    }
```

#### should shallow clone array values

```ts
test('should shallow clone array values', function(assert) {
      assert.expect(2);

      var array = [1],
          actual = fp.castArray(array);

      assert.deepEqual(actual, array);
      assert.notStrictEqual(actual, array);
    }
```

#### should not shallow clone non-array values

```ts
test('should not shallow clone non-array values', function(assert) {
      assert.expect(2);

      var object = { 'a': 1 },
          actual = fp.castArray(object);

      assert.deepEqual(actual, [object]);
      assert.strictEqual(actual[0], object);
    }
```

#### should have an argument order of `defaultValue` then `value`

```ts
test('should have an argument order of `defaultValue` then `value`', function(assert) {
      assert.expect(2);

      assert.strictEqual(fp.defaultTo(1)(0), 0);
      assert.strictEqual(fp.defaultTo(1)(undefined), 1);
    }
```

#### should have an argument order of `iteratee`, `array`, then `values`

```ts
test('should have an argument order of `iteratee`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.differenceBy(Math.floor, [2.1, 1.2], [2.3, 3.4]);
      assert.deepEqual(actual, [1.2]);
    }
```

#### should have an argument order of `comparator`, `array`, then `values`

```ts
test('should have an argument order of `comparator`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.differenceWith(fp.eq)([2, 1])([2, 3]);
      assert.deepEqual(actual, [1]);
    }
```

#### should have an argument order of `start`, `end`, then `value`

```ts
test('should have an argument order of `start`, `end`, then `value`', function(assert) {
      assert.expect(1);

      var array = [1, 2, 3];
      assert.deepEqual(fp.fill(1)(2)('*')(array), [1, '*', 3]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.fill(1)(2)('*')(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [1, '*', 3]);
    }
```

#### should have an argument order of `value`, `fromIndex`, then `array`

```ts
test('should have an argument order of `value`, `fromIndex`, then `array`', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'a': 2 }, { 'a': 1 }, { 'a': 2 }];

      assert.strictEqual(fp.findFrom(resolve(1))(1)(objects), objects[2]);
      assert.strictEqual(fp.findFrom(resolve(2))(-2)(objects), objects[3]);
    }
```

#### should have an argument order of `value`, `fromIndex`, then `array`

```ts
test('should have an argument order of `value`, `fromIndex`, then `array`', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': 1 }, { 'a': 2 }, { 'a': 1 }, { 'a': 2 }];

      assert.strictEqual(fp.findLastFrom(resolve(1))(1)(objects), objects[0]);
      assert.strictEqual(fp.findLastFrom(resolve(2))(-2)(objects), objects[1]);
    }
```

#### fp.' + methodName + '` should have an argument order of `value`, `fromIndex`, then `array`

```ts
test('fp.' + methodName + '` should have an argument order of `value`, `fromIndex`, then `array`', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3, 1, 2, 3];

      assert.strictEqual(func(resolve(1))(2)(array), 3);
      assert.strictEqual(func(resolve(2))(-3)(array), 4);
    }
```

#### `fp.' + methodName + '` should support shortcut fusion

```ts
test('`fp.' + methodName + '` should support shortcut fusion', function(assert) {
      assert.expect(6);

      var filterCount,
          mapCount,
          array = fp.range(0, LARGE_ARRAY_SIZE);

      var iteratee = function(value) {
        mapCount++;
        return square(value);
      };

      var predicate = function(value) {
        filterCount++;
        return isEven(value);
      };

      var filter = fp.filter(predicate),
          map = fp.map(iteratee),
          take = fp.take(2);

      _.times(2, function(index) {
        var combined = isFlow
          ? func(map, filter, fp.compact, take)
          : func(take, fp.compact, filter, map);

        filterCount = mapCount = 0;

        if (WeakMap && WeakMap.name) {
          assert.deepEqual(combined(array), [4, 16]);
          assert.strictEqual(filterCount, 5, 'filterCount');
          assert.strictEqual(mapCount, 5, 'mapCount');
        }
        else {
          skipAssert(assert, 3);
        }
      });
    }
```

#### `fp.' + methodName + '` should provide `value` to `iteratee`

```ts
test('`fp.' + methodName + '` should provide `value` to `iteratee`', function(assert) {
      assert.expect(2);

      var args;

      func(function() {
        args || (args = slice.call(arguments));
      })(['a']);

      assert.deepEqual(args, ['a']);

      args = undefined;

      func(function() {
        args || (args = slice.call(arguments));
      })({ 'a': 1 });

      assert.deepEqual(args, [1]);
    }
```

#### should accept a `defaultValue` param

```ts
test('should accept a `defaultValue` param', function(assert) {
      assert.expect(1);

      var actual = fp.getOr('default')('path')({});
      assert.strictEqual(actual, 'default');
    }
```

#### should have an argument order of `start`, `end`, then `value`

```ts
test('should have an argument order of `start`, `end`, then `value`', function(assert) {
      assert.expect(2);

      assert.strictEqual(fp.inRange(2)(4)(3), true);
      assert.strictEqual(fp.inRange(-2)(-6)(-3), true);
    }
```

#### should have an argument order of `iteratee`, `array`, then `values`

```ts
test('should have an argument order of `iteratee`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.intersectionBy(Math.floor, [2.1, 1.2], [2.3, 3.4]);
      assert.deepEqual(actual, [2.1]);
    }
```

#### should have an argument order of `comparator`, `array`, then `values`

```ts
test('should have an argument order of `comparator`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.intersectionWith(fp.eq)([2, 1])([2, 3]);
      assert.deepEqual(actual, [2]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var objects = [{ 'a': [1, 2] }, { 'a': [3] }],
          actual = fp.mergeWith(_.noop, objects[0], objects[1]);

      assert.deepEqual(objects[0], { 'a': [1, 2] });
      assert.deepEqual(actual, { 'a': [3, 2] });
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

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.pull(2)(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [1, 3]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.pullAll([1, 3])(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [2]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.pullAt([0, 2])(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [2]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.remove(fp.eq(2))(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [1, 3]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var array = [1, 2, 3],
          actual = fp.reverse(array);

      assert.deepEqual(array, [1, 2, 3]);
      assert.deepEqual(actual, [3, 2, 1]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2, 'c': 3 } },
          actual = fp.set('a.b')(3)(object);

      assert.deepEqual(object, { 'a': { 'b': 2, 'c': 3 } });
      assert.deepEqual(actual, { 'a': { 'b': 3, 'c': 3 } });
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2, 'c': 3 } },
          actual = fp.setWith(Object)('d.e')(4)(object);

      assert.deepEqual(object, { 'a': { 'b': 2, 'c': 3 } });
      assert.deepEqual(actual, { 'a': { 'b': 2, 'c': 3 }, 'd': { 'e': 4 } });
    }
```

#### should have an argument order of `comparator`, `array`, then `values`

```ts
test('should have an argument order of `comparator`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.unionWith(fp.eq)([2, 1])([2, 3]);
      assert.deepEqual(actual, [2, 1, 3]);
    }
```

#### should have an argument order of `comparator`, `array`, then `values`

```ts
test('should have an argument order of `comparator`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.uniqWith(fp.eq)([2, 1, 2]);
      assert.deepEqual(actual, [2, 1]);
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2, 'c': 3 } },
          actual = fp.update('a.b')(square)(object);

      assert.deepEqual(object, { 'a': { 'b': 2, 'c': 3 } });
      assert.deepEqual(actual, { 'a': { 'b': 4, 'c': 3 } });
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2, 'c': 3 } },
          actual = fp.updateWith(Object)('d.e')(_.constant(4))(object);

      assert.deepEqual(object, { 'a': { 'b': 2, 'c': 3 } });
      assert.deepEqual(actual, { 'a': { 'b': 2, 'c': 3 }, 'd': { 'e': 4 } });
    }
```

#### should not mutate values

```ts
test('should not mutate values', function(assert) {
      assert.expect(2);

      var object = { 'a': { 'b': 2, 'c': 3 } },
          actual = fp.unset('a.b')(object);

      assert.deepEqual(object, { 'a': { 'b': 2, 'c': 3 } });
      assert.deepEqual(actual, { 'a': { 'c': 3 } });
    }
```

#### should have an argument order of `comparator`, `array`, then `values`

```ts
test('should have an argument order of `comparator`, `array`, then `values`', function(assert) {
      assert.expect(1);

      var actual = fp.xorWith(fp.eq)([2, 1])([2, 3]);
      assert.deepEqual(actual, [1, 3]);
    }
```

#### should zip together key/value arrays into an object

```ts
test('should zip together key/value arrays into an object', function(assert) {
      assert.expect(1);

      assert.deepEqual(fp.zipObject(['a', 'b'])([1, 2]), { 'a': 1, 'b': 2 });
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

#### should otherwise return the value

```ts
it('should otherwise return the value', function(){
      var app = express();
      app.set('foo', 'bar');
      assert.equal(app.get('foo'), 'bar');
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

#### countBy

```ts
test('countBy', function(assert) {
    var parity = _.countBy([1, 2, 3, 4, 5], function(num){ return num % 2 === 0; });
    assert.equal(parity['true'], 2);
    assert.equal(parity['false'], 3);

    var list = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    var grouped = _.countBy(list, 'length');
    assert.equal(grouped['3'], 4);
    assert.equal(grouped['4'], 3);
    assert.equal(grouped['5'], 3);

    var context = {};
    _.countBy([{}], function(){ assert.strictEqual(this, context); }, context);

    grouped = _.countBy([4.2, 6.1, 6.4], function(num) {
      return Math.floor(num) > 4 ? 'hasOwnProperty' : 'constructor';
    });
    assert.equal(grouped.constructor, 1);
    assert.equal(grouped.hasOwnProperty, 2);

    var array = [{}];
    _.countBy(array, function(value, index, obj){ assert.strictEqual(obj, array); });

    array = [1, 2, 1, 2, 3];
    grouped = _.countBy(array);
    assert.equal(grouped['1'], 2);
    assert.equal(grouped['3'], 1);
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

### ../../.sbomtest/repos/f3c62de455-express/test/app.route.js

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

#### values

```ts
test('values', function(assert) {
    assert.deepEqual(_.values({one: 1, two: 2}), [1, 2], 'can extract the values from an object');
    assert.deepEqual(_.values({one: 1, two: 2, length: 3}), [1, 2, 3], '... even when one of them is "length"');
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

#### tap

```ts
test('tap', function(assert) {
    var intercepted = null;
    var interceptor = function(obj) { intercepted = obj; };
    var returned = _.tap(1, interceptor);
    assert.equal(intercepted, 1, 'passes tapped object to interceptor');
    assert.equal(returned, 1, 'returns tapped object');

    returned = _([1, 2, 3]).chain().
      map(function(n){ return n * 2; }).
      max().
      tap(interceptor).
      value();
    assert.equal(returned, 6, 'can use tapped objects in a chain');
    assert.equal(intercepted, returned, 'can use tapped objects in a chain');
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### initialize with parsed attributes

```ts
test('initialize with parsed attributes', function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      parse: function(attrs) {
        attrs.value += 1;
        return attrs;
      }
    });
    var model = new Model({value: 1}, {parse: true});
    assert.equal(model.get('value'), 2);
  }
```

#### parse can return null

```ts
test('parse can return null', function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      parse: function(attrs) {
        attrs.value += 1;
        return null;
      }
    });
    var model = new Model({value: 1}, {parse: true});
    assert.equal(JSON.stringify(model.toJSON()), '{}');
  }
```

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

#### chain

```ts
test('chain', function(assert) {
    var model = new Backbone.Model({a: 0, b: 1, c: 2});
    assert.deepEqual(model.chain().pick('a', 'b', 'c').values().compact().value(), [1, 2]);
  }
```

#### set triggers changes in the correct order

```ts
test('set triggers changes in the correct order', function(assert) {
    var value = null;
    var model = new Backbone.Model;
    model.on('last', function(){ value = 'last'; });
    model.on('first', function(){ value = 'first'; });
    model.trigger('first');
    model.trigger('last');
    assert.equal(value, 'last');
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

#### set value regardless of equality/change

```ts
test('set value regardless of equality/change', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model({x: []});
    var a = [];
    model.set({x: a});
    assert.ok(model.get('x') === a);
  }
```

#### set same value does not trigger change

```ts
test('set same value does not trigger change', function(assert) {
    assert.expect(0);
    var model = new Backbone.Model({x: 1});
    model.on('change change:x', function() { assert.ok(false); });
    model.set({x: 1});
    model.set({x: 1});
  }
```

#### set: undefined values

```ts
test('set: undefined values', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model({x: undefined});
    assert.ok('x' in model.attributes);
  }
```

#### #1664 - Changing from one value, silently to another, back to original triggers a change.

```ts
test('#1664 - Changing from one value, silently to another, back to original triggers a change.', function(assert) {
    assert.expect(1);
    var model = new Backbone.Model({x: 1});
    model.on('change:x', function() { assert.ok(true); });
    model.set({x: 2}, {silent: true});
    model.set({x: 3}, {silent: true});
    model.set({x: 1});
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/utility.js

#### noConflict (node vm)

```ts
test('noConflict (node vm)', function(assert) {
      assert.expect(2);
      var done = assert.async();
      var fs = require('fs');
      var vm = require('vm');
      var filename = __dirname + '/../underscore.js';
      fs.readFile(filename, function(err, content){
        var sandbox = vm.createScript(
          content + 'this.underscore = this._.noConflict();',
          filename
        );
        var context = {_: 'oldvalue'};
        sandbox.runInNewContext(context);
        assert.equal(context._, 'oldvalue');
        assert.equal(context.underscore.VERSION, _.VERSION);

        done();
      });
    }
```

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

#### random

```ts
test('random', function(assert) {
    var array = _.range(1000);
    var min = Math.pow(2, 31);
    var max = Math.pow(2, 62);

    assert.ok(_.every(array, function() {
      return _.random(min, max) >= min;
    }), 'should produce a random number greater than or equal to the minimum number');

    assert.ok(_.some(array, function() {
      return _.random(Number.MAX_VALUE) > 0;
    }), 'should produce a random number when passed `Number.MAX_VALUE`');
  }
```

#### times

```ts
test('times', function(assert) {
    var vals = [];
    _.times(3, function(i) { vals.push(i); });
    assert.deepEqual(vals, [0, 1, 2], 'is 0 indexed');
    //
    vals = [];
    _(3).times(function(i) { vals.push(i); });
    assert.deepEqual(vals, [0, 1, 2], 'works as a wrapper');
    // collects return values
    assert.deepEqual([0, 1, 2], _.times(3, function(i) { return i; }), 'collects return values');

    assert.deepEqual(_.times(0, _.identity), []);
    assert.deepEqual(_.times(-1, _.identity), []);
    assert.deepEqual(_.times(parseFloat('-Infinity'), _.identity), []);
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

#### result returns a default value if object is null or undefined

```ts
test('result returns a default value if object is null or undefined', function(assert) {
    assert.strictEqual(_.result(null, 'b', 'default'), 'default');
    assert.strictEqual(_.result(void 0, 'c', 'default'), 'default');
    assert.strictEqual(_.result(''.match('missing'), 1, 'default'), 'default');
  }
```

#### result returns a default value if property of object is missing

```ts
test('result returns a default value if property of object is missing', function(assert) {
    assert.strictEqual(_.result({d: null}, 'd', 'default'), null);
    assert.strictEqual(_.result({e: false}, 'e', 'default'), false);
  }
```

#### result only returns the default value if the object does not have the property or is undefined

```ts
test('result only returns the default value if the object does not have the property or is undefined', function(assert) {
    assert.strictEqual(_.result({}, 'b', 'default'), 'default');
    assert.strictEqual(_.result({d: void 0}, 'd', 'default'), 'default');
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/req.query.js

#### should throw

```ts
it('should throw', function () {
        assert.throws(createApp.bind(null, 'bogus'),
          /unknown value.*query parser/)
      }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

#### routes (function)

```ts
test('routes (function)', function(assert) {
    assert.expect(3);
    router.on('route', function(name) {
      assert.ok(name === '');
    });
    assert.equal(ExternalObject.value, 'unset');
    location.replace('http://example.com#function/set');
    Backbone.history.checkUrl();
    assert.equal(ExternalObject.value, 'set');
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

#### compact

```ts
test('compact', function(assert) {
    assert.deepEqual(_.compact([1, false, null, 0, '', void 0, NaN, 2]), [1, 2], 'removes all falsy values');
    var result = (function(){ return _.compact(arguments); }(0, 1, false, 2, false, 3));
    assert.deepEqual(result, [1, 2, 3], 'works on an arguments object');
    result = _.map([[1, false, false], [false, false, 3]], _.compact);
    assert.deepEqual(result, [[1], [3]], 'works well with _.map');
  }
```

#### without

```ts
test('without', function(assert) {
    var list = [1, 2, 1, 0, 3, 1, 4];
    assert.deepEqual(_.without(list, 0, 1), [2, 3, 4], 'removes all instances of the given values');
    var result = (function(){ return _.without(arguments, 0, 1); }(1, 2, 1, 0, 3, 1, 4));
    assert.deepEqual(result, [2, 3, 4], 'works on an arguments object');

    list = [{one: 1}, {two: 2}];
    assert.deepEqual(_.without(list, {one: 1}), list, 'compares objects by reference (value case)');
    assert.deepEqual(_.without(list, list[0]), [{two: 2}], 'compares objects by reference (reference case)');
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

#### zip

```ts
test('zip', function(assert) {
    var names = ['moe', 'larry', 'curly'], ages = [30, 40, 50], leaders = [true];
    assert.deepEqual(_.zip(names, ages, leaders), [
      ['moe', 30, true],
      ['larry', 40, void 0],
      ['curly', 50, void 0]
    ], 'zipped together arrays of different lengths');

    var stooges = _.zip(['moe', 30, 'stooge 1'], ['larry', 40, 'stooge 2'], ['curly', 50, 'stooge 3']);
    assert.deepEqual(stooges, [['moe', 'larry', 'curly'], [30, 40, 50], ['stooge 1', 'stooge 2', 'stooge 3']], 'zipped pairs');

    // In the case of different lengths of the tuples, undefined values
    // should be used as placeholder
    stooges = _.zip(['moe', 30], ['larry', 40], ['curly', 50, 'extra data']);
    assert.deepEqual(stooges, [['moe', 'larry', 'curly'], [30, 40, 50], [void 0, void 0, 'extra data']], 'zipped pairs with empties');

    var empty = _.zip([]);
    assert.deepEqual(empty, [], 'unzipped empty');

    assert.deepEqual(_.zip(null), [], 'handles null');
    assert.deepEqual(_.zip(), [], '_.zip() returns []');
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

#### should default to application/octet-stream when mime lookup fails

```ts
it('should default to application/octet-stream when mime lookup fails', () => {
    const result = utils.normalizeType('unknown-extension-xyz');
    assert.deepEqual(result, {
      value: 'application/octet-stream',
      params: {}
    });
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

### ../../.sbomtest/repos/f3c62de455-express/test/req.get.js

#### should return the header field value

```ts
it('should return the header field value', function(done){
      var app = express();

      app.use(function(req, res){
        assert(req.get('Something-Else') === undefined);
        res.end(req.get('Content-Type'));
      });

      request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .expect('application/json', done);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/sync.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/collection.js

#### add model with parse

```ts
test('add model with parse', function(assert) {
    assert.expect(1);
    var Model = Backbone.Model.extend({
      parse: function(obj) {
        obj.value += 1;
        return obj;
      }
    });

    var Col = Backbone.Collection.extend({model: Model});
    var collection = new Col;
    collection.add({value: 1}, {parse: true});
    assert.equal(collection.at(0).get('value'), 2);
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

### ../../.sbomtest/repos/f3c62de455-express/test/express.json.js

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

#### should assert value if function

```ts
it('should assert value if function', function () {
      assert.throws(createApp.bind(null, { verify: 'lol' }),
        /TypeError: option verify must be function/)
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

### ../../.sbomtest/repos/f3c62de455-express/test/req.signedCookies.js

#### should return a signed JSON cookie

```ts
it('should return a signed JSON cookie', function(done){
      var app = express();

      app.use(cookieParser('secret'));

      app.use(function(req, res){
        if (req.path === '/set') {
          res.cookie('obj', { foo: 'bar' }, { signed: true });
          res.end();
        } else {
          res.send(req.signedCookies);
        }
      });

      request(app)
      .get('/set')
      .end(function(err, res){
        if (err) return done(err);
        var cookie = res.header['set-cookie'];

        request(app)
        .get('/')
        .set('Cookie', cookie)
        .expect(200, { obj: { foo: 'bar' } }, done)
      });
    }
```

### ../../.sbomtest/repos/f3c62de455-express/test/res.cookie.js

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

## ./stage

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

