from app.core.config import Settings
from app.core.dependencies import check_runtime_dependencies


def validate_startup(settings: Settings) -> None:
    check_runtime_dependencies(settings)
