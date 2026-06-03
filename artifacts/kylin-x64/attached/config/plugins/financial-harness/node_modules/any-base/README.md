# README #

The library allows you to convert any large numbers in any number base to another number base. The base is determined by specifying the alphabet. So is full freedom

[![NPM](https://nodei.co/npm/any-base.png?downloads=true&stars=true)](https://nodei.co/npm/any-base/)

## Installation ##

```
npm install any-base --save
```

## API ##

### AnyBase() ###

```
converterFunction = anyBase(sourceAlphabet, destinationAlphabet);
```

#### Parameters ####

* {String} __sourceAlphabet__      digits from smallest to the largest
* {String} __destinationAlphabet__ digits from smallest to the largest

#### Return Values ####

Returns __function__ that converts the number of source base to the destination

### Convert() ###

```
converterFunction(number)
```

#### Parameters ####

* {String} __number__ number of source base

#### Return Values ####

Returns number of destonation base

## Example ##

```js
var anyBase = require('any-base'),
dec2hex = anyBase(anyBase.DEC, anyBase.HEX),
shortId = anyBase(anyBase.DEC, '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-+!@#$^'),
longId  = anyBase('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-+!@#$^', anyBase.DEC);

dec2hex('123456'); // return: '1E240'
shortId('1234567890'); // return: 'PtmIa'
longId('PtmIa'); // return: '1234567890'
```
