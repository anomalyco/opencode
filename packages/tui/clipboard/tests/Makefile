# Copyright 2021 The golang.design Initiative Authors.
# All rights reserved. Use of this source code is governed
# by a MIT license that can be found in the LICENSE file.
#
# Written by Changkun Ou <changkun.de>

all: test

test:
	go test -v -count=1 -covermode=atomic ..

test-docker:
	docker build -t golang-design/x/clipboard ..
	docker run --rm --name cb golang-design/x/clipboard
	docker rmi golang-design/x/clipboard