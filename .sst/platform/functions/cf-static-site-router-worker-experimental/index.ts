import path from "node:path";

export interface Env {
  ASSETS: any;
  INDEX_PAGE: string;
  ERROR_PAGE?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Requests to exact filename already handled by worker assets, below are handlings
    // for requests not matching exact filename

    // Handle requests to /
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = env.INDEX_PAGE;
      return env.ASSETS.fetch(new Request(url), request);
    }

    // Handle requests to /foo => /foo/index.html
    {
      url.pathname = path.join(url.pathname, "index.html");
      const res: Response = await env.ASSETS.fetch(new Request(url), request);
      if (res.status === 200) return res;
    }
    // Handle requests to /foo => /foo.html
    {
      url.pathname = path.join(url.pathname, ".html");
      const res: Response = await env.ASSETS.fetch(new Request(url), request);
      if (res.status === 200) return res;
    }

    // Handle error page
    if (env.ERROR_PAGE) {
      // TODO: rework this logic once setting
      //  - htmlHandling: "none",
      //  - notFoundHandling: "none",
      url.pathname = env.ERROR_PAGE.endsWith(".html")
        ? env.ERROR_PAGE.substring(0, env.ERROR_PAGE.length - 5)
        : env.ERROR_PAGE;
      console.log(url.pathname);
      const res: Response = await env.ASSETS.fetch(new Request(url), request);
      console.log(res.status);
      if (res.status === 200) {
        const t = await res.text();
        return new Response(t, {
          status: 404,
          statusText: "Not Found",
          headers: res.headers,
        });
      }
    }

    // Fallback to index page
    url.pathname = env.INDEX_PAGE;
    return env.ASSETS.fetch(new Request(url), request);
  },
};
