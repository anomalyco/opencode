"""
Настройка логирования
"""
import logging
import sys


def setup_logging(debug: bool = False) -> logging.Logger:
    """
    Настраивает логирование.

    Args:
        debug: Если True, включает debug-режим с записью в файл

    Returns:
        Настроенный логгер
    """
    logger = logging.getLogger("vk-opencode")

    if debug:
        logger.setLevel(logging.DEBUG)
        # Очищаем старые хендлеры
        logger.handlers.clear()

        # Файловый хендлер
        file_handler = logging.FileHandler("debug.log", mode="w")
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        logger.addHandler(file_handler)

        # Консольный хендлер
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(logging.DEBUG)
        console_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        logger.addHandler(console_handler)
    else:
        logger.setLevel(logging.INFO)
        logger.handlers.clear()
        console_handler = logging.StreamHandler(sys.stderr)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        logger.addHandler(console_handler)

    return logger


# Глобальный логгер (инициализируется при первом импорте с дефолтными настройками)
logger = logging.getLogger("vk-opencode")
