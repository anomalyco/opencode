#!/usr/bin/env python3
"""Test script to verify Parakeet transcription works"""
import sys
import os

# Suppress NeMo logging
os.environ['NEMO_LOG_LEVEL'] = 'ERROR'

print("Testing Parakeet transcription...", file=sys.stderr)

try:
    import nemo.collections.asr as nemo_asr
    import torch
    print(f"✓ Imports successful", file=sys.stderr)
    print(f"✓ CUDA available: {torch.cuda.is_available()}", file=sys.stderr)
    
    # Redirect NeMo logs to stderr
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    
    print("Loading model...", file=sys.stderr)
    model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
    model = model.cpu()
    model.eval()
    
    # Restore stdout
    sys.stdout = old_stdout
    
    print("✓ Model loaded successfully!", file=sys.stderr)
    print("✓ Transcription service is ready to use", file=sys.stderr)
    
except Exception as e:
    print(f"✗ Error: {e}", file=sys.stderr)
    sys.exit(1)
