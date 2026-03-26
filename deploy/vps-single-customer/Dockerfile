FROM oven/bun:1.3.8

WORKDIR /app

ARG VITE_OPENCODE_LICENSE_URL
ENV VITE_OPENCODE_LICENSE_URL=${VITE_OPENCODE_LICENSE_URL} \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/numeral/python \
    PATH=/opt/numeral/python/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

COPY docker/runtime/ /tmp/runtime/

RUN apt-get update \
 && xargs -a /tmp/runtime/apt-packages.txt apt-get install -y --no-install-recommends \
 && if [ -x /usr/bin/fdfind ] && [ ! -e /usr/local/bin/fd ]; then ln -s /usr/bin/fdfind /usr/local/bin/fd; fi \
 && python3 -m venv "$VIRTUAL_ENV" \
 && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir --upgrade pip \
 && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir -r /tmp/runtime/python-data.txt \
 && rm -rf /var/lib/apt/lists/*

COPY . .

RUN bun install --frozen-lockfile
RUN bun --cwd packages/app build

# Managed config (highest priority, overrides user/project settings)
COPY docker/managed/ /etc/opencode/

EXPOSE 4096
