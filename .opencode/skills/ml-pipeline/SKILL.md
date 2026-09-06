---
name: ml-pipeline
description: "Designs and implements production-grade ML pipeline infrastructure: configures experiment tracking with MLflow or Weights & Biases, creates Kubeflow or Airflow DAGs for training orchestration, builds feature store schemas with Feast, deploys model registries, and automates retraining and validation workflows. Use when building ML pipelines, orchestrating training workflows, automating model lifecycle, implementing feature stores, managing experiment tracking systems, setting up DVC for data versioning, tuning hyperparameters, or configuring MLOps tooling like Kubeflow, Airflow, MLflow, or Prefect."
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: data-ml
  triggers: ML pipeline, MLflow, Kubeflow, feature engineering, model training, experiment tracking, feature store, hyperparameter tuning, pipeline orchestration, model registry, training workflow, MLOps, model deployment, data pipeline, model versioning
  role: expert
  scope: implementation
  output-format: code
  related-skills: devops-engineer, kubernetes-specialist, cloud-architect, python-pro
---

# ML Pipeline Expert

Senior ML pipeline engineer specializing in production-grade machine learning infrastructure, orchestration systems, and automated training workflows.

## Core Workflow

1. **Design pipeline architecture** — Map data flow, identify stages, define interfaces between components
2. **Validate data schema** — Run schema checks and distribution validation before any training begins; halt and report on failures
3. **Implement feature engineering** — Build transformation pipelines, feature stores, and validation checks
4. **Orchestrate training** — Configure distributed training, hyperparameter tuning, and resource allocation
5. **Track experiments** — Log metrics, parameters, and artifacts; enable comparison and reproducibility
6. **Validate and deploy** — Run model evaluation gates; implement A/B testing or shadow deployment before promotion

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Feature Engineering | `references/feature-engineering.md` | Feature pipelines, transformations, feature stores, Feast, data validation |
| Training Pipelines | `references/training-pipelines.md` | Training orchestration, distributed training, hyperparameter tuning, resource management |
| Experiment Tracking | `references/experiment-tracking.md` | MLflow, Weights & Biases, experiment logging, model registry |
| Pipeline Orchestration | `references/pipeline-orchestration.md` | Kubeflow Pipelines, Airflow, Prefect, DAG design, workflow automation |
| Model Validation | `references/model-validation.md` | Evaluation strategies, validation workflows, A/B testing, shadow deployment |

## Code Templates

### MLflow Experiment Logging (minimal reproducible example)

```python
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score
import numpy as np

# Pin random state for reproducibility
SEED = 42
np.random.seed(SEED)

mlflow.set_experiment("my-classifier-experiment")

with mlflow.start_run():
    # Log all hyperparameters — never hardcode silently
    params = {"n_estimators": 100, "max_depth": 5, "random_state": SEED}
    mlflow.log_params(params)

    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)

    # Log metrics
    mlflow.log_metric("accuracy", accuracy_score(y_test, preds))
    mlflow.log_metric("f1", f1_score(y_test, preds, average="weighted"))

    # Log and register the model artifact
    mlflow.sklearn.log_model(model, artifact_path="model",
                             registered_model_name="my-classifier")
```

### Kubeflow Pipeline Component (single-step template)

```python
from kfp.v2 import dsl
from kfp.v2.dsl import component, Input, Output, Dataset, Model, Metrics

@component(base_image="python:3.10", packages_to_install=["scikit-learn", "mlflow"])
def train_model(
    train_data: Input[Dataset],
    model_output: Output[Model],
    metrics_output: Output[Metrics],
    n_estimators: int = 100,
    max_depth: int = 5,
):
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier
    import pickle, json

    df = pd.read_csv(train_data.path)
    X, y = df.drop("label", axis=1), df["label"]

    model = RandomForestClassifier(n_estimators=n_estimators,
                                   max_depth=max_depth, random_state=42)
    model.fit(X, y)

    with open(model_output.path, "wb") as f:
        pickle.dump(model, f)

    metrics_output.log_metric("train_samples", len(df))

@dsl.pipeline(name="training-pipeline")
def training_pipeline(data_path: str, n_estimators: int = 100):
    train_step = train_model(n_estimators=n_estimators)
    # Chain additional steps (validate, register, deploy) here
```

### Data Validation Checkpoint (Great Expectations style)

```python
import great_expectations as ge

def validate_training_data(df):
    """Run schema and distribution checks. Raise on failure — never skip."""
    gdf = ge.from_pandas(df)
    results = gdf.expect_column_values_to_not_be_null("label")
    results &= gdf.expect_column_values_to_be_between("feature_1", 0, 1)

    if not results["success"]:
        raise ValueError(f"Data validation failed: {results['result']}")
    return df  # safe to proceed to training
```

## Constraints

**Always:**
- Version all data, code, and models explicitly (DVC, Git tags, model registry)
- Pin dependencies and random seeds for reproducible training environments
- Log all hyperparameters, metrics, and artifacts to experiment tracking
- Validate data schema and distribution before training begins
- Use containerized environments; store credentials in secrets managers, never in code
- Implement error handling, retry logic, and pipeline alerting
- Separate training and inference code clearly

**Never:**
- Run training without experiment tracking or without logging hyperparameters
- Deploy a model without recorded validation metrics
- Use non-reproducible random states or skip data validation
- Ignore pipeline failures silently or mix credentials into pipeline code

## Output Format

When implementing a pipeline, provide:
1. Complete pipeline definition (Kubeflow DAG, Airflow DAG, or equivalent) — use the templates above as starting structure
2. Feature engineering code with inline data validation calls
3. Training script with MLflow (or equivalent) experiment logging
4. Model evaluation code with explicit pass/fail thresholds
5. Deployment configuration and rollback strategy
6. Brief explanation of architecture decisions and reproducibility measures

## Knowledge Reference

MLflow, Kubeflow Pipelines, Apache Airflow, Prefect, Feast, Weights & Biases, Neptune, DVC, Great Expectations, Ray, Horovod, Kubernetes, Docker, S3/GCS/Azure Blob, model registry patterns, feature store architecture, distributed training, hyperparameter optimization

[Documentation](https://jeffallan.github.io/claude-skills/skills/data-ml/ml-pipeline/)
