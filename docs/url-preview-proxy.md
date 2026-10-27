# Embedded Browser

Terminal Dock turns `http://`, `https://`, and `file://` URLs in terminal output into links, and opens them in the embedded Browser on the right without leaving the terminal. The Browser is also a view of its own: the bottom button of the activity bar lists the pages opened so far (`Reports`) and has an address field for paths and URLs. The list is stored on the server (`data/reports.json`), so a report written by an agent on the desk shows up on the iPad.

## User Flow

1. Select a target. Browser fetches happen through it: Local targets read the server machine, SSH targets stream the helper to the remote host.
2. Click a URL in the terminal, enter a path or URL in the Browser view (`/tmp/report.html`, `~/reports/` style paths become `file://` URLs on the target), or pick a report from the list.
3. The Browser drawer embeds the page. In-page links and GET forms navigate inside the drawer; back/forward and the history menu move through what was opened from the same root.
4. A directory path shows a file listing (folders first) whose entries open in the drawer.
5. Pin the drawer to keep it as a fixed column; unpinned drawers close when the rest of the workbench is used, except the Browser view itself. The Browser button in the activity bar reopens the last page.
6. Each loaded page records itself in `Reports` with its title; entries can be pinned to the top or removed.

Address bar input is normalized before loading:

- `https://example.com/report.html` stays unchanged.
- `example.com/report.html` becomes `https://example.com/report.html`.
- `localhost:8080/report.html` becomes `https://localhost:8080/report.html`.
- `/tmp/report.html` becomes `file:///tmp/report.html` on the selected target.

## Proxy URLs

Pages load from same-origin proxy URLs shaped like paths:

```text
/p/<targetId>/<access token>/<scheme>/<host or ->/<path>?<query>
```

For example `file:///tmp/report/index.html` on target `mc-tmux` becomes `/p/mc-tmux/<token>/file/-/tmp/report/index.html`. Because the proxy URL mirrors the target URL's path, every relative reference resolves in the browser on its own: `data.json` requested from that page lands on `/p/mc-tmux/<token>/file/-/tmp/report/data.json`, whether it comes from markup, a stylesheet, `fetch()`, `XMLHttpRequest`, an ES module `import`, a web worker script, `srcset` or an element created at runtime. The older `/api/url-resource?targetId=&url=` form is still served for history entries that predate the path form.

`server/url_proxy.js` still rewrites HTML and CSS for the references the browser cannot resolve on its own: absolute target URLs (`file:///...`, `http://localhost:8080/...`), root-relative paths (`/assets/x.css`) and CSS `@import` strings. The page also receives a bridge script, injected first in `<head>`, that:

- reroutes runtime `fetch()`, `XMLHttpRequest` and `EventSource` calls whose URL is an absolute target URL or a root-relative path;
- rewrites `src`/`href`/`poster`/`data` attributes on elements added or changed after load (`img.src = "file:///..."`);
- intercepts link clicks and GET form submits so the drawer, the address bar and the history stay in sync;
- reports the page's title to the Reports list, including titles set later by script.

Which host fetches a resource:

- `file://` always goes through the target.
- `http(s)://` goes through the target when the host is private (loopback, RFC 1918, link-local, CGNAT and Tailscale ranges, ULA IPv6, bare hostnames, `.local`, `.lan`, `.internal`, `.home.arpa`, `.ts.net`) or the same host the document came from.
- Other `http(s)://` hosts, typically CDNs such as `cdn.jsdelivr.net` or `cdn.plot.ly`, are loaded directly by the viewing browser. A report on a GPU box without internet access still renders if the iPad has internet; a report that needs a private service on that box goes through the box.

The proxy serves HTML, CSS, JavaScript, JSON, images, fonts and media (with byte-range requests for playback and seeking). Proxied subresources carry `crossorigin="anonymous"` because the sandboxed frame has an opaque origin.

## Access Tokens

The frame is sandboxed without `allow-same-origin`, so its requests do not carry the device cookie. `/api/url-access-token` issues a signed token scoped to the target and the opened URL's directory prefix (`KRD_PREVIEW_ACCESS_TTL_MS`, default two hours); the token travels in the proxy path, so every relative resource is authorized automatically. Resources outside that directory (`../shared/lib.js`) need the device cookie and are refused from inside the frame. Navigating to another page issues a new token for that page's directory.

## Security Model

```html
sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-scripts"
```

Proxied pages run with an opaque origin: they cannot read the parent app, its cookies or `localStorage`, and `Worker`/`SharedWorker` creation fails the same-origin check. Scripts, inline or external, do run. The bridge communicates over `postMessage`; the parent accepts messages only from its own frame and routes every navigation back through the proxy. `meta http-equiv="refresh"` is stripped.

## Limits

- `file://`, `http://`, and `https://` only.
- Large non-local responses are capped in `server/remote_helper.py` (10 MB documents, 8 MB resources).
- `localStorage`, `sessionStorage`, IndexedDB and web workers are unavailable to proxied pages (opaque origin).
- Pages that compute absolute URLs for a public host and expect the target to fetch them (for example a public hostname only resolvable inside the target's network) load directly from the viewer instead.

## Relevant Files

- `public/app.js`: terminal URL linkification, Browser view and Reports list, address bar, history, pin state, iframe messages.
- `public/index.html`: Browser view in the sidebar and the right-side drawer.
- `server.js`: `/p/...` and `/api/url-resource` routes, access tokens, `/api/reports` routes.
- `server/url_proxy.js`: proxy URL form, host heuristic, HTML/CSS rewriting, bridge script.
- `server/reports.js`: the Reports store.
- `server/remote_helper.py`: target-side fetching and directory listings.
- `tests/url_proxy.test.mjs`, `tests/url_relay.test.mjs`, `tests/reports.test.mjs`.
