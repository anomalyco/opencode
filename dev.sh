#!/bin/bash

# Development script for hot-reloading C++ Mandiri Backend
# Watches for file changes and automatically rebuilds and restarts the server

nodemon --ext ts,js --exec "bash -c 'bun dev serve'"
