import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

// happy-dom has no Web Animations: the menus' motion runs to its end at once.
Element.prototype.animate = function () {
  return { finished: Promise.resolve(), cancel() {} } as unknown as Animation
}
