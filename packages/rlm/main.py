import sys
import os
import json
from rlm import RLM
from rlm.logger import RLMLogger

def run_rlm(prompt: str, model_name: str, provider: str = "openai", log_dir: str = "./logs"):
    logger = RLMLogger(log_dir=log_dir)
    # Configure RLM with ipython environment
    rlm = RLM(
        backend=provider,
        backend_kwargs={"model_name": model_name},
        environment="ipython",
        environment_kwargs={"cell_timeout": 10},
        logger=logger,
        verbose=True
    )
    result = rlm.completion(prompt)
    return {
        "response": result.response,
        "trajectory": result.metadata if hasattr(result, "metadata") else None
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python main.py <prompt> <model_name> [provider] [log_dir]"}))
        sys.exit(1)
        
    prompt = sys.argv[1]
    model_name = sys.argv[2]
    provider = sys.argv[3] if len(sys.argv) > 3 else "openai"
    log_dir = sys.argv[4] if len(sys.argv) > 4 else "./logs"
    
    try:
        res = run_rlm(prompt, model_name, provider, log_dir)
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
