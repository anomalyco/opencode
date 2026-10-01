// Retired in favor of the R2 lake. Nothing writes to it anymore, but the table,
// catalog and Athena workgroup stay while the anomalyco/anomaly inference and
// analytics dashboards still query its history. Pulumi reads forceDestroy and
// retainOnDelete from state at delete time, so keep those settings until the
// lake is removed.

const current = aws.getCallerIdentityOutput({})
const partition = aws.getPartitionOutput({})
const region = aws.getRegionOutput({})

const tableBucketName = `opencode-${$app.stage}-lake`
const glueCatalogName = "s3tablescatalog"
const s3TablesBucketWildcardArn = $interpolate`arn:${partition.partition}:s3tables:${region.region}:${current.accountId}:bucket/*`

export const tableBucket = new aws.s3tables.TableBucket("LakeTableBucket", {
  name: tableBucketName,
  forceDestroy: true,
})

new aws.cloudcontrol.Resource(
  "LakeS3TablesCatalog",
  {
    typeName: "AWS::Glue::Catalog",
    desiredState: $jsonStringify({
      Name: glueCatalogName,
      Description: "Federated catalog for S3 Tables",
      FederatedCatalog: {
        Identifier: s3TablesBucketWildcardArn,
        ConnectionName: "aws:s3tables",
      },
      CreateDatabaseDefaultPermissions: [
        {
          Principal: {
            DataLakePrincipalIdentifier: "IAM_ALLOWED_PRINCIPALS",
          },
          Permissions: ["ALL"],
        },
      ],
      CreateTableDefaultPermissions: [
        {
          Principal: {
            DataLakePrincipalIdentifier: "IAM_ALLOWED_PRINCIPALS",
          },
          Permissions: ["ALL"],
        },
      ],
      AllowFullTableExternalDataAccess: "True",
    }),
  },
  { dependsOn: [tableBucket] },
)

const athenaResultsBucket = new aws.s3.Bucket(
  "LakeAthenaResults",
  {
    bucket: `opencode-${$app.stage}-lake-athena-results`,
    forceDestroy: true,
  },
  { retainOnDelete: false },
)

new aws.athena.Workgroup("LakeAthenaWorkgroup", {
  name: `opencode-${$app.stage}-lake-workgroup`,
  forceDestroy: true,
  configuration: {
    enforceWorkgroupConfiguration: true,
    publishCloudwatchMetricsEnabled: true,
    // Athena bills $5/TB scanned; kill any query that would scan more than 2 TB
    // so a regression cannot silently burn money. Stats sync full passes scan
    // ~250 GB as of 2026-07.
    bytesScannedCutoffPerQuery: 2 * 1024 ** 4,
    resultConfiguration: {
      outputLocation: $interpolate`s3://${athenaResultsBucket.bucket}/`,
    },
  },
})

export const lakeVpc = new sst.aws.Vpc("LakeVpc")
export const lakeCluster = new sst.aws.Cluster("LakeCluster", { vpc: lakeVpc })
