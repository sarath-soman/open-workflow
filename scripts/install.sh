#!/usr/bin/env bash
# owf installer.
#
#   curl -fsSL https://raw.githubusercontent.com/sarath-soman/open-workflow/main/scripts/install.sh | bash
#
# Env:
#   OWF_INSTALL   install root (default: $HOME/.owf)
# Args:
#   $1            version tag to install (default: latest), e.g. v0.1.0
set -euo pipefail

repo="sarath-soman/open-workflow"
install_dir="${OWF_INSTALL:-$HOME/.owf}"
bin_dir="$install_dir/bin"
exe="$bin_dir/owf"

error() {
  echo "error: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || error "curl is required"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) error "unsupported OS '$os' — build from source: https://github.com/$repo" ;;
esac
case "$arch" in
  arm64 | aarch64) arch="aarch64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) error "unsupported architecture '$arch'" ;;
esac

asset="owf-${os}-${arch}"
version="${1:-latest}"
if [ "$version" = "latest" ]; then
  url="https://github.com/$repo/releases/latest/download/$asset"
else
  url="https://github.com/$repo/releases/download/$version/$asset"
fi

mkdir -p "$bin_dir"
echo "downloading $asset ($version)..."
curl -fSL "$url" -o "$exe" || error "download failed: $url"
chmod +x "$exe"
echo "installed owf to $exe"

if ! command -v owf >/dev/null 2>&1; then
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      echo
      echo "add owf to your PATH by adding this to your shell profile:"
      echo "  export PATH=\"$bin_dir:\$PATH\""
      ;;
  esac
fi

echo
echo "done. run: owf --help"
