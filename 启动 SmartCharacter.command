#!/bin/zsh
SC_ENTRY_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
/bin/zsh "$SC_ENTRY_ROOT/scripts/bootstrap-local-web.sh" start
SC_RESULT=$?
if [[ "${SC_ENTRY_NO_PAUSE:-0}" != 1 ]]; then read -r "?按回车关闭窗口…"; fi
exit "$SC_RESULT"
