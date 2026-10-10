#!/bin/zsh
set -eu
SC_APP_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
SC_MODE="${1:-start}"
[[ "$SC_MODE" == install || "$SC_MODE" == start ]] || { print -u2 '入口参数无效'; exit 1; }
[[ "$(/usr/bin/uname -s)" == Darwin ]] || { print -u2 '此入口只适用于 Mac'; exit 1; }
SC_CPU="$(/usr/bin/uname -m)"
if [[ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" == 1 ]]; then SC_CPU=arm64; fi
case "$SC_CPU" in arm64) SC_TARGET=darwin-arm64;; x86_64) SC_TARGET=darwin-x64;; *) print -u2 '未覆盖的芯片'; exit 1;; esac
SC_OS_MAJOR="$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)"
[[ "$SC_OS_MAJOR" -ge 14 ]] || { print -u2 '本候选要求 macOS 14 或更高版本'; exit 1; }
SC_DATA="${SC_LOCAL_USER_DATA:-$HOME/Library/Application Support/SmartCharacterLocalWeb}"
SC_STORE="${SC_LOCAL_COMPONENT_STORE:-$SC_DATA/components}"
[[ "$SC_STORE" == /* && "$SC_DATA" == /* ]] || { print -u2 '组件和用户数据目录须为绝对路径'; exit 1; }
# This table is generated from node-bootstrap-lock.json and checked by the installer tests.
SC_FIELDS="$(/usr/bin/awk -F '\t' -v target="$SC_TARGET" '$1 == target {print $2" "$3" "$4" "$5" "$6}' "$SC_APP_ROOT/resources/node-bootstrap-lock.tsv")"
[[ -n "$SC_FIELDS" ]] || { print -u2 '缺少 Node 固定锁'; exit 1; }
read -r SC_FILE SC_ARCHIVE_HASH SC_BINARY_HASH SC_DIRECTORY SC_URL <<< "$SC_FIELDS"
SC_NODE_HOME="$SC_STORE/node/$SC_TARGET-24.14.0"
SC_NODE="$SC_NODE_HOME/bin/node"
if [[ "$SC_MODE" == install ]]; then
  [[ -f "$SC_APP_ROOT/bundles/sc-components-$SC_TARGET.tar.gz" ]] || { print -u2 "缺少 $SC_TARGET 的完整组件包；请取得对应芯片候选，或由源码维护者先装配资源。"; exit 1; }
  if [[ ! -f "$SC_NODE" ]] || [[ "$(/usr/bin/shasum -a 256 "$SC_NODE" | /usr/bin/awk '{print $1}')" != "$SC_BINARY_HASH" ]]; then
  /bin/mkdir -p -- "$SC_STORE/downloads" "$SC_STORE/node"
  SC_ARCHIVE="$SC_STORE/downloads/$SC_FILE"
  if [[ ! -f "$SC_ARCHIVE" ]]; then
    if [[ -f "$SC_APP_ROOT/bundles/$SC_FILE" ]]; then /bin/cp -- "$SC_APP_ROOT/bundles/$SC_FILE" "$SC_ARCHIVE.partial"
    elif [[ -f "$SC_APP_ROOT/.runtime-cache/downloads/$SC_FILE" ]]; then /bin/cp -- "$SC_APP_ROOT/.runtime-cache/downloads/$SC_FILE" "$SC_ARCHIVE.partial"
    elif [[ "${SC_INSTALL_OFFLINE:-0}" == 1 ]]; then print -u2 '离线 Node 归档缺失'; exit 1
    else /usr/bin/curl --fail --location --retry 2 "$SC_URL" --output "$SC_ARCHIVE.partial"; fi
    [[ "$(/usr/bin/shasum -a 256 "$SC_ARCHIVE.partial" | /usr/bin/awk '{print $1}')" == "$SC_ARCHIVE_HASH" ]] || { /bin/rm -f -- "$SC_ARCHIVE.partial"; print -u2 'Node 下载校验失败'; exit 1; }
    /bin/mv -- "$SC_ARCHIVE.partial" "$SC_ARCHIVE"
  fi
  [[ "$(/usr/bin/shasum -a 256 "$SC_ARCHIVE" | /usr/bin/awk '{print $1}')" == "$SC_ARCHIVE_HASH" ]] || { print -u2 'Node 缓存校验失败；只删除此缓存后重试'; exit 1; }
  SC_STAGE="$(/usr/bin/mktemp -d "$SC_STORE/node/stage.XXXXXXXX")"
  trap '/bin/rm -rf -- "$SC_STAGE"' EXIT
  /usr/bin/tar -xf "$SC_ARCHIVE" -C "$SC_STAGE"
  [[ "$(/usr/bin/shasum -a 256 "$SC_STAGE/$SC_DIRECTORY/bin/node" | /usr/bin/awk '{print $1}')" == "$SC_BINARY_HASH" ]] || { print -u2 'Node 解压校验失败'; exit 1; }
  if [[ -e "$SC_NODE_HOME" ]]; then /bin/mv -- "$SC_NODE_HOME" "$SC_NODE_HOME.previous.$(/bin/date +%s).$$"; fi
  /bin/mv -- "$SC_STAGE/$SC_DIRECTORY" "$SC_NODE_HOME"
  fi
fi
[[ -f "$SC_NODE" ]] || { print -u2 '请先运行“安装 SmartCharacter”'; exit 1; }
[[ "$(/usr/bin/shasum -a 256 "$SC_NODE" | /usr/bin/awk '{print $1}')" == "$SC_BINARY_HASH" ]] || { print -u2 '已安装 Node 校验失败，请重新安装'; exit 1; }
export SC_LOCAL_COMPONENT_STORE="$SC_STORE"
if [[ "$SC_MODE" == install ]]; then "$SC_NODE" "$SC_APP_ROOT/scripts/install-local-web.mjs"
else exec "$SC_NODE" "$SC_APP_ROOT/scripts/launch-installed.mjs"; fi
