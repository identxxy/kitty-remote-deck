import base64
import glob
import json
import mimetypes
import os
import shutil
import socket as socket_module
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import unquote, urlparse
from urllib.request import Request, url2pathname, urlopen


MAX_PREVIEW_BYTES = 10_000_000
MAX_RESOURCE_BYTES = 8_000_000


def respond(ok, data=None, error=None):
    payload = {"ok": ok}
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error or "Unknown error"
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def decode_payload(encoded):
    return json.loads(base64.b64decode(encoded.encode("utf-8")).decode("utf-8"))


ACTION = sys.argv[1]
PAYLOAD = decode_payload(sys.argv[2])


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def discover_kitty_binary():
    preferred = PAYLOAD.get("kittyBinary") or "kitty"
    if os.path.isabs(preferred) and os.path.exists(preferred):
        return preferred
    if shutil.which(preferred):
        return shutil.which(preferred)
    if preferred != "kitty" and shutil.which("kitty"):
        return shutil.which("kitty")
    raise RuntimeError(f"kitty binary not found: {preferred}")


KITTY_BINARY_CACHE = None
BACKEND = (PAYLOAD.get("backend") or "kitty").strip().lower()
DEFAULT_SOCKET = PAYLOAD.get("defaultSocket") or ""


def default_tmux_socket_pattern():
    tmpdir = os.environ.get("TMUX_TMPDIR") or "/tmp"
    return os.path.join(tmpdir, f"tmux-{os.getuid()}", "*")


if BACKEND == "tmux":
    SOCKET_PATTERN = PAYLOAD.get("socketPattern") or default_tmux_socket_pattern()
else:
    SOCKET_PATTERN = PAYLOAD.get("socketPattern") or "/tmp/kitty.sock-*"


def get_kitty_binary():
    global KITTY_BINARY_CACHE
    if not KITTY_BINARY_CACHE:
        KITTY_BINARY_CACHE = discover_kitty_binary()
    return KITTY_BINARY_CACHE


def socket_is_live(path):
    try:
        if not stat.S_ISSOCK(os.stat(path).st_mode):
            return False
        probe = socket_module.socket(socket_module.AF_UNIX, socket_module.SOCK_STREAM)
        probe.settimeout(1.0)
        try:
            probe.connect(path)
        finally:
            probe.close()
        return True
    except OSError:
        return False


def discover_sockets():
    sockets = [path for path in glob.glob(SOCKET_PATTERN) if os.path.exists(path)]
    if BACKEND == "tmux":
        # A tmux server that exited uncleanly leaves its socket file behind.
        sockets = [path for path in sockets if socket_is_live(path)]
    sockets.sort(key=lambda item: os.path.getmtime(item), reverse=True)
    return sockets


def resolve_socket(explicit_socket=None):
    if explicit_socket and os.path.exists(explicit_socket):
        return explicit_socket
    if DEFAULT_SOCKET and os.path.exists(DEFAULT_SOCKET):
        return DEFAULT_SOCKET
    sockets = discover_sockets()
    if sockets:
        return sockets[0]
    raise RuntimeError(f"No {BACKEND} sockets found for pattern {SOCKET_PATTERN}")


def run_kitty(args, socket=None, stdin_text=None):
    command = [get_kitty_binary(), "@", "--to", f"unix:{socket}", *args]
    completed = subprocess.run(
        command,
        input=stdin_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "kitty command failed")
    return completed.stdout


def count_windows(tree):
    total = 0
    for os_window in tree:
        for tab in os_window.get("tabs", []):
            total += len(tab.get("windows", []))
    return total


def action_test():
    sockets = discover_sockets()
    selected_socket = resolve_socket(PAYLOAD.get("socket") or "") if sockets else ""
    tree = json.loads(run_kitty(["ls"], socket=selected_socket)) if selected_socket else []
    return {
        "host": subprocess.run(["hostname"], stdout=subprocess.PIPE, text=True, check=False).stdout.strip(),
        "user": os.environ.get("USER") or os.environ.get("LOGNAME") or "",
        "kittyBinary": get_kitty_binary(),
        "socketPattern": SOCKET_PATTERN,
        "sockets": sockets,
        "selectedSocket": selected_socket,
        "sessionCount": len(tree),
        "windowCount": count_windows(tree),
        "checkedAt": utc_now(),
    }


def content_type_charset(content_type):
    for part in (content_type or "").split(";")[1:]:
        key, _, value = part.strip().partition("=")
        if key.lower() == "charset" and value:
            return value.strip("\"'")
    return "utf-8"


def decode_preview_body(raw, content_type):
    encoding = content_type_charset(content_type)
    return raw.decode(encoding, errors="replace"), encoding


def is_text_like_content_type(content_type):
    value = (content_type or "").split(";", 1)[0].strip().lower()
    return (
        value.startswith("text/")
        or value in (
            "application/javascript",
            "application/json",
            "application/xml",
            "image/svg+xml",
        )
    )


def make_fetch_response(url, final_url, raw, content_type, truncated):
    response = {
        "url": url,
        "finalUrl": final_url,
        "contentType": content_type,
        "bodyBase64": base64.b64encode(raw).decode("ascii"),
        "byteLength": len(raw),
        "truncated": truncated,
        "fetchedAt": utc_now(),
    }

    if is_text_like_content_type(content_type):
        body, encoding = decode_preview_body(raw, content_type)
        response["body"] = body
        response["encoding"] = encoding

    return response


def read_limited_bytes(path):
    with open(path, "rb") as handle:
        raw = handle.read(MAX_PREVIEW_BYTES + 1)
    return raw[:MAX_PREVIEW_BYTES], len(raw) > MAX_PREVIEW_BYTES


def parse_range_header(range_header, size):
    value = (range_header or "").strip()
    if not value.startswith("bytes=") or size < 1:
        return None

    spec = value[6:]
    if "," in spec or "-" not in spec:
        return None

    start_text, end_text = spec.split("-", 1)
    if not start_text and not end_text:
        return None

    try:
        if not start_text:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return None
            start = max(0, size - suffix_length)
            end = size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else size - 1
    except ValueError:
        return None

    if start < 0 or end < start or start >= size:
        return None

    end = min(end, size - 1)
    if end - start + 1 > MAX_RESOURCE_BYTES:
        end = start + MAX_RESOURCE_BYTES - 1

    return start, min(end, size - 1)


def make_resource_response(url, final_url, raw, content_type, status_code=200, content_range=None, truncated=False):
    response = make_fetch_response(url, final_url, raw, content_type, truncated)
    response["statusCode"] = status_code
    response["acceptRanges"] = "bytes"
    if content_range:
        response["contentRange"] = content_range
    return response


def fetch_file_url(url, parsed):
    if parsed.netloc and parsed.netloc not in ("localhost", "127.0.0.1"):
        raise RuntimeError("file:// URLs must point to the selected host.")

    file_path = url2pathname(unquote(parsed.path))
    if not file_path:
        raise RuntimeError("file:// URL is missing a path.")

    raw, truncated = read_limited_bytes(file_path)
    content_type = mimetypes.guess_type(file_path)[0] or "text/plain"
    return make_fetch_response(url, url, raw, content_type, truncated)


def fetch_file_resource(url, parsed, range_header):
    if parsed.netloc and parsed.netloc not in ("localhost", "127.0.0.1"):
        raise RuntimeError("file:// URLs must point to the selected host.")

    file_path = url2pathname(unquote(parsed.path))
    if not file_path:
        raise RuntimeError("file:// URL is missing a path.")
    if not os.path.isfile(file_path):
        raise RuntimeError("file:// URL must point to a regular file.")

    size = os.path.getsize(file_path)
    content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    if range_header:
        parsed_range = parse_range_header(range_header, size)
        if not parsed_range:
            return {
                "url": url,
                "finalUrl": url,
                "contentType": content_type,
                "bodyBase64": "",
                "byteLength": 0,
                "statusCode": 416,
                "acceptRanges": "bytes",
                "contentRange": f"bytes */{size}",
                "truncated": False,
                "fetchedAt": utc_now(),
            }

        start, end = parsed_range
        with open(file_path, "rb") as handle:
            handle.seek(start)
            raw = handle.read(end - start + 1)
        return make_resource_response(
            url,
            url,
            raw,
            content_type,
            status_code=206,
            content_range=f"bytes {start}-{end}/{size}",
        )

    raw, truncated = read_limited_bytes(file_path)
    return make_resource_response(url, url, raw, content_type, truncated=truncated)


def fetch_http_url(url):
    request = Request(url, headers={"User-Agent": "KittyRemoteDeck/0.1"})
    with urlopen(request, timeout=15) as response:
        raw = response.read(MAX_PREVIEW_BYTES + 1)
        truncated = len(raw) > MAX_PREVIEW_BYTES
        raw = raw[:MAX_PREVIEW_BYTES]
        content_type = response.headers.get("content-type") or "application/octet-stream"
        return make_fetch_response(url, response.geturl(), raw, content_type, truncated)


def fetch_http_resource(url, range_header):
    headers = {"User-Agent": "KittyRemoteDeck/0.1"}
    if range_header:
        headers["Range"] = range_header
    request = Request(url, headers=headers)

    try:
        response_context = urlopen(request, timeout=15)
    except HTTPError as error:
        if error.code not in (206, 416):
            raise
        response_context = error

    response = response_context
    try:
        raw = response.read(MAX_RESOURCE_BYTES + 1)
        truncated = len(raw) > MAX_RESOURCE_BYTES
        raw = raw[:MAX_RESOURCE_BYTES]
        content_type = response.headers.get("content-type") or "application/octet-stream"
        return make_resource_response(
            url,
            response.geturl(),
            raw,
            content_type,
            status_code=getattr(response, "status", None) or response.getcode(),
            content_range=response.headers.get("content-range"),
            truncated=truncated,
        )
    finally:
        response.close()


def action_fetch_url():
    url = (PAYLOAD.get("url") or "").strip()
    if not url:
        raise RuntimeError("URL is required.")

    parsed = urlparse(url)
    if parsed.scheme == "file":
        return fetch_file_url(url, parsed)
    if parsed.scheme in ("http", "https"):
        return fetch_http_url(url)

    raise RuntimeError("Only file://, http://, and https:// URLs are supported.")


def action_fetch_url_resource():
    url = (PAYLOAD.get("url") or "").strip()
    if not url:
        raise RuntimeError("URL is required.")

    range_header = (PAYLOAD.get("range") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return fetch_file_resource(url, parsed, range_header)
    if parsed.scheme in ("http", "https"):
        return fetch_http_resource(url, range_header)

    raise RuntimeError("Only file://, http://, and https:// URLs are supported.")


def action_list_sessions():
    sockets = discover_sockets()
    selected_socket = resolve_socket(PAYLOAD.get("socket") or "")
    tree = json.loads(run_kitty(["ls"], socket=selected_socket))
    return {
        "backend": "kitty",
        "sockets": sockets,
        "selectedSocket": selected_socket,
        "tree": tree,
        "discoveredAt": utc_now(),
    }


def action_get_screen():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    text, text_format = get_window_text(window_id, socket, PAYLOAD.get("extent") or "screen")
    return {"socket": socket, "windowId": window_id, "text": text, "format": text_format}


def get_window_text(window_id, socket, extent):
    args = [
        "get-text",
        "--match",
        f"id:{window_id}",
        "--extent",
        extent,
        "--ansi",
    ]

    try:
        return run_kitty(args, socket=socket), "ansi"
    except RuntimeError as error:
        if "--ansi" not in str(error) and "ansi" not in str(error).lower():
            raise

    return run_kitty(args[:-1], socket=socket), "plain"


def action_scroll_window():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    lines = int(PAYLOAD.get("lines") or 0)
    amount = min(abs(lines), 120)

    if PAYLOAD.get("toEnd"):
        run_kitty(["scroll-window", "--match", f"id:{window_id}", "end"], socket=socket)
    elif amount:
        suffix = "-" if lines < 0 else ""
        run_kitty(["scroll-window", "--match", f"id:{window_id}", f"{amount}{suffix}"], socket=socket)

    text, text_format = get_window_text(window_id, socket, "screen")
    return {"socket": socket, "windowId": window_id, "lines": lines, "text": text, "format": text_format}


def action_send_text():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    text = PAYLOAD.get("text") or ""
    match = ["--match", f"id:{window_id}"]
    # --stdin sends the text verbatim; as an argument kitty would interpret
    # backslash escapes. Bracketed paste keeps embedded newlines from submitting
    # early in programs that support it, so the final Enter is a separate key.
    if text:
        run_kitty(["send-text", *match, "--stdin", "--bracketed-paste", "auto"], socket=socket, stdin_text=text)
    if PAYLOAD.get("appendNewline"):
        run_kitty(["send-key", *match, "enter"], socket=socket)
    return {"socket": socket, "windowId": window_id, "sentLength": len(text)}


def key_repeat_count():
    # Chords like Ctrl-D twice must arrive in one call; separate requests are too slow.
    return max(1, min(int(PAYLOAD.get("repeat") or 1), 5))


def key_sequence():
    # `keys` is a chord such as Ctrl-X Ctrl-S; otherwise one key repeated.
    keys = PAYLOAD.get("keys")
    if isinstance(keys, list) and keys:
        return [str(key) for key in keys[:8]]
    return [PAYLOAD.get("key") or "enter"] * key_repeat_count()


def send_key_sequence(send, names):
    # A doubled Escape in one write can be read as one Alt-prefixed key, so
    # sequences containing Escape go out one key at a time like real presses.
    if len(names) > 1 and any(name in ("Escape", "escape", "esc") for name in names):
        for index, name in enumerate(names):
            if index:
                time.sleep(0.05)
            send([name])
    else:
        send(names)


def action_send_key():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    keys = key_sequence()
    send_key_sequence(lambda names: run_kitty(["send-key", "--match", f"id:{window_id}", *names], socket=socket), keys)
    return {"socket": socket, "windowId": window_id, "key": keys[0], "keys": keys, "repeat": len(keys)}


def action_focus_window():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    run_kitty(["focus-window", "--match", f"id:{window_id}"], socket=socket)
    return {"socket": socket, "windowId": window_id}


def action_close_panel():
    kind = (PAYLOAD.get("kind") or "pane").strip().lower()
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    ident = int(PAYLOAD["id"])
    if kind == "pane":
        run_kitty(["close-window", "--match", f"id:{ident}"], socket=socket)
    elif kind == "tab":
        run_kitty(["close-tab", "--match", f"id:{ident}"], socket=socket)
    else:
        raise RuntimeError(f"Unsupported close kind for kitty: {kind}")
    return {"socket": socket, "kind": kind, "id": ident}


def optional_positive_int(name):
    value = PAYLOAD.get(name)
    if value in (None, ""):
        return None
    number = int(value)
    if number < 0:
        raise RuntimeError(f"{name} must be a non-negative integer.")
    return number


def run_launch(args, socket):
    raw_window_id = run_kitty(args, socket=socket).strip()
    try:
        window_id = int(raw_window_id)
    except ValueError as error:
        raise RuntimeError(f"kitty launch returned an invalid window id: {raw_window_id or '<empty>'}") from error
    run_kitty(["focus-window", "--match", f"id:{window_id}"], socket=socket)
    return window_id


def action_create_panel():
    kind = (PAYLOAD.get("kind") or "window").strip().lower()
    socket = resolve_socket(PAYLOAD.get("socket") or "")

    if kind == "window":
        # A new OS window starts at home rather than in kitty's own cwd.
        window_id = run_launch(["launch", "--type", "os-window", "--cwd", os.path.expanduser("~")], socket)
        return {"socket": socket, "kind": kind, "windowId": window_id}

    source_window_id = optional_positive_int("sourceWindowId")
    if source_window_id is None:
        raise RuntimeError("sourceWindowId is required.")

    source_match = f"id:{source_window_id}"
    common_args = [
        "--source-window",
        source_match,
        "--cwd",
        "current",
        "--next-to",
        source_match,
    ]

    if kind == "tab":
        window_id = run_launch(["launch", "--type", "tab", *common_args], socket)
        return {
            "socket": socket,
            "kind": kind,
            "sourceWindowId": source_window_id,
            "windowId": window_id,
        }

    if kind == "split":
        tab_id = optional_positive_int("tabId")
        if tab_id is None:
            raise RuntimeError("tabId is required.")

        tab_match = f"id:{tab_id}"
        run_kitty(["goto-layout", "--match", tab_match, "splits"], socket=socket)
        window_id = run_launch(
            [
                "launch",
                "--type",
                "window",
                "--match",
                tab_match,
                "--location",
                "split",
                *common_args,
            ],
            socket,
        )
        return {
            "socket": socket,
            "kind": kind,
            "tabId": tab_id,
            "sourceWindowId": source_window_id,
            "windowId": window_id,
        }

    raise RuntimeError("kind must be one of: window, tab, split.")

# ---------------------------------------------------------------------------
# tmux backend
#
# The frontend consumes kitty's `ls` tree shape, so tmux is mapped onto it:
#   session -> OS window, window -> tab, pane -> window.
# Ids are the numeric part of $N / @N / %N, which tmux never reuses within one
# server, and %0 is a legal pane id.
# ---------------------------------------------------------------------------

TMUX_LABELS = {
    "osWindow": "Session",
    "tab": "Window",
    "window": "Pane",
    "createWindow": "New Session",
    "createTab": "New Window",
    "createSplit": "New Split",
}

# tmux escapes control characters in -F output, so use a printable separator
# that does not occur in pane titles or paths.
TMUX_FIELD_SEPARATOR = "\u241f"
TMUX_PANE_FORMAT = TMUX_FIELD_SEPARATOR.join(
    [
        "#{session_id}",
        "#{session_name}",
        "#{session_attached}",
        "#{window_id}",
        "#{window_index}",
        "#{window_name}",
        "#{window_active}",
        "#{pane_id}",
        "#{pane_index}",
        "#{pane_active}",
        "#{pane_title}",
        "#{pane_current_path}",
        "#{pane_current_command}",
        "#{pane_pid}",
        "#{pane_width}",
        "#{pane_height}",
        "#{window_panes}",
        "#{alternate_on}",
        "#{window_zoomed_flag}",
        "#{window_width}",
        "#{window_height}",
    ]
)

TMUX_BINARY_CACHE = None


def get_tmux_binary():
    global TMUX_BINARY_CACHE
    if TMUX_BINARY_CACHE:
        return TMUX_BINARY_CACHE
    preferred = PAYLOAD.get("tmuxBinary") or "tmux"
    if os.path.isabs(preferred) and os.path.exists(preferred):
        TMUX_BINARY_CACHE = preferred
    elif shutil.which(preferred):
        TMUX_BINARY_CACHE = shutil.which(preferred)
    elif preferred != "tmux" and shutil.which("tmux"):
        TMUX_BINARY_CACHE = shutil.which("tmux")
    else:
        raise RuntimeError(f"tmux binary not found: {preferred}")
    return TMUX_BINARY_CACHE


def run_tmux(args, socket, stdin_text=None):
    command = [get_tmux_binary(), "-S", socket, *args]
    completed = subprocess.run(
        command,
        input=stdin_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "tmux command failed")
    return completed.stdout


def tmux_numeric_id(value):
    return int(str(value).lstrip("$@%"))


def tmux_pane_target(window_id):
    return f"%{int(window_id)}"


def tmux_attached_session_ids(socket):
    """Sessions with a real (non control-mode) client; the deck's own watchers are control clients."""
    attached = set()
    output = run_tmux(["list-clients", "-F", TMUX_FIELD_SEPARATOR.join(["#{session_id}", "#{client_control_mode}"])], socket)
    for line in output.splitlines():
        session_id, _, control = line.partition(TMUX_FIELD_SEPARATOR)
        if session_id and control.strip() != "1":
            attached.add(session_id)
    return attached


def tmux_tree(socket):
    output = run_tmux(["list-panes", "-a", "-F", TMUX_PANE_FORMAT], socket)
    attached_ids = tmux_attached_session_ids(socket)
    sessions = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        fields = line.split(TMUX_FIELD_SEPARATOR)
        if len(fields) != 21:
            continue
        (
            session_id, session_name, session_attached,
            window_id, window_index, window_name, window_active,
            pane_id, pane_index, pane_active, pane_title, pane_path, pane_command, pane_pid,
            pane_width, pane_height, window_panes, alternate_on, window_zoomed,
            window_width, window_height,
        ) = fields
        attached = session_id in attached_ids
        session = sessions.setdefault(
            session_id,
            {
                "id": tmux_numeric_id(session_id),
                "title": session_name,
                "is_focused": attached,
                "tabs": [],
                "_windows": {},
            },
        )
        window = session["_windows"].get(window_id)
        if window is None:
            window = {
                "id": tmux_numeric_id(window_id),
                "index": int(window_index),
                "title": window_name,
                "is_focused": window_active == "1",
                "layout": f"{window_panes} panes" if int(window_panes or 1) > 1 else "",
                "columns": int(window_width or 0),
                "lines": int(window_height or 0),
                "zoomed": window_zoomed == "1",
                "windows": [],
            }
            session["_windows"][window_id] = window
            session["tabs"].append(window)
        is_active = pane_active == "1"
        window["windows"].append(
            {
                "id": tmux_numeric_id(pane_id),
                "index": int(pane_index),
                "title": pane_title or window_name,
                "cwd": pane_path,
                "pid": int(pane_pid or 0),
                "is_active": is_active,
                "is_focused": is_active and window_active == "1" and attached,
                "is_attached": attached,
                # Alternate-screen apps (Claude Code's fullscreen renderer) have no tmux history.
                "alternate_on": alternate_on == "1",
                # Zoom gives one pane the whole window; only the active pane is zoomed.
                "zoomed": window_zoomed == "1" and is_active,
                "pane_count": int(window_panes or 1),
                "columns": int(pane_width or 0),
                "lines": int(pane_height or 0),
                "window_columns": int(window_width or 0),
                "window_lines": int(window_height or 0),
                "cmdline": [pane_command] if pane_command else [],
                "foreground_processes": [{"cmdline": [pane_command]}] if pane_command else [],
            }
        )
    tree = []
    for session in sessions.values():
        session.pop("_windows", None)
        tree.append(session)
    return tree


def tmux_pane_geometry(window_id, socket):
    output = run_tmux(
        ["display-message", "-p", "-t", tmux_pane_target(window_id), "#{history_size} #{pane_height}"],
        socket,
    ).strip()
    history, _, height = output.partition(" ")
    return int(history or 0), int(height or 0)


def tmux_capture(window_id, socket, extent, scroll_offset=0):
    target = tmux_pane_target(window_id)
    args = ["capture-pane", "-p", "-e", "-t", target]
    if extent == "all":
        args.extend(["-S", "-"])
        return run_tmux(args, socket), 0
    history, height = tmux_pane_geometry(window_id, socket)
    offset = max(0, min(int(scroll_offset or 0), history))
    if offset:
        # Line 0 is the top of the visible screen; negative numbers reach into history.
        args.extend(["-S", str(-offset), "-E", str(height - 1 - offset)])
    return run_tmux(args, socket), offset


def tmux_action_test():
    sockets = discover_sockets()
    selected_socket = resolve_socket(PAYLOAD.get("socket") or "") if sockets else ""
    tree = tmux_tree(selected_socket) if selected_socket else []
    return {
        "host": subprocess.run(["hostname"], stdout=subprocess.PIPE, text=True, check=False).stdout.strip(),
        "user": os.environ.get("USER") or os.environ.get("LOGNAME") or "",
        "backend": "tmux",
        "tmuxBinary": get_tmux_binary(),
        "socketPattern": SOCKET_PATTERN,
        "sockets": sockets,
        "selectedSocket": selected_socket,
        "sessionCount": len(tree),
        "windowCount": count_windows(tree),
        "labels": TMUX_LABELS,
        "checkedAt": utc_now(),
    }


def tmux_action_list_sessions():
    sockets = discover_sockets()
    selected_socket = resolve_socket(PAYLOAD.get("socket") or "")
    return {
        "backend": "tmux",
        "labels": TMUX_LABELS,
        "sockets": sockets,
        "selectedSocket": selected_socket,
        "tree": tmux_tree(selected_socket),
        "discoveredAt": utc_now(),
    }


def tmux_window_layout(window_id, socket):
    # Geometry of every pane in the selected pane's window, as tmux lays them out.
    # A zoomed window shows only its active pane at full size.
    target = tmux_pane_target(window_id)
    fmt = TMUX_FIELD_SEPARATOR.join([
        "#{pane_id}", "#{pane_left}", "#{pane_top}", "#{pane_width}", "#{pane_height}",
        "#{pane_active}", "#{alternate_on}", "#{pane_title}",
        "#{window_width}", "#{window_height}", "#{window_zoomed_flag}",
    ])
    panes = []
    window = {"columns": 0, "rows": 0, "zoomed": False}
    for line in run_tmux(["list-panes", "-t", target, "-F", fmt], socket).splitlines():
        fields = line.split(TMUX_FIELD_SEPARATOR)
        if len(fields) != 11:
            continue
        pane_id, left, top, width, height, active, alt, title, win_w, win_h, zoomed = fields
        window = {"columns": int(win_w or 0), "rows": int(win_h or 0), "zoomed": zoomed == "1"}
        if zoomed == "1" and active != "1":
            continue
        panes.append({
            "id": tmux_numeric_id(pane_id),
            "left": 0 if zoomed == "1" else int(left or 0),
            "top": 0 if zoomed == "1" else int(top or 0),
            "columns": int(width or 0),
            "rows": int(height or 0),
            "active": active == "1",
            "alternate_on": alt == "1",
            "title": title,
        })
    return window, panes


def tmux_action_get_screen():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    extent = PAYLOAD.get("extent") or "screen"
    text, offset = tmux_capture(window_id, socket, extent, PAYLOAD.get("scrollOffset") or 0)
    result = {"socket": socket, "windowId": window_id, "text": text, "format": "ansi", "scrollOffset": offset}
    if extent == "screen":
        # Screen extent reproduces the whole tmux window: every pane in place.
        window, panes = tmux_window_layout(window_id, socket)
        for pane in panes:
            pane["text"] = text if pane["id"] == window_id else tmux_capture(pane["id"], socket, "screen", 0)[0]
        result["window"] = window
        result["panes"] = panes
    return result


def tmux_pane_alternate_on(window_id, socket):
    value = run_tmux(["display-message", "-p", "-t", tmux_pane_target(window_id), "#{alternate_on}"], socket).strip()
    return value == "1"


def tmux_action_scroll_window():
    # tmux has no viewport for a non-attached viewer, so the deck keeps a scroll
    # offset per pane and captures the matching history window. This never puts
    # the pane into copy mode, so attached terminals are unaffected.
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    lines = int(PAYLOAD.get("lines") or 0)
    offset = int(PAYLOAD.get("scrollOffset") or 0)
    target = tmux_pane_target(window_id)
    if tmux_pane_alternate_on(window_id, socket):
        # Alternate-screen apps (Claude Code fullscreen, less, vim) keep no tmux
        # history; they scroll themselves. PgUp/PgDn move half a screen each.
        if PAYLOAD.get("toEnd"):
            run_tmux(["send-keys", "-t", target, "C-End"], socket)
        elif lines:
            _, height = tmux_pane_geometry(window_id, socket)
            pages = max(1, round(abs(lines) / max(1, height // 2)))
            key = "PPage" if lines < 0 else "NPage"
            for _ in range(min(pages, 8)):
                run_tmux(["send-keys", "-t", target, key], socket)
        text, _ = tmux_capture(window_id, socket, "screen", 0)
        return {
            "socket": socket,
            "windowId": window_id,
            "lines": lines,
            "text": text,
            "format": "ansi",
            "scrollOffset": 0,
            "alternateScreen": True,
        }
    if PAYLOAD.get("toEnd"):
        offset = 0
    else:
        offset = max(0, offset - lines)
    text, offset = tmux_capture(window_id, socket, "screen", offset)
    return {
        "socket": socket,
        "windowId": window_id,
        "lines": lines,
        "text": text,
        "format": "ansi",
        "scrollOffset": offset,
    }


def tmux_action_send_text():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    text = PAYLOAD.get("text") or ""
    target = tmux_pane_target(window_id)
    if text:
        # load-buffer keeps the text verbatim; paste-buffer -p brackets it when the
        # application asked for bracketed paste, matching kitty's `--bracketed-paste auto`.
        buffer_name = f"krd-{os.getpid()}"
        run_tmux(["load-buffer", "-b", buffer_name, "-"], socket, stdin_text=text)
        run_tmux(["paste-buffer", "-d", "-p", "-b", buffer_name, "-t", target], socket)
    if PAYLOAD.get("appendNewline"):
        run_tmux(["send-keys", "-t", target, "Enter"], socket)
    return {"socket": socket, "windowId": window_id, "sentLength": len(text)}


TMUX_KEY_NAMES = {
    "enter": "Enter",
    "return": "Enter",
    "escape": "Escape",
    "esc": "Escape",
    "tab": "Tab",
    "backspace": "BSpace",
    "delete": "DC",
    "insert": "IC",
    "space": "Space",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "home": "Home",
    "end": "End",
    "page_up": "PgUp",
    "pageup": "PgUp",
    "page_down": "PgDn",
    "pagedown": "PgDn",
}


def tmux_key_name(key):
    # Translate kitty-style key names (ctrl+c, shift+left, alt+up) to tmux names.
    parts = [part for part in str(key or "enter").strip().lower().split("+") if part]
    if not parts:
        parts = ["enter"]
    base = parts[-1]
    modifiers = set(parts[:-1])
    if base == "tab" and "shift" in modifiers:
        modifiers.discard("shift")
        name = "BTab"
    elif base in TMUX_KEY_NAMES:
        name = TMUX_KEY_NAMES[base]
    elif len(base) == 1:
        name = base.upper() if "shift" in modifiers and base.isalpha() else base
        modifiers.discard("shift")
    elif base.startswith("f") and base[1:].isdigit():
        name = base.upper()
    else:
        raise RuntimeError(f"Unsupported key for tmux: {key}")
    prefix = ""
    if "ctrl" in modifiers or "control" in modifiers:
        prefix += "C-"
    if "alt" in modifiers or "opt" in modifiers or "meta" in modifiers:
        prefix += "M-"
    if "shift" in modifiers:
        prefix += "S-"
    return prefix + name


def tmux_action_send_key():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    keys = key_sequence()
    target = tmux_pane_target(window_id)
    send_key_sequence(lambda names: run_tmux(["send-keys", "-t", target, *names], socket), [tmux_key_name(key) for key in keys])
    return {"socket": socket, "windowId": window_id, "key": keys[0], "keys": keys, "repeat": len(keys)}


def tmux_action_focus_window():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    target = tmux_pane_target(window_id)
    run_tmux(["select-window", "-t", target], socket)
    run_tmux(["select-pane", "-t", target], socket)
    return {"socket": socket, "windowId": window_id}


def tmux_action_create_panel():
    kind = (PAYLOAD.get("kind") or "window").strip().lower()
    socket = resolve_socket(PAYLOAD.get("socket") or "")

    if kind == "window":
        # Without -c the session would inherit this helper's cwd (the deck's own
        # directory locally, or wherever ssh landed); a fresh session starts at home.
        pane_id = run_tmux(
            ["new-session", "-d", "-c", os.path.expanduser("~"), "-P", "-F", "#{pane_id}"], socket
        ).strip()
        return {"socket": socket, "kind": kind, "windowId": tmux_numeric_id(pane_id)}

    source_window_id = optional_positive_int("sourceWindowId")
    if source_window_id is None:
        raise RuntimeError("sourceWindowId is required.")
    source = tmux_pane_target(source_window_id)
    info = run_tmux(
        [
            "display-message", "-p", "-t", source,
            TMUX_FIELD_SEPARATOR.join(["#{window_id}", "#{pane_width}", "#{pane_height}", "#{pane_current_path}"]),
        ],
        socket,
    ).rstrip("\n").split(TMUX_FIELD_SEPARATOR)
    source_window, width, height, cwd = (info + ["", "", "", ""])[:4]
    cwd_args = ["-c", cwd] if cwd else []

    if kind == "tab":
        # new-window takes a window target, not a pane; -a inserts after it.
        pane_id = run_tmux(
            ["new-window", "-a", "-t", source_window, *cwd_args, "-P", "-F", "#{pane_id}"],
            socket,
        ).strip()
        return {
            "socket": socket,
            "kind": kind,
            "sourceWindowId": source_window_id,
            "windowId": tmux_numeric_id(pane_id),
        }

    if kind == "split":
        tab_id = optional_positive_int("tabId")
        if tab_id is None:
            raise RuntimeError("tabId is required.")
        orientation = "-h" if int(width or 0) >= 2 * int(height or 1) else "-v"
        pane_id = run_tmux(
            ["split-window", orientation, "-t", source, *cwd_args, "-P", "-F", "#{pane_id}"],
            socket,
        ).strip()
        return {
            "socket": socket,
            "kind": kind,
            "tabId": tab_id,
            "sourceWindowId": source_window_id,
            "windowId": tmux_numeric_id(pane_id),
        }

    raise RuntimeError("kind must be one of: window, tab, split.")


def tmux_action_resize_window():
    # Match the pane to the browser's cell grid. Detached sessions resize freely;
    # attached ones only with force, which pins window-size to manual so the
    # attached client stops winning the size back.
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    columns = max(20, min(int(PAYLOAD.get("columns") or 0), 500))
    rows = max(5, min(int(PAYLOAD.get("rows") or 0), 300))
    force = bool(PAYLOAD.get("force"))
    target = tmux_pane_target(window_id)
    size_format = TMUX_FIELD_SEPARATOR.join(
        [
            "#{window_id}", "#{session_id}", "#{window_width}", "#{window_height}", "#{window-size}",
            "#{window_panes}", "#{window_zoomed_flag}", "#{pane_active}",
        ]
    )
    info = run_tmux(["display-message", "-p", "-t", target, size_format], socket).rstrip("\n").split(TMUX_FIELD_SEPARATOR)
    window, session_id, width, height, size_mode, pane_count, zoomed_flag, pane_active = (info + [""] * 8)[:8]
    attached = session_id in tmux_attached_session_ids(socket)
    pane_count = int(pane_count or 1)
    result = {
        "socket": socket,
        "windowId": window_id,
        "attached": attached,
        "columns": int(width or 0),
        "rows": int(height or 0),
        "requestedColumns": columns,
        "requestedRows": rows,
    }
    if attached and not force:
        result["skipped"] = True
        result["reason"] = "attached"
        return result
    if attached and size_mode != "manual":
        run_tmux(["set-option", "-w", "-t", window, "window-size", "manual"], socket)
    run_tmux(["resize-window", "-t", window, "-x", str(columns), "-y", str(rows)], socket)
    after = run_tmux(
        ["display-message", "-p", "-t", target, TMUX_FIELD_SEPARATOR.join(["#{window_width}", "#{window_height}", "#{window_zoomed_flag}"])],
        socket,
    ).rstrip("\n").split(TMUX_FIELD_SEPARATOR)
    result["columns"] = int((after + [""])[0] or 0)
    result["rows"] = int((after + ["", ""])[1] or 0)
    result["zoomed"] = (after + ["", "", ""])[2] == "1"
    result["paneCount"] = pane_count
    result["manualSize"] = attached
    return result


def tmux_action_toggle_zoom():
    # Same as prefix-z: zoom the pane, or unzoom the window if it is zoomed.
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    target = tmux_pane_target(window_id)
    run_tmux(["resize-pane", "-Z", "-t", target], socket)
    zoomed = run_tmux(["display-message", "-p", "-t", target, "#{window_zoomed_flag}"], socket).strip() == "1"
    return {"socket": socket, "windowId": window_id, "zoomed": zoomed}


def tmux_action_close_panel():
    kind = (PAYLOAD.get("kind") or "pane").strip().lower()
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    ident = int(PAYLOAD["id"])
    commands = {"session": ("kill-session", f"${ident}"), "tab": ("kill-window", f"@{ident}"), "pane": ("kill-pane", f"%{ident}")}
    if kind not in commands:
        raise RuntimeError(f"Unsupported close kind: {kind}")
    command, target = commands[kind]
    run_tmux([command, "-t", target], socket)
    return {"socket": socket, "kind": kind, "id": ident}


def tmux_action_describe_window():
    """Where a deck pane lives, for the server's control-mode watcher."""
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    fmt = TMUX_FIELD_SEPARATOR.join(["#{session_id}", "#{session_name}", "#{window_id}", "#{pane_id}"])
    info = run_tmux(["display-message", "-p", "-t", tmux_pane_target(window_id), fmt], socket).rstrip("\n").split(TMUX_FIELD_SEPARATOR)
    session_id, session_name, tmux_window, pane = (info + [""] * 4)[:4]
    return {
        "socket": socket,
        "windowId": window_id,
        "sessionId": session_id,
        "sessionName": session_name,
        "tmuxWindowId": tmux_window,
        "paneId": pane,
        "tmuxBinary": get_tmux_binary(),
    }


TMUX_ACTIONS = {
    "test": tmux_action_test,
    "describe_window": tmux_action_describe_window,
    "resize_window": tmux_action_resize_window,
    "toggle_zoom": tmux_action_toggle_zoom,
    "close_panel": tmux_action_close_panel,
    "list_sessions": tmux_action_list_sessions,
    "get_screen": tmux_action_get_screen,
    "scroll_window": tmux_action_scroll_window,
    "send_text": tmux_action_send_text,
    "send_key": tmux_action_send_key,
    "focus_window": tmux_action_focus_window,
    "create_panel": tmux_action_create_panel,
}


ACTIONS = {
    "test": action_test,
    "fetch_url": action_fetch_url,
    "fetch_url_resource": action_fetch_url_resource,
    "list_sessions": action_list_sessions,
    "get_screen": action_get_screen,
    "scroll_window": action_scroll_window,
    "send_text": action_send_text,
    "send_key": action_send_key,
    "focus_window": action_focus_window,
    "create_panel": action_create_panel,
    "close_panel": action_close_panel,
}


if BACKEND not in ("kitty", "tmux"):
    respond(False, error=f"Unsupported backend: {BACKEND}")
    sys.exit(0)

if BACKEND == "tmux":
    ACTIONS = {**ACTIONS, **TMUX_ACTIONS}

try:
    if ACTION not in ACTIONS:
        raise RuntimeError(f"Unsupported action: {ACTION}")
    respond(True, ACTIONS[ACTION]())
except Exception as error:
    respond(False, error=str(error))
