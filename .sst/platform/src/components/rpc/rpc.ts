import { dynamic } from "@pulumi/pulumi";
import http from "http";

export module rpc {
  export class MethodNotFoundError extends Error {
    constructor(public method: string) {
      super(`Method "${method}" not found`);
    }
  }
  export async function call<T = any>(method: string, args: any) {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(process.env.SST_SERVER! + "/rpc");
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      };

      const req = http.request(options, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to call RPC: ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            if (json.error) {
              if (json.error.startsWith("rpc: can't find")) {
                reject(new MethodNotFoundError(method));
                return;
              }
              reject(new Error(json.error));
              return;
            }
            resolve(json.result);
          } catch (error: any) {
            reject(new Error(`Failed to parse JSON: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      // Set timeout to 0 to prevent any timeout
      req.setTimeout(0);

      const body = JSON.stringify({
        jsonrpc: "1.0",
        method,
        params: [args],
      });

      req.write(body);
      req.end();
    });
  }

  export class Provider implements dynamic.ResourceProvider {
    constructor(private type: string) {}
    private name(action: string) {
      return "Resource." + this.type + "." + action;
    }
    async create(inputs: any) {
      return call(this.name("Create"), inputs) as Promise<dynamic.CreateResult>;
    }

    async delete(id: string, outs: any): Promise<void> {
      return call(this.name("Delete"), { id, outs }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return;
        throw ex;
      });
    }

    async update(id: string, olds: any, news: any) {
      return call(this.name("Update"), { id, olds, news }).catch((ex) => {
        if (ex instanceof MethodNotFoundError)
          return {
            id,
          };
        throw ex;
      });
    }

    async read(id: string, props: any): Promise<dynamic.ReadResult> {
      return call(this.name("Read"), { id, props }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return { id, props };
        throw ex;
      });
    }

    async diff(id: string, olds: any, news: any): Promise<dynamic.DiffResult> {
      return call(this.name("Diff"), { id, olds, news }).catch((ex) => {
        if (ex instanceof MethodNotFoundError) return { id, olds, news };
        throw ex;
      });
    }
  }
}
