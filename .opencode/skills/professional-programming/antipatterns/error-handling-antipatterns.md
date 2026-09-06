<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table of Contents

- [Error handling anti-patterns](#error-handling-anti-patterns)
  - [Hiding exceptions](#hiding-exceptions)
  - [Raising unrelated/unspecific exception](#raising-unrelatedunspecific-exception)
  - [Unconstrained defensive programming](#unconstrained-defensive-programming)
  - [Unnecessarily catching and re-raising exceptions](#unnecessarily-catching-and-re-raising-exceptions)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# Error handling anti-patterns

## Hiding exceptions

There are multiple variations of this anti-pattern:

```python
# Silence all exceptions
def toast(bread):
    try:
        toaster = Toaster()
        toaster.insert(bread)
        toaster.toast()
    except:
        pass


# Silence some exceptions
def toast(bread):
    try:
        toaster = Toaster()
        toaster.insert(bread)
        toaster.toast()
    except ValueError:
        pass
```

It depends on the context but in most cases this is a bad pattern:

- **Debugging** those silent errors will be really difficult, because they won't show up in logs and exception reporting tool such as Sentry. Say you have an undefined variable in `Toaster.insert()`: it will raise `NameError`, which will be caught, and ignored, and you will never know about this developer error.
- **The user experience** will randomly degrade without anybody knowing about it, including the user.
- **Identifying** those errors will be impossible. Say `do_stuff` does an HTTP request to another service, and that service starts misbehaving. There won't be any exception, any metric that will let you identify it.

An article even named this [the most diabolical Python antipattern](https://realpython.com/blog/python/the-most-diabolical-python-antipattern/).

The following full example:

```python
from collections import namedtuple

Bread = namedtuple('Bread', 'color')

class ToastException(Exception):
    pass

def toast(bread):
    try:
        put_in_toaster(bread)
    except:
        raise ToastException('Could not toast bread')


def put_in_toaster(bread):
    brad.color = 'light_brown'  # Note the typo


toast(Bread('yellow'))
```

Will raise this cryptic and impossible to debug error:

```
Traceback (most recent call last):
  File "python-examples/reraise_exceptions.py", line 19, in <module>
    toast(Bread('yellow'))
  File "python-examples/reraise_exceptions.py", line 12, in toast
    raise ToastException('Could not toast bread')
__main__.ToastException: Could not toast bread
```

Sometime it's tempting to think that graceful degradation is about silencing
exception. It's not.

- Graceful degradation needs to happen at the **highest level** of the code, so that the user can get a very explicit error message (e.g. "we're having issues with X, please retry in a moment"). That requires knowing that there was an error, which you can't tell if you're silencing the exception.
- You need to know when graceful degradation happens. You also need to be
  alerted if it happens too often. This requires adding monitoring (using
  something like statsd) and logging (Python's `logger.exception` automatically
  adds the exception stacktrace to the log message for instance). Silencing an
  exception won't make the error go away: all things being equal, it's better
  for something to break hard, than for an error to be silenced.
- It is tempting to confound silencing the exception and fixing the exception. Say you're getting sporadic timeouts from a service. You might thing: let's ignore those timeouts and just do something else, like return an empty response. But this is very different from (1) actually finding the root cause for those timeouts (e.g. maybe a specific edge cases impacting certain objects) (2) doing proper graceful degradation (e.g. asking users to retry later because the request failed).

In other words, ask yourself: would it be a problem if every single action was failing? If you're silencing the error, how would you know it's happening for every single action?

Here's a number a better ways to do this:

**Log and create metrics**

```python
import statsd


def toast(bread):
    # Note: no exception handling here.
    toaster = Toaster()
    toaster.insert(bread)
    toaster.toast()


def main():
    try:
        toast('brioche')
    except:
        logger.exception('Could not toast bread')
        statsd.count('toast.error', 1)
```

**Very important**: adding logging and metrics won't not sufficient if it's difficult to consume them. They won't help the developer who's debugging. There needs to be automatic alerting associated to those stats. The logs needs to be surfaced somewhere, ideally next to the higher exception (e.g. let's our `main` function above is used in a web interface - the web interface could say "additionally, the following logs were generated and display the log). For instance, Sentry can be configured to surface `logger.exception` errors the same way exception are surfaced. Otherwise the developer will still have to read the code to understand what's going on. Also - this won't work with sporadic errors. Those needs to be dealt with properly, and until then, it's better to let them go to your usual alerting tool.

Note that knowing where to catch is very important too. If you're catching
inside the `toast` function, you might be hiding things a caller would need to
know. Since this function is not returning anything, how would you make the
difference between a success and a failure? You can't. That's why you want to
let it raise, and catch only in the caller, where you have the context to know
how you'll handle the exception.

**Re-raise immediately**

```python
import statsd


def toast(bread):
    try:
        toaster = Toaster()
        toaster.insert(bread)
        toaster.toast()
    except:
        raise ToastingException('Could not toast bread %r' % bread)


def main():
    # Note: no exception handling here
    toast('brioche')
```

**Be very specific about the exception that are caught**

```python
import statsd


def toast(bread):
    try:
        toaster = Toaster()
    except ValueError:
        # Note that even though we catch, we're still logging + creating
        # a metric
        logger.exception('Could not get toaster')
        statsd.count('toaster.instantiate.error', 1)
        return

    toaster.insert(bread)
    toaster.toast()


def main():
    toast('brioche')
```

## Raising unrelated/unspecific exception

Most languages have predefined exceptions, including Python. It is important to make sure that the right exception is raised from a semantic standpoint.

Bad:

```python
def validate(toast):
    if isinstance(toast, Brioche):
        # RuntimeError is too broad
        raise RuntimeError('Invalid toast')


def validate(toast):
    if isinstance(toast, Brioche):
        # SystemError should only be used for internal interpreter errors
        raise SystemError('Invalid toast')
```

Good:

```python
def validate(toast):
    if isinstance(toast, Brioche):
        raise TypeError('Invalid toast')
```

`TypeError` is here perfectly meaningful, and clearly convey the context around the error.

## Unconstrained defensive programming

While defensive programming can be a very good technique to make the code more resilient, it can seriously backfire when misused. This is a very similar anti-pattern to carelessly silencing exceptions (see about this anti-pattern in this document).

One example is to handle an edge case as a generic case at a very low level. Consider the following example:

```python
def get_user_name(user_id):
    url = 'http://127.0.0.1/users/%s' % user_id
    response = requests.get(url)
    if response.status == 404:
        return 'unknown'
    return response.data
```

While this may look like a very good example of defensive programming (we're returning `unknown` when we can't find the user), this can have terrible repercussions, very similar to the one we have when doing an unrestricted bare `try... except`:

- A new developer might not know about this magical convention, and assume that `get_user_name` is guaranteed to return a true user name.
- The external service that we're getting user name from might start failing, and returning 404. We would silently return 'unknown' as a user name for all users, which could have terrible repercussions.

A much cleaner way is to raise an exception on 404, and let the caller decide how it wants to handle users that are not found.

## Unnecessarily catching and re-raising exceptions

Bad:

```python
def toast(bread):
    try:
        put_in_toaster(bread)
    except InvalidBreadException:
        raise ToastException('Could not toast')
```

Side note: an unconditional exception catching is considered even worse (see [hiding exceptions](https://github.com/charlax/antipatterns/blob/master/code-antipatterns.md#hiding-exceptions)).

This is a better pattern because we explicitly state what happened in the exception message:

```python
def toast(bread):
    try:
        put_in_toaster(bread)
    except InvalidBreadType as e:
        raise ToastException('Cannot toast this bread type')
```

If we need to do some cleanup or extra logging, it's better to just raise the original exception again. The developer will know exactly what happened.

```python
def toast(bread):
    try:
        put_in_toaster(bread)
    except:
        print 'Got exception while trying to toast'
        raise  # note the absence of specific exception
```

Here's what would happen:

```
Got exception while trying to toast
Traceback (most recent call last):
  File "reraise_exceptions_good.py", line 20, in <module>
    toast(Bread('yellow'))
  File "reraise_exceptions_good.py", line 10, in toast
    put_in_toaster(bread)
  File "reraise_exceptions_good.py", line 17, in put_in_toaster
    brad.color = 'light_brown'  # Note the typo
NameError: global name 'brad' is not defined
```

Another way to show how absurd the anti-pattern becomes at scale is through an example:

```python
def call_1():
    try:
        call_2()
    except Call2Exception:
        raise Call1Exception()


def call_2():
    try:
        call_3()
    except Call3Exception:
        raise Call2Exception()


def call_3():
    ...
```

Another problem with this pattern is that you can consider it quite useless to do all of this catch/re-raise, since you will still need to catch at the end. In other words:

> Error handling, and recovery are best done at the outer layers of your code base. This is known as the end-to-end principle. The end-to-end principle argues that it is easier to handle failure at the far ends of a connection than anywhere in the middle. If you have any handling inside, you still have to do the final top level check. If every layer atop must handle errors, so why bother handling them on the inside?

_[Write code that is easy to delete, not easy to extend](http://programmingisterrible.com/post/139222674273/write-code-that-is-easy-to-delete-not-easy-to)_

A better way:

```python
# This is the highest level function where we have enough
# context to know how to handle the exceptions
def call_1():
    try:
        call_2()
    except Call2Exception:
        # handle it...
        pass
    except Call3Exception:
        # handle it...
        pass


def call_2():
    # Do not handle anything here.
    call_3()


def call_3():
    ...
```

More resources:

- [Hiding exceptions](https://github.com/charlax/antipatterns/blob/master/code-antipatterns.md#hiding-exceptions)) anti-pattern.
