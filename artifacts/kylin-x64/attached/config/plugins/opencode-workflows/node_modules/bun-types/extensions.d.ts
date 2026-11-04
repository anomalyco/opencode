declare module "*.txt" {
  var text: string;
  export = text;
}

declare module "*.toml" {
  var contents: any;
  export = contents;
}

declare module "*.yaml" {
  var contents: any;
  export = contents;
}

declare module "*.yml" {
  var contents: any;
  export = contents;
}

declare module "*.jsonc" {
  var contents: any;
  export = contents;
}

declare module "*.json5" {
  var contents: any;
  export = contents;
}

declare module "*/bun.lock" {
  var contents: import("bun").BunLockFile;
  export = contents;
}

declare module "*.html" {
  var contents: import("bun").HTMLBundle;

  export = contents;
}
