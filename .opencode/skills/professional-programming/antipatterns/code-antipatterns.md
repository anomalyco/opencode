<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Antipatterns](#antipatterns)
  - [Strict email validation](#strict-email-validation)
  - [Late returns](#late-returns)
  - [Hacks comment](#hacks-comment)
  - [Repeating arguments in function name](#repeating-arguments-in-function-name)
  - [Repeating class name in method name](#repeating-class-name-in-method-name)
  - [Repeating function name in docstring](#repeating-function-name-in-docstring)
  - [Unreadable response construction](#unreadable-response-construction)
  - [Undeterministic tests](#undeterministic-tests)
  - [Unbalanced boilerplate](#unbalanced-boilerplate)
  - [Inconsistent use of verbs in functions](#inconsistent-use-of-verbs-in-functions)
  - [Opaque function arguments](#opaque-function-arguments)
  - [Hiding formatting](#hiding-formatting)
  - [Returning nothing instead of raising NotFound exception](#returning-nothing-instead-of-raising-notfound-exception)
  - [Having a library that contains all utils](#having-a-library-that-contains-all-utils)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Antipatterns

Most of those are antipatterns in the Python programming language, but some of
them might be more generic.

## Strict email validation

It is almost impossible to strictly validate an email. Even if you were writing
or using a regex that follows
[RFC5322](http://tools.ietf.org/html/rfc5322#section-3.4), you would have false
positives when trying to validate actual emails that don't follow the RFC.

What's more, validating an email provides very weak guarantees. A stronger,
more meaningful validation would be to send an email and validate that the user
received it.

To sum up, don't waste your time trying to validate an email if you don't need
to (or just check that there's a `@` in it). If you need to, send an email with
a token and validate that the user received it.

## Late returns

Returning early reduces cognitive overhead, and improve readability by killing
indentation levels.

Bad:

```python
def toast(bread):
    if bread.kind != 'brioche':
        if not bread.is_stale:
            toaster.toast(bread)
```

Good:

```python
def toast(bread):
    if bread.kind == 'brioche' or bread.is_stale:
        return

    toaster.toast(bread)
```

## Hacks comment

Bad:

```python
# Gigantic hack (written by Louis de Funes) 04-01-2015
toaster.restart()
```

There's multiple things wrong with this comment:

- Even if it is actually a hack, no need to say it in a comment. It lowers the
  perceived quality of a codebase and impacts developer motivation.
- Putting the author and the date is totally useless when using source control
  (`git blame`).
- This does not explain why it's temporary.
- It's impossible to easily grep for temporary fixes.
- [Louis de Funès](https://en.wikipedia.org/wiki/Louis_de_Fun%C3%A8s) would never
  write a hack.

Good:

```python
# Need to restart toaster to prevent burning bread
# TODO: replace with proper fix
toaster.restart()
```

- This clearly explains the nature of the temporary fix.
- Using `TODO` is an ubiquitous pattern that allows easy grepping and plays
  nice with most text editors.
- The perceived quality of this temporary fix is much higher.

## Repeating arguments in function name

Bad:

```python
def get_by_color(color):
    return Toasters.filter_by(color=color)
```

Putting the argument name in both the function name and in arguments is, in
most cases and for most interpreted languages, redundant.

Good:

```python
def get(color=None):
    if color:
        return Toasters.filter_by(color=color)
```

## Repeating class name in method name

Bad:

```python
class Toasters(object):
    def get_toaster(self, toaster_id):
        pass
```

This is bad because it's unnecessarily redundant (`Toasters.get_toaster(1)`). According to the single responsibility principle, a class should focus on one area of responsibility. So the `Toasters` class should only focus on toasters object.

Good:

```python
class Toasters(object):
    def get(self, toaster_id):
        pass
```

Which produces much more concise code:

```
toaster = Toasters.get(1)
```

## Repeating function name in docstring

Bad:

```python
def test_return_true_if_toast_is_valid():
    """Verify that we return true if toast is valid."""
    assert is_valid(Toast('brioche')) is true
```

Why is it bad?

- The docstring and function name are not DRY.
- There's no actual explanation of what valid means.

Good:

```python
def test_valid_toast():
    """Verify that 'brioche' are valid toasts."""
    assert is_valid(Toast('brioche')) is true
```

Or, another variation:

```python
def test_brioche_are_valid_toast():
    assert is_valid(Toast('brioche')) is true
```

## Unreadable response construction

TODO

Bad:

```python
def get_data():
    returned = {}
    if stuff:
        returned['toaster'] = 'toaster'
    if other_stuff:
        if the_other_stuff:
            returned['toast'] = 'brioche'
    else:
        returned['toast'] = 'bread'
    return returned
```

Good:

```python
def get_data():
    returned = {
        'toaster': '',
        'toast': '',
    }
```

## Undeterministic tests

When testing function that don't behave deterministically, it can be tempting
to run them multiple time and average their results.

Bad:

```python
def function():
    if random.random() > .4:
        return True
    else:
        return False


def test_function():
    number_of_true = 0
    for _ in xrange(1000):
        returned = function()
        if returned:
            number_of_true += 1

    assert 30 < number_of_true < 50
```

There are multiple things that are wrong with this approach:

- This is a flaky test. Theoretically, this test could still fail.
- This example is simple enough, but `function` might be doing some
  computationally expensive task, which would make this test severely
  inefficient.
- The test is quite difficult to understand.

Good:

```python
@mock.patch('random.random')
def test_function(mock_random):
    mock_random.return_value = 0.7
    assert function() is True
```

This is a deterministic test that clearly tells what's going on.

## Unbalanced boilerplate

One thing to strive for in libraries is have as little boilerplate as possible,
but not less.

Not enough boilerplate: you'll spend hours trying to understand specific
behaviors that are too magical/implicit. You will need flexibility and you
won't be able to get it. Boilerplate is useful insofar as it increases
[transparency](http://www.catb.org/esr/writings/taoup/html/ch01s06.html).

Too much boilerplate: users of your library will be stuck using outdated
patterns. Users will write library to generate the boilerplate required by your
library.

I think Flask and SQLAlchemy do a very good job at keeping this under control.

## Inconsistent use of verbs in functions

Bad:

```python
def get_toasters(color):
    """Get a bunch of toasters."""
    return filter(lambda toaster: toaster.color == color, TOASTERS)


def find_toaster(id_):
    """Return a single toaster."""
    toasters = filter(lambda toaster: toaster.id == id_, TOASTERS)
    assert len(toasters) == 1
    return toasters[1]


def find_toasts(color):
    """Find a bunch of toasts."""
    return filter(lambda toast: toast.color == color, TOASTS)
```

The use of verb is inconsistent in this example. `get` is used to return
a possibly empty list of toasters, and `find` is used to return a single
toaster (or raise an exception) in the second function or a possibly empty list
of toasts in the third function.

This is based on personal taste but I have the following rule:

- `get` prefixes function that return at most one object (they either return
  none or raise an exception depending on the cases)
- `find` prefixes function that return a possibly empty list (or iterable) of
  objects.

Good:

```python
def find_toasters(color):
    """Find a bunch of toasters."""
    return filter(lambda toaster: toaster.color == color, TOASTERS)


def get_toaster(id_):
    """Return a single toaster."""
    toasters = filter(lambda toaster: toaster.id == id_, TOASTERS)
    assert len(toasters) == 1
    return toasters[1]


def find_toasts(color):
    """Find a bunch of toasts."""
    return filter(lambda toast: toast.color == color, TOASTS)
```

## Opaque function arguments

A few variants of what I consider code that is difficult to debug:

```python
def create(toaster_params):
    name = toaster_params['name']
    color = toaster_params.get('color', 'red')


class Toaster(object):

    def __init__(self, params):
        self.name = params['name']


# Probably the worst of all
def create2(*args, **kwargs):
    name = kwargs['name']
```

Why is this bad?

- It's really easy to make a mistake, especially in interpreted languages such
  as Python. For instance, if I call `create({'name': 'hello', 'ccolor': 'blue'})`, I won't get any error, but the color won't be the one I expect.
- It increases cognitive load, as I have to understand where the object is
  coming from to introspect its content.
- It makes the job of static analyzer harder or impossible.

Granted, this pattern is sometimes required (for instance when the number of
params is too large, or when dealing with pure data).

A better way is to be explicit:

```python
def create(name, color='red'):
    pass  # ...
```

## Hiding formatting

Bad:

```python
# main.py

from utils import format_query


def get_user(user_id):
    url = get_url(user_id)
    return requests.get(url)


# utils.py


def get_url(user_id):
    return 'http://127.0.0.1/users/%s' % user_id
```

I consider this an antipattern because it hides the request formatting from the developer, making it more complex to see what `url` look like. In this extreme example, the formatting function is a one-liner which sounds a bit overkill for
a function.

Good:

```python
def get_user(user_id):
    url = 'http://127.0.0.1/users/%s' % user_id
    return requests.get(url)
```

Even if you were duplicating the logic once or twice it might still be fine, because:

- You're unlikely to re-use anywhere else outside this file.
- Putting this inline makes it easier for follow the flow. Code is written to be read primarily by computers.

## Returning nothing instead of raising NotFound exception

Bad in certain cases:

```python
def get_toaster(toaster_id):
    try:
        return do_get_toaster(toaster_id)
    except NotFound:
        return None


def toast(toaster_id):
    toaster = get_toaster(toaster_id)
    ...
    toaster.toast("brioche")
```

It all depends on the caller, but in this cases I'd argue that it is bad practice to return nothing when the toaster identified by `toaster_id` can't be found, for two main reasons.

**First reason**: when we provide an identifier, we expect it to return something. Once again, this depends on the caller (for instance, we could try to see if a user exists by checking an email for instance). In this simple example it's ok because the `toaster.toast()` will fail immediately, but what if we were never calling it and creating some other unrelated objects? We would be doing things that we should never be doing if the object did not exist:

```python
def toast(toaster_id, user):
    toaster = get_toaster(toaster_id)
    # We should never do this! The toaster might not even exists.
    send_welcome_email(user)
    bill_new_toaster(user)
```

**Second reason**: `toaster.toast` will fail anyway if `toaster` is none (in Python with `AttributeError: NoneType has no attribute toast`). In this abstract example it's ok because the two lines are next to each other, but the actual `toaster.toast()` call might happen further down the stack - and it will be very difficult for the developer to understand where the error is coming from.

```python
def toast(toaster_id, user):
    toaster = get_toaster(toaster_id)
    do_stuff_a(toaster)


def do_stuff_a(toaster):
    ...
    do_stuff_b(toaster)
    ...


def do_stuff_b(toaster):
    # Here is the actual call where toaster is called - but we should
    # have failed early if it's not there.
    toaster.toast()
```

What's the correct things to do?

- If you expect the object to be there, make sure to raise if you don't find it.
- If you're using SQLAlchemy, use `one()` to force raising an exception if the object can't be found. Don't use `first` or `one_or_none()`.

## Having a library that contains all utils

Bad:

```python
def get_current_date():
    ...


def create_csv(...):
    ...


def upload_to_sftp(...):
    ...
```

`util` or `tools` or `lib` modules that contain all sorts of utilities have a tendency to become bloated and unmaintainable. Prefer to have small, dedicated files.

This will keep your imports logical (`lib.date_utils`, `lib.csv_utils`, `lib.sftp`), make it easier for the reader to identify all the utilities around a specific topic, and test files easy to keep organized.
