#!/bin/sh
# agent-files transfers. Started by the mod as an hc terminal, so a copy outlives the panel,
# its renders and the 10-minute limit of exec.
#
#   sh transfer.sh run <root> <id> <from> <path> <to> <folder>
#     Copies <path> (a file or a folder) into <folder> under its own name, or "<name> 2",
#     "<name> 3"... when that is taken. <from> and <to> are ssh targets, "" for this computer;
#     at most one of them is another machine. The copy is made in <folder>/.agent-files-<id>/
#     and moved into place whole, so a half-copied file never shows under its real name.
#     Writes <root>/<id>/: pid, log ("size <KiB>", then rsync's output), err, and at the end
#     status: "done" and the name it got, or "failed" and what went wrong.
#   sh transfer.sh read <root> [<id>=<offset>...]
#     Per transfer: id, info.json, status, alive (1, 0, "" before it started), log size, and
#     the log from <offset>, each followed by a NUL. Drops transfers that ended over a day ago.
#
# $HC_SSH, when set, stands in for ssh as it does for hc: given the target and the command.

# Runs on the machine the copy goes to: moves the staged copy to the first free name.
PLACE='s=$1 d=$2 n=$3 b=$3 e= i=1
[ -d "$s/$n" ] || case $n in ?*.*) b=${n%.*} e=.${n##*.} ;; esac
c=$n
while [ $i -lt 1000 ]; do
  if [ ! -e "$d/$c" ] && [ ! -L "$d/$c" ]; then
    mv -n "$s/$n" "$d/$c" || [ -e "$d/$c" ] || [ -L "$d/$c" ] || exit 1
    if [ ! -e "$s/$n" ] && [ ! -L "$s/$n" ]; then rmdir "$s" 2>/dev/null; printf "%s\n" "$c"; exit 0; fi
  fi
  i=$((i + 1))
  c="$b $i$e"
done
echo "no free name for $n in $d" >&2
exit 1'

SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15"

# A word for the remote shell, which reads every command ssh carries.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# Runs a shell line on <machine> ("" for this computer).
at() {
  if [ -z "$1" ]; then sh -c "$2"
  elif [ -n "${HC_SSH:-}" ]; then "$HC_SSH" "$1" "$2"
  else ssh $SSH_OPTS "$1" "$2"
  fi
}

finish() {
  printf '%s\n%s\n' "$1" "$2" >"$state/status.tmp" && mv -f "$state/status.tmp" "$state/status"
}

run() {
  root=$1 id=$2 from=$3 src=${4%/} to=$5 dest=${6%/}
  state=$root/$id name=${src##*/}
  stage=$dest/.agent-files-$id
  mkdir -p "$state" || exit 1
  echo $$ >"$state/pid"
  : >"$state/log"
  : >"$state/err"
  failed() {
    at "$to" "rm -rf $(q "$stage")" 2>/dev/null
    finish failed "${1:-$(cat "$state/err")}"
    exit 1
  }
  trap 'failed stopped' HUP INT TERM

  size=$(at "$from" "du -sk $(q "$src")" 2>>"$state/err") || failed
  printf 'size %s\n' "${size%%[!0-9]*}" >>"$state/log"

  # rsync 3 makes a missing last folder itself; openrsync may not.
  at "$to" "mkdir $(q "$stage")" 2>>"$state/err" || failed
  s=$src d=$stage/
  [ -n "$from" ] && s=$from:$(q "$src")
  [ -n "$to" ] && d=$to:$(q "$stage/")
  # Remote paths are quoted here, so rsync 3 must pass them as they are (openrsync always does).
  RSYNC_OLD_ARGS=1 rsync -a --progress -e "${HC_SSH:-ssh $SSH_OPTS}" "$s" "$d" >>"$state/log" 2>>"$state/err" || failed

  got=$(at "$to" "sh -c $(q "$PLACE") place $(q "$stage") $(q "$dest") $(q "$name")" 2>>"$state/err") || failed
  finish done "$got"
}

read_all() {
  root=$1
  shift
  [ -d "$root" ] || exit 0
  find "$root" -mindepth 2 -maxdepth 2 -name status -mtime +0 2>/dev/null | while IFS= read -r f; do rm -rf "${f%/status}"; done
  for dir in "$root"/*/; do
    [ -f "$dir/info.json" ] || continue
    id=${dir%/}
    id=${id##*/}
    off=0
    for a in "$@"; do case $a in "$id="*) off=${a#*=} ;; esac; done
    alive=
    if [ -f "$dir/pid" ]; then
      alive=0
      kill -0 "$(cat "$dir/pid")" 2>/dev/null && alive=1
    fi
    size=$(wc -c <"$dir/log" 2>/dev/null | tr -d ' ')
    printf '%s\0' "$id" "$(cat "$dir/info.json")" "$(cat "$dir/status" 2>/dev/null)" "$alive" "${size:-0}"
    [ "${size:-0}" -gt "$off" ] && head -c "$size" "$dir/log" | tail -c +$((off + 1))
    printf '\0'
  done
}

case $1 in
  run) shift; run "$@" ;;
  read) shift; read_all "$@" ;;
  *) echo "usage: sh transfer.sh run|read ..." >&2; exit 2 ;;
esac
