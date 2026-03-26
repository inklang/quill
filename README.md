# quill

The package manager for [Ink](https://github.com/inklang/ink) — a scripting language for Paper Minecraft servers.

## Install

```bash
npm install -g @inklang/quill
```

## Getting started

Create a new project and start writing scripts:

```bash
quill new my-project
cd my-project
quill add ink.mobs
quill build
```

## Commands

### Project setup

```bash
quill new <name>             # create a new script project (interactive template picker)
quill new <name> --package   # create a publishable grammar package
quill init                   # create ink-package.toml in an existing directory
```

### Dependencies

```bash
quill add <package>          # add a package and install it
quill remove <package>       # remove a package
quill install                # install all dependencies from ink-package.toml
quill update [packages...]   # update dependencies to latest matching versions
quill ls                     # list installed packages
quill clean                  # remove the .quill-cache/ directory
```

### Building

```bash
quill build                  # compile grammar and/or Ink scripts
quill check                  # check grammar and scripts for errors without building
quill watch                  # watch for changes and rebuild automatically
```

### Registry

```bash
quill login                  # generate a keypair and register with the registry
quill logout                 # remove your keypair from ~/.quillrc
quill publish                # publish your package to the registry
```

## Configuration

Point quill at a different registry:

```bash
export LECTERN_REGISTRY=https://lectern.inklang.org
```
