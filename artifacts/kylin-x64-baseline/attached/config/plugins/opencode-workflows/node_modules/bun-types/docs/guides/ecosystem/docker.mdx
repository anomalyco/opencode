---
title: Containerize a Bun application with Docker
sidebarTitle: Docker with Bun
mode: center
---

<Note>
  This guide assumes you already have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.
</Note>

[Docker](https://www.docker.com) is a platform for packaging and running an application as a lightweight, portable _container_ that encapsulates all the necessary dependencies.

---

To _containerize_ our application, we define a `Dockerfile`. This file contains a list of instructions to initialize the container, copy our local project files into it, install dependencies, and starts the application.

```docker Dockerfile icon="docker"
# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# [optional] tests & build
ENV NODE_ENV=production
RUN bun test
RUN bun run build

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/index.ts .
COPY --from=prerelease /usr/src/app/package.json .

# run the app
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "index.ts" ]
```

---

Now that you have your docker image, let's look at `.dockerignore` which has the same syntax as `.gitignore`, here you need to specify the files/directories that must not go in any stage of the docker build. An example for a ignore file is

```txt .dockerignore icon="docker"
node_modules
Dockerfile*
docker-compose*
.dockerignore
.git
.gitignore
README.md
LICENSE
.vscode
Makefile
helm-charts
.env
.editorconfig
.idea
coverage*
```

---

We'll now use `docker build` to convert this `Dockerfile` into a _Docker image_, a self-contained template containing all the dependencies and configuration required to run the application.

The `-t` flag lets us specify a name for the image, and `--pull` tells Docker to automatically download the latest version of the base image (`oven/bun`). The initial build will take longer, as Docker will download all the base images and dependencies.

```bash terminal icon="terminal"
docker build --pull -t bun-hello-world .
```

```txt
[+] Building 0.9s (21/21) FINISHED
 => [internal] load build definition from Dockerfile                                                                                     0.0s
 => => transferring dockerfile: 37B                                                                                                      0.0s
 => [internal] load .dockerignore                                                                                                        0.0s
 => => transferring context: 35B                                                                                                         0.0s
 => [internal] load metadata for docker.io/oven/bun:1                                                                                    0.8s
 => [auth] oven/bun:pull token for registry-1.docker.io                                                                                  0.0s
 => [base 1/2] FROM docker.io/oven/bun:1@sha256:373265748d3cd3624cb3f3ee6004f45b1fc3edbd07a622aeeec17566d2756997                         0.0s
 => [internal] load build context                                                                                                        0.0s
 => => transferring context: 155B                                                                                                        0.0s
 # ...lots of commands...
 => exporting to image                                                                                                                   0.0s
 => => exporting layers                                                                                                                  0.0s
 => => writing image sha256:360663f7fdcd6f11e8e94761d5592e2e4dfc8d167f034f15cd5a863d5dc093c4                                             0.0s
 => => naming to docker.io/library/bun-hello-world                                                                                       0.0s
```

---

We've built a new _Docker image_. Now let's use that image to spin up an actual, running _container_.

We'll use `docker run` to start a new container using the `bun-hello-world` image. It will be run in _detached_ mode (`-d`) and we'll map the container's port 3000 to our local machine's port 3000 (`-p 3000:3000`).

The `run` command prints a string representing the _container ID_.

```sh terminal icon="terminal"
docker run -d -p 3000:3000 bun-hello-world
```

```txt
7f03e212a15ede8644379bce11a13589f563d3909a9640446c5bbefce993678d
```

---

The container is now running in the background. Visit [localhost:3000](http://localhost:3000). You should see a `Hello, World!` message.

---

To stop the container, we'll use `docker stop <container-id>`.

```sh terminal icon="terminal"
docker stop 7f03e212a15ede8644379bce11a13589f563d3909a9640446c5bbefce993678d
```

---

If you can't find the container ID, you can use `docker ps` to list all running containers.

```sh terminal icon="terminal"
docker ps
```

```txt
CONTAINER ID        IMAGE               COMMAND                  CREATED             STATUS              PORTS                    NAMES
7f03e212a15e        bun-hello-world     "bun run index.ts"       2 minutes ago       Up 2 minutes        0.0.0.0:3000->3000/tcp   flamboyant_cerf
```

---

That's it! Refer to the [Docker documentation](https://docs.docker.com/) for more advanced usage.
