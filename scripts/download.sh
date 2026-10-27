#!/usr/bin/env bash
# Download MovieLens 32M (~240 MB) from GroupLens and verify its checksum.
set -euo pipefail
cd "$(dirname "$0")/../data"
curl -sSL -o ml-32m.zip https://files.grouplens.org/datasets/movielens/ml-32m.zip
curl -sSL -o ml-32m.zip.md5 https://files.grouplens.org/datasets/movielens/ml-32m.zip.md5
[ "$(md5 -q ml-32m.zip 2>/dev/null || md5sum ml-32m.zip | cut -d' ' -f1)" = "$(cut -d' ' -f1 ml-32m.zip.md5)" ] || { echo "checksum mismatch"; exit 1; }
unzip -q -o ml-32m.zip
echo "ok: data/ml-32m"
