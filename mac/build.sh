#!/bin/bash
# Build "Chip's Challenge.app" (universal: Apple Silicon + Intel) with the
# command line Swift compiler. No Xcode project needed.
#   bash mac/build.sh            -> build/Chip's Challenge.app
#   bash mac/build.sh --zip      -> also build/ChipsChallenge-mac.zip
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="build/Chip's Challenge.app"
VERSION="$(cat VERSION 2>/dev/null || echo 1.0.0)"
MIN_OS="13.0"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/obj

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos$MIN_OS" \
    -framework AppKit -framework AVFoundation -framework JavaScriptCore \
    mac/Sources/main.swift -o "build/obj/ChipsChallenge-$arch"
done
lipo -create build/obj/ChipsChallenge-arm64 build/obj/ChipsChallenge-x86_64 -output "$APP/Contents/MacOS/ChipsChallenge"

# shared engine + data
cp web/js/formats.js web/js/engine.js web/js/midi.js mac/Sources/bridge.js "$APP/Contents/Resources/"
cp web/assets/tiles-free.png web/levels/CCLP1.dat "$APP/Contents/Resources/"

# icon
ICONSET="build/obj/AppIcon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s web/assets/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) web/assets/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

sed -e "s/__VERSION__/$VERSION/g" -e "s/__MIN_OS__/$MIN_OS/g" mac/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# ad hoc signature so it launches on Apple Silicon
codesign --force --deep --sign - "$APP"
echo "built $APP ($VERSION)"

if [[ "${1:-}" == "--zip" ]]; then
  rm -f build/ChipsChallenge-mac.zip
  (cd build && ditto -c -k --keepParent "Chip's Challenge.app" ChipsChallenge-mac.zip)
  echo "zipped build/ChipsChallenge-mac.zip"
fi
