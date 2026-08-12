from __future__ import annotations

import argparse
from pathlib import Path

from .readme import update_readme


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data"))
    parser.add_argument("--readme", type=Path, default=Path("README.md"))
    args = parser.parse_args()
    update_readme(args.data_root, args.readme)
    print(args.readme)


if __name__ == "__main__":
    main()
