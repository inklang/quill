#!/bin/bash
# Mock java — simulates: java -jar <jar> compile --grammar <path> --sources <dir> --out <dir>
# Skip java args: -jar <jarpath> compile
shift  # -jar
shift  # <jarpath>
shift  # compile

OUT=""
SOURCES=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --out) OUT="$2"; shift 2;;
    --sources) SOURCES="$2"; shift 2;;
    --grammar) shift 2;;  # skip grammar path
    *) shift;;
  esac
done

mkdir -p "$OUT"
for f in "$SOURCES"/*.ink; do
  base=$(basename "$f" .ink)
  echo "compiled" > "$OUT/$base.inkc"
done
echo "Compilation successful"
