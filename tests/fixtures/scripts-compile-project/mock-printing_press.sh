#!/bin/bash
# Mock printing_press — simulates batch and single-file modes
# Batch:  printing_press compile --sources <dir> --out <dir>
# Single: printing_press compile <file.ink> -o <output.inkc>

SOURCES=""
OUT=""
SINGLE_IN=""
SINGLE_OUT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    compile)
      shift
      ;;
    --sources)
      SOURCES="$2"
      shift 2
      ;;
    --out)
      OUT="$2"
      shift 2
      ;;
    -o)
      SINGLE_OUT="$2"
      shift 2
      ;;
    -d|--debug)
      shift 2
      ;;
    *.ink)
      SINGLE_IN="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Single-file mode
if [[ -n "$SINGLE_IN" && -n "$SINGLE_OUT" ]]; then
  mkdir -p "$(dirname "$SINGLE_OUT")"
  echo "compiled" > "$SINGLE_OUT"
  echo "Compiled $SINGLE_IN"
  exit 0
fi

# Batch mode
if [[ -n "$SOURCES" && -n "$OUT" ]]; then
  mkdir -p "$OUT"
  for f in "$SOURCES"/*.ink; do
    base=$(basename "$f" .ink)
    echo "compiled" > "$OUT/$base.inkc"
  done
  echo "Compilation successful"
  exit 0
fi

echo "Usage: printing_press compile [--sources <dir>] [--out <dir>] | <file.ink> -o <output.inkc>"
exit 1
