#!/bin/bash
# Toolchain check for the parts that run in WSL (Foundry, circom).
# Usage from Windows: wsl bash scripts/doctor.sh
export PATH="$HOME/.foundry/bin:$HOME/.cargo/bin:$PATH"
fail=0
check() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>/dev/null | head -1)" && [ -n "$out" ]; then
    printf "  ok    %-8s %s\n" "$name" "$out"
  else
    printf "  MISS  %s\n" "$name"; fail=1
  fi
}
echo "WSL toolchain:"
check forge  forge --version
check anvil  anvil --version
check circom circom --version
exit $fail
