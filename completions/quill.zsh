#compdef quill q
# quill shell completions — zsh
# Save to ~/.zsh/completion/_quill or ~/.zcompdump
# Or install via: quill completions zsh > ~/.zsh/completion/_quill

_quill() {
  local -a commands
  commands=(
    'new:Create a new project'
    'init:Initialize ink-package.toml'
    'add:Add a package'
    'remove:Remove a package'
    'uninstall:Remove a package'
    'install:Install all dependencies'
    'update:Update dependencies'
    'outdated:Check for newer versions'
    'ls:List installed packages'
    'clean:Remove cache'
    'build:Compile scripts'
    'check:Check for errors'
    'watch:Watch and rebuild'
    'run:Run Paper dev server'
    'login:Log in to registry'
    'logout:Log out'
    'publish:Publish package'
    'unpublish:Remove published package'
    'search:Search registry'
    'info:Show package info'
    'doctor:Run diagnostics'
    'cache-info:Show cache info'
  )

  _describe 'command' commands
}

quill) _quill ;;
q) _quill ;;
*) ;;
esac
