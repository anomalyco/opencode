#!/usr/bin/env python3
"""
Parakeet TDT v3 Transcription Server
Reads audio chunks from stdin, outputs transcriptions to stdout
Keeps model loaded in memory for fast inference
"""

import sys
import json
import base64
import io
import tempfile
import os
import logging
import warnings
from pathlib import Path

# Suppress all warnings
warnings.filterwarnings('ignore')

# Suppress NeMo and other library logging
logging.getLogger('nemo_logger').setLevel(logging.CRITICAL)
logging.getLogger('nemo').setLevel(logging.CRITICAL)
logging.getLogger('lightning').setLevel(logging.CRITICAL)
logging.getLogger('pytorch_lightning').setLevel(logging.CRITICAL)
logging.getLogger('torch').setLevel(logging.CRITICAL)
logging.basicConfig(level=logging.CRITICAL)
os.environ['NEMO_LOG_LEVEL'] = 'CRITICAL'
os.environ['HYDRA_FULL_ERROR'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

try:
    import nemo.collections.asr as nemo_asr
    import torch
except ImportError as e:
    print(json.dumps({"error": f"Failed to import dependencies: {e}"}), file=sys.stderr, flush=True)
    sys.exit(1)


class TranscriptionServer:
    def __init__(self, model_name="nvidia/parakeet-tdt-0.6b-v3", device=None):
        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        
    def initialize(self):
        try:
            print(json.dumps({"status": "loading", "model": self.model_name, "device": self.device}), flush=True)
            
            # Redirect stdout at file descriptor level to suppress NeMo logs
            stdout_fd = sys.stdout.fileno()
            saved_stdout_fd = os.dup(stdout_fd)
            devnull_fd = os.open(os.devnull, os.O_WRONLY)
            
            try:
                # Redirect FD 1 (stdout) to /dev/null
                os.dup2(devnull_fd, stdout_fd)
                
                self.model = nemo_asr.models.ASRModel.from_pretrained(
                    model_name=self.model_name
                )
                
                if self.device == "cuda" and torch.cuda.is_available():
                    self.model = self.model.cuda()
                else:
                    self.model = self.model.cpu()
                
                self.model.eval()
            finally:
                # Restore stdout file descriptor
                os.dup2(saved_stdout_fd, stdout_fd)
                os.close(saved_stdout_fd)
                os.close(devnull_fd)
            
            print(json.dumps({"status": "ready", "device": self.device}), flush=True)
            return True
            
        except Exception as e:
            print(json.dumps({"status": "error", "message": str(e)}), flush=True)
            return False
    
    def transcribe_audio(self, audio_data, timestamps=False):
        try:
            # Create temporary file for audio data
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_data)
                tmp_path = tmp.name
            
            try:
                # Call transcribe with minimal parameters
                output = self.model.transcribe([tmp_path], batch_size=1, verbose=False)
                
                # Extract text - NeMo models typically return a list of strings
                text = ""
                if output:
                    if isinstance(output, list) and len(output) > 0:
                        # If it's a list of strings
                        if isinstance(output[0], str):
                            text = output[0]
                        # If it's a list of objects with text attribute
                        elif hasattr(output[0], 'text'):
                            text = str(output[0].text)
                        else:
                            # Try to convert to string
                            text = str(output[0])
                    elif isinstance(output, str):
                        text = output
                
                result = {
                    "text": text,
                }
                
                if timestamps and output and len(output) > 0 and hasattr(output[0], 'timestamp'):
                    try:
                        result["timestamps"] = {
                            "word": output[0].timestamp.get('word', []),
                            "segment": output[0].timestamp.get('segment', []),
                        }
                    except:
                        pass
                
                return result
            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except:
                    pass
                
        except Exception as e:
            return {"error": str(e)}
    
    def run(self):
        if not self.initialize():
            return 1
        
        # Main processing loop
        for line in sys.stdin:
            try:
                line = line.strip()
                if not line:
                    continue
                
                request = json.loads(line)
                command = request.get("command")
                
                if command == "transcribe":
                    # Decode base64 audio
                    audio_base64 = request.get("audio")
                    if not audio_base64:
                        print(json.dumps({"error": "No audio data provided"}), flush=True)
                        continue
                    
                    audio_data = base64.b64decode(audio_base64)
                    timestamps = request.get("timestamps", False)
                    
                    # Transcribe
                    result = self.transcribe_audio(audio_data, timestamps)
                    
                    # Ensure result is JSON serializable
                    safe_result = {
                        "text": str(result.get("text", "")) if result.get("text") is not None else "",
                    }
                    if "timestamps" in result:
                        safe_result["timestamps"] = result["timestamps"]
                    
                    print(json.dumps(safe_result), flush=True)
                    
                elif command == "ping":
                    print(json.dumps({"status": "alive"}), flush=True)
                    
                elif command == "shutdown":
                    print(json.dumps({"status": "shutting_down"}), flush=True)
                    break
                    
                else:
                    print(json.dumps({"error": f"Unknown command: {command}"}), flush=True)
                    
            except json.JSONDecodeError as e:
                print(json.dumps({"error": f"Invalid JSON: {e}"}), flush=True)
            except Exception as e:
                print(json.dumps({"error": f"Processing error: {e}"}), flush=True)
        
        return 0


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Parakeet Transcription Server")
    parser.add_argument("--model", default="nvidia/parakeet-tdt-0.6b-v3", help="Model name")
    parser.add_argument("--device", choices=["cuda", "cpu"], help="Device to use")
    
    args = parser.parse_args()
    
    server = TranscriptionServer(model_name=args.model, device=args.device)
    sys.exit(server.run())
