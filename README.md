# quill

The package manager for [Ink](https://github.com/inklang/ink) — a scripting language for Paper Minecraft servers.

## Install

```bash
cargo install --git https://github.com/inklang/quill
```

## Getting started

Create a new project and start writing scripts:

```bash
quill new my-project
cd my-project
quill add ink.mobs
quill build
quill run
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
quill add <package>           # add a package and install it
quill remove <package>        # remove a package (alias: uninstall)
quill install                 # install all dependencies from ink-package.toml
quill update [packages...]    # update dependencies to latest matching versions
quill outdated                # check for packages with newer versions
quill outdated --json         # output outdated packages as JSON
quill why <package>          # show why a package is installed
quill ls                      # list installed packages
quill clean                   # remove the .quill-cache/ directory
```

### Building

```bash
quill build                   # compile grammar and/or Ink scripts
quill build --full            # force full recompilation
quill check                   # check grammar and scripts for errors without building
quill watch                   # watch for changes and rebuild automatically
quill run                     # build, deploy, and run a managed Paper dev server
quill run --no-watch          # start without file watching
```

### Registry

```bash
quill login                   # generate a keypair and register with the registry
quill login --token <tok> --username <user>   # token-only login (CI environments)
quill logout                  # remove your keypair from ~/.quillrc
quill publish                 # publish your package to the registry
quill unpublish [version]     # remove a published package version
quill search <query>          # search the registry for packages
quill info <pkg>              # show details about a package
```

### Cache

```bash
quill cache-info              # show build cache info
quill cache-info ls           # list cached package tarballs
quill cache-info clean        # remove build cache
```

### Diagnostics

```bash
quill doctor                  # run diagnostics and check for common issues
```

### Shell completions

```bash
# Install completions for your shell
quill completions bash >> ~/.bashrc       # bash
quill completions zsh  > ~/.zsh/completion/_quill   # zsh
quill completions fish > ~/.config/fish/completions/quill.fish  # fish
```

## Lockfile

`quill.lock` is automatically created and updated by `add`, `install`, and `update`. It ensures reproducible installs by pinning exact versions. Commit it to version control.

## Configuration

Point quill at a different registry:

```bash
export LECTERN_REGISTRY=https://lectern.inklang.org
```

Or set it in `~/.quillrc`:

```json
{ "token": "...", "registry": "https://lectern.inklang.org" }
```

## Development

```bash
cargo build                   # debug build
cargo build --release         # optimized build
cargo test                    # run tests
```
