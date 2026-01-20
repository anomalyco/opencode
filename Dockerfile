FROM debian:trixie
SHELL ["/bin/bash", "-c"]
# escape=\

ARG PYTHON_VERSION="3.13"
ARG OTEL_VERSION="0.143.0"

ENV USER="opencode"
ENV HOME="/home/$USER"
WORKDIR "$HOME"

# hadolint ignore=DL3008
RUN apt-get update -y  \
    && apt-get upgrade -y  \
    && apt-get install -y --no-install-recommends ca-certificates procps jq curl wget unzip git gh nodejs npm \
    && apt-get install -y --no-install-recommends python${PYTHON_VERSION} python${PYTHON_VERSION}-venv python${PYTHON_VERSION} python3-pip \
    && python3 --version \
    && pip3 --version \
    # clean up \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# OpenTelemetry install
ARG TARGETPLATFORM
# need to be explicitly set for docker build locally on MacOS (automatic on GitHub buildx)
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/arm64}
ENV OTEL_PLATFORM=${TARGETPLATFORM#*/}
# contrib package is required to have filelog extension
# ARG OTEL_COLL_DEB="otelcol_${OTEL_VERSION}_linux_${OTEL_PLATFORM}.deb"
ARG OTEL_COLL_DEB="otelcol-contrib_${OTEL_VERSION}_linux_${OTEL_PLATFORM}.deb"
RUN curl --location --output "$OTEL_COLL_DEB" "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$OTEL_VERSION/$OTEL_COLL_DEB" \
    && dpkg -i "$OTEL_COLL_DEB" \
    && rm "$OTEL_COLL_DEB"

# OTEL_CONFIG="/etc/otelcol/config.yaml"
ENV OTEL_CONFIG="$HOME/otel-config.yaml"
COPY otel-config.yaml "$OTEL_CONFIG"

# install last version of uv
ENV PATH="$PATH:/$HOME/.local/bin"
# set to avoid issue describd in https://github.com/hadolint/hadolint/wiki/DL4006
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN curl -LsSf https://astral.sh/uv/install.sh | sh  \
    && source /$HOME/.local/bin/env \
    && uv --version

# install last version of opencode
# hadolint ignore=DL3016
RUN npm install -g  opencode-ai
ENV PATH="$PATH:/$HOME/.opencode/bin/"

ENV OPENCODE_CONFIG="$HOME/.config/opencode/opencode.jsonc"
# use * pattern to avoid copy failure if files don't exist
COPY .opencode/* .opencode/

# user 'opencode'  allows to have all user Opencode data & config on mounted volume
# see https://opencode.ai/docs/troubleshooting/  for content of –/.local
RUN groupadd --system $USER  \
    && useradd --system $USER --gid $USER \
    && chown -R "$USER:$USER"  $HOME
USER "$USER"

# for otel extensions - for debugging but should be removed for prod
# http://localhost:55679/debug/servicez
# http://localhost:1777/debug/pprof/
# http://localhost:13133
EXPOSE 1777
EXPOSE 13133
EXPOSE 55679

# expose otel grpc and http endpoints to make them usable from outside of the container
# for debugging but should be removed for prod
EXPOSE 4317
EXPOSE 4318

# no OpenTelemetry by default
ENV WITH_OTEL="false"

COPY <<EOF start-opencode.sh
echo "Opencode agent - version: $() - user= $(whoami) - started: $(TZ=$TZ date)"
export GH_TOKEN=$GITHUB_OPENCODE_TOKEN
if [[ "\$WITH_OTEL" == "true" ]]
then
  echo "starting OpenTelemetry collector with backend $OTEL_BACKEND_ENDPOINT ..."
  nohup otelcol-contrib --config=$OTEL_CONFIG
fi
sleep infinity
EOF

CMD ["bash", "-c", "bash ./start-opencode.sh | tee -a opencode.log"]
