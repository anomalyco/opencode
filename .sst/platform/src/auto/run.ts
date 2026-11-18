import { Link } from "../components/link";
import {
  ResourceTransformationArgs,
  runtime,
  automation,
  output,
} from "@pulumi/pulumi";

import { VisibleError } from "../components/error";

export async function run(program: automation.PulumiFn) {
  process.chdir($cli.paths.root);

  addTransformationToRetainResourcesOnDelete();
  addTransformationToAddTags();
  addTransformationToCheckBucketsHaveMultiplePolicies();

  Link.reset();
  const outputs = (await program()) || {};
  outputs._protect = $app.protect;
  return outputs;
}

function addTransformationToRetainResourcesOnDelete() {
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if (
      $app.removal === "retain-all" ||
      ($app.removal === "retain" &&
        [
          "aws:dynamodb/table:Table",
          "aws:rds/instance:Instance",
          "aws:s3/bucket:Bucket",
          "aws:s3/bucketV2:BucketV2",
          "planetscale:index/database:Database",
          "planetscale:index/branch:Branch",
        ].includes(args.type))
    ) {
      args.opts.retainOnDelete = args.opts.retainOnDelete ?? true;
      return args;
    }
    return undefined;
  });
}

function addTransformationToAddTags() {
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if ("import" in args.opts && args.opts.import) {
      if (!args.opts.ignoreChanges) args.opts.ignoreChanges = [];
      args.opts.ignoreChanges.push("tags");
      args.opts.ignoreChanges.push("tagsAll");
    }
    return args;
  });
}

function addTransformationToCheckBucketsHaveMultiplePolicies() {
  const bucketsWithPolicy: Record<string, string> = {};
  runtime.registerStackTransformation((args: ResourceTransformationArgs) => {
    if (args.type !== "aws:s3/bucketPolicy:BucketPolicy") return;

    output(args.props.bucket).apply((bucket: string) => {
      if (bucketsWithPolicy[bucket])
        throw new VisibleError(
          `Cannot add bucket policy "${args.name}" to the AWS S3 Bucket "${bucket}". The bucket already has a policy attached "${bucketsWithPolicy[bucket]}".`,
        );

      bucketsWithPolicy[bucket] = args.name;
    });

    return undefined;
  });
}
