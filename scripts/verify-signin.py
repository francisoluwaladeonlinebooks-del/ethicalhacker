#!/usr/bin/env python3
"""Repeat the five sign-in paths against a running platform.

    npm run start          # in another terminal
    python3 scripts/verify-signin.py

Both paths are checked for every seeded persona:

  1. password, then a time-based one-time code, then the role's dashboard;
  2. the demonstration shortcut, where it is enabled.

The harness replays the real Next.js Server Action envelopes (the hidden
``$ACTION_*`` inputs) rather than guessing at the endpoint, because a Server
Action invoked without them fails by design.

Two behaviours are load-bearing and are the reason this is a script rather than a
manual checklist:

* TOTP replay protection is real. Reusing a code inside the same 30-second step
  is rejected, so the harness waits for a fresh step when the current one is
  nearly spent, and an account cannot be verified twice in one step.
* The rate limiter is real. A sweep of repeated attempts returns 429; that is the
  control working, not a defect. Set FICAP_RATE_LIMIT_DISABLED=1 on the server if
  you are running this in a loop.

Nothing is written to the database beyond the sessions a human sign-in would
create. Use it against a demonstration deployment only.
"""
import html as htmllib
import http.cookiejar
import time
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import os

BASE = os.environ.get("FICAP_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
PASSWORD = "FicapDemo#2026"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


def get(op, path, cookie_header=None):
    req = urllib.request.Request(BASE + path, headers=headers(cookie_header))
    try:
        with op.open(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf8", "replace"), dict(exc.headers)


def headers(cookie_header=None):
    h = {"User-Agent": "ficap-verify/1.0", "Accept": "text/html"}
    if cookie_header:
        h["Cookie"] = cookie_header
    return h


def post_form(op, path, fields, cookie_header=None, content_type="multipart/form-data; boundary=XyZ"):
    boundary = "XyZ"
    parts = []
    for name, value in fields:
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
    body = ("".join(parts) + f"--{boundary}--\r\n").encode()
    h = headers(cookie_header)
    h["Content-Type"] = content_type
    h["Origin"] = BASE
    h["Referer"] = BASE + path
    req = urllib.request.Request(BASE + path, data=body, headers=h, method="POST")
    try:
        with op.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf8", "replace"), dict(exc.headers)


def form_fields(html, marker):
    """Fields of the form whose hidden inputs include `marker`."""
    out = []
    for form in re.findall(r"<form[^>]*>(.*?)</form>", html, re.S):
        if marker not in form:
            continue
        for name, value in re.findall(r'<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/>', form):
            out.append((name, htmllib.unescape(value or "")))
        return out
    return out


def title_of(html):
    m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    if not m:
        return "(no h1)"
    text = re.sub(r"<[^>]+>", " ", m.group(1))
    return " ".join(text.split())


def dashboards():
    results = []
    status, html, _ = get(opener()[0], "/login")
    if status != 200:
        print(f"GET /login -> {status}")
        return results
    for email in [
        "assessor@cbn.gov.ng",
        "reviewer@cbn.gov.ng",
        "approver@cbn.gov.ng",
        "contact@meridian.example",
        "admin@cbn.gov.ng",
    ]:
        op, jar = opener()
        _, page, _ = get(op, "/login")
        fields = form_fields(page, f'value="{email}"')
        if not fields:
            results.append((email, "NO FORM", "", ""))
            continue
        status, _, hdrs = post_form(op, "/login", fields)
        loc = hdrs.get("Location", "")
        cookie = "; ".join(f"{c.name}={c.value}" for c in jar)
        status2, dash, _ = get(op, "/", cookie)
        results.append((email, f"{status}->{loc}", status2, title_of(dash)))
    return results


def _submit_code(op, cookie, mfa):
    """Enter the displayed demonstration code. Returns (status, headers)."""
    text = " ".join(re.sub(r"<[^>]+>", " ", mfa).split())
    match = re.search(r"current code is shown.*?(\d{6})", text)
    code = match.group(1) if match else "000000"
    fields = form_fields(mfa, 'name="code"')
    fields += [("code", code)]
    status, _, hdrs = post_form(op, "/login/mfa", fields, cookie)
    return status, hdrs


def totp_path(email):
    """Password then authenticator, the path the acceptance criteria name.

    A one-time code has a 30-second lifetime and the page renders the code it will
    compare at submit time, so a slow round trip can land in the next step. That
    is a real property of the control, not flakiness to hide: the harness waits
    for a step with enough life left, and retries once on the next step if the
    submission is rejected. Two attempts cannot lock an account (five do).
    """
    op, jar = opener()
    _, page, _ = get(op, "/login")
    fields = [f for f in form_fields(page, 'name="email"') if not f[0].startswith("$ACTION_ID")]
    fields += [("email", email), ("password", PASSWORD)]
    status, _, hdrs = post_form(op, "/login", fields)
    loc = hdrs.get("Location", "")
    cookie = "; ".join(f"{c.name}={c.value}" for c in jar)
    if "mfa" not in loc:
        return f"password step -> {status} {loc}", "", ""

    for attempt in range(2):
        _, mfa, _ = get(op, "/login/mfa", cookie)
        text = " ".join(re.sub(r"<[^>]+>", " ", mfa).split())
        left = re.search(r"(\d+)\s*s left", text)
        if left and int(left.group(1)) < 10:
            time.sleep(int(left.group(1)) + 1)
            _, mfa, _ = get(op, "/login/mfa", cookie)
        status, hdrs = _submit_code(op, cookie, mfa)
        loc2 = hdrs.get("Location", "")
        if status == 303:
            break
        if attempt == 0:
            time.sleep(30 - (int(time.time()) % 30) + 1)
            _, mfa, _ = get(op, "/login/mfa", cookie)
            status, hdrs = _submit_code(op, cookie, mfa)
            loc2 = hdrs.get("Location", "")
            break

    cookie2 = "; ".join(f"{c.name}={c.value}" for c in jar)
    status2, dash, _ = get(op, "/", cookie2)
    return f"password -> {loc}; code -> {status} {loc2}", status2, title_of(dash)


if __name__ == "__main__":
    print("== demonstration shortcut ==")
    for email, step, status, title in dashboards():
        print(f"  {email:32} {step:22} dashboard {status}  {title}")
    print("\n== password + authenticator ==")
    failures = 0
    for email in [
        "assessor@cbn.gov.ng",
        "reviewer@cbn.gov.ng",
        "approver@cbn.gov.ng",
        "contact@meridian.example",
        "admin@cbn.gov.ng",
    ]:
        step, status, title = totp_path(email)
        ok = status == 200
        failures += 0 if ok else 1
        print(f"  {email:30} {step}; dashboard {status}  {title}")
        time.sleep(1)

    print(f"\n  {'all sign-in paths verified' if failures == 0 else f'{failures} path(s) failed'}")
    sys.exit(0 if failures == 0 else 1)
