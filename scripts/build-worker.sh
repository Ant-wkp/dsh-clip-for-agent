#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
sdk=${1:?Pass the path to the reSpeaker Clip SDK directory}
sdk=$(cd "$sdk" && pwd)
python=${PYTHON:-python3}
opus=${CLIP_LIBOPUS:-/lib/x86_64-linux-gnu/libopus.so.0}
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]]
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
"$python" -m PyInstaller --noconfirm --log-level WARN --onefile --name clip-worker \
  --paths "$sdk/src" --collect-submodules bleak.backends.bluezdbus \
  --add-binary "$opus:." --workpath "$build/build" --specpath "$build" \
  --distpath "$root/runtime/linux-x64" "$root/worker/main.py"
