ARG REGISTRY=ghcr.io/CyberStrikeus
FROM ${REGISTRY}/build/bun-node:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    docker.io \
    pacman-package-manager \
  && rm -rf /var/lib/apt/lists/*
