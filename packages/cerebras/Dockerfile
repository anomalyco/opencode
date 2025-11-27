FROM alpine

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++
ADD ./dist/cerebras-linux-x64-baseline-musl/bin/cerebras /usr/local/bin/cerebras
RUN cerebras --version
ENTRYPOINT ["cerebras"]
