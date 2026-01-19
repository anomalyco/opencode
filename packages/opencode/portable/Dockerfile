# syntax=docker/dockerfile:1
ARG BUN_VERSION="1.3.5"
ARG TARGETARCH

FROM oven/bun:${BUN_VERSION}-alpine AS build-step
ARG TARGETARCH
ARG RUST_TARGET
ARG OPENCODE_ARTIFACT
ARG LD_NAME
ARG LIBC_NAME
ARG CPU

WORKDIR /code
RUN mkdir -p ./embedded /output

# Install deps
RUN apk add patchelf rustup gcc libstdc++
RUN rustup-init -t ${RUST_TARGET} -y
ENV PATH="/root/.cargo/bin:$PATH"

# These are the required shared libraries for bun and opencode to run
# They are copied from this base image to ensure compatibility
# The `patchelf` tool is used in runtime to set the interpreter after unpacking the binary
RUN cp --dereference \
      /usr/bin/patchelf \
      /usr/lib/libstdc++.so.6 \
      /usr/lib/libgcc_s.so.1 \
      /lib/${LIBC_NAME} \
      ./embedded && \
    patchelf --set-rpath '$ORIGIN' ./embedded/patchelf && \
    ln -sf ${LIBC_NAME} ./embedded/${LD_NAME}

COPY --from=dist ${OPENCODE_ARTIFACT}/bin/opencode ./embedded/opencode
RUN patchelf --set-rpath '$ORIGIN' ./embedded/opencode

# Pull the code and build the launcher
# It will bundle the files we put in ./embedded above
ADD . /code
RUN cargo build --release --target ${RUST_TARGET} && \
    cp /code/target/${RUST_TARGET}/release/launcher /output/opencode

# This step is used together with buildx `--output=type=local,dest=$PATH` to extract the built binary
# Otherwise we need to create a temporary container to copy the binary out
FROM scratch AS output-step
COPY --from=build-step /output/opencode opencode
