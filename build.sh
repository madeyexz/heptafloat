#!/bin/sh
# Builds HeptaFloat.app (Apple Silicon + Intel), installs it to ~/Applications, and packages
# dist/HeptaFloat-<version>.zip for a GitHub release.
set -e
cd "$(dirname "$0")"
VERSION=0.9.12
APP=build/HeptaFloat.app

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/obj dist

# Editor: ProseMirror bundle + page + fonts. As an IIFE, so minified names stay out of the page's
# globals: a top-level function minified to `hf` was replaced by `window.hf` (0.9.9 broke IME input).
bun install --silent
bun build src/editor.js --outfile "$APP/Contents/Resources/editor.js" --minify --format=iife >/dev/null
cp src/index.html "$APP/Contents/Resources/"
cp -R src/fonts "$APP/Contents/Resources/"
cp assets/AppIcon.icns "$APP/Contents/Resources/"

# Host: one binary for both architectures
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" -o "build/obj/HeptaFloat-$arch" Sources/main.swift
done
lipo -create -output "$APP/Contents/MacOS/HeptaFloat" build/obj/HeptaFloat-arm64 build/obj/HeptaFloat-x86_64

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>HeptaFloat</string>
  <key>CFBundleDisplayName</key><string>HeptaFloat</string>
  <key>CFBundleIdentifier</key><string>com.ianhsiao.heptafloat</string>
  <key>CFBundleExecutable</key><string>HeptaFloat</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT License</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null

# Release archive
rm -f "dist/HeptaFloat-$VERSION.zip"
ditto -c -k --keepParent "$APP" "dist/HeptaFloat-$VERSION.zip"

# Local install
rm -rf ~/Applications/HeptaFloat.app
mkdir -p ~/Applications
cp -R "$APP" ~/Applications/
echo "Built dist/HeptaFloat-$VERSION.zip and installed ~/Applications/HeptaFloat.app"
