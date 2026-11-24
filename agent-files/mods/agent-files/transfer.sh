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
#     the log from <offset> (over 64 KB of it: so_far), each followed by a NUL. Drops transfers
#     that ended over a day ago.
#
# $HC_SSH, when set, stands in for ssh as it does for hc: given the target and the command.

# Runs on the machine the copy goes to: moves the staged copy to the first free name.
PLACE='s=$1 d=$2 n=$3 b=$3 e= i=1 t=
[ -d "$s/$n" ] || case $n in ?*.*) b=${n%.*} e=.${n##*.} ;; esac
# GNU mv: -T, or a folder that took the name meanwhile gets ours inside it. BSD mv has no -T.
mv --version >/dev/null 2>&1 && t=T
c=$n
while [ $i -lt 1000 ]; do
  if [ ! -e "$d/$c" ] && [ ! -L "$d/$c" ]; then
    mv -n$t "$s/$n" "$d/$c" || [ -e "$d/$c" ] || [ -L "$d/$c" ] || exit 1
    if [ ! -e "$s/$n" ] && [ ! -L "$s/$n" ]; then rmdir "$s" 2>/dev/null; printf "%s\n" "$c"; exit 0; fi
  fi
  i=$((i + 1))
  c="$b $i$e"
done
echo "no free name for $n in $d" >&2
exit 1'

# ServerAlive: a link that goes silent (Wi-Fi gone, sleep) ends the transfer instead of hanging it.
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"

# Staging folders of other transfers are never carried along.
STAGE_GLOB='.agent-files-*'

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

  # -H and the folder test follow <path> itself when it is a link, not links inside it.
  info=$(at "$from" "du -skH $(q "$src") && { [ -d $(q "$src") ] && echo dir || echo file; }" 2>>"$state/err") || failed
  printf 'size %s\n' "${info%%[!0-9]*}" >>"$state/log"

  # A folder (or a link to one) is copied by its contents, a file (or a link to one) by its
  # content. rsync 3 makes a missing last folder itself; openrsync may not.
  if [ "${info##*[!a-z]}" = dir ]; then
    s=$src/ d=$stage/$name/ links=
    at "$to" "mkdir $(q "$stage") $(q "$stage/$name")" 2>>"$state/err" || failed
  else
    s=$src d=$stage/ links=--copy-links
    at "$to" "mkdir $(q "$stage")" 2>>"$state/err" || failed
  fi
  [ -n "$from" ] && s=$from:$(q "$s")
  [ -n "$to" ] && d=$to:$(q "$d")
  # Remote paths are quoted here, so rsync 3 must pass them as they are (openrsync always does).
  RSYNC_OLD_ARGS=1 rsync -a $links --exclude="$STAGE_GLOB" --progress -e "${HC_SSH:-ssh $SSH_OPTS}" "$s" "$d" >>"$state/log" 2>>"$state/err" || failed

  got=$(at "$to" "sh -c $(q "$PLACE") place $(q "$stage") $(q "$dest") $(q "$name")" 2>>"$state/err") || failed
  finish done "$got"
}

# Over 64 KB of new log (a folder of many files, read after a panel reset): the panel gets one
# line with the bytes of finished files and du's size, and the last 20 lines, so one read's work
# in the panel stays small whatever the log's size.
so_far() {
  lines=$(head -c "$2" "$1" | tr '\r' '\n' | wc -l | tr -d ' ')
  k=$((lines > 20 ? lines - 20 : 0))
  head -c "$2" "$1" | tr '\r' '\n' | awk -v k="$k" '
    NR > k { exit }
    /^size [0-9]+$/ { s = $2 }
    /^ *[0-9,]+ +[0-9]+%/ && /\(xfe?r#[0-9]+/ { b = $1; gsub(",", "", b); d += b }
    END { printf "agent-files-so-far %.0f %s\n", d, s }'
  head -c "$2" "$1" | tr '\r' '\n' | tail -n +$((k + 1))
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
    size=${size:-0}
    printf '%s\0' "$id" "$(cat "$dir/info.json")" "$(cat "$dir/status" 2>/dev/null)" "$alive" "$size"
    if [ $((size - off)) -gt 65536 ]; then so_far "$dir/log" "$size"
    elif [ "$size" -gt "$off" ]; then head -c "$size" "$dir/log" | tail -c +$((off + 1))
    fi
    printf '\0'
  done
}

case $1 in
  run) shift; run "$@" ;;
  read) shift; read_all "$@" ;;
  *) echo "usage: sh transfer.sh run|read ..." >&2; exit 2 ;;
esac
