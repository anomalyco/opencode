if ! type _init_completion &>/dev/null; then
  _init_completion()
  {
    COMPREPLY=()
    local _i _j=0 _piece _line="$COMP_LINE"
    words=("${COMP_WORDS[0]}")
    cword=0
    _line="${_line#*"${COMP_WORDS[0]}"}"
    for ((_i = 1; _i < ${#COMP_WORDS[@]}; _i++)); do
      _piece="${COMP_WORDS[_i]}"
      if [[ "$_line" == [[:blank:]]* ]]; then
        ((_j++))
        words[_j]="$_piece"
      else
        words[_j]="${words[_j]}$_piece"
      fi
      ((_i == COMP_CWORD)) && cword=$_j
      _line="${_line#*"$_piece"}"
    done
    cur="${words[cword]}"
    prev=""
    ((cword > 0)) && prev="${words[cword-1]}"
    return 0
  }
fi

_@NAME@--choices()
{
  local _cur="$1" _word="$2"; shift 2

  local _head="${_cur%"$_word"}"
  local _open=""
  case "$_head" in
    *\') _open="'" ;;
    *\") _open='"' ;;
  esac

  local _prefix="$_cur" _committed="$_head"
  _prefix=${_prefix//\\/}; _prefix=${_prefix//\"/}; _prefix=${_prefix//\'/}
  _committed=${_committed//\\/}; _committed=${_committed//\"/}; _committed=${_committed//\'/}

  COMPREPLY=()
  local _choice _rest _match
  for _choice in "$@"; do
    [[ "$_choice" == "$_prefix"* ]] || continue
    _rest="${_choice#"$_committed"}"
    case "$_open" in
      "'")
        if [[ "$_head" == "'" ]]; then
          _match=${_rest//\'/\'\\\'\'}
        else
          [[ "$_rest" == *\'* ]] && continue
          _match="$_rest"
        fi
        ;;
      '"')
        _match="${_rest//\\/\\\\}"
        _match="${_match//\$/\\$}"
        _match="${_match//\`/\\\`}"
        _match="${_match//\"/\\\"}"
        ;;
      *)
        printf -v _match '%q' "$_rest"
        [[ -z "$_head" && "$_match" == '~'* ]] && _match="\\$_match"
        ;;
    esac
    [[ -n "$_open" && "$_match" == *"$_open" ]] && _match+="$_open"
    COMPREPLY+=("$_match")
  done
}

_@NAME@--paths()
{
  local _kind="$1" _cur="$2" _word="$3"

  local _prefix="$_cur" _committed="${_cur%"$_word"}"
  _prefix=${_prefix//\\/}; _prefix=${_prefix//\"/}; _prefix=${_prefix//\'/}
  _committed=${_committed//\\/}; _committed=${_committed//\"/}; _committed=${_committed//\'/}

  local _typed="" _dir="$_committed" _open="" _i
  if [[ "$_word" == */* ]]; then
    _typed="${_word%/*}/"
    _dir="${_prefix%/*}/"
    if [[ "$_cur" == "$_word" ]]; then
      for ((_i = 0; _i < ${#_typed}; _i++)); do
        case "$_open${_typed:_i:1}" in
          \\|\"\\) ((_i += 1)) ;;
          \"|\') _open="${_typed:_i:1}" ;;
          \"\"|\'\') _open="" ;;
        esac
      done
    fi
  fi

  local _path _names=() _rest="${_word#"$_typed"}"
  while IFS= read -r _path; do
    if [[ "$_path" == "$_dir"* ]]; then
      _names+=("$_committed${_path#"$_dir"}")
    elif [[ -z "$_committed" ]]; then
      _names+=("$_path")
      _typed="" _rest="" _open=""
    fi
  done < <(compgen "$_kind" -- "$_prefix")
  if [[ -n "$_open" ]]; then
    _typed+="$_open"
    _rest="${_prefix##*/}"
  fi

  _@NAME@--choices "${_cur%"$_word"}$_rest" "$_rest" "${_names[@]}"
  for ((_i = 0; _i < ${#COMPREPLY[@]}; _i++)); do
    COMPREPLY[_i]="$_typed${COMPREPLY[_i]}"
  done
}
