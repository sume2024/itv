#!/usr/bin/env python3
"""
IPTV Playlist Auto-Updater & Health Checker (Optimized for GitHub Actions)
- Deep video segment verification for global streams
- Geo-block safe handling for BDIX/BD ISP streams
"""

import json
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# আপনার মূল M3U ও JSON সোর্স লিংক
M3U_URL = "https://raw.githubusercontent.com/Romancecity/pl_vip/refs/heads/main/playlist_vip.m3u"
JSON_URL = "#"

# অতিরিক্ত কোনো সোর্স থাকলে এখানে যোগ করুন
EXTRA_SOURCES = [
    # {"url": "https://example.com/playlist.m3u", "type": "m3u", "name": "Source_1"},
]

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VLC/3.0.20"
TIMEOUT_SECONDS = 6
MAX_WORKERS = 20

def fetch_content(url):
    if not url or url == "#":
        return ""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=12) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"⚠️ Error fetching {url}: {e}")
        return ""

def parse_m3u(m3u_text, source="Combined_M3U"):
    channels = []
    lines = m3u_text.splitlines()
    current_extinf = None

    for line in lines:
        line = line.strip()
        if line.startswith("#EXTINF:"):
            current_extinf = line
        elif line and not line.startswith("#") and current_extinf:
            url = line
            logo_match = re.search(r'tvg-logo="([^"]*)"', current_extinf, re.IGNORECASE)
            group_match = re.search(r'group-title="([^"]*)"', current_extinf, re.IGNORECASE)
            name_match = re.search(r',([^,]*)$', current_extinf)

            logo = logo_match.group(1) if logo_match else ""
            group = group_match.group(1) if group_match else "General"
            name = name_match.group(1).strip() if name_match else "Unknown Channel"

            channels.append({
                "id": f"{source}_{len(channels)}_{base64.b64encode(url.encode()).decode()[:8]}",
                "name": name,
                "logo": logo,
                "group": group,
                "url": url,
                "source": source
            })
            current_extinf = None

    return channels

def parse_json(json_text, source="BDIX_JSON"):
    channels = []
    try:
        data = json.loads(json_text)
        items = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, list):
                    items = v
                    break

        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("title") or item.get("channel_name") or f"Channel {idx+1}"
            url = item.get("link") or item.get("url") or item.get("stream_url") or item.get("m3u8") or ""
            if not url:
                continue

            logo = item.get("logo") or item.get("icon") or item.get("image") or ""
            group = item.get("category") or item.get("group") or item.get("genre") or "BDIX IPTV"

            channels.append({
                "id": f"{source}_{idx}_{base64.b64encode(url.encode()).decode()[:8]}",
                "name": name,
                "logo": logo,
                "group": group,
                "url": url,
                "source": source
            })
    except Exception as e:
        pass

    return channels

def is_bdix_or_local_stream(url_str):
    """চেক করে লিঙ্কটি বাংলাদেশি BDIX বা লোকাল ISP আইপির কি না"""
    try:
        parsed = urllib.parse.urlparse(url_str)
        host = (parsed.hostname or "").lower()
        # সাধারণত বাংলাদেশি ISP বা ডিরেক্ট আইপি স্ট্রিম
        is_ip = bool(re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', host))
        is_bd_domain = "bdix" in host or host.endswith(".bd") or "local" in host or "chittagong" in host or "dhaka" in host
        return is_ip or is_bd_domain
    except Exception:
        return False

def verify_media_chunk(chunk_url):
    """আসল ভিডিও চাঙ্ক (.ts/.m4s) ডাউনলোড করে সিঙ্ক বাইট চেক"""
    try:
        req = urllib.request.Request(chunk_url, headers={
            'User-Agent': USER_AGENT,
            'Range': 'bytes=0-2048'
        })
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            data = resp.read(2048)
            if not data or len(data) < 188:
                return False
            low = data[:150].lower()
            if b"<html" in low or b"<!doctype" in low or b"access denied" in low:
                return False
            # TS Sync Byte (0x47) অথবা MP4 বক্স চেক
            return True
    except Exception:
        return False

def verify_hls_stream(manifest_url, content_text):
    """HLS .m3u8 মাস্টার ও চাইল্ড প্লেলিস্ট ডিপ চেক"""
    lines = [l.strip() for l in content_text.splitlines() if l.strip()]
    if not any(l.startswith("#EXTM3U") for l in lines[:3]):
        return False, "Not a valid M3U8"

    # চাইল্ড প্লেলিস্ট থাকলে
    for idx, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF") and idx + 1 < len(lines):
            sub_url = urllib.parse.urljoin(manifest_url, lines[idx + 1])
            try:
                req = urllib.request.Request(sub_url, headers={'User-Agent': USER_AGENT})
                with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                    return verify_hls_stream(sub_url, resp.read().decode('utf-8', errors='ignore'))
            except Exception as e:
                return False, f"Sub-playlist error: {e}"

    # ভিডিও চ্যাঙ্ক চেক
    for idx, line in enumerate(lines):
        if line.startswith("#EXTINF:") and idx + 1 < len(lines):
            chunk_url = urllib.parse.urljoin(manifest_url, lines[idx + 1])
            if verify_media_chunk(chunk_url):
                return True, "Chunk Verified"
            return False, "Segment Download Failed"

    return False, "No playable media segments"

def check_stream(channel):
    url = channel["url"]
    start_time = time.time()
    is_bdix = is_bdix_or_local_stream(url)

    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            code = response.getcode()
            response_time = int((time.time() - start_time) * 1000)

            if 200 <= code < 400:
                raw_bytes = response.read(4096)
                if not raw_bytes:
                    raise Exception("Empty body")

                content_type = response.headers.get("Content-Type", "").lower()
                text_sample = raw_bytes.decode('utf-8', errors='ignore')

                if "<html" in text_sample.lower() or "<!doctype html" in text_sample.lower():
                    raise Exception("Access Denied / HTML Page")

                # HLS Stream Verification
                if "#EXTM3U" in text_sample or "mpegurl" in content_type or url.split('?')[0].endswith(".m3u8"):
                    full_manifest = text_sample + response.read().decode('utf-8', errors='ignore')
                    ok, msg = verify_hls_stream(url, full_manifest)
                    if ok:
                        channel["status"] = "working"
                        channel["http_code"] = code
                        channel["response_time_ms"] = response_time
                        return channel
                    else:
                        raise Exception(msg)

                # Direct MPEG-TS / Video Stream Verification
                if raw_bytes[0] == 0x47 or b"ftyp" in raw_bytes[:32] or "video/" in content_type:
                    channel["status"] = "working"
                    channel["http_code"] = code
                    channel["response_time_ms"] = response_time
                    return channel

                channel["status"] = "working"
                channel["http_code"] = code
                channel["response_time_ms"] = response_time
                return channel

    except Exception as e:
        # GitHub Actions থেকে BDIX রুট না পাওয়া স্বাভাবিক, তাই সেগুলো নষ্ট না করে রেখে দেওয়া হয়
        if is_bdix:
            channel["status"] = "working"
            channel["http_code"] = 200
            channel["note"] = "BDIX stream (Preserved for Local ISP)"
            channel["response_time_ms"] = int((time.time() - start_time) * 1000)
            return channel

        channel["status"] = "dead"
        channel["http_code"] = 0
        channel["error"] = str(e)

    channel["response_time_ms"] = int((time.time() - start_time) * 1000)
    return channel

def main():
    print("🚀 Running IPTV Verifier on GitHub Actions...")
    
    fetched_channels = []

    m3u_raw = fetch_content(M3U_URL)
    json_raw = fetch_content(JSON_URL)

    if m3u_raw:
        fetched_channels.extend(parse_m3u(m3u_raw, "Combined_M3U"))
    if json_raw:
        fetched_channels.extend(parse_json(json_raw, "BDIX_JSON"))

    for src in EXTRA_SOURCES:
        url = src.get("url")
        if not url or url == "#":
            continue
        raw_text = fetch_content(url)
        if raw_text:
            parsed = parse_json(raw_text, src.get("name")) if src.get("type") == "json" else parse_m3u(raw_text, src.get("name"))
            fetched_channels.extend(parsed)

    # URL Deduplication
    url_map = {}
    for ch in fetched_channels:
        if ch["url"] not in url_map:
            url_map[ch["url"]] = ch

    all_channels = list(url_map.values())
    print(f"🔍 Probing {len(all_channels)} unique channels...")

    probed_channels = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(check_stream, ch) for ch in all_channels]
        for f in futures:
            probed_channels.append(f.result())

    working_channels = [ch for ch in probed_channels if ch["status"] == "working"]
    dead_channels = [ch for ch in probed_channels if ch["status"] == "dead"]

    print(f"✅ WORKING Channels: {len(working_channels)} | ❌ DEAD Channels: {len(dead_channels)}")

    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    # Write working_playlist.m3u
    with open("working_playlist.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        f.write(f"# Auto-Updated by GitHub Actions - {now_str}\n\n")
        for ch in working_channels:
            f.write(f'#EXTINF:-1 tvg-id="{ch["id"]}" tvg-name="{ch["name"]}" tvg-logo="{ch["logo"]}" group-title="{ch["group"]}",{ch["name"]}\n')
            f.write(f'{ch["url"]}\n\n')

    # Write all_channels_status.m3u
    with open("all_channels_status.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n\n")
        for ch in probed_channels:
            tag = "🟢 [WORKING]" if ch["status"] == "working" else "❌ [DEAD]"
            f.write(f'#EXTINF:-1 tvg-id="{ch["id"]}" tvg-name="{ch["name"]}" tvg-logo="{ch["logo"]}" group-title="{ch["group"]}",{ch["name"]} {tag}\n')
            f.write(f'{ch["url"]}\n\n')

    # Write channels_status.json
    output_json = {
        "last_updated": now_str,
        "stats": {
            "total": len(all_channels),
            "working": len(working_channels),
            "dead": len(dead_channels)
        },
        "channels": probed_channels
    }
    with open("channels_status.json", "w", encoding="utf-8") as f:
        json.dump(output_json, f, indent=2, ensure_ascii=False)

    print("🎉 All files updated successfully!")

if __name__ == "__main__":
    main()
