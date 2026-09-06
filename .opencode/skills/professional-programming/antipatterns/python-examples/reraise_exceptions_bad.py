from collections import namedtuple

Bread = namedtuple("Bread", "color")


class ToastException(Exception):
    pass


def toast(bread):
    try:
        put_in_toaster(bread)
    except:
        raise ToastException("Could not toast bread")


def put_in_toaster(bread):
    brad.color = "light_brown"  # Note the typo


toast(Bread("yellow"))
