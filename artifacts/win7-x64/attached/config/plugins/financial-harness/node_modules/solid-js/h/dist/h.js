import { spread, assign, insert, createComponent, dynamicProperty, SVGElements } from 'solid-js/web';

const $ELEMENT = Symbol("hyper-element");
function createHyperScript(r) {
  function h() {
    let args = [].slice.call(arguments),
      e,
      classes = [],
      multiExpression = false;
    while (Array.isArray(args[0])) args = args[0];
    if (args[0][$ELEMENT]) args.unshift(h.Fragment);
    typeof args[0] === "string" && detectMultiExpression(args);
    const ret = () => {
      while (args.length) item(args.shift());
      if (e instanceof Element && classes.length) e.classList.add(...classes);
      return e;
    };
    ret[$ELEMENT] = true;
    return ret;
    function item(l) {
      const type = typeof l;
      if (l == null) ;else if ("string" === type) {
        if (!e) parseClass(l);else e.appendChild(document.createTextNode(l));
      } else if ("number" === type || "boolean" === type || "bigint" === type || "symbol" === type || l instanceof Date || l instanceof RegExp) {
        e.appendChild(document.createTextNode(l.toString()));
      } else if (Array.isArray(l)) {
        for (let i = 0; i < l.length; i++) item(l[i]);
      } else if (l instanceof Element) {
        r.insert(e, l, multiExpression ? null : undefined);
      } else if ("object" === type) {
        let dynamic = false;
        const d = Object.getOwnPropertyDescriptors(l);
        for (const k in d) {
          if (k === "class" && classes.length !== 0) {
            const fixedClasses = classes.join(" "),
              value = typeof d["class"].value === "function" ? () => fixedClasses + " " + d["class"].value() : fixedClasses + " " + l["class"];
            Object.defineProperty(l, "class", {
              ...d[k],
              value
            });
            classes = [];
          }
          if (k !== "ref" && k.slice(0, 2) !== "on" && typeof d[k].value === "function") {
            r.dynamicProperty(l, k);
            dynamic = true;
          } else if (d[k].get) dynamic = true;
        }
        dynamic ? r.spread(e, l, e instanceof SVGElement, !!args.length) : r.assign(e, l, e instanceof SVGElement, !!args.length);
      } else if ("function" === type) {
        if (!e) {
          let props,
            next = args[0];
          if (next == null || typeof next === "object" && !Array.isArray(next) && !(next instanceof Element)) props = args.shift();
          props || (props = {});
          if (args.length) {
            props.children = args.length > 1 ? args : args[0];
          }
          const d = Object.getOwnPropertyDescriptors(props);
          for (const k in d) {
            if (Array.isArray(d[k].value)) {
              const list = d[k].value;
              props[k] = () => {
                for (let i = 0; i < list.length; i++) {
                  while (list[i][$ELEMENT]) list[i] = list[i]();
                }
                return list;
              };
              r.dynamicProperty(props, k);
            } else if (typeof d[k].value === "function" && !d[k].value.length) r.dynamicProperty(props, k);
          }
          e = r.createComponent(l, props);
          args = [];
        } else {
          while (l[$ELEMENT]) l = l();
          r.insert(e, l, multiExpression ? null : undefined);
        }
      }
    }
    function parseClass(string) {
      const m = string.split(/([\.#]?[^\s#.]+)/);
      if (/^\.|#/.test(m[1])) e = document.createElement("div");
      for (let i = 0; i < m.length; i++) {
        const v = m[i],
          s = v.substring(1, v.length);
        if (!v) continue;
        if (!e) e = r.SVGElements.has(v) ? document.createElementNS("http://www.w3.org/2000/svg", v) : document.createElement(v);else if (v[0] === ".") classes.push(s);else if (v[0] === "#") e.setAttribute("id", s);
      }
    }
    function detectMultiExpression(list) {
      for (let i = 1; i < list.length; i++) {
        if (typeof list[i] === "function") {
          multiExpression = true;
          return;
        } else if (Array.isArray(list[i])) {
          detectMultiExpression(list[i]);
        }
      }
    }
  }
  h.Fragment = props => props.children;
  return h;
}

const h = createHyperScript({
  spread,
  assign,
  insert,
  createComponent,
  dynamicProperty,
  SVGElements
});

export { h as default };
