import h from 'solid-js/h';

function Fragment(props) {
  return props.children;
}
function jsx(type, props) {
  return h(type, props);
}

export { Fragment, jsx, jsx as jsxDEV, jsx as jsxs };
