# Standalone experiment; deliberately not part of the package build.
BUILD := .build
SRC := $(BUILD)/lua-5.1.5/src
SUITE := $(BUILD)/lua5.1-tests
CORE := $(SRC)/liblua.a
CLI := $(SRC)/lua
DEBUG := $(BUILD)/debug/lua-5.1.5/src
.DELETE_ON_ERROR:
.PHONY: all cli test conformance test-debug
all: $(CORE)
cli: $(CLI)

$(BUILD)/source.tgz:
	mkdir -p $(BUILD)
	curl -fsSL https://www.lua.org/ftp/lua-5.1.5.tar.gz -o $@

$(SRC)/value-ops.inc: $(BUILD)/source.tgz
	echo '2640fc56a795f29d28ef15e13c34a47e223960b0240e8cb0a82d9b0738695333  $<' | shasum -a 256 -c -
	tar xzf $< -C $(BUILD)
	sed '/^#define runtime_check/,$$d' $(SRC)/lvm.c > $@

$(CORE): $(SRC)/value-ops.inc vm.c
	cp vm.c $(SRC)/lvm.c
	$(MAKE) -C $(SRC) CC="$(CC)" MYCFLAGS="-std=gnu99 -DLUA_USE_POSIX" liblua.a

$(CLI): $(CORE)
	$(MAKE) -C $(SRC) CC="$(CC)" MYCFLAGS="-std=gnu99 -DLUA_USE_POSIX" lua

test: $(CLI)
	$(CLI) test/vm.lua

$(SUITE)/.prepared: Makefile
	mkdir -p $(BUILD)
	curl -fsSL https://www.lua.org/tests/lua5.1-tests.tar.gz -o $(BUILD)/tests.tgz
	echo '49e4ca6561f82ea605908c5041ab5fad66ed9930fa0686675bd51b02767f18ad  $(BUILD)/tests.tgz' | shasum -a 256 -c -
	tar xzf $(BUILD)/tests.tgz -C $(BUILD)
	# The 2006 suite expects a 4 GiB concatenation to overflow size_t.
	# On 64-bit machines it allocates instead. Guard only that assertion block.
	awk 'NR==1 {print "if string.dump(function() end):byte(9) == 4 then"} {print} NR==12 {print "else print(\"skipping 32-bit size overflow assertion\") end"}' $(SUITE)/big.lua > $(BUILD)/big.lua
	mv $(BUILD)/big.lua $(SUITE)/big.lua
	touch $@

conformance: $(CLI) $(SUITE)/.prepared
	cd $(SUITE) && LUA_INIT= LUA_PATH='?;./?.lua' "$(abspath $(CLI))" all.lua

# The internal API/allocator checks need a different ABI. Never link the
# test-only T library into the normal artifact.
$(DEBUG)/lua: vm.c $(SRC)/value-ops.inc $(SUITE)/.prepared
	mkdir -p $(BUILD)/debug
	tar xzf $(BUILD)/source.tgz -C $(BUILD)/debug
	cp $(SRC)/value-ops.inc $(SUITE)/etc/ltests.[ch] $(DEBUG)/
	cp vm.c $(DEBUG)/lvm.c
	$(MAKE) -C $(DEBUG) CC="$(CC)" MYCFLAGS='-std=gnu99 -DLUA_USE_POSIX -DLUA_USER_H=\"ltests.h\"' LUA_O='lua.o ltests.o' lua

test-debug: $(DEBUG)/lua
	$(DEBUG)/lua test/vm.lua
	cd $(SUITE) && LUA_INIT= LUA_PATH='?;./?.lua' "$(abspath $(DEBUG)/lua)" -e 'dofile("api.lua"); dofile("closure.lua"); dofile("db.lua")'
