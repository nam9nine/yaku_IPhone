#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
version=$(cat .node-version)
case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *) echo 'Unsupported platform' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) architecture=arm64 ;;
  x86_64) architecture=x64 ;;
  *) echo 'Unsupported architecture' >&2; exit 1 ;;
esac
distribution="node-v${version}-${platform}-${architecture}"
mkdir -p .tooling/downloads
archive="${distribution}.tar.gz"
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${version}/${archive}" -o ".tooling/downloads/${archive}"
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v${version}/SHASUMS256.txt" -o .tooling/downloads/SHASUMS256.txt
(
  cd .tooling/downloads
  awk -v archive="$archive" '$2 == archive { print }' SHASUMS256.txt > selected.sha256
  test -s selected.sha256
  shasum -a 256 -c selected.sha256
)
tar -xzf ".tooling/downloads/${archive}" -C .tooling
printf '\nNode installed. Add %s/.tooling/%s/bin to PATH.\n' "$PWD" "$distribution"
