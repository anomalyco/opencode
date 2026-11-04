const jsxTransform = require("babel-plugin-jsx-dom-expressions");

module.exports = function (context, options = {}) {
  const plugins = [
    [
      jsxTransform,
      Object.assign(
        {
          moduleName: "solid-js/web",
          builtIns: [
            "For",
            "Show",
            "Switch",
            "Match",
            "Suspense",
            "SuspenseList",
            "Portal",
            "Index",
            "Dynamic",
            "ErrorBoundary"
          ],
          contextToCustomElements: true,
          wrapConditionals: true,
          generate: "dom"
        },
        options
      )
    ]
  ];

  return {
    plugins
  };
};
