#!/usr/bin/env bash
# Fetch only this command's named secrets; keep credentials out of its environment.
. "$(dirname "$0")/lib.sh"
set +x
while [[ $# -gt 0 && $1 != -- ]]; do
  name=${1%%=*} id=${1#*=}
  [[ $name =~ ^[A-Z][A-Z0-9_]*$ && $id != "$1" && -n $id ]] || die 'Expected NAME=secret-id'
  if ! dry_run; then
    value=$(aws secretsmanager get-secret-value --region us-east-1 --secret-id "$id" --query SecretString --output text)
    [[ -n $value && $value != None ]] || die "Empty secret: $id"
    while IFS= read -r line; do
      [[ -z $line ]] || printf '::add-mask::%s\n' "${line//%/%25}"
    done <<< "$value"
    export "$name=$value"
  fi
  shift
done
[[ ${1:-} == -- && $# -gt 1 ]] || die 'Expected -- command'
shift
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN value
exec "$@"
