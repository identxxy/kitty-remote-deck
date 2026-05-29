# Embedded Browser Proxy

Kitty Remote Deck turns `http://`, `https://`, and `file://` URLs in terminal output into browser links. Clicking a link opens the right-side embedded Browser drawer without leaving the active kitty session.

## User Flow

1. Select a Local or SSH target.
2. Open a KT session pane.
3. Click a URL shown in the terminal text, or type a URL into the Browser address bar.
4. The right-side Browser drawer slides in and embeds the page in an iframe.
5. Hide the drawer with `x`.
6. Use the small right-edge `Browser` handle to reopen the last page.
7. Use back/forward buttons or the history menu to move through the local Browser history.
8. Pin the Browser when it should stay open as a fixed right-side column. Unpinned Browser panels close when another part of the workbench is clicked or focused.
9. Enable top-bar Resize mode and drag the Browser left border to change its width.

Address bar input is normalized before loading:

- `https://example.com/report.html` stays unchanged.
- `example.com/report.html` becomes `https://example.com/report.html`.
- `localhost:8080/report.html` becomes `https://localhost:8080/report.html`.
- `/tmp/report.html` becomes `file:///tmp/report.html` on the selected target.

## Target-Side Fetching

Browser fetches happen through the active target:

- Local targets run `server/remote_helper.py` directly on the machine running `server.js`.
- SSH targets stream the same helper over SSH and fetch from the SSH host.

This matters for `file://` URLs and private network URLs. The client browser never reads those paths directly; it asks the server, and the server asks the selected target.

## Resource Proxy

The iframe loads same-origin URLs under:

```text
/api/url-resource?targetId=<target-id>&url=<encoded-url>
```

The proxy supports:

- HTML documents
- CSS stylesheets
- images
- fonts
- JavaScript files requested by the document
- relative links and CSS `url(...)` references

HTML and CSS resources are rewritten in `server/url_proxy.js` so relative paths keep going through `/api/url-resource`. HTML pages also receive a small bridge script that intercepts in-frame link clicks and GET form submissions. The bridge tells the parent app which target URL should be opened next, so the Browser can keep its address bar, forward/back stack, and history menu synchronized while still loading through the same proxy endpoint.

For example:

```html
<link rel="stylesheet" href="style.css">
<img src="images/plot.png">
```

loaded from:

```text
file:///tmp/report/index.html
```

becomes same-origin proxy links for:

```text
file:///tmp/report/style.css
file:///tmp/report/images/plot.png
```

## Security Model

The preview iframe is sandboxed:

```html
sandbox="allow-forms allow-modals allow-popups allow-scripts"
```

It does not receive `allow-same-origin`, so proxied pages cannot read the parent app DOM or cookies as same-origin content. The injected bridge communicates with the parent using `postMessage`; the parent only accepts messages from the Browser iframe and still routes every navigation back through `/api/url-resource`. Device authentication protects the proxy endpoint, because `/api/url-resource` requires a valid device session.

## Limits

- `file://`, `http://`, and `https://` are the only supported URL schemes.
- Large responses are capped in `server/remote_helper.py`.
- HTML and CSS static references are rewritten. Normal anchor clicks and GET forms update the embedded Browser history. Runtime JavaScript that constructs unusual fetch URLs may still need follow-up handling.
- Meta refresh tags are stripped during HTML rewriting to avoid automatic navigation surprises.

## Relevant Files

- `public/app.js`: terminal URL linkification, Browser address bar, forward/back history, pin state, outside-click close behavior, and iframe navigation messages.
- `public/index.html`: right-side Browser drawer markup.
- `public/styles.css`: Browser drawer, address bar, and right-edge reopen handle styling.
- `server.js`: `/api/url-resource` API route.
- `server/url_proxy.js`: HTML/CSS rewriting helpers.
- `server/remote_helper.py`: target-side URL fetching.
- `tests/url_proxy.test.mjs`: rewrite behavior tests.
- `tests/url_relay.test.mjs`: helper fetch behavior tests.
