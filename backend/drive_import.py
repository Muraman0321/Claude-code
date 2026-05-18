"""Import IGC files from a public Google Drive folder URL.

Google Drive only lets you list folder contents over the official Drive API,
which requires either OAuth or an API key. To keep the UX zero-setup we use
the unauthenticated `embeddedfolderview` HTML page that Drive serves for
publicly-shared folders. If the user provides a `GOOGLE_DRIVE_API_KEY`
environment variable, we use the official API instead — more robust and
less likely to break if Google changes the HTML.

Either way, individual files are downloaded with the unauthenticated
`uc?export=download&id=<id>` endpoint, which works for files inside a
publicly-shared folder.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

import httpx

_FOLDER_ID_PATTERNS = [
    re.compile(r"/folders/([a-zA-Z0-9_-]{15,})"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]{15,})"),
]
_BARE_ID = re.compile(r"^[a-zA-Z0-9_-]{20,}$")


@dataclass
class DriveFile:
    file_id: str
    name: str


def extract_folder_id(url_or_id: str) -> str | None:
    """Pull a folder ID out of a paste-able Drive URL (or accept a bare ID)."""
    s = url_or_id.strip()
    for pat in _FOLDER_ID_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    if _BARE_ID.match(s):
        return s
    return None


def list_folder(folder_id: str, timeout: float = 20.0) -> list[DriveFile]:
    """List files inside a publicly-shared folder.

    Uses the Drive v3 API when GOOGLE_DRIVE_API_KEY is configured (most
    reliable), otherwise falls back to scraping the embedded folder view.
    Raises on network failure; returns [] if no files found.
    """
    api_key = os.environ.get("GOOGLE_DRIVE_API_KEY")
    if api_key:
        return _list_via_api(folder_id, api_key, timeout)
    return _list_via_embedded_view(folder_id, timeout)


def _list_via_api(folder_id: str, api_key: str, timeout: float) -> list[DriveFile]:
    out: list[DriveFile] = []
    page_token: str | None = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken, files(id, name, mimeType)",
            "pageSize": 200,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token
        r = httpx.get("https://www.googleapis.com/drive/v3/files", params=params, timeout=timeout)
        r.raise_for_status()
        data = r.json()
        for f in data.get("files", []):
            out.append(DriveFile(file_id=f["id"], name=f.get("name", f["id"])))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return out


# Heuristic patterns for the embedded folder view. Each tuple is
# (file_id_regex_group, name_regex_group_or_None). We collect all matches
# and merge name + id by proximity afterwards.
_EMBED_ID_RES = [
    re.compile(r'/file/d/([a-zA-Z0-9_-]{15,})/'),
    re.compile(r'data-id="([a-zA-Z0-9_-]{15,})"'),
]


def _list_via_embedded_view(folder_id: str, timeout: float) -> list[DriveFile]:
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    r = httpx.get(url, timeout=timeout, follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (compatible; glider-analyzer)",
    })
    r.raise_for_status()
    html = r.text

    # Primary pattern: each entry has both an anchor with the file ID and a
    # title div nearby. Robust to small changes by using a non-greedy match
    # for the gap between them.
    pattern = re.compile(
        r'/file/d/(?P<id>[a-zA-Z0-9_-]{15,})/'
        r'.{0,400}?'
        r'class="flip-entry-title"[^>]*>(?P<name>[^<]+)<',
        re.DOTALL,
    )
    seen: dict[str, str] = {}
    for m in pattern.finditer(html):
        fid = m.group("id")
        if fid not in seen:
            seen[fid] = m.group("name").strip()

    # Fallback: if the above turned up nothing, just collect file IDs and
    # name them by ID. Better than nothing — the ingest step can still
    # normalize and parse the filename if the original was stored in the
    # `title` attribute somewhere.
    if not seen:
        for pat in _EMBED_ID_RES:
            for m in pat.finditer(html):
                fid = m.group(1)
                if fid not in seen:
                    seen[fid] = f"{fid}.igc"

    return [DriveFile(file_id=fid, name=name) for fid, name in seen.items()]


def download_file(file_id: str, timeout: float = 30.0) -> bytes:
    """Download a Drive file by ID. Works for files in publicly-shared folders.

    For large files (>~100MB) Drive returns a virus-scan confirmation page;
    IGC files are tiny (~200KB) so we don't bother with that flow.
    """
    url = "https://drive.google.com/uc"
    r = httpx.get(
        url,
        params={"export": "download", "id": file_id},
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; glider-analyzer)"},
    )
    r.raise_for_status()
    return r.content
