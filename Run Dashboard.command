#!/usr/bin/env bash
# macOS double-click launcher for the OOTP Dashboard.
# Resolves the script's directory so users can run from anywhere in Finder.
set -e
cd "$(dirname "$0")"
exec python3 run.py "$@"
