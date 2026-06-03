"""Convenience launcher for running the dashboard from this directory.

This lets `python -m keitaro_dashboard ...` work from `dashboard/` without
installing the package or setting PYTHONPATH manually.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
PACKAGE = SRC / "keitaro_dashboard"


def load_local_cli():
    """Load the local src package even if another copy is installed."""
    src_path = str(SRC)
    sys.path = [path for path in sys.path if path != src_path]
    sys.path.insert(0, src_path)

    init_file = PACKAGE / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "keitaro_dashboard",
        init_file,
        submodule_search_locations=[str(PACKAGE)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load dashboard package from {init_file}")

    module = importlib.util.module_from_spec(spec)
    sys.modules["keitaro_dashboard"] = module
    spec.loader.exec_module(module)

    from keitaro_dashboard.cli import main

    return main


if __name__ == "__main__":
    raise SystemExit(load_local_cli()())
