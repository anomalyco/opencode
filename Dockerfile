FROM alpine:3.21 AS dev

RUN apk add --no-cache curl git ca-certificates bash libstdc++ libgcc

RUN curl -fsSL https://opencode.ai/install | bash && \
    cp /root/.opencode/bin/opencode /usr/local/bin/opencode

RUN adduser -D -u 1000 -h /home/jovyan jovyan
ENV HOME=/home/jovyan
WORKDIR /home/jovyan

EXPOSE 8888

CMD ["opencode", "web", "--port", "8888", "--hostname", "0.0.0.0"]
