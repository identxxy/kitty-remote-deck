import base64
import glob
import json
import mimetypes
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse
from urllib.request import Request, url2pathname, urlopen


MAX_PREVIEW_BYTES = 10_000_000


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
SOCKET_PATTERN = PAYLOAD.get("socketPattern") or "/tmp/kitty.sock-*"
DEFAULT_SOCKET = PAYLOAD.get("defaultSocket") or ""


def get_kitty_binary():
    global KITTY_BINARY_CACHE
    if not KITTY_BINARY_CACHE:
        KITTY_BINARY_CACHE = discover_kitty_binary()
    return KITTY_BINARY_CACHE


def discover_sockets():
    sockets = [path for path in glob.glob(SOCKET_PATTERN) if os.path.exists(path)]
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
    raise RuntimeError(f"No kitty sockets found for pattern {SOCKET_PATTERN}")


def run_kitty(args, socket=None):
    command = [get_kitty_binary(), "@", "--to", f"unix:{socket}", *args]
    completed = subprocess.run(
        command,
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


def fetch_file_url(url, parsed):
    if parsed.netloc and parsed.netloc not in ("localhost", "127.0.0.1"):
        raise RuntimeError("file:// URLs must point to the selected host.")

    file_path = url2pathname(unquote(parsed.path))
    if not file_path:
        raise RuntimeError("file:// URL is missing a path.")

    raw, truncated = read_limited_bytes(file_path)
    content_type = mimetypes.guess_type(file_path)[0] or "text/plain"
    return make_fetch_response(url, url, raw, content_type, truncated)


def fetch_http_url(url):
    request = Request(url, headers={"User-Agent": "KittyRemoteDeck/0.1"})
    with urlopen(request, timeout=15) as response:
        raw = response.read(MAX_PREVIEW_BYTES + 1)
        truncated = len(raw) > MAX_PREVIEW_BYTES
        raw = raw[:MAX_PREVIEW_BYTES]
        content_type = response.headers.get("content-type") or "application/octet-stream"
        return make_fetch_response(url, response.geturl(), raw, content_type, truncated)


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


def action_list_sessions():
    sockets = discover_sockets()
    selected_socket = resolve_socket(PAYLOAD.get("socket") or "")
    tree = json.loads(run_kitty(["ls"], socket=selected_socket))
    return {
        "sockets": sockets,
        "selectedSocket": selected_socket,
        "tree": tree,
        "discoveredAt": utc_now(),
    }


def action_get_screen():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    text = run_kitty(
        [
            "get-text",
            "--match",
            f"id:{window_id}",
            "--extent",
            PAYLOAD.get("extent") or "screen",
        ],
        socket=socket,
    )
    return {"socket": socket, "windowId": window_id, "text": text}


def action_scroll_window():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    lines = int(PAYLOAD.get("lines") or 0)
    amount = min(abs(lines), 120)

    if amount:
        suffix = "-" if lines < 0 else ""
        run_kitty(["scroll-window", "--match", f"id:{window_id}", f"{amount}{suffix}"], socket=socket)

    text = run_kitty(
        [
            "get-text",
            "--match",
            f"id:{window_id}",
            "--extent",
            "screen",
        ],
        socket=socket,
    )
    return {"socket": socket, "windowId": window_id, "lines": lines, "text": text}


def action_send_text():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    text = PAYLOAD.get("text") or ""
    if PAYLOAD.get("appendNewline"):
        text += "\n"
    run_kitty(["send-text", "--match", f"id:{window_id}", text], socket=socket)
    return {"socket": socket, "windowId": window_id, "sentLength": len(text)}


def action_send_key():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    key = PAYLOAD.get("key") or "enter"
    run_kitty(["send-key", "--match", f"id:{window_id}", key], socket=socket)
    return {"socket": socket, "windowId": window_id, "key": key}


def action_focus_window():
    window_id = int(PAYLOAD["windowId"])
    socket = resolve_socket(PAYLOAD.get("socket") or "")
    run_kitty(["focus-window", "--match", f"id:{window_id}"], socket=socket)
    return {"socket": socket, "windowId": window_id}


ACTIONS = {
    "test": action_test,
    "fetch_url": action_fetch_url,
    "list_sessions": action_list_sessions,
    "get_screen": action_get_screen,
    "scroll_window": action_scroll_window,
    "send_text": action_send_text,
    "send_key": action_send_key,
    "focus_window": action_focus_window,
}


try:
    if ACTION not in ACTIONS:
        raise RuntimeError(f"Unsupported action: {ACTION}")
    respond(True, ACTIONS[ACTION]())
except Exception as error:
    respond(False, error=str(error))
