FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY packages/opencode/dist/opencode-linux-x64/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode

ENV OPENCODE_DATABASE_URL=postgresql://opencode:opencode@postgres:5432/opencode

WORKDIR /home/jadson

ENTRYPOINT ["opencode"]
