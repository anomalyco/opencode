---
name: fine-tuning-expert
description: "Use when fine-tuning LLMs, training custom models, or adapting foundation models for specific tasks. Invoke for configuring LoRA/QLoRA adapters, preparing JSONL training datasets, setting hyperparameters for fine-tuning runs, adapter training, transfer learning, finetuning with Hugging Face PEFT, OpenAI fine-tuning, instruction tuning, RLHF, DPO, or quantizing and deploying fine-tuned models. Trigger terms include: LoRA, QLoRA, PEFT, finetuning, fine-tuning, adapter tuning, LLM training, model training, custom model."
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: data-ml
  triggers: fine-tuning, fine tuning, finetuning, LoRA, QLoRA, PEFT, adapter tuning, transfer learning, model training, custom model, LLM training, instruction tuning, RLHF, model optimization, quantization
  role: expert
  scope: implementation
  output-format: code
  related-skills: devops-engineer
---

# Fine-Tuning Expert

Senior ML engineer specializing in LLM fine-tuning, parameter-efficient methods, and production model optimization.

## Core Workflow

1. **Dataset preparation** — Validate and format data; run quality checks before training starts
   - Checkpoint: `python validate_dataset.py --input data.jsonl` — fix all errors before proceeding
2. **Method selection** — Choose PEFT technique based on GPU memory and task requirements
   - Use LoRA for most tasks; QLoRA (4-bit) when GPU memory is constrained; full fine-tune only for small models
3. **Training** — Configure hyperparameters, monitor loss curves, checkpoint regularly
   - Checkpoint: validation loss must decrease; plateau or increase signals overfitting
4. **Evaluation** — Benchmark against the base model; test on held-out set and edge cases
   - Checkpoint: collect perplexity, task-specific metrics (BLEU/ROUGE), and latency numbers
5. **Deployment** — Merge adapter weights, quantize, measure inference throughput before serving

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| LoRA/PEFT | `references/lora-peft.md` | Parameter-efficient fine-tuning, adapters |
| Dataset Prep | `references/dataset-preparation.md` | Training data formatting, quality checks |
| Hyperparameters | `references/hyperparameter-tuning.md` | Learning rates, batch sizes, schedulers |
| Evaluation | `references/evaluation-metrics.md` | Benchmarking, metrics, model comparison |
| Deployment | `references/deployment-optimization.md` | Model merging, quantization, serving |

## Minimal Working Example — LoRA Fine-Tuning with Hugging Face PEFT

```python
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer
import torch

# 1. Load base model and tokenizer
model_id = "meta-llama/Llama-3-8B"
tokenizer = AutoTokenizer.from_pretrained(model_id)
tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.bfloat16,
    device_map="auto",
)

# 2. Configure LoRA adapter
lora_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,               # rank — increase for more capacity, decrease to save memory
    lora_alpha=32,      # scaling factor; typically 2× rank
    target_modules=["q_proj", "v_proj"],
    lora_dropout=0.05,
    bias="none",
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()  # verify: should be ~0.1–1% of total params

# 3. Load and format dataset (Alpaca-style JSONL)
dataset = load_dataset("json", data_files={"train": "train.jsonl", "test": "test.jsonl"})

def format_prompt(example):
    return {"text": f"### Instruction:\n{example['instruction']}\n\n### Response:\n{example['output']}"}

dataset = dataset.map(format_prompt)

# 4. Training arguments
training_args = TrainingArguments(
    output_dir="./checkpoints",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,     # effective batch size = 16
    learning_rate=2e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,                 # always use warmup
    fp16=False,
    bf16=True,
    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_steps=200,
    load_best_model_at_end=True,
)

# 5. Train
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=dataset["train"],
    eval_dataset=dataset["test"],
    dataset_text_field="text",
    max_seq_length=2048,
)
trainer.train()

# 6. Save adapter weights only
model.save_pretrained("./lora-adapter")
tokenizer.save_pretrained("./lora-adapter")
```

**QLoRA variant** — add these lines before loading the model to enable 4-bit quantization:
```python
from transformers import BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)
model = AutoModelForCausalLM.from_pretrained(model_id, quantization_config=bnb_config, device_map="auto")
```

**Merge adapter into base model for deployment:**
```python
from peft import PeftModel

base = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.bfloat16)
merged = PeftModel.from_pretrained(base, "./lora-adapter").merge_and_unload()
merged.save_pretrained("./merged-model")
```

## Constraints

### MUST DO
- Validate dataset quality before training
- Use parameter-efficient methods for large models (>7B)
- Monitor training/validation loss curves
- Document hyperparameters and training config
- Version datasets and model checkpoints
- Always include a learning rate warmup

### MUST NOT DO
- Skip data quality validation
- Overfit on small datasets — use regularisation (dropout, weight decay) and early stopping
- Merge incompatible adapters (mismatched rank, base model, or target modules)
- Deploy without evaluation against a held-out set and latency benchmark

## Output Templates

When implementing fine-tuning, always provide:
1. **Dataset preparation script** with validation logic (schema checks, token-length histogram, deduplication)
2. **Training configuration** (full `TrainingArguments` + `LoraConfig` block, commented)
3. **Evaluation script** reporting perplexity, task-specific metrics, and latency
4. **Brief design rationale** — why this PEFT method, rank, and learning rate were chosen for this task

[Documentation](https://jeffallan.github.io/claude-skills/skills/data-ml/fine-tuning-expert/)
