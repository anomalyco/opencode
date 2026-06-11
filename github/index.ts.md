# External tests for index.ts

**Arquivo:** `github/index.ts`

## Checklist

- [ ] bun
- [ ] @octokit/rest
- [ ] @octokit/graphql
- [ ] @actions/github/lib/context
- [ ] @octokit/webhooks-types
- [ ] @opencode-ai/sdk
- [ ] node:child_process
- [ ] node:timers/promises
- [ ] node:path

## bun

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @octokit/rest

**Consultas usadas no Horsebox:** `Octokit`, `@octokit/rest Octokit`, `octokit/rest Octokit`, `rest Octokit`

**Arquivos de teste encontrados:** 8

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

#### rest

```ts
test('rest', function(assert) {
    var numbers = [1, 2, 3, 4];
    assert.deepEqual(_.rest(numbers), [2, 3, 4], 'fetches all but the first element');
    assert.deepEqual(_.rest(numbers, 0), [1, 2, 3, 4], 'returns the whole array when index is 0');
    assert.deepEqual(_.rest(numbers, 2), [3, 4], 'returns elements starting at the given index');
    var result = (function(){ return _(arguments).rest(); }(1, 2, 3, 4));
    assert.deepEqual(result, [2, 3, 4], 'works on an arguments object');
    result = _.map([[1, 2, 3], [1, 2, 3]], _.rest);
    assert.deepEqual(_.flatten(result), [2, 3, 2, 3], 'works well with _.map');
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/router.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

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

#### should apply a rest parameter to `func`

```ts
test('should apply a rest parameter to `func`', function(assert) {
      assert.expect(1);

      var rest = _.rest(fn);
      assert.deepEqual(rest(1, 2, 3, 4), [1, 2, [3, 4]]);
    }
```

#### should work with `start`

```ts
test('should work with `start`', function(assert) {
      assert.expect(1);

      var rest = _.rest(fn, 1);
      assert.deepEqual(rest(1, 2, 3, 4), [1, [2, 3, 4]]);
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

#### should coerce `start` to an integer

```ts
test('should coerce `start` to an integer', function(assert) {
      assert.expect(1);

      var rest = _.rest(fn, 1.6);
      assert.deepEqual(rest(1, 2, 3), [1, [2, 3]]);
    }
```

#### should use an empty array when `start` is not reached

```ts
test('should use an empty array when `start` is not reached', function(assert) {
      assert.expect(1);

      var rest = _.rest(fn);
      assert.deepEqual(rest(1), [1, undefined, []]);
    }
```

#### should work on functions with more than three parameters

```ts
test('should work on functions with more than three parameters', function(assert) {
      assert.expect(1);

      var rest = _.rest(function(a, b, c, d) {
        return slice.call(arguments);
      });

      assert.deepEqual(rest(1, 2, 3, 4, 5), [1, 2, 3, [4, 5]]);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/test/test-fp.js

#### should have a cap of 1

```ts
test('should have a cap of 1', function(assert) {
      assert.expect(1);

      var funcMethods = [
        'curry', 'iteratee', 'memoize', 'over', 'overEvery', 'overSome',
        'method', 'methodOf', 'rest', 'runInContext'
      ];

      var exceptions = funcMethods.concat('mixin', 'nthArg', 'template'),
          expected = _.map(mapping.aryMethod[1], _.constant(true));

      var actual = _.map(mapping.aryMethod[1], function(methodName) {
        var arg = _.includes(funcMethods, methodName) ? _.noop : 1,
            result = _.attempt(function() { return fp[methodName](arg); });

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

#### should accept a `start` param

```ts
test('should accept a `start` param', function(assert) {
      assert.expect(1);

      var actual = fp.restFrom(2)(function() {
        return slice.call(arguments);
      })('a', 'b', 'c', 'd');

      assert.deepEqual(actual, ['a', 'b', ['c', 'd']]);
    }
```

## @octokit/graphql

**Consultas usadas no Horsebox:** `defaults`, `@octokit/graphql defaults`, `octokit/graphql defaults`, `graphql defaults`, `graphql`, `@octokit/graphql graphql`, `octokit/graphql graphql`, `graphql graphql`

**Arquivos de teste encontrados:** 8

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### defaults

```ts
test('defaults', function(assert) {
    assert.expect(9);
    var Defaulted = Backbone.Model.extend({
      defaults: {
        one: 1,
        two: 2
      }
    });
    var model = new Defaulted({two: undefined});
    assert.equal(model.get('one'), 1);
    assert.equal(model.get('two'), 2);
    model = new Defaulted({two: 3});
    assert.equal(model.get('one'), 1);
    assert.equal(model.get('two'), 3);
    Defaulted = Backbone.Model.extend({
      defaults: function() {
        return {
          one: 3,
          two: 4
        };
      }
    });
    model = new Defaulted({two: undefined});
    assert.equal(model.get('one'), 3);
    assert.equal(model.get('two'), 4);
    Defaulted = Backbone.Model.extend({
      defaults: {hasOwnProperty: true}
    });
    model = new Defaulted();
    assert.equal(model.get('hasOwnProperty'), true);
    model = new Defaulted({hasOwnProperty: undefined});
    assert.equal(model.get('hasOwnProperty'), true);
    model = new Defaulted({hasOwnProperty: false});
    assert.equal(model.get('hasOwnProperty'), false);
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

#### #1545 - `undefined` can be passed to a model constructor without coersion

```ts
test('#1545 - `undefined` can be passed to a model constructor without coersion', function(assert) {
    var Model = Backbone.Model.extend({
      defaults: {one: 1},
      initialize: function(attrs, opts) {
        assert.equal(attrs, undefined);
      }
    });
    var emptyattrs = new Model();
    var undefinedattrs = new Model(undefined);
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/objects.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/events.js

#### binding and trigger with event maps context

```ts
test('binding and trigger with event maps context', function(assert) {
    assert.expect(2);
    var obj = {counter: 0};
    var context = {};
    _.extend(obj, Backbone.Events);

    obj.on({
      a: function() {
        assert.strictEqual(this, context, 'defaults `context` to `callback` param');
      }
    }, context).trigger('a');

    obj.off().on({
      a: function() {
        assert.strictEqual(this, context, 'will not override explicit `context` param');
      }
    }, this, context).trigger('a');
  }
```

#### bind a callback with a supplied context using once with object notation

```ts
test('bind a callback with a supplied context using once with object notation', function(assert) {
    assert.expect(1);
    var obj = {counter: 0};
    var context = {};
    _.extend(obj, Backbone.Events);

    obj.once({
      a: function() {
        assert.strictEqual(this, context, 'defaults `context` to `callback` param');
      }
    }, context).trigger('a');
  }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/arrays.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should assign source properties if missing on `object`

```ts
test('should assign source properties if missing on `object`', function(assert) {
      assert.expect(1);

      var actual = _.defaults({ 'a': 1 }, { 'a': 2, 'b': 2 });
      assert.deepEqual(actual, { 'a': 1, 'b': 2 });
    }
```

#### should accept multiple sources

```ts
test('should accept multiple sources', function(assert) {
      assert.expect(2);

      var expected = { 'a': 1, 'b': 2, 'c': 3 },
          actual = _.defaults({ 'a': 1, 'b': 2 }, { 'b': 3 }, { 'c': 3 });

      assert.deepEqual(actual, expected);

      actual = _.defaults({ 'a': 1, 'b': 2 }, { 'b': 3, 'c': 3 }, { 'c': 2 });
      assert.deepEqual(actual, expected);
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

#### should deep assign source properties if missing on `object`

```ts
test('should deep assign source properties if missing on `object`', function(assert) {
      assert.expect(1);

      var object = { 'a': { 'b': 2 }, 'd': 4 },
          source = { 'a': { 'b': 3, 'c': 3 }, 'e': 5 },
          expected = { 'a': { 'b': 2, 'c': 3 }, 'd': 4, 'e': 5 };

      assert.deepEqual(_.defaultsDeep(object, source), expected);
    }
```

#### should accept multiple sources

```ts
test('should accept multiple sources', function(assert) {
      assert.expect(2);

      var source1 = { 'a': { 'b': 3 } },
          source2 = { 'a': { 'c': 3 } },
          source3 = { 'a': { 'b': 3, 'c': 3 } },
          source4 = { 'a': { 'c': 4 } },
          expected = { 'a': { 'b': 2, 'c': 3 } };

      assert.deepEqual(_.defaultsDeep({ 'a': { 'b': 2 } }, source1, source2), expected);
      assert.deepEqual(_.defaultsDeep({ 'a': { 'b': 2 } }, source3, source4), expected);
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

#### should not convert function properties to objects

```ts
test('should not convert function properties to objects', function(assert) {
      assert.expect(2);

      var actual = _.defaultsDeep({}, { 'a': noop });
      assert.strictEqual(actual.a, noop);

      actual = _.defaultsDeep({}, { 'a': { 'b': noop } });
      assert.strictEqual(actual.a.b, noop);
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

#### should merge sources containing circular references

```ts
test('should merge sources containing circular references', function(assert) {
      assert.expect(2);

      var object = {
        'foo': { 'b': { 'c': { 'd': {} } } },
        'bar': { 'a': 2 }
      };

      var source = {
        'foo': { 'b': { 'c': { 'd': {} } } },
        'bar': {}
      };

      object.foo.b.c.d = object;
      source.foo.b.c.d = source;
      source.bar.b = source.foo.b;

      var actual = _.defaultsDeep(object, source);

      assert.strictEqual(actual.bar.b, actual.foo.b);
      assert.strictEqual(actual.foo.b.c.d, actual.foo.b.c.d.foo.b.c.d);
    }
```

#### should not modify sources

```ts
test('should not modify sources', function(assert) {
      assert.expect(3);

      var source1 = { 'a': 1, 'b': { 'c': 2 } },
          source2 = { 'b': { 'c': 3, 'd': 3 } },
          actual = _.defaultsDeep({}, source1, source2);

      assert.deepEqual(actual, { 'a': 1, 'b': { 'c': 2, 'd': 3 } });
      assert.deepEqual(source1, { 'a': 1, 'b': { 'c': 2 } });
      assert.deepEqual(source2, { 'b': { 'c': 3, 'd': 3 } });
    }
```

#### should not attempt a merge of a string into an array

```ts
test('should not attempt a merge of a string into an array', function(assert) {
      assert.expect(1);

      var actual = _.defaultsDeep({ 'a': ['abc'] }, { 'a': 'abc' });
      assert.deepEqual(actual.a, ['abc']);
    }
```

#### should not indirectly merge `Object` properties

```ts
test('should not indirectly merge `Object` properties', function(assert) {
      assert.expect(1);

      _.defaultsDeep({}, { 'constructor': { 'a': 1 } });

      var actual = 'a' in Object;
      delete Object.a;

      assert.notOk(actual);
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

## @actions/github/lib/context

**Consultas usadas no Horsebox:** `Context`, `@actions/github/lib/context Context`, `actions/github/lib/context Context`, `context Context`

**Arquivos de teste encontrados:** 12

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/events.js

#### binding and trigger with event maps context

```ts
test('binding and trigger with event maps context', function(assert) {
    assert.expect(2);
    var obj = {counter: 0};
    var context = {};
    _.extend(obj, Backbone.Events);

    obj.on({
      a: function() {
        assert.strictEqual(this, context, 'defaults `context` to `callback` param');
      }
    }, context).trigger('a');

    obj.off().on({
      a: function() {
        assert.strictEqual(this, context, 'will not override explicit `context` param');
      }
    }, this, context).trigger('a');
  }
```

#### listenToOnce without context cleans up references after the event has fired

```ts
test('listenToOnce without context cleans up references after the event has fired', function(assert) {
    assert.expect(2);
    var a = _.extend({}, Backbone.Events);
    var b = _.extend({}, Backbone.Events);
    a.listenToOnce(b, 'all', function(){ assert.ok(true); });
    b.trigger('anything');
    assert.equal(_.size(a._listeningTo), 0);
  }
```

#### bind a callback with a default context when none supplied

```ts
test('bind a callback with a default context when none supplied', function(assert) {
    assert.expect(1);
    var obj = _.extend({
      assertTrue: function() {
        assert.equal(this, obj, '`this` was bound to the callback');
      }
    }, Backbone.Events);

    obj.once('event', obj.assertTrue);
    obj.trigger('event');
  }
```

#### bind a callback with a supplied context

```ts
test('bind a callback with a supplied context', function(assert) {
    assert.expect(1);
    var TestClass = function() {
      return this;
    };
    TestClass.prototype.assertTrue = function() {
      assert.ok(true, '`this` was bound to the callback');
    };

    var obj = _.extend({}, Backbone.Events);
    obj.on('event', function() { this.assertTrue(); }, new TestClass);
    obj.trigger('event');
  }
```

#### remove all events for a specific context

```ts
test('remove all events for a specific context', function(assert) {
    assert.expect(4);
    var obj = _.extend({}, Backbone.Events);
    obj.on('x y all', function() { assert.ok(true); });
    obj.on('x y all', function() { assert.ok(false); }, obj);
    obj.off(null, null, obj);
    obj.trigger('x y');
  }
```

#### bind a callback with a supplied context using once with object notation

```ts
test('bind a callback with a supplied context using once with object notation', function(assert) {
    assert.expect(1);
    var obj = {counter: 0};
    var context = {};
    _.extend(obj, Backbone.Events);

    obj.once({
      a: function() {
        assert.strictEqual(this, context, 'defaults `context` to `callback` param');
      }
    }, context).trigger('a');
  }
```

#### once with off only by context

```ts
test('once with off only by context', function(assert) {
    assert.expect(0);
    var context = {};
    var obj = _.extend({}, Backbone.Events);
    obj.once('event', function(){ assert.ok(false); }, context);
    obj.off(null, null, context);
    obj.trigger('event');
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

#### lookupIterator with contexts

```ts
test('lookupIterator with contexts', function(assert) {
    _.each([true, false, 'yes', '', 0, 1, {}], function(context) {
      _.each([1], function() {
        assert.equal(this, context);
      }, context);
    });
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

#### filter

```ts
test('filter', function(assert) {
    var evenArray = [1, 2, 3, 4, 5, 6];
    var evenObject = {one: 1, two: 2, three: 3};
    var isEven = function(num){ return num % 2 === 0; };

    assert.deepEqual(_.filter(evenArray, isEven), [2, 4, 6]);
    assert.deepEqual(_.filter(evenObject, isEven), [2], 'can filter objects');
    assert.deepEqual(_.filter([{}, evenObject, []], 'two'), [evenObject], 'predicate string map to object properties');

    _.filter([1], function() {
      assert.equal(this, evenObject, 'given context');
    }, evenObject);

    // Can be used like _.where.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.deepEqual(_.filter(list, {a: 1}), [{a: 1, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}]);
    assert.deepEqual(_.filter(list, {b: 2}), [{a: 1, b: 2}, {a: 2, b: 2}]);
    assert.deepEqual(_.filter(list, {}), list, 'Empty object accepts all items');
    assert.deepEqual(_(list).filter({}), list, 'OO-filter');
  }
```

#### reject

```ts
test('reject', function(assert) {
    var odds = _.reject([1, 2, 3, 4, 5, 6], function(num){ return num % 2 === 0; });
    assert.deepEqual(odds, [1, 3, 5], 'rejected each even number');

    var context = 'obj';

    var evens = _.reject([1, 2, 3, 4, 5, 6], function(num){
      assert.equal(context, 'obj');
      return num % 2 !== 0;
    }, context);
    assert.deepEqual(evens, [2, 4, 6], 'rejected each odd number');

    assert.deepEqual(_.reject([odds, {one: 1, two: 2, three: 3}], 'two'), [odds], 'predicate string map to object properties');

    // Can be used like _.where.
    var list = [{a: 1, b: 2}, {a: 2, b: 2}, {a: 1, b: 3}, {a: 1, b: 4}];
    assert.deepEqual(_.reject(list, {a: 1}), [{a: 2, b: 2}]);
    assert.deepEqual(_.reject(list, {b: 2}), [{a: 1, b: 3}, {a: 1, b: 4}]);
    assert.deepEqual(_.reject(list, {}), [], 'Returns empty list given empty object');
    assert.deepEqual(_.reject(list, []), [], 'Returns empty list given empty array');
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

#### result fallback can use a function

```ts
test('result fallback can use a function', function(assert) {
    var obj = {a: [1, 2, 3]};
    assert.strictEqual(_.result(obj, 'b', _.constant(5)), 5);
    assert.strictEqual(_.result(obj, 'b', function() {
      return this.a;
    }), obj.a, 'called with context');
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/objects.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/app.router.js

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

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should throw an error if core-js is detected

```ts
test('should throw an error if core-js is detected', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var lodash = _.runInContext({
          '__core-js_shared__': {}
        });

        assert.raises(function() { lodash.isNative(noop); });
      }
      else {
        skipAssert(assert);
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

#### should not require a fully populated `context` object

```ts
test('should not require a fully populated `context` object', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var lodash = _.runInContext({
          'setTimeout': function(func) { func(); }
        });

        var pass = false;
        lodash.delay(function() { pass = true; }, 32);
        assert.ok(pass);
      }
      else {
        skipAssert(assert);
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

#### should clear timeout when `func` is called

```ts
test('should clear timeout when `func` is called', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount == 5 ? Infinity : +new Date;
            }
          }
        });

        var throttled = lodash.throttle(function() { callCount++; }, 32);

        throttled();
        throttled();

        setTimeout(function() {
          assert.strictEqual(callCount, 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert);
        done();
      }
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

#### `_.' + methodName + '` should work if the system time is set backwards

```ts
test('`_.' + methodName + '` should work if the system time is set backwards', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount == 4
                ? +new Date(2012, 3, 23, 23, 27, 18)
                : +new Date;
            }
          }
        });

        var funced = lodash[methodName](function() {
          callCount++;
        }, 32);

        funced();

        setTimeout(function() {
          funced();
          assert.strictEqual(callCount, isDebounce ? 1 : 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert);
        done();
      }
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

## @octokit/webhooks-types

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## @opencode-ai/sdk

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## node:child_process

Nenhum arquivo de teste encontrado pelo Horsebox para esta lib.

## node:timers/promises

**Consultas usadas no Horsebox:** `setTimeout`, `node:timers/promises setTimeout`, `promises setTimeout`, `sleep`, `node:timers/promises sleep`, `promises sleep`

**Arquivos de teste encontrados:** 11

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should support loading ' + basename + ' in a web worker

```ts
test('should support loading ' + basename + ' in a web worker', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (Worker) {
        var limit = 30000 / QUnit.config.asyncRetries,
            start = +new Date;

        var attempt = function() {
          var actual = _._VERSION;
          if ((new Date - start) < limit && typeof actual != 'string') {
            setTimeout(attempt, 16);
            return;
          }
          assert.strictEqual(actual, _.VERSION);
          done();
        };

        attempt();
      }
      else {
        skipAssert(assert);
        done();
      }
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

#### should not immediately call `func` when `wait` is `0`

```ts
test('should not immediately call `func` when `wait` is `0`', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          debounced = _.debounce(function() { ++callCount; }, 0);

      debounced();
      debounced();
      assert.strictEqual(callCount, 0);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        done();
      }, 5);
    }
```

#### should apply default options

```ts
test('should apply default options', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          debounced = _.debounce(function() { callCount++; }, 32, {});

      debounced();
      assert.strictEqual(callCount, 0);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        done();
      }, 64);
    }
```

#### should support a `leading` option

```ts
test('should support a `leading` option', function(assert) {
      assert.expect(4);

      var done = assert.async();

      var callCounts = [0, 0];

      var withLeading = _.debounce(function() {
        callCounts[0]++;
      }, 32, { 'leading': true });

      var withLeadingAndTrailing = _.debounce(function() {
        callCounts[1]++;
      }, 32, { 'leading': true });

      withLeading();
      assert.strictEqual(callCounts[0], 1);

      withLeadingAndTrailing();
      withLeadingAndTrailing();
      assert.strictEqual(callCounts[1], 1);

      setTimeout(function() {
        assert.deepEqual(callCounts, [1, 2]);

        withLeading();
        assert.strictEqual(callCounts[0], 2);

        done();
      }, 64);
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

#### should support a `trailing` option

```ts
test('should support a `trailing` option', function(assert) {
      assert.expect(4);

      var done = assert.async();

      var withCount = 0,
          withoutCount = 0;

      var withTrailing = _.debounce(function() {
        withCount++;
      }, 32, { 'trailing': true });

      var withoutTrailing = _.debounce(function() {
        withoutCount++;
      }, 32, { 'trailing': false });

      withTrailing();
      assert.strictEqual(withCount, 0);

      withoutTrailing();
      assert.strictEqual(withoutCount, 0);

      setTimeout(function() {
        assert.strictEqual(withCount, 1);
        assert.strictEqual(withoutCount, 0);
        done();
      }, 64);
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

#### should support `maxWait` in a tight loop

```ts
test('should support `maxWait` in a tight loop', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var limit = (argv || isPhantom) ? 1000 : 320,
          withCount = 0,
          withoutCount = 0;

      var withMaxWait = _.debounce(function() {
        withCount++;
      }, 64, { 'maxWait': 128 });

      var withoutMaxWait = _.debounce(function() {
        withoutCount++;
      }, 96);

      var start = +new Date;
      while ((new Date - start) < limit) {
        withMaxWait();
        withoutMaxWait();
      }
      var actual = [Boolean(withoutCount), Boolean(withCount)];
      setTimeout(function() {
        assert.deepEqual(actual, [false, true]);
        done();
      }, 1);
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

#### should cancel `maxDelayed` when `delayed` is invoked

```ts
test('should cancel `maxDelayed` when `delayed` is invoked', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0;

      var debounced = _.debounce(function() {
        callCount++;
      }, 32, { 'maxWait': 64 });

      debounced();

      setTimeout(function() {
        debounced();
        assert.strictEqual(callCount, 1);
      }, 128);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 192);
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

#### should defer `func` execution

```ts
test('should defer `func` execution', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var pass = false;
      _.defer(function() { pass = true; });

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

#### should delay `func` execution

```ts
test('should delay `func` execution', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var pass = false;
      _.delay(function() { pass = true; }, 32);

      setTimeout(function() {
        assert.notOk(pass);
      }, 1);

      setTimeout(function() {
        assert.ok(pass);
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

      _.delay(function() {
        args = slice.call(arguments);
      }, 32, 1, 2);

      setTimeout(function() {
        assert.deepEqual(args, [1, 2]);
        done();
      }, 64);
    }
```

#### should use a default `wait` of `0`

```ts
test('should use a default `wait` of `0`', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var pass = false;
      _.delay(function() { pass = true; });

      assert.notOk(pass);

      setTimeout(function() {
        assert.ok(pass);
        done();
      }, 0);
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

#### should work with mocked `setTimeout`

```ts
test('should work with mocked `setTimeout`', function(assert) {
      assert.expect(1);

      if (!isPhantom) {
        var pass = false,
            setTimeout = root.setTimeout;

        setProperty(root, 'setTimeout', function(func) { func(); });
        _.delay(function() { pass = true; }, 32);
        setProperty(root, 'setTimeout', setTimeout);

        assert.ok(pass);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should compare promises by reference

```ts
test('should compare promises by reference', function(assert) {
      assert.expect(4);

      if (promise) {
        lodashStable.each([[promise, Promise.resolve(1)], [promise, realm.promise]], function(promises) {
          var promise1 = promises[0],
              promise2 = promises[1];

          assert.strictEqual(_.isEqual(promise1, promise2), false);
          assert.strictEqual(_.isEqual(promise1, promise1), true);
        });
      }
      else {
        skipAssert(assert, 4);
      }
    }
```

#### should return the number of milliseconds that have elapsed since the Unix epoch

```ts
test('should return the number of milliseconds that have elapsed since the Unix epoch', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var stamp = +new Date,
          actual = _.now();

      assert.ok(actual >= stamp);

      setTimeout(function() {
        assert.ok(_.now() > actual);
        done();
      }, 32);
    }
```

#### should not require a fully populated `context` object

```ts
test('should not require a fully populated `context` object', function(assert) {
      assert.expect(1);

      if (!isModularize) {
        var lodash = _.runInContext({
          'setTimeout': function(func) { func(); }
        });

        var pass = false;
        lodash.delay(function() { pass = true; }, 32);
        assert.ok(pass);
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should throttle a function

```ts
test('should throttle a function', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          throttled = _.throttle(function() { callCount++; }, 32);

      throttled();
      throttled();
      throttled();

      var lastCount = callCount;
      assert.ok(callCount);

      setTimeout(function() {
        assert.ok(callCount > lastCount);
        done();
      }, 64);
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

#### should clear timeout when `func` is called

```ts
test('should clear timeout when `func` is called', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount == 5 ? Infinity : +new Date;
            }
          }
        });

        var throttled = lodash.throttle(function() { callCount++; }, 32);

        throttled();
        throttled();

        setTimeout(function() {
          assert.strictEqual(callCount, 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert);
        done();
      }
    }
```

#### should not trigger a trailing call when invoked once

```ts
test('should not trigger a trailing call when invoked once', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          throttled = _.throttle(function() { callCount++; }, 32);

      throttled();
      assert.strictEqual(callCount, 1);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        done();
      }, 64);
    }
```

#### should trigger a call when invoked repeatedly' + (index ? ' and `leading` is `false`' : ''), function(assert) {
        assert.expect(1);

        var done = assert.async();

        var callCount = 0,
            limit = (argv || isPhantom) ? 1000 : 320,
            options = index ? { 'leading': false } : {},
            throttled = _.throttle(function() { callCount++; }, 32, options);

        var start = +new Date;
        while ((new Date - start) < limit) {
          throttled();
        }
        var actual = callCount > 1;
        setTimeout(function() {
          assert.ok(actual);
          done();
        }, 1);
      });
    });

    QUnit.test('should trigger a second throttled call as soon as possible

```ts
test('should trigger a call when invoked repeatedly' + (index ? ' and `leading` is `false`' : ''), function(assert) {
        assert.expect(1);

        var done = assert.async();

        var callCount = 0,
            limit = (argv || isPhantom) ? 1000 : 320,
            options = index ? { 'leading': false } : {},
            throttled = _.throttle(function() { callCount++; }, 32, options);

        var start = +new Date;
        while ((new Date - start) < limit) {
          throttled();
        }
        var actual = callCount > 1;
        setTimeout(function() {
          assert.ok(actual);
          done();
        }, 1);
      });
    });

    QUnit.test('should trigger a second throttled call as soon as possible', function(assert) {
      assert.expect(3);

      var done = assert.async();

      var callCount = 0;

      var throttled = _.throttle(function() {
        callCount++;
      }, 128, { 'leading': false });

      throttled();

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        throttled();
      }, 192);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
      }, 254);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 384);
    }
```

#### should apply default options

```ts
test('should apply default options', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          throttled = _.throttle(function() { callCount++; }, 32, {});

      throttled();
      throttled();
      assert.strictEqual(callCount, 1);

      setTimeout(function() {
        assert.strictEqual(callCount, 2);
        done();
      }, 128);
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

#### should not update `lastCalled`, at the end of the timeout, when `trailing` is `false`

```ts
test('should not update `lastCalled`, at the end of the timeout, when `trailing` is `false`', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var callCount = 0;

      var throttled = _.throttle(function() {
        callCount++;
      }, 64, { 'trailing': false });

      throttled();
      throttled();

      setTimeout(function() {
        throttled();
        throttled();
      }, 96);

      setTimeout(function() {
        assert.ok(callCount > 1);
        done();
      }, 192);
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

#### `_.' + methodName + '` should use a default `wait` of `0`

```ts
test('`_.' + methodName + '` should use a default `wait` of `0`', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var callCount = 0,
          funced = func(function() { callCount++; });

      funced();

      setTimeout(function() {
        funced();
        assert.strictEqual(callCount, isDebounce ? 1 : 2);
        done();
      }, 32);
    }
```

#### `_.' + methodName + '` should invoke `func` with the correct `this` binding

```ts
test('`_.' + methodName + '` should invoke `func` with the correct `this` binding', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var actual = [],
          object = { 'funced': func(function() { actual.push(this); }, 32) },
          expected = lodashStable.times(isDebounce ? 1 : 2, lodashStable.constant(object));

      object.funced();
      if (!isDebounce) {
        object.funced();
      }
      setTimeout(function() {
        assert.deepEqual(actual, expected);
        done();
      }, 64);
    }
```

#### `_.' + methodName + '` supports recursive calls

```ts
test('`_.' + methodName + '` supports recursive calls', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var actual = [],
          args = lodashStable.map(['a', 'b', 'c'], function(chr) { return [{}, chr]; }),
          expected = args.slice(),
          queue = args.slice();

      var funced = func(function() {
        var current = [this];
        push.apply(current, arguments);
        actual.push(current);

        var next = queue.shift();
        if (next) {
          funced.call(next[0], next[1]);
        }
      }, 32);

      var next = queue.shift();
      funced.call(next[0], next[1]);
      assert.deepEqual(actual, expected.slice(0, isDebounce ? 0 : 1));

      setTimeout(function() {
        assert.deepEqual(actual, expected.slice(0, actual.length));
        done();
      }, 256);
    }
```

#### `_.' + methodName + '` should work if the system time is set backwards

```ts
test('`_.' + methodName + '` should work if the system time is set backwards', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (!isModularize) {
        var callCount = 0,
            dateCount = 0;

        var lodash = _.runInContext({
          'Date': {
            'now': function() {
              return ++dateCount == 4
                ? +new Date(2012, 3, 23, 23, 27, 18)
                : +new Date;
            }
          }
        });

        var funced = lodash[methodName](function() {
          callCount++;
        }, 32);

        funced();

        setTimeout(function() {
          funced();
          assert.strictEqual(callCount, isDebounce ? 1 : 2);
          done();
        }, 64);
      }
      else {
        skipAssert(assert);
        done();
      }
    }
```

#### `_.' + methodName + '` should support cancelling delayed calls

```ts
test('`_.' + methodName + '` should support cancelling delayed calls', function(assert) {
      assert.expect(1);

      var done = assert.async();

      var callCount = 0;

      var funced = func(function() {
        callCount++;
      }, 32, { 'leading': false });

      funced();
      funced.cancel();

      setTimeout(function() {
        assert.strictEqual(callCount, 0);
        done();
      }, 64);
    }
```

#### `_.' + methodName + '` should reset `lastCalled` after cancelling

```ts
test('`_.' + methodName + '` should reset `lastCalled` after cancelling', function(assert) {
      assert.expect(3);

      var done = assert.async();

      var callCount = 0;

      var funced = func(function() {
        return ++callCount;
      }, 32, { 'leading': true });

      assert.strictEqual(funced(), 1);
      funced.cancel();

      assert.strictEqual(funced(), 2);
      funced();

      setTimeout(function() {
        assert.strictEqual(callCount, 3);
        done();
      }, 64);
    }
```

#### `_.' + methodName + '` should support flushing delayed calls

```ts
test('`_.' + methodName + '` should support flushing delayed calls', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0;

      var funced = func(function() {
        return ++callCount;
      }, 32, { 'leading': false });

      funced();
      assert.strictEqual(funced.flush(), 1);

      setTimeout(function() {
        assert.strictEqual(callCount, 1);
        done();
      }, 64);
    }
```

#### `_.' + methodName + '` should noop `cancel` and `flush` when nothing is queued

```ts
test('`_.' + methodName + '` should noop `cancel` and `flush` when nothing is queued', function(assert) {
      assert.expect(2);

      var done = assert.async();

      var callCount = 0,
          funced = func(function() { callCount++; }, 32);

      funced.cancel();
      assert.strictEqual(funced.flush(), undefined);

      setTimeout(function() {
        assert.strictEqual(callCount, 0);
        done();
      }, 64);
    }
```

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/underscore/test/functions.js

#### delay

```ts
test('delay', function(assert) {
    assert.expect(2);
    var done = assert.async();
    var delayed = false;
    _.delay(function(){ delayed = true; }, 100);
    setTimeout(function(){ assert.notOk(delayed, "didn't delay the function quite yet"); }, 50);
    setTimeout(function(){ assert.ok(delayed, 'delayed the function'); done(); }, 150);
  }
```

### ../../.sbomtest/repos/f3c62de455-express/test/express.text.js

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

### ../../.sbomtest/repos/f3c62de455-express/test/Router.js

#### should not mix requests

```ts
it('should not mix requests', function (done) {
      var req1 = { url: '/foo/50/bar', method: 'get' };
      var req2 = { url: '/foo/10/bar', method: 'get' };
      var router = new Router();
      var sub = new Router();
      var cb = after(2, done)


      sub.get('/bar', function (req, res, next) {
        next();
      });

      router.param('ms', function (req, res, next, ms) {
        ms = parseInt(ms, 10);
        req.ms = ms;
        setTimeout(next, ms);
      });

      router.use('/foo/:ms/', new Router());
      router.use('/foo/:ms/', sub);

      router.handle(req1, {}, function (err) {
        assert.ifError(err);
        assert.equal(req1.ms, 50);
        assert.equal(req1.originalUrl, '/foo/50/bar');
        cb()
      });

      router.handle(req2, {}, function (err) {
        assert.ifError(err);
        assert.equal(req2.ms, 10);
        assert.equal(req2.originalUrl, '/foo/10/bar');
        cb()
      });
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

### ../../.sbomtest/repos/901466a5bb-lodash/vendor/backbone/test/model.js

#### #1478 - Model `save` does not trigger change on unchanged attributes

```ts
test('#1478 - Model `save` does not trigger change on unchanged attributes', function(assert) {
    var done = assert.async();
    assert.expect(0);
    var Model = Backbone.Model.extend({
      sync: function(method, m, options) {
        setTimeout(function(){
          options.success();
          done();
        }, 0);
      }
    });
    new Model({x: true})
    .on('change:x', function(){ assert.ok(false); })
    .save(null, {wait: true});
  }
```

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

## node:path

**Consultas usadas no Horsebox:** `basename`, `node:path basename`

**Arquivos de teste encontrados:** 1

### ../../.sbomtest/repos/901466a5bb-lodash/test/test.js

#### should support loading ' + basename + ' as the "lodash" module

```ts
test('should support loading ' + basename + ' as the "lodash" module', function(assert) {
      assert.expect(1);

      if (amd) {
        assert.strictEqual((lodashModule || {}).moduleName, 'lodash');
      }
      else {
        skipAssert(assert);
      }
    }
```

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

#### should support loading ' + basename + ' as the "underscore" module

```ts
test('should support loading ' + basename + ' as the "underscore" module', function(assert) {
      assert.expect(1);

      if (amd) {
        assert.strictEqual((underscoreModule || {}).moduleName, 'underscore');
      }
      else {
        skipAssert(assert);
      }
    }
```

#### should support loading ' + basename + ' in a web worker

```ts
test('should support loading ' + basename + ' in a web worker', function(assert) {
      assert.expect(1);

      var done = assert.async();

      if (Worker) {
        var limit = 30000 / QUnit.config.asyncRetries,
            start = +new Date;

        var attempt = function() {
          var actual = _._VERSION;
          if ((new Date - start) < limit && typeof actual != 'string') {
            setTimeout(attempt, 16);
            return;
          }
          assert.strictEqual(actual, _.VERSION);
          done();
        };

        attempt();
      }
      else {
        skipAssert(assert);
        done();
      }
    }
```

