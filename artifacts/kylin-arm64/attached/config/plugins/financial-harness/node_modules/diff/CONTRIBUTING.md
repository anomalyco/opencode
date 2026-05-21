## Building and testing

```
yarn
yarn test
```

To run tests in a *browser* (for instance to test compatibility with Firefox, with Safari, or with old browser versions), run `yarn karma start`, then open http://localhost:9876/ in the browser you want to test in. Results of the test run will appear in the terminal where `yarn karma start` is running.

If you notice any problems, please report them to the GitHub issue tracker at
[http://github.com/kpdecker/jsdiff/issues](http://github.com/kpdecker/jsdiff/issues).

## Releasing

Run a test in Firefox via the procedure above before releasing.

A full release may be completed by first updating the `"version"` property in package.json, then running the following:

```
yarn clean
yarn build
yarn publish
```

After releasing, remember to:
* commit the `package.json` change and push it to GitHub
* create a new version tag on GitHub
* update `diff.js` on the `gh-pages` branch to the latest built version from the `dist/` folder.
