VERSION=$(shell node --eval "console.log(require('./package.json').version)")
BUNDLE=dist/exif-parser-$(VERSION).js
MIN_BUNDLE=dist/exif-parser-$(VERSION)-min.js
BROWSERIFY=node_modules/.bin/browserify
UGLIFY=node_modules/.bin/uglifyjs

build-browser-bundle: setup
	@echo "building $(BUNDLE) ..."
	@mkdir -p dist/
	@$(BROWSERIFY) --bare browser-global.js -o $(BUNDLE)
	@echo "building $(MIN_BUNDLE) ..."
	@$(UGLIFY) $(BUNDLE) -o $(MIN_BUNDLE) --compress
setup:
	@npm install --no-optional --loglevel error --development
clean:
	@rm -rf dist/