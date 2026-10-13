"""Format authored documents and configuration with the pinned Oxfmt release."""

import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OXFMT_VERSION = "0.71.0"


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if len(arguments) != 1 or arguments[0] not in ("--prepare", "--check", "--write"):
        print("Usage: format_docs.py --prepare|--check|--write", file=sys.stderr)
        return 2
    environment = os.environ.copy()
    environment.setdefault("npm_config_cache", str(ROOT / ".cache/npm"))
    mode = arguments[0]
    options = ["--version"] if mode == "--prepare" else ["--config", str(ROOT / ".oxfmtrc.json"), mode, "."]
    try:
        result = subprocess.run([
            "npx", "--yes", "--ignore-scripts", "--prefer-offline",
            "--prefix", environment["npm_config_cache"],
            f"oxfmt@{OXFMT_VERSION}", *options,
        ], cwd=ROOT, env=environment, check=False)
        return result.returncode if result.returncode >= 0 else 128 - result.returncode
    except OSError as error:
        print(f"Documentation formatting failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
