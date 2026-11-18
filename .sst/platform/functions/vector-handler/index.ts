import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import { useClient } from "../../src/components/aws/helpers/client";

export type PutEvent = {
  vector: number[];
  metadata: Record<string, any>;
};

export type QueryEvent = {
  vector: number[];
  include: Record<string, any>;
  exclude?: Record<string, any>;
  threshold?: number;
  count?: number;
};

export type RemoveEvent = {
  include: Record<string, any>;
};

const { CLUSTER_ARN, SECRET_ARN, DATABASE_NAME, TABLE_NAME } = process.env;

export async function put(event: PutEvent) {
  const metadata = JSON.stringify(event.metadata);
  await useClient(RDSDataClient).send(
    new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DATABASE_NAME,
      sql: [
        `INSERT INTO ${TABLE_NAME} (embedding, metadata)`,
        `VALUES (ARRAY[${event.vector.join(",")}], :metadata)`,
      ].join(" "),
      parameters: [
        {
          name: "metadata",
          value: { stringValue: metadata },
          typeHint: "JSON",
        },
      ],
    }),
  );
}
export async function query(event: QueryEvent) {
  const include = JSON.stringify(event.include);
  // The return type of JSON.stringify() is always "string".
  // This is wrong when "event.exclude" is undefined.
  const exclude = JSON.stringify(event.exclude) as string | undefined;
  const threshold = event.threshold ?? 0;
  const count = event.count ?? 10;
  const ret = await useClient(RDSDataClient).send(
    new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DATABASE_NAME,
      sql: [
        `SELECT metadata, embedding <=> string_to_array(:vector, ',')::float[]::vector AS score`,
        `FROM ${TABLE_NAME}`,
        `WHERE embedding <=> string_to_array(:vector, ',')::float[]::vector < ${
          1 - threshold
        }`,
        `AND metadata @> :include`,
        `${exclude ? "AND NOT metadata @> :exclude" : ""}`,
        `ORDER BY score`,
        `LIMIT ${count}`,
      ].join(" "),
      parameters: [
        {
          name: "vector",
          value: { stringValue: event.vector.join(",") },
        },
        {
          name: "include",
          value: { stringValue: include },
          typeHint: "JSON",
        },
        ...(exclude
          ? [
              {
                name: "exclude",
                value: { stringValue: exclude },
                typeHint: "JSON" as const,
              },
            ]
          : []),
      ],
    }),
  );

  return {
    results: ret.records?.map((record) => ({
      metadata: JSON.parse(record[0].stringValue!),
      score: 1 - record[1].doubleValue!,
    })),
  };
}
export async function remove(event: RemoveEvent) {
  const include = JSON.stringify(event.include);
  await useClient(RDSDataClient).send(
    new ExecuteStatementCommand({
      resourceArn: CLUSTER_ARN,
      secretArn: SECRET_ARN,
      database: DATABASE_NAME,
      sql: `DELETE FROM ${TABLE_NAME} WHERE metadata @> :include`,
      parameters: [
        {
          name: "include",
          value: { stringValue: include },
          typeHint: "JSON",
        },
      ],
    }),
  );
}
