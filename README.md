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
quill new <name>                # create a new project (--kind script|library)
```

### Dependencies

```bash
quill add <package>             # add a dependency
quill remove <package>          # remove a dependency
quill install                   # install all dependencies
quill update [packages...]      # update dependencies
quill outdated                  # check for newer versions
quill why <package>             # show why a package is installed
quill ls                        # list installed packages
```

### Building

```bash
quill build                     # compile grammar and Ink scripts
quill build --full              # force full recompilation
quill compile                   # compile Ink scripts
quill check                     # check for errors without building
quill watch                     # watch for changes and rebuild
quill run                       # build, deploy, and run a Paper dev server
quill run --no-watch            # start without file watching
quill pack                      # create a package tarball
quill clean                     # clean build artifacts
```

### Registry

```bash
quill login                     # login to the registry
quill login --token <tok> --username <user>  # token-only login (CI)
quill logout                    # remove credentials
quill publish                   # publish your package
quill unpublish [version]       # remove a published version
quill search <query>            # search the registry
quill info <package>            # show package details
```

### Cache

```bash
quill cache info                # show cache info
quill cache ls                  # list cached packages
quill cache clean               # clean cache
```

### Diagnostics

```bash
quill audit                     # audit for vulnerabilities
quill doctor                    # run diagnostics
quill completions [shell]       # generate shell completions
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
cargo build                     # debug build
cargo build --release           # optimized build
cargo test                      # run tests
```
