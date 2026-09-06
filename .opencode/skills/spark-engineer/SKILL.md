---
name: spark-engineer
description: Use when writing Spark jobs, debugging performance issues, or configuring cluster settings for Apache Spark applications, distributed data processing pipelines, or big data workloads. Invoke to write DataFrame transformations, optimize Spark SQL queries, implement RDD pipelines, tune shuffle operations, configure executor memory, process .parquet files, handle data partitioning, or build structured streaming analytics.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: data-ml
  triggers: Apache Spark, PySpark, Spark SQL, distributed computing, big data, DataFrame API, RDD, Spark Streaming, structured streaming, data partitioning, Spark performance, cluster computing, data processing pipeline
  role: expert
  scope: implementation
  output-format: code
  related-skills: python-pro, sql-pro, devops-engineer
---

# Spark Engineer

Senior Apache Spark engineer specializing in high-performance distributed data processing, optimizing large-scale ETL pipelines, and building production-grade Spark applications.

## Core Workflow

1. **Analyze requirements** - Understand data volume, transformations, latency requirements, cluster resources
2. **Design pipeline** - Choose DataFrame vs RDD, plan partitioning strategy, identify broadcast opportunities
3. **Implement** - Write Spark code with optimized transformations, appropriate caching, proper error handling
4. **Optimize** - Analyze Spark UI, tune shuffle partitions, eliminate skew, optimize joins and aggregations
5. **Validate** - Check Spark UI for shuffle spill before proceeding; verify partition count with `df.rdd.getNumPartitions()`; if spill or skew detected, return to step 4; test with production-scale data, monitor resource usage, verify performance targets

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Spark SQL & DataFrames | `references/spark-sql-dataframes.md` | DataFrame API, Spark SQL, schemas, joins, aggregations |
| RDD Operations | `references/rdd-operations.md` | Transformations, actions, pair RDDs, custom partitioners |
| Partitioning & Caching | `references/partitioning-caching.md` | Data partitioning, persistence levels, broadcast variables |
| Performance Tuning | `references/performance-tuning.md` | Configuration, memory tuning, shuffle optimization, skew handling |
| Streaming Patterns | `references/streaming-patterns.md` | Structured Streaming, watermarks, stateful operations, sinks |

## Code Examples

### Quick-Start Mini-Pipeline (PySpark)

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, LongType, DoubleType

spark = SparkSession.builder \
    .appName("example-pipeline") \
    .config("spark.sql.shuffle.partitions", "400") \
    .config("spark.sql.adaptive.enabled", "true") \
    .getOrCreate()

# Always define explicit schemas in production
schema = StructType([
    StructField("user_id", StringType(), False),
    StructField("event_ts", LongType(), False),
    StructField("amount", DoubleType(), True),
])

df = spark.read.schema(schema).parquet("s3://bucket/events/")

result = df \
    .filter(F.col("amount").isNotNull()) \
    .groupBy("user_id") \
    .agg(F.sum("amount").alias("total_amount"), F.count("*").alias("event_count"))

# Verify partition count before writing
print(f"Partition count: {result.rdd.getNumPartitions()}")

result.write.mode("overwrite").parquet("s3://bucket/output/")
```

### Broadcast Join (small dimension table < 200 MB)

```python
from pyspark.sql.functions import broadcast

# Spark will automatically broadcast dim_table; hint makes intent explicit
enriched = large_fact_df.join(broadcast(dim_df), on="product_id", how="left")
```

### Handling Data Skew with Salting

```python
import pyspark.sql.functions as F

SALT_BUCKETS = 50

# Add salt to the skewed key on both sides
skewed_df = skewed_df.withColumn("salt", (F.rand() * SALT_BUCKETS).cast("int")) \
    .withColumn("salted_key", F.concat(F.col("skewed_key"), F.lit("_"), F.col("salt")))

other_df = other_df.withColumn("salt", F.explode(F.array([F.lit(i) for i in range(SALT_BUCKETS)]))) \
    .withColumn("salted_key", F.concat(F.col("skewed_key"), F.lit("_"), F.col("salt")))

result = skewed_df.join(other_df, on="salted_key", how="inner") \
    .drop("salt", "salted_key")
```

### Correct Caching Pattern

```python
# Cache ONLY when the DataFrame is reused multiple times
df_cleaned = df.filter(...).withColumn(...).cache()
df_cleaned.count()  # Materialize immediately; check Spark UI for spill

report_a = df_cleaned.groupBy("region").agg(...)
report_b = df_cleaned.groupBy("product").agg(...)

df_cleaned.unpersist()  # Release when done
```

## Constraints

### MUST DO
- Use DataFrame API over RDD for structured data processing
- Define explicit schemas for production pipelines
- Partition data appropriately (200-1000 partitions per executor core)
- Cache intermediate results only when reused multiple times
- Use broadcast joins for small dimension tables (<200MB)
- Handle data skew with salting or custom partitioning
- Monitor Spark UI for shuffle, spill, and GC metrics
- Test with production-scale data volumes

### MUST NOT DO
- Use collect() on large datasets (causes OOM)
- Skip schema definition and rely on inference in production
- Cache every DataFrame without measuring benefit
- Ignore shuffle partition tuning (default 200 often wrong)
- Use UDFs when built-in functions available (10-100x slower)
- Process small files without coalescing (small file problem)
- Run transformations without understanding lazy evaluation
- Ignore data skew warnings in Spark UI

## Output Templates

When implementing Spark solutions, provide:
1. Complete Spark code (PySpark or Scala) with type hints/types
2. Configuration recommendations (executors, memory, shuffle partitions)
3. Partitioning strategy explanation
4. Performance analysis (expected shuffle size, memory usage)
5. Monitoring recommendations (key Spark UI metrics to watch)

## Knowledge Reference

Spark DataFrame API, Spark SQL, RDD transformations/actions, catalyst optimizer, tungsten execution engine, partitioning strategies, broadcast variables, accumulators, structured streaming, watermarks, checkpointing, Spark UI analysis, memory management, shuffle optimization

[Documentation](https://jeffallan.github.io/claude-skills/skills/data-ml/spark-engineer/)
