"""
Функции для работы с моделями
"""
import config


def get_current_model():
    """Возвращает текущую модель из конфига."""
    if not config.MODELS:
        return None
    return config.MODELS.get(config.DEFAULT_MODEL)


def get_model_by_alias(alias: str):
    """Возвращает модель по алиасу."""
    if not config.MODELS:
        return None
    return config.MODELS.get(alias)


def model_to_api_format(model: str) -> dict:
    """Преобразует модель в формат для API OpenCode."""
    if not model:
        return {}
    if isinstance(model, dict):
        return {"model": model}
    if "/" in model:
        providerID, model_id = model.split("/", 1)
        return {"model": {"id": model_id, "providerID": providerID}}
    return {"model": {"id": model, "providerID": "cli"}}
