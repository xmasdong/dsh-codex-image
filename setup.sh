#!/usr/bin/env bash
# Setup for the dsh-codex-image-bridge plugin.
#
# The plugin imports @deepseek-ai/* packages at runtime. DSH keeps a flat
# fallback of symlinks under $DSH_HOME/profiles/node_modules (one symlink per
# package the installation depends on), and any plugin located in the working
# tree can resolve them through the ordinary parent-walk — but only if this
# project's own node_modules exposes the same packages.
#
# This script symlinks the fallback's top-level scopes/packages into
# ./node_modules so the plugin loads with exactly the versions the running
# harness uses. It is idempotent and safe to re-run.
set -euo pipefail

DOT_DSH="${DSH_HOME:-$HOME/.dsh}"
FALLBACK="$DOT_DSH/profiles/node_modules"

if [ ! -d "$FALLBACK" ]; then
  echo "error: DSH flat fallback not found at $FALLBACK" >&2
  echo "run this from a machine with dsh installed (dsh >= 0.1.0-rc.6)" >&2
  exit 1
fi

mkdir -p node_modules
for entry in "$FALLBACK"/*; do
  base="$(basename "$entry")"
  link="node_modules/$base"
  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -rf "$link"
  fi
  ln -s "$entry" "$link"
done

echo "linked $(find node_modules -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ') packages from $FALLBACK"
