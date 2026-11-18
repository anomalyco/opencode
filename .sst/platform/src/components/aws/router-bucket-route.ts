import { ComponentResourceOptions, Input, all, output } from "@pulumi/pulumi";
import { Component } from "../component";
import {
  buildKvNamespace,
  createKvRouteData,
  parsePattern,
  RouterBaseRouteArgs,
  updateKvRoutes,
} from "./router-base-route";
import { Bucket } from "./bucket";
import { RouterBucketRouteArgs } from "./router";
import { toSeconds } from "../duration";

export interface Args extends RouterBaseRouteArgs {
  /**
   * The bucket to route to.
   */
  bucket: Input<Bucket>;
  /**
   * Additional arguments for the route.
   */
  routeArgs?: Input<RouterBucketRouteArgs>;
}

/**
 * The `RouterBucketRoute` component is internally used by the `Router` component
 * to add routes.
 *
 * :::note
 * This component is not intended to be created directly.
 * :::
 *
 * You'll find this component returned by the `routeBucket` method of the `Router` component.
 */
export class RouterBucketRoute extends Component {
  constructor(name: string, args: Args, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const self = this;

    all([args.pattern, args.routeArgs]).apply(([pattern, routeArgs]) => {
      const patternData = parsePattern(pattern);
      const namespace = buildKvNamespace(name);
      createKvRouteData(name, args, self, namespace, {
        domain: output(args.bucket).nodes.bucket.bucketRegionalDomainName,
        rewrite: routeArgs?.rewrite,
        origin: {
          connectionAttempts: routeArgs?.connectionAttempts,
          timeouts: {
            connectionTimeout:
              routeArgs?.connectionTimeout &&
              toSeconds(routeArgs?.connectionTimeout),
          },
        },
      });
      updateKvRoutes(name, args, self, "bucket", namespace, patternData);
    });
  }
}

const __pulumiType = "sst:aws:RouterBucketRoute";
// @ts-expect-error
RouterBucketRoute.__pulumiType = __pulumiType;
