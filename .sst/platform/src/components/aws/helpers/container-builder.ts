import { all, ComponentResourceOptions } from "@pulumi/pulumi";
import { Semaphore } from "../../../util/semaphore";
import { Image, ImageArgs } from "@pulumi/docker-build";

const limiter = new Semaphore(
  parseInt(process.env.SST_BUILD_CONCURRENCY_CONTAINER || "1"),
);

export function imageBuilder(
  name: string,
  args: ImageArgs,
  opts?: ComponentResourceOptions,
) {
  // Wait for the all args values to be resolved before acquiring the semaphore
  return all([args]).apply(async ([args]) => {
    await limiter.acquire(name);
    const image = new Image(
      name,
      {
        ...(process.env.BUILDX_BUILDER
          ? { builder: { name: process.env.BUILDX_BUILDER } }
          : {}),
        ...args,
      },
      opts,
    );
    return image.urn.apply(() => {
      limiter.release();
      return image;
    });
  });
}
