# xmlbuilder-js

An XML builder for [node.js](https://nodejs.org/) similar to
[java-xmlbuilder](https://github.com/jmurty/java-xmlbuilder).

[![License](http://img.shields.io/npm/l/xmlbuilder.svg?style=flat-square)](http://opensource.org/licenses/MIT)
[![NPM Version](http://img.shields.io/npm/v/xmlbuilder.svg?style=flat-square)](https://npmjs.com/package/xmlbuilder)
[![NPM Downloads](https://img.shields.io/npm/dm/xmlbuilder.svg?style=flat-square)](https://npmjs.com/package/xmlbuilder)

[![Travis Build Status](http://img.shields.io/travis/oozcitak/xmlbuilder-js.svg?style=flat-square)](http://travis-ci.org/oozcitak/xmlbuilder-js)
[![AppVeyor Build status](https://ci.appveyor.com/api/projects/status/bf7odb20hj77isry?svg=true)](https://ci.appveyor.com/project/oozcitak/xmlbuilder-js)
[![Dev Dependency Status](http://img.shields.io/david/dev/oozcitak/xmlbuilder-js.svg?style=flat-square)](https://david-dm.org/oozcitak/xmlbuilder-js)
[![Code Coverage](https://img.shields.io/coveralls/oozcitak/xmlbuilder-js.svg?style=flat-square)](https://coveralls.io/github/oozcitak/xmlbuilder-js)

### Installation:

``` sh
npm install xmlbuilder
```

### Usage:

``` js
var builder = require('xmlbuilder');
var xml = builder.create('root')
  .ele('xmlbuilder')
    .ele('repo', {'type': 'git'}, 'git://github.com/oozcitak/xmlbuilder-js.git')
  .end({ pretty: true});

console.log(xml);
```

will result in:

``` xml
<?xml version="1.0"?>
<root>
  <xmlbuilder>
    <repo type="git">git://github.com/oozcitak/xmlbuilder-js.git</repo>
  </xmlbuilder>
</root>
```

It is also possible to convert objects into nodes:

``` js
builder.create({
  root: {
    xmlbuilder: {
      repo: {
        '@type': 'git', // attributes start with @
        '#text': 'git://github.com/oozcitak/xmlbuilder-js.git' // text node
      }
    }
  }
});
```

If you need to do some processing:

``` js
var root = builder.create('squares');
root.com('f(x) = x^2');
for(var i = 1; i <= 5; i++)
{
  var item = root.ele('data');
  item.att('x', i);
  item.att('y', i * i);
}
```

This will result in:

``` xml
<?xml version="1.0"?>
<squares>
  <!-- f(x) = x^2 -->
  <data x="1" y="1"/>
  <data x="2" y="4"/>
  <data x="3" y="9"/>
  <data x="4" y="16"/>
  <data x="5" y="25"/>
</squares>
```

See the [wiki](https://github.com/oozcitak/xmlbuilder-js/wiki) for details and [examples](https://github.com/oozcitak/xmlbuilder-js/wiki/Examples) for more complex examples.
