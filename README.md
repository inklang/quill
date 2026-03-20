# quill

Package manager CLI for the Ink programming language.

## Install

```bash
npm install -g @inklang/quill
```

## Usage

```bash
quill new my-package   # Scaffold a new package
quill init              # Initialize quill.toml in existing project
quill add ink-core     # Install a package
quill install          # Install all dependencies
quill ls               # List installed packages
quill clean            # Remove .quill-cache/
```

## Configure registry

```bash
export LECTERN_REGISTRY=https://packages.inklang.org
```
