from collections import namedtuple

Bread = namedtuple("Bread", "color")


class ToastException(Exception):
    pass


def toast(bread):
    try:
        put_in_toaster(bread)
    except:
        print("Got exception while trying to toast")
        raise


def put_in_toaster(bread):
    brad.color = "light_brown"  # Note the typo


toast(Bread("yellow"))
