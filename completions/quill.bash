#!/bin/bash
# quill shell completions — bash
# Source this file from your .bashrc, or install via:
#   quill completions bash >> ~/.bashrc

_quill_completions() {
  local cur prev words cword
  _init_compat || return

  local commands="new init add remove uninstall install update outdated ls clean build check watch run
    login logout publish unpublish search info doctor cache-info"

  local project_commands="add remove install update ls clean build check watch run publish unpublish"

  # Complete subcommands
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  local cmd="${words[1]}"

  case "$cmd" in
    add|remove|install|update|publish|unpublish)
      # For now, no package name completion (would need registry index)
      ;;
    new)
      # Skip completing first arg (project name) and template options
      ;;
    info|search)
      # No completion for package names
      ;;
    run|build|check|watch)
      # No extra completions
      ;;
    doctor)
      if [[ "$cur" == -* ]]; then
        COMPREPLY=($(compgen -W "--json" -- "$cur"))
      fi
      ;;
  esac
}

complete -F _quill_completions quill
complete -F _quill_completions q
