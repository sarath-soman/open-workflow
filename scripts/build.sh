#!/usr/bin/env bash
# Cross-compile the `owf` CLI into standalone Bun executables, one per target.
# Asset names match what scripts/install.sh downloads. Run from repo root or anywhere.
set -euo pipefail

cd "$(dirname "$0")/.."

ENTRY="packages/cli/src/index.ts"
OUT="dist"
mkdir -p "$OUT"

# "<bun --target>:<release asset name>"
targets=(
  "bun-darwin-arm64:owf-darwin-aarch64"
  "bun-darwin-x64:owf-darwin-x64"
  "bun-linux-x64:owf-linux-x64"
  "bun-linux-arm64:owf-linux-aarch64"
)

for entry in "${targets[@]}"; do
  bun_target="${entry%%:*}"
  asset="${entry##*:}"
  echo "building ${asset} (${bun_target})..."
  bun build --compile --target="${bun_target}" "${ENTRY}" --outfile "${OUT}/${asset}"
done

echo
echo "built:"
ls -la "${OUT}"
