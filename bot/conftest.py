"""
Root conftest.py - перехватывает аргументы перед импортом config.py
config.py имеет argparse, который конфликтует с pytest
"""
import sys
import argparse

# Сохраняем оригинальные аргументы
_original_argv = sys.argv.copy()

# Устанавливаем правильные аргументы для config.py
sys.argv = ["opencode-vk-gateway", "--config", "config.json"]

# Импортируем config.py (он использует argparse)
try:
    import config
except SystemExit:
    pass  # argparse может вызвать SystemExit

# Восстанавливаем оригинальные аргументы для pytest
sys.argv = _original_argv
