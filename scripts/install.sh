#!/bin/bash
set -e

VERSION="${1:-latest}"
INSTALL_DIR="${HOME}/.quill/bin"
mkdir -p "$INSTALL_DIR"

if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -s https://api.github.com/repos/inklang/quill/releases/latest | grep tag_name | cut -d'"' -f4)
fi

ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

case "${OS}-${ARCH}" in
    linux-x86_64) ARTIFACT="quill-x86_64-linux.tar.gz" ;;
    linux-aarch64) ARTIFACT="quill-aarch64-linux.tar.gz" ;;
    darwin-x86_64) ARTIFACT="quill-x86_64-macos.tar.gz" ;;
    darwin-arm64) ARTIFACT="quill-aarch64-macos.tar.gz" ;;
    windows-x86_64) ARTIFACT="quill-x86_64-windows.tar.gz" ;;
    *) echo "Unsupported platform: $OS-$ARCH" && exit 1 ;;
esac

URL="https://github.com/inklang/quill/releases/download/${VERSION}/${ARTIFACT}"
TEMP=$(mktemp)

curl -L "$URL" -o "$TEMP"
tar -xzf "$TEMP" -C "$INSTALL_DIR"
rm "$TEMP"
chmod +x "${INSTALL_DIR}/quill"

echo "Installed quill ${VERSION} to ${INSTALL_DIR}"
