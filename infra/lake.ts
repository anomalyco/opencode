import { domain } from "./stage"

const current = aws.getCallerIdentityOutput({})
const partition = aws.getPartitionOutput({})
const region = aws.getRegionOutput({})

const tableBucketName = `opencode-${$app.stage}-lake`
const glueCatalogName = "s3tablescatalog"
const glueCatalogArn = $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:catalog`
const glueS3TablesCatalogArn = $interpolate`${glueCatalogArn}/${glueCatalogName}`
const glueS3TablesChildCatalogArn = $interpolate`${glueS3TablesCatalogArn}/${tableBucketName}`
const glueS3TablesDatabaseWildcardArn = $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:database/${glueCatalogName}/${tableBucketName}/*`
const glueS3TablesTableWildcardArn = $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:table/${glueCatalogName}/${tableBucketName}/*/*`
const s3TablesBucketWildcardArn = $interpolate`arn:${partition.partition}:s3tables:${region.region}:${current.accountId}:bucket/*`

export const tableBucket = new aws.s3tables.TableBucket("LakeTableBucket", {
  name: tableBucketName,
  forceDestroy: $app.stage !== "production",
})

const s3TablesCatalog = new aws.cloudcontrol.Resource(
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

const athenaResultsBucket = new aws.s3.Bucket("LakeAthenaResults", {
  bucket: `opencode-${$app.stage}-lake-athena-results`,
  forceDestroy: $app.stage !== "production",
})

const firehoseErrorBucket = new aws.s3.Bucket("LakeFirehoseErrors", {
  bucket: `opencode-${$app.stage}-lake-firehose-errors`,
  forceDestroy: $app.stage !== "production",
})

const athenaWorkgroup = new aws.athena.Workgroup("LakeAthenaWorkgroup", {
  name: `opencode-${$app.stage}-lake-workgroup`,
  forceDestroy: $app.stage !== "production",
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

const firehoseRole = new aws.iam.Role("LakeFirehoseRole", {
  assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        effect: "Allow",
        actions: ["sts:AssumeRole"],
        principals: [
          {
            type: "Service",
            identifiers: ["firehose.amazonaws.com"],
          },
        ],
      },
    ],
  }).json,
})

const firehosePolicy = new aws.iam.RolePolicy("LakeFirehosePolicy", {
  role: firehoseRole.id,
  policy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        effect: "Allow",
        actions: [
          "s3tables:ListTableBuckets",
          "s3tables:GetTableBucket",
          "s3tables:GetNamespace",
          "s3tables:GetTable",
          "s3tables:GetTableData",
          "s3tables:GetTableMetadataLocation",
          "s3tables:ListNamespaces",
          "s3tables:ListTables",
          "s3tables:PutTableData",
          "s3tables:UpdateTableMetadataLocation",
        ],
        resources: ["*"],
      },
      {
        effect: "Allow",
        actions: [
          "glue:GetCatalog",
          "glue:GetCatalogs",
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:UpdateTable",
        ],
        resources: [
          glueCatalogArn,
          glueS3TablesCatalogArn,
          $interpolate`${glueS3TablesCatalogArn}/*`,
          glueS3TablesDatabaseWildcardArn,
          glueS3TablesTableWildcardArn,
          $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:database/*`,
          $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:table/*/*`,
          $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:table/${glueCatalogName}/*`,
        ],
      },
      {
        effect: "Allow",
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
        ],
        resources: [firehoseErrorBucket.arn, $interpolate`${firehoseErrorBucket.arn}/*`],
      },
      {
        effect: "Allow",
        actions: ["lakeformation:GetDataAccess"],
        resources: ["*"],
      },
    ],
  }).json,
})

const firehose = new aws.kinesis.FirehoseDeliveryStream(
  "LakeFirehose",
  {
    name: `opencode-${$app.stage}-lake-ingest`,
    destination: "iceberg",
    icebergConfiguration: {
      appendOnly: true,
      bufferingInterval: 60,
      bufferingSize: 1,
      catalogArn: glueS3TablesChildCatalogArn,
      processingConfiguration: {
        enabled: true,
        processors: [
          {
            type: "MetadataExtraction",
            parameters: [
              { parameterName: "JsonParsingEngine", parameterValue: "JQ-1.6" },
              {
                parameterName: "MetadataExtractionQuery",
                parameterValue:
                  '{destinationDatabaseName:._lake_database,destinationTableName:._lake_table,operation:(._lake_operation // "insert")}',
              },
            ],
          },
        ],
      },
      roleArn: firehoseRole.arn,
      s3BackupMode: "FailedDataOnly",
      s3Configuration: {
        roleArn: firehoseRole.arn,
        bucketArn: firehoseErrorBucket.arn,
        errorOutputPrefix: "errors/!{firehose:error-output-type}/",
      },
    },
  },
  { dependsOn: [s3TablesCatalog, firehosePolicy] },
)

export const lakeVpc = new sst.aws.Vpc("LakeVpc")
export const lakeCluster = new sst.aws.Cluster("LakeCluster", { vpc: lakeVpc })
export const lakeRegion = region.region
export const lakeCatalog = $interpolate`${glueCatalogName}/${tableBucket.name}`
export const lakeAthenaWorkgroup = athenaWorkgroup

const ingestSecret = new random.RandomPassword("LakeIngestSecret", { length: 32 })
export const ingestSecretSsm = new aws.ssm.Parameter("LakeIngestSecretSsm", {
  name: $interpolate`/${$app.name}/${$app.stage}/lake/ingest/secret`,
  type: "SecureString",
  value: ingestSecret.result,
})

const ingestConfig = new sst.Linkable("LakeIngestConfig", {
  properties: {
    streamName: firehose.name,
    secret: ingestSecret.result,
  },
})

const ingestService = new sst.aws.Service("LakeIngestService", {
  cluster: lakeCluster,
  architecture: "arm64",
  cpu: "1 vCPU",
  memory: "4 GB",
  image: {
    context: ".",
    dockerfile: "packages/stats/server/Dockerfile",
  },
  link: [ingestConfig],
  permissions: [
    {
      actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
      resources: [firehose.arn],
    },
  ],
  scaling: {
    min: $app.stage === "production" ? 2 : 1,
    max: $app.stage === "production" ? 32 : 4,
    cpuUtilization: 60,
    memoryUtilization: 70,
  },
  loadBalancer: {
    domain: {
      name: `lake.${domain}`,
      dns: sst.cloudflare.dns(),
    },
    rules: [
      { listen: "80/http", redirect: "443/https" },
      { listen: "443/https", forward: "3000/http" },
    ],
    health: {
      "3000/http": {
        path: "/ready",
        successCodes: "200-299",
      },
    },
  },
  health: {
    command: [
      "CMD-SHELL",
      "bun --eval \"fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"",
    ],
    interval: "30 seconds",
    retries: 3,
    startPeriod: "30 seconds",
    timeout: "5 seconds",
  },
  dev: {
    command: "bun run start",
    directory: "packages/stats/server",
    url: "http://localhost:3000",
  },
  wait: $app.stage === "production",
})

export const lakeIngest = new sst.Linkable("LakeIngest", {
  properties: {
    url: ingestService.url,
    secret: ingestSecret.result,
  },
})

export const lakeQueryPermissions = [
  {
    actions: ["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults"],
    resources: [athenaWorkgroup.arn],
  },
  {
    actions: [
      "glue:GetCatalog",
      "glue:GetCatalogs",
      "glue:GetDatabase",
      "glue:GetDatabases",
      "glue:GetTable",
      "glue:GetTables",
      "glue:GetPartitions",
    ],
    resources: [
      glueCatalogArn,
      glueS3TablesCatalogArn,
      $interpolate`${glueS3TablesCatalogArn}/*`,
      glueS3TablesDatabaseWildcardArn,
      glueS3TablesTableWildcardArn,
      $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:database/*`,
      $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:table/*/*`,
      $interpolate`arn:${partition.partition}:glue:${region.region}:${current.accountId}:table/${glueCatalogName}/*`,
    ],
  },
  {
    actions: ["s3:GetBucketLocation", "s3:ListBucket"],
    resources: [athenaResultsBucket.arn],
  },
  {
    actions: ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListBucketMultipartUploads"],
    resources: [$interpolate`${athenaResultsBucket.arn}/*`],
  },
  {
    actions: [
      "s3tables:GetTableBucket",
      "s3tables:GetNamespace",
      "s3tables:GetTable",
      "s3tables:GetTableData",
      "s3tables:GetTableMetadataLocation",
      "s3tables:ListNamespaces",
      "s3tables:ListTables",
    ],
    resources: ["*"],
  },
  {
    actions: ["lakeformation:GetDataAccess"],
    resources: ["*"],
  },
]
