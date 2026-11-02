// Pure helpers: no herdr or gpui imports, so they load anywhere.

// Lists live agent-browser daemons on one machine as JSON lines. It reads
// agent-browser's own state files instead of calling the CLI, so it needs no
// PATH and costs one round trip per machine. Same directories, same order as
// agent-browser itself (cli/src/connection.rs).
export const DISCOVER = [
  `printf '{"os":"%s"}\\n' "$(uname -s)"`,
  `seen=" "`,
  `for d in "\${AGENT_BROWSER_SOCKET_DIR:-}" "\${XDG_RUNTIME_DIR:+$XDG_RUNTIME_DIR/agent-browser}" "$HOME/.agent-browser" "\${TMPDIR:-/tmp}/agent-browser"; do`,
  // Only folders this user owns: /tmp/agent-browser could be anyone's.
  `  [ -n "$d" ] && [ -d "$d" ] && [ -O "$d" ] || continue`,
  `  for p in "$d"/*.pid "$d"/namespaces/*/run/*.pid; do`,
  // dashboard.pid is agent-browser's dashboard server, not a browser.
  `    case $p in */dashboard.pid) continue ;; esac`,
  `    [ -f "$p" ] || continue`,
  `    pid=$(cat "$p" 2>/dev/null)`,
  `    case $pid in ''|*[!0-9]*) continue ;; esac`,
  `    case $seen in *" $pid "*) continue ;; esac`,
  `    kill -0 "$pid" 2>/dev/null || continue`,
  `    seen="$seen$pid "`,
  `    b=\${p%.pid}`,
  `    port=$(cat "$b.stream" 2>/dev/null)`,
  `    case $port in ''|*[!0-9]*) port=0 ;; esac`,
  `    engine=$(cat "$b.engine" 2>/dev/null | tr -cd 'a-z0-9_-')`,
  `    target=$(cat "$b.target" 2>/dev/null | tr -d '\\n\\r')`,
  `    [ -n "$target" ] || target=null`,
  `    name=$(printf %s "\${b##*/}" | tr -d '"\\\\')`,
  `    dir=$(printf %s "\${p%/*}" | tr -d '"\\\\')`,
  `    printf '{"session":"%s","dir":"%s","pid":%s,"port":%s,"engine":"%s","target":%s}\\n' "$name" "$dir" "$pid" "$port" "$engine" "$target"`,
  `  done`,
  `done`,
].join("\n");

export function parseDiscovery(stdout) {
  let os = null;
  const sessions = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // A target file that isn't JSON must not hide its session.
      try { row = JSON.parse(line.replace(/,"target":.*\}$/, ',"target":null}')); } catch { continue; }
    }
    if (row.os !== undefined) { os = row.os; continue; }
    if (!row.session) continue;
    const dir = typeof row.dir === "string" ? row.dir : "";
    sessions.push({
      session: row.session,
      dir,
      // Set when AGENT_BROWSER_NAMESPACE put it apart: the same name can live in several.
      namespace: /\/namespaces\/([^/]+)\/run$/.exec(dir)?.[1] ?? null,
      pid: row.pid,
      port: row.port || null,
      engine: row.engine || "chrome",
      url: typeof row.target?.url === "string" ? row.target.url : null,
    });
  }
  sessions.sort((a, b) => a.session.localeCompare(b.session) || a.dir.localeCompare(b.dir));
  return { os, sessions };
}

// A short stable token for file names and window keys: [a-z0-9-] only.
export function slug(text) {
  const s = String(text ?? "here");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "x";
  return `${base}-${h.toString(36)}`;
}

// One session among all machines: same name in two namespaces are two sessions.
export function sessionKey(machine, s) {
  return `${machine ?? ""}|${s.dir ?? ""}|${s.session}`;
}

// An address fit to show next to everything else: no user:password@, no query
// or fragment (where tokens live). The viewer's own address bar shows it whole.
export function brief(url) {
  if (typeof url !== "string") return "";
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/, "");
}

export function host(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#]+)/i.exec(url ?? "");
  return m ? m[1] : brief(url);
}

// An address on the browser's own machine, which another machine can only reach
// through a tunnel: its scheme, port and everything after the host.
export function loopback(url) {
  const m = /^(https?):\/\/(?:[^/?#@]*@)?(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)(?::(\d+))?([/?#].*)?$/i.exec(url ?? "");
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), port: Number(m[3] ?? (m[1].toLowerCase() === "https" ? 443 : 80)), rest: m[4] ?? "/" };
}

// What the address bar navigates to: agent-browser's own rule, https:// unless a scheme it knows is there.
export function normalizeUrl(text) {
  const v = String(text ?? "").trim();
  if (!v) return null;
  return /^(https?:\/\/|about:|data:|file:|chrome(-extension)?:\/\/)/i.test(v) ? v : `https://${v}`;
}

export function ago(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// A JPEG's pixel size from its frame header (SOFn).
export function jpegSize(bytes) {
  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

// The page a frame shows, in CSS pixels. The frame is the viewport only, at
// the device's pixel ratio; metadata's deviceHeight is the whole window, so
// only its width is used.
export function pageOf(size, deviceWidth) {
  if (!size?.width || !size?.height) return null;
  const width = deviceWidth || size.width;
  return { width, height: Math.round((size.height * width) / size.width) };
}

// Where a point inside the screen element lands on the page. The frame is
// drawn with object-fit: contain, so the page sits letterboxed in the middle.
// With clamp, a point outside the page lands on its nearest edge (a release
// after a drag must still reach the page).
export function toPage(local, bounds, pageW, pageH, clamp = false) {
  if (!local || !bounds || !pageW || !pageH || !bounds.width || !bounds.height) return null;
  const s = Math.min(bounds.width / pageW, bounds.height / pageH);
  let x = (local.x - (bounds.width - pageW * s) / 2) / s;
  let y = (local.y - (bounds.height - pageH * s) / 2) / s;
  if (x < 0 || y < 0 || x > pageW || y > pageH) {
    if (!clamp) return null;
    x = Math.min(Math.max(x, 0), pageW);
    y = Math.min(Math.max(y, 0), pageH);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

// CDP modifier bits. The Mac's Command becomes Control on a Linux browser,
// where shortcuts live on Control.
export function cdpModifiers(m, browserOs) {
  if (!m) return 0;
  const cmdIsCtrl = browserOs && browserOs !== "Darwin";
  return (m.alt ? 1 : 0) | (m.control || (m.platform && cmdIsCtrl) ? 2 : 0) | (m.platform && !cmdIsCtrl ? 4 : 0) | (m.shift ? 8 : 0);
}

const NAMED = {
  enter: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  backspace: ["Backspace", "Backspace", 8],
  escape: ["Escape", "Escape", 27],
  delete: ["Delete", "Delete", 46],
  insert: ["Insert", "Insert", 45],
  left: ["ArrowLeft", "ArrowLeft", 37],
  up: ["ArrowUp", "ArrowUp", 38],
  right: ["ArrowRight", "ArrowRight", 39],
  down: ["ArrowDown", "ArrowDown", 40],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
  space: [" ", "Space", 32, " "],
};

function codeFor(ch) {
  if (/^[a-z]$/i.test(ch)) return [`Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0)];
  if (/^[0-9]$/.test(ch)) return [`Digit${ch}`, ch.charCodeAt(0)];
  return [undefined, 0];
}

// One GPUI key press as the stream's input_keyboard messages (down, then up).
export function keyMessages(e, browserOs) {
  const modifiers = cdpModifiers(e.modifiers, browserOs);
  const shortcut = e.modifiers?.control || e.modifiers?.platform;
  const named = NAMED[e.key];
  let key, code, vk, text;
  if (named) {
    [key, code, vk, text] = named;
    if (shortcut) text = undefined;
  } else if (e.key_char && !shortcut) {
    key = text = e.key_char;
    [code, vk] = codeFor(e.key);
  } else if (e.key && [...e.key].length === 1) {
    key = e.key;
    [code, vk] = codeFor(e.key);
  } else {
    return [];
  }
  const down = { type: "input_keyboard", eventType: text ? "keyDown" : "rawKeyDown", key, windowsVirtualKeyCode: vk, modifiers };
  if (code) down.code = code;
  if (text) down.text = text;
  const up = { type: "input_keyboard", eventType: "keyUp", key, windowsVirtualKeyCode: vk, modifiers };
  if (code) up.code = code;
  return [down, up];
}

// Typed text (a paste) as one keyDown with text per character.
export function textMessages(text, limit = 2000) {
  return [...String(text ?? "")].slice(0, limit).map((ch) => ch === "\n"
    ? { type: "input_keyboard", eventType: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }
    : { type: "input_keyboard", eventType: "keyDown", key: ch, text: ch });
}

// What an agent's command was, for the activity line. Only targets are shown:
// fill/type values can be passwords, eval bodies can be anything.
const SHOWN = ["url", "selector", "ref", "key", "direction", "tabId", "index"];
export function describe(cmd) {
  const p = cmd?.params ?? {};
  const target = SHOWN.map((k) => p[k]).find((v) => typeof v === "string" || typeof v === "number");
  const t = target === undefined ? "" : target === p.url ? brief(String(target)) : String(target);
  return `${cmd?.action ?? "?"}${t ? ` ${t.length > 60 ? `${t.slice(0, 57)}…` : t}` : ""}`;
}
