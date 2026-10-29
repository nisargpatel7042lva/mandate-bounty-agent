#!/bin/bash
# Run a toolchain command (forge, circom, ...) from a given directory inside WSL.
# Usage: wsl bash scripts/wsl-exec.sh <wsl-dir> <command> [args...]
set -e
export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"
cd "$1"; shift
exec "$@"
