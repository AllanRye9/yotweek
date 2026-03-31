# YouTube Download Error — Solutions Log

This file tracks every YouTube-related error that has been encountered and fixed
in this repository, in chronological order.  It is intended as a reference for
future debugging sessions so that past fixes can be located quickly and
regressions can be diagnosed without re-reading the full PR history.

---

## PR #12 — `Fix YouTube bot detection error: update yt-dlp and use ios player client`

**Commit:** `b45adb6`

**Error:** YouTube returned a "Sign in to confirm you're not a bot" error when
using the `android` + `web` player clients.

**Fix:**
- Updated yt-dlp to the latest version.
- Switched `player_client` from `["android", "web"]` to `["ios", "web"]` to
  evade bot detection.

---

## PR #13 — `Fix YouTube bot detection by switching player clients to android/tv_embedded and adding PO token support`

**Commit:** `2721568`

**Error:** The `ios` + `web` client combination still triggered YouTube bot
detection in some environments.

**Fix:**
- Introduced the `_get_yt_extractor_args()` helper function.
- Switched `player_client` to `["android", "tv_embedded"]`.
- Added optional `YOUTUBE_PO_TOKEN` and `YOUTUBE_VISITOR_DATA` environment
  variables for Proof-of-Origin token support.

---

## PR #14 — `Fix YouTube downloads, remove cookies, move Downloaded Videos below Start Download button`

**Commit:** `95f91b0`

**Error:** Stale cookie handling caused failures; cookie state was interfering
with downloads.

**Fix:**
- Removed cookie-based download paths to simplify the flow.
- Cleaned up cookie-related code that was causing conflicts.

---

## PR #19 — `Fix YouTube 403 error, add country tracking for downloads, improve analytics UI`

**Commit:** `a5735b5`

**Error:** HTTP 403 Forbidden from YouTube CDN during video data download.

**Fix:**
- Added detection of HTTP 403 patterns in the error handler.
- Implemented retry logic with alternative player clients when a 403 is
  encountered.

---

## PR #20 — `Fix YouTube 'Requested format is not available' error with format fallback chains`

**Commit:** `7569db6`

**Error:** yt-dlp reported "Requested format is not available" when the
preferred format was unavailable for certain videos.

**Fix:**
- Implemented format fallback chains so that if the first format specifier
  fails, yt-dlp automatically retries with progressively less strict format
  selectors (e.g. `bestvideo+bestaudio/best`).

---

## PR #21 — `Fix YouTube bot detection: revert player clients to android_vr/web/web_safari`

**Commit:** `fe389d0`

**Error:** The `android` + `tv_embedded` client combination introduced in PR #13
started triggering bot detection.

**Fix:**
- Reverted `player_client` to `["android_vr", "web", "web_safari"]`, which
  proved more reliable for unauthenticated server environments.

---

## PR #53 — `Add cookie file support for YouTube bot-detection bypass`

**Commit:** `1f30c55`

**Error:** YouTube continued to block downloads in certain server environments
where IP-level bot detection was active.

**Fix:**
- Added `COOKIES_FILE` path constant and `DATA_DIR`.
- Added `_get_cookie_opts()` helper that returns `cookiefile` when a valid
  cookies file exists on disk.
- Updated all yt-dlp option dictionaries to include the cookie file when
  present.
- Added admin API endpoints for cookie management: `GET /admin/cookies/status`,
  `POST /admin/cookies/upload`, `DELETE /admin/cookies`.

---

## PR #54 — `Fix YouTube bot-detection error with user-friendly cookie message`

**Commit:** `b04c899`

**Error:** Bot-detection errors were shown to users as raw yt-dlp tracebacks.

**Fix:**
- Added detection of bot-detection patterns in error messages.
- Replaced cryptic error output with a user-friendly message explaining that a
  cookie file can be uploaded to bypass the restriction.

---

## PR #63 — `Fix YouTube auth error: use yt-dlp default player clients, add playlist throttling, update Chrome UA and yt-dlp version`

**Commit:** `5d56286`

**Error:** The hardcoded `["android_vr", "web", "web_safari"]` clients were
being ignored for authenticated sessions because `android_vr` has
`SUPPORTS_COOKIES=False`, causing yt-dlp to silently drop it.

**Fix:**
- Changed `_get_yt_extractor_args()` to use `player_client: ["default"]` so
  that yt-dlp can auto-select the best client (including `tv_downgraded` for
  authenticated sessions).
- Updated Chrome User-Agent header to match the then-current Chrome version.
- Updated yt-dlp version pin in `requirements.txt`.
- Added playlist throttling to avoid rate-limiting on long playlists.

---

## PR #75 — `Enable Node.js as fallback JS runtime for yt-dlp to fix YouTube auth errors`

**Commit:** `3f0a46c`

**Error:** In environments where `deno` was not installed, yt-dlp had no JS
runtime and fell back to the `android_vr` client only, which YouTube increasingly
blocked with bot detection.

**Fix:**
- Added `js_runtimes: {'deno': {}, 'node': {}}` to yt-dlp options so that
  Node.js is recognised as a fallback JS runtime.
- This allowed yt-dlp to use the `web` / `web_safari` clients when a JS
  runtime was available, enabling higher-quality streams.

---

## PR #76 — `Fix YouTube auth error: update yt-dlp to 2026.3.13 and Chrome UA to 134`

**Commit:** `fbb8939`

**Error:** Older yt-dlp versions failed to authenticate against updated YouTube
endpoints.

**Fix:**
- Updated yt-dlp to version `2026.3.13` in `requirements.txt`.
- Updated the Chrome User-Agent string to Chrome 134.

---

## PR #82 — `Fix YouTube auth error: add web_embedded+tv to player_client for yt-dlp 2026.3.13`

**Commit:** `e25db1c`

**Error:** After the yt-dlp 2026.3.13 update, the `web` and `web_safari`
clients were removed from the unauthenticated defaults and now require PO tokens
for HTTPS/DASH streams.  This meant `player_client: ["default"]` no longer
provided reliable streams without a POT provider.

**Fix:**
- Changed `player_client` to `["default", "web_embedded", "tv"]`.
- `web_embedded` and `tv` have no PO-token requirement and support cookies,
  making them reliable POT-free fallbacks.

---

## PR #81 — `Add DO NOT REMOVE warning comments to critical yt-dlp settings (PR #78)`

**Commit:** `c6296a3`

**Error:** Developers were accidentally removing the `"default"` entry from
`player_client` during refactors, re-introducing the auth error fixed in PR #63.

**Fix:**
- Added prominent `⚠️ DO NOT REMOVE "default"` warning comments to
  `_get_yt_extractor_args()` explaining that `"default"` is required for
  authenticated sessions to use `tv_downgraded`.

---

## PR #134 — `Add YouTube bot-check CI job, /api/youtube_status endpoint, iOS media save routing`

**Commit:** `9fd1f73`

**Error:** There was no visibility into whether YouTube bot-detection was active
in the deployment environment; failures were only discovered when a user
attempted a download.

**Fix:**
- Added a `youtube-bot-check` CI job that probes YouTube with yt-dlp after
  every push.  The job uses `continue-on-error: true` so that a YouTube block
  (an external issue) does not fail the build.
- Added `/api/youtube_status` endpoint so operators can check YouTube
  reachability without reading server logs.

---

## PR #146 — `fix: recognize YouTube throttle error as bot-detection in _AUTH_PATTERNS`

**Commit:** `fca61c9`

**Error:** YouTube sometimes returned "This video cannot be downloaded right
now. Please try again in a few minutes, or try a different video." as a
throttling/bot-detection signal.  This phrase was absent from `_AUTH_PATTERNS`,
so the cookieless-client retry was never triggered and the error was surfaced
directly to the user.

**Fix:**
- Added the throttle-error phrase to `_AUTH_PATTERNS`.
- The cookieless retry path is now triggered for throttle errors in addition to
  explicit "sign in" messages.

---

## PR #149 — `Improve YouTube bot-detection evasion: human-like headers, jitter sleep, broader error patterns`

**Commit:** `063cde5`

**Error:** YouTube's bot-detection became more aggressive; simple client
switching was no longer sufficient to avoid the block in all cases.

**Fix:**
- Added human-like HTTP headers (Accept-Language, sec-fetch-*, etc.) to yt-dlp
  requests.
- Introduced random jitter sleep between retry attempts to mimic human
  behaviour.
- Broadened `_AUTH_PATTERNS` to cover additional bot-detection phrase variants.

---

## PR #155 — `Add mweb YouTube client fallback and extractor args tests`

**Commit:** `baf5f63`

**Error:** Some video formats were only available through the `mweb` client,
causing format-selection failures when `mweb` was absent from the client list.

**Fix:**
- Added `mweb` to the cookieless fallback client list as an additional
  format source.
- Added `TestExtractorArgs` unit tests to prevent accidental removal of
  required clients.

> ⚠️ **Note:** This fix was later superseded by PR #208, which removed `mweb`
> after it was discovered that yt-dlp 2026.3.x requires a GVS PO Token for all
> `mweb` streaming protocols.

---

## PR #157 — `Fix TikTok download: scope YouTube browser headers and cookieless retry to YouTube URLs only`

**Commit:** `726fdc9`

**Error:** The YouTube-specific browser headers and cookieless retry logic were
being applied to TikTok and other platform URLs, causing those downloads to fail
because TikTok rejected the YouTube-specific headers.

**Fix:**
- Added URL-based guards so that YouTube-specific extractor args and headers
  are only injected when the URL hostname matches YouTube domains.

---

## PR #167 — `Fix card animation transitions, add cancellation cleanup, improve alt tool fallback with cancellation support, skip yt-dlp fallbacks when info_error is set`

**Commits:** `5f718ab`, `dc3d500`

**Error:** When a download was cancelled mid-retry, leftover state caused
subsequent download attempts to enter unexpected code paths.  Also, alternative
tool fallbacks (gallery-dl, you-get, streamlink) did not respect cancellation
signals.

**Fix:**
- Scoped YouTube extractor args to YouTube-only paths.
- Added cancellation cleanup so that in-progress alternative tool processes are
  terminated when the user cancels.
- Added an `info_error` guard that skips yt-dlp fallback strategies when video
  metadata extraction has already failed (avoids pointless retries).

---

## PR #169 — `Fix HTTP 403 Forbidden YouTube download error with multi-stage retry and fallback`

**Commit:** `f060c60`

**Error:** HTTP 403 Forbidden errors occurred at the video data download stage
(not the info-extraction stage), even though extraction succeeded.  This
happened because CDN stream-URL tokens sometimes expired between extraction and
download, or the server IP was temporarily CDN-blocked.

**Fix:**
- Implemented a multi-stage retry strategy:
  1. First attempt with cookies + full client list.
  2. On 403, retry with cookieless extractor args (`android_vr`, `web_embedded`,
     `tv`).
  3. On continued failure, fall through to alternative CLI tools (gallery-dl,
     you-get, streamlink).
  4. Final fallback to ssyoutube/savefrom.net API.
- Added `_is_http_forbidden_error()` and `_is_auth_or_forbidden_error()` helper
  functions.

---

## PR #187 — `Fix deployability (downloads dir), ADMIN_PASSWORD security, YouTube consistency`

**Commit:** `44360ea`

**Error:** YouTube extractor args were specified inconsistently across the
codebase; some code paths used the helper function while others hardcoded the
client list.

**Fix:**
- Unified all YouTube yt-dlp option dictionaries to call `_get_yt_extractor_args()`
  and `_get_cookieless_extractor_args()` instead of hardcoding client lists.
- Ensured `check_youtube_connectivity()` also uses the centralised helper.

---

## PR #192 — `Add ssyoutube/savefrom.net fallback to bypass YouTube download restrictions`

**Commit:** `d162b5e`

**Error:** All yt-dlp strategies and alternative CLI tools sometimes failed
simultaneously due to IP-level YouTube blocks.

**Fix:**
- Added ssyoutube/savefrom.net (`worker.sf-tools.com/savefrom.php`) as a
  last-resort fallback.
- Implemented `_ssyoutube_get_download_url()` and `_ssyoutube_download()` helper
  functions.
- The fallback is only invoked for YouTube URLs, after all yt-dlp strategies
  and alternative tools have been exhausted.

---

## PR #208 — `Fix YouTube downloads: remove mweb (requires GVS PO Token in yt-dlp 2026.3.x)`

**Commit:** `825f7ba`

**Error:** As of yt-dlp 2026.3.x, the `mweb` player client requires a GVS PO
Token for **all** streaming protocols.  With no POT provider configured, every
`mweb` format was skipped and yt-dlp emitted a user-visible warning:

```
mweb client https formats require a GVS PO Token which was not provided.
They will be skipped as they may yield HTTP Error 403.
```

**Fix:**
- Removed `mweb` from `_get_yt_extractor_args()`.  Primary client list is now
  `["default", "web_embedded", "tv"]`.
- Removed `mweb` from `_get_cookieless_extractor_args()` and added `android_vr`
  (POT-free, JS-free).  Cookieless list is now `["android_vr", "web_embedded", "tv"]`.
- Updated `check_youtube_connectivity()` to delegate to
  `_get_cookieless_extractor_args()` instead of hardcoding a client list,
  keeping the probe in sync with the download path.
- Updated `TestExtractorArgs` assertions: `mweb` must be **absent**; `android_vr`
  must be **present** in the cookieless args.

**yt-dlp 2026.3.x client POT requirements:**

| Client        | REQUIRE_JS_PLAYER | GVS POT required |
|---------------|:-----------------:|:----------------:|
| `android_vr`  | ❌                | ❌               |
| `web_embedded`| ✅                | ❌               |
| `tv`          | ✅                | ❌               |
| `mweb`        | ✅                | ✅ ← removed     |

---

## Summary of Current State (as of PR #208)

| Setting | Value |
|---------|-------|
| `_get_yt_extractor_args()` | `["default", "web_embedded", "tv"]` |
| `_get_cookieless_extractor_args()` | `["android_vr", "web_embedded", "tv"]` |
| `check_youtube_connectivity()` | delegates to `_get_cookieless_extractor_args()` |
| CI bot-check clients | `["android_vr", "web_embedded", "tv"]` |
| `mweb` | ❌ excluded (requires GVS PO Token in yt-dlp 2026.3.x) |
| Cookie file support | ✅ via `COOKIES_FILE` env var / admin upload API |
| PO token support | ✅ via `YOUTUBE_PO_TOKEN` / `YOUTUBE_VISITOR_DATA` env vars |
| ssyoutube fallback | ✅ last-resort for YouTube URLs |
| Alternative tools | gallery-dl → you-get → streamlink |

### Retry Strategy (most-to-least preferred)

1. yt-dlp with cookies + `["default", "web_embedded", "tv"]`
2. yt-dlp cookieless with `["android_vr", "web_embedded", "tv"]`
3. gallery-dl
4. you-get
5. streamlink
6. ssyoutube / savefrom.net API

---

## Quick-Reference: Diagnosing Future YouTube Errors

| Symptom | Likely cause | Where to look |
|---------|-------------|---------------|
| "Sign in to confirm you're not a bot" | Bot detection / IP block | `_AUTH_PATTERNS`, try uploading cookies via `/admin/cookies/upload` |
| "HTTP Error 403" during download | CDN token expired or IP blocked at CDN | `_is_http_forbidden_error()`, retry triggers automatically |
| "mweb client … requires a GVS PO Token" | `mweb` re-added to client list | `_get_yt_extractor_args()` — keep `mweb` out |
| "Requested format is not available" | Format not offered by selected client | Format fallback chains in `download_worker()` |
| All downloads fail silently | Cookies file expired | Check `/admin/cookies/status`, re-upload fresh cookies |
| yt-dlp version mismatch | Outdated version pin | Update `yt-dlp` in `requirements.txt` |
