import { createInterface } from "readline";
import { stdin as input, stdout as output } from "process";

const loaderToString = [
  "none",
  "base64",
  "binary",
  "copy",
  "css",
  "dataurl",
  "default",
  "empty",
  "file",
  "global-css",
  "js",
  "json",
  "json",
  "jsx",
  "local-css",
  "text",
  "ts",
  "ts",
  "tsx",
];

const plugins = await import(process.argv[2]);

const onResolve = [];
const onLoad = [];
const onEnd = [];

const stubAPI = {
  onResolve(options, callback) {
    onResolve.push({ options, callback });
  },
  onLoad(options, callback) {
    onLoad.push({ options, callback });
  },
  onEnd(callback) {
    onEnd.push(callback);
  },
};

for (const plugin of plugins.default) {
  plugin.setup(stubAPI);
}

const rl = createInterface({ input, output, terminal: false });

rl.on("line", async (line) => {
  const msg = JSON.parse(line);

  new Promise(async () => {
    let reply;

    if (msg.command === "resolve") {
      for (const { options, callback } of onResolve) {
        if (new RegExp(options.filter).test(msg.path)) {
          reply = await callback(msg.value);
          if (reply) break;
        }
      }
    }

    if (msg.command === "load") {
      for (const { options, callback } of onLoad) {
        if (new RegExp(options.filter).test(msg.path)) {
          reply = await callback(msg.value);
          if (reply) break;
        }
      }
    }
    if (msg.command === "end") {
      for (const callback of onEnd) {
        reply = await callback(msg.value);
      }
    }

    reply = reply || {};
    output.write(
      JSON.stringify({
        id: msg.id,
        value: reply,
      }) + "\n",
    );
  });
});
