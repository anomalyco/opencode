import { crossSerializeStream } from './cross';
import {
  resolvePlugins,
  type Plugin,
  type PluginAccessOptions,
} from './plugin';
import { serializeString } from './string';

export interface SerializerOptions extends PluginAccessOptions {
  globalIdentifier: string;
  scopeId?: string;
  disabledFeatures?: number;
  onData: (result: string) => void;
  onError: (error: unknown) => void;
  onDone?: () => void;
}

export default class Serializer {
  private alive = true;

  private flushed = false;

  private done = false;

  private pending = 0;

  private cleanups: (() => void)[] = [];

  private refs = new Map<unknown, number>();

  private plugins?: Plugin<any, any>[];

  constructor(private options: SerializerOptions) {
    this.plugins = resolvePlugins(options.plugins);
  }

  keys = new Set<string>();

  write(key: string, value: unknown): void {
    if (this.alive && !this.flushed) {
      this.pending++;
      this.keys.add(key);
      this.cleanups.push(
        crossSerializeStream(value, {
          plugins: this.plugins,
          scopeId: this.options.scopeId,
          refs: this.refs,
          disabledFeatures: this.options.disabledFeatures,
          onError: this.options.onError,
          onSerialize: (data, initial) => {
            if (this.alive) {
              this.options.onData(
                initial
                  ? this.options.globalIdentifier +
                      '["' +
                      serializeString(key) +
                      '"]=' +
                      data
                  : data,
              );
            }
          },
          onDone: () => {
            if (this.alive) {
              this.pending--;
              if (
                this.pending <= 0 &&
                this.flushed &&
                !this.done &&
                this.options.onDone
              ) {
                this.options.onDone();
                this.done = true;
              }
            }
          },
        }),
      );
    }
  }

  ids = 0;

  private getNextID(): string {
    while (this.keys.has('' + this.ids)) {
      this.ids++;
    }
    return '' + this.ids;
  }

  push(value: unknown): string {
    const newID = this.getNextID();
    this.write(newID, value);
    return newID;
  }

  flush(): void {
    if (this.alive) {
      this.flushed = true;
      if (this.pending <= 0 && !this.done && this.options.onDone) {
        this.options.onDone();
        this.done = true;
      }
    }
  }

  close(): void {
    if (this.alive) {
      for (let i = 0, len = this.cleanups.length; i < len; i++) {
        this.cleanups[i]();
      }
      if (!this.done && this.options.onDone) {
        this.options.onDone();
        this.done = true;
      }
      this.alive = false;
    }
  }
}
