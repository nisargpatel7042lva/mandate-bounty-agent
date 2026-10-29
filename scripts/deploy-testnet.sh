#!/bin/bash
# Deploys MockUSDC + BountyVault to Ethereum Sepolia using DEPLOYER_PRIVATE_KEY from the root .env,
# then writes packages/contracts/deployments/11155111.json.
# Usage (Windows): wsl bash scripts/deploy-testnet.sh    (Linux/macOS: bash scripts/deploy-testnet.sh)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
root="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$root/.env"; set +a
cd "$root/packages/contracts"
# --skip-simulation: take gas limits from the node's eth_estimateGas. Forge's local fork simulation
# under-estimated contract creation on Sepolia (507k vs 2.64M) and the first deploy ran out of gas.
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --slow --skip-simulation
cat deployments/11155111.json
