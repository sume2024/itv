import json
import os
import re
import urllib.request
from datetime import datetime

# Custom Branding Configurations
BRANDING = {
    "status": "success",
    "owner": "MD ANAMUL HOQUE",
    "telegram": "https://t.me/ireentv",
    "website": "https://anamul.pages.dev",
    "developer": "IreenTechnology",
    "version": "1.0"
}

def fetch_content(url):
    """Fetches text content from the remote URL with User-Agent header"""
    try:
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def parse_m3u(content):
    """Parses standard M3U playlists into clean structured Channel dictionaries"""
    channels = []
    lines = content.splitlines()
    current_channel = {}
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        if line.startswith('#EXTINF:'):
            current_channel = {}
            
            # Extract all attributes in key="value" format
            attrs = {}
            for k, v in re.findall(r'([a-zA-Z0-9_-]+)="([^"]*)"', line):
                attrs[k] = v
            
            # Extract tvg-logo
            current_channel['logo'] = attrs.get('tvg-logo') or attrs.get('logo') or ""
            
            # Extract group-title (category)
            current_channel['group'] = attrs.get('group-title') or attrs.get('category') or "General"
            
            # Extract channel name (everything after the last comma)
            comma_idx = line.rfind(',')
            if comma_idx != -1:
                current_channel['name'] = line[comma_idx+1:].strip()
            else:
                current_channel['name'] = attrs.get('tvg-name') or "Channel"
                
            # Remove keys from attrs that are mapped to root fields to avoid duplication in JSON
            for key in list(attrs.keys()):
                if key.lower() in ['tvg-logo', 'logo', 'group-title', 'category', 'tvg-name', 'name']:
                    del attrs[key]
            
            if attrs:
                current_channel['attrs'] = attrs
                
        elif line.startswith('#EXTVLCOPT:'):
            opt_content = line[len('#EXTVLCOPT:'):].strip()
            
            # Also parse as header for dynamic/JSON capability
            if '=' in opt_content:
                k, v = opt_content.split('=', 1)
                k = k.strip()
                v = v.strip()
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                
                is_http_header = k.lower() in ['http-user-agent', 'http-referrer', 'http-origin']
                
                if 'headers' not in current_channel:
                    current_channel['headers'] = {}
                
                if k.lower() == 'http-user-agent':
                    current_channel['headers']['User-Agent'] = v
                elif k.lower() == 'http-referrer':
                    current_channel['headers']['Referer'] = v
                elif k.lower() == 'http-origin':
                    current_channel['headers']['Origin'] = v
                else:
                    current_channel['headers'][k] = v
                    
                # If it's not a standard HTTP header option, keep in vlc_opts
                if not is_http_header:
                    if 'vlc_opts' not in current_channel:
                        current_channel['vlc_opts'] = []
                    current_channel['vlc_opts'].append(opt_content)
            else:
                if 'vlc_opts' not in current_channel:
                    current_channel['vlc_opts'] = []
                current_channel['vlc_opts'].append(opt_content)
                    
        elif line.startswith('#KODIPROP:'):
            prop_content = line[len('#KODIPROP:'):].strip()
            if 'kodiprops' not in current_channel:
                current_channel['kodiprops'] = []
            current_channel['kodiprops'].append(prop_content)
            
        elif line.startswith('#EXTHTTP:'):
            http_content = line[len('#EXTHTTP:'):].strip()
            if 'exthttps' not in current_channel:
                current_channel['exthttps'] = []
            current_channel['exthttps'].append(http_content)
            # Also extract headers from EXTHTTP if it is valid JSON
            try:
                import json
                parsed_http = json.loads(http_content)
                if parsed_http and isinstance(parsed_http, dict):
                    if 'headers' not in current_channel:
                        current_channel['headers'] = {}
                    for k, v in parsed_http.items():
                        if k.lower() == 'user-agent':
                            current_channel['headers']['User-Agent'] = str(v)
                        elif k.lower() == 'referer':
                            current_channel['headers']['Referer'] = str(v)
                        elif k.lower() == 'origin':
                            current_channel['headers']['Origin'] = str(v)
                        else:
                            current_channel['headers'][k] = str(v)
            except Exception:
                pass
            
        elif not line.startswith('#'):
            if 'name' not in current_channel:
                current_channel['name'] = f"Channel {len(channels) + 1}"
            if 'logo' not in current_channel:
                current_channel['logo'] = ""
            if 'group' not in current_channel:
                current_channel['group'] = "General"
                
            current_channel['url'] = line
            current_channel['url_raw'] = line
            
            # Handle inline User-Agent or custom header options like url|User-Agent=... or url|x-forwarded-for:value
            if '|' in line:
                parts = line.split('|')
                current_channel['url'] = parts[0]
                if 'headers' not in current_channel:
                    current_channel['headers'] = {}
                for part in parts[1:]:
                    if '=' in part:
                        k, v = part.split('=', 1)
                        current_channel['headers'][k.strip()] = v.strip()
                    elif ':' in part:
                        k, v = part.split(':', 1)
                        current_channel['headers'][k.strip()] = v.strip()
            
            channels.append(current_channel)
            current_channel = {}
            
    return channels

def parse_json_playlist(data):
    """Recursively searches for channel or match array within complex JSON structures"""
    channels_list = []
    
    # Check common list keywords case-insensitively
    target_array = None
    priority_keys = ['channels', 'matches', 'streams', 'items', 'live', 'data', 'list']
    
    if isinstance(data, list):
        target_array = data
    elif isinstance(data, dict):
        for key in data.keys():
            if key.lower() in priority_keys and isinstance(data[key], list):
                target_array = data[key]
                break
                
        # Fallback: find any list that contains objects
        if not target_array:
            for key, val in data.items():
                if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                    target_array = val
                    break
                    
    if not target_array:
        return []
        
    for item in target_array:
        if not isinstance(item, dict):
            continue
            
        # Parse channel properties dynamically (case-insensitive keys search)
        name = ""
        name_keys = ['match_name', 'matchname', 'event_name', 'eventname', 'broadcast_channel', 'broadcastchannel', 'name', 'title', 'channel_name', 'label', 'displayname', 'videoname', 'categoryname']
        for k, v in item.items():
            if k.lower() in name_keys:
                name = str(v)
                break
                
        url = ""
        url_keys = ['video_url', 'videourl', 'pub_url', 'puburl', 'dai_url', 'daiurl', 'url', 'link', 'stream', 'stream_url', 'stream_link', 'source', 'uri', 'm3u8', 'streamurl', 'playurl', 'play_url']
        for k, v in item.items():
            if k.lower() in url_keys:
                url = str(v)
                break
                
        # Fallback if URL is empty (e.g. upcoming event)
        if not url:
            url = "https://upcoming-match-no-stream.m3u8"
            
        logo = ""
        logo_keys = ['logo', 'image', 'logo_url', 'thumbnail', 'img', 'icon', 'channel_logo', 'poster', 'logourl', 'imageurl', 'thumbnailstandard', 'thumbnailtv', 'src']
        for k, v in item.items():
            if k.lower() in logo_keys:
                logo = str(v)
                break
                
        group = "General"
        group_keys = ['group', 'category', 'genre', 'group-title', 'type', 'sportname', 'event_category', 'eventcategory']
        for k, v in item.items():
            if k.lower() in group_keys:
                group = str(v)
                break
                
        status = ""
        for k, v in item.items():
            if k.lower() == 'status':
                status = str(v)
                break
                
        headers = None
        for k, v in item.items():
            if k.lower() in ['headers', 'header', 'http_headers'] and isinstance(v, dict):
                headers = v
                break
                
        kodiprops = None
        for k, v in item.items():
            if k.lower() in ['kodiprops', 'kodiprop', 'kodi_props', 'kodi']:
                if isinstance(v, list):
                    kodiprops = [str(x) for x in v]
                elif isinstance(v, dict):
                    kodiprops = [f"{pk}={pv}" for pk, pv in v.items()]
                break
                
        exthttps = None
        for k, v in item.items():
            if k.lower() in ['exthttps', 'exthttp', 'ext_https', 'ext_http']:
                if isinstance(v, list):
                    exthttps = [str(x) for x in v]
                elif isinstance(v, str):
                    exthttps = [v]
                break
                
        attrs = None
        for k, v in item.items():
            if k.lower() == 'attrs' and isinstance(v, dict):
                attrs = v
                break
                
        vlc_opts = None
        for k, v in item.items():
            if k.lower() == 'vlc_opts' and isinstance(v, list):
                vlc_opts = [str(x) for x in v]
                break
                
        if name or url:
            url_raw = url
            if url and '|' in url:
                parts = url.split('|')
                url = parts[0]
                if not headers:
                    headers = {}
                for part in parts[1:]:
                    if '=' in part:
                        k, v = part.split('=', 1)
                        headers[k.strip()] = v.strip()
                    elif ':' in part:
                        k, v = part.split(':', 1)
                        headers[k.strip()] = v.strip()
                        
            channel_obj = {
                "name": name if name else f"Channel {len(channels_list) + 1}",
                "logo": logo,
                "url": url,
                "group": group
            }
            if url_raw:
                channel_obj["url_raw"] = url_raw
            if status:
                channel_obj["status"] = status
            if headers:
                channel_obj["headers"] = headers
            if kodiprops:
                channel_obj["kodiprops"] = kodiprops
            if exthttps:
                channel_obj["exthttps"] = exthttps
            if attrs:
                channel_obj["attrs"] = attrs
            if vlc_opts:
                channel_obj["vlc_opts"] = vlc_opts
            channels_list.append(channel_obj)
            
    return channels_list

def generate_m3u_file(brand, channels, name):
    """Outputs branded M3U text format"""
    m3u = f"#EXTM3U\n"
    m3u += f"# Playlist Name: {name}\n"
    m3u += f"# Owner: {brand['owner']}\n"
    m3u += f"# Telegram: {brand['telegram']}\n"
    m3u += f"# Website: {brand['website']}\n"
    m3u += f"# Developer: {brand['developer']}\n"
    m3u += f"# Version: {brand['version']}\n"
    m3u += f"# Channels Amount: {len(channels)}\n"
    m3u += f"# Last Update: {brand['Last_update']}\n\n"
    
    for ch in channels:
        # Reconstruct #EXTINF using parsed attrs dictionary to preserve all original attributes
        attrs_to_write = {}
        if ch.get("attrs") and isinstance(ch["attrs"], dict):
            attrs_to_write.update(ch["attrs"])
            
        # Ensure standard keys are present if we have them in the main fields
        if ch.get("logo"):
            attrs_to_write["tvg-logo"] = ch["logo"]
        if ch.get("group") and ch.get("group") != "General":
            attrs_to_write["group-title"] = ch["group"]
        if ch.get("name"):
            attrs_to_write["tvg-name"] = ch["name"]
        if ch.get("status"):
            attrs_to_write["status"] = ch["status"]
            
        # Clean up duplicate key variations
        for key_to_del in ['logo', 'category', 'group', 'name']:
            if key_to_del in attrs_to_write:
                del attrs_to_write[key_to_del]
                
        if attrs_to_write:
            attrs_str = ""
            for k, v in attrs_to_write.items():
                attrs_str += f' {k}="{v}"'
            m3u += f"#EXTINF:-1{attrs_str},{ch['name']}\n"
        else:
            m3u += f"#EXTINF:-1,{ch['name']}\n"
        
        # Write custom VLCOPT lines if they were parsed
        if ch.get("vlc_opts") and isinstance(ch["vlc_opts"], list):
            for opt in ch["vlc_opts"]:
                m3u += f"#EXTVLCOPT:{opt}\n"
        else:
            # Fallback to reconstructing headers as EXTVLCOPT
            if "headers" in ch and isinstance(ch["headers"], dict):
                for k, v in ch["headers"].items():
                    if k.lower() == 'user-agent':
                        m3u += f"#EXTVLCOPT:http-user-agent={v}\n"
                    elif k.lower() == 'referer':
                        m3u += f"#EXTVLCOPT:http-referrer={v}\n"
                    elif k.lower() == 'origin':
                        m3u += f"#EXTVLCOPT:http-origin={v}\n"
                        
        # Write custom KODIPROP lines if they were parsed
        if ch.get("kodiprops") and isinstance(ch["kodiprops"], list):
            for prop in ch["kodiprops"]:
                m3u += f"#KODIPROP:{prop}\n"
                
        # Write custom EXTHTTP lines if they were parsed, or generate from ch["headers"]
        if ch.get("exthttps") and isinstance(ch["exthttps"], list):
            for http in ch["exthttps"]:
                m3u += f"#EXTHTTP:{http}\n"
        elif "headers" in ch and isinstance(ch["headers"], dict) and len(ch["headers"]) > 0:
            import json
            m3u += f"#EXTHTTP:{json.dumps(ch['headers'])}\n"
                
        url_to_write = ch.get('url_raw') or ch.get('url') or "https://upcoming-match-no-stream.m3u8"
        if not ch.get('url_raw') and ch.get('url') and ch.get('headers') and isinstance(ch['headers'], dict):
            # Reconstruct inline headers if url_raw is not present and custom headers exist
            inline_headers = []
            for hk, hv in ch['headers'].items():
                if hk.lower() not in ['user-agent', 'referer', 'origin']:
                    inline_headers.append(f"{hk}:{hv}")
            if inline_headers:
                url_to_write = f"{ch['url']}|" + "|".join(inline_headers)
                
        m3u += f"{url_to_write}\n\n"
        
    return m3u

def generate_m3u_file(branding, channels, custom_name="playlist"):
    m3u = f"""#EXTM3U
# Playlist Name: {custom_name}
# Owner: {branding['owner']}
# Telegram: {branding['telegram']}
# Website: {branding['website']}
# Developer: {branding['developer']}
# Version: {branding['version']}
# Channels Amount: {len(channels)}
# Last Update: {branding['Last_update']}

"""
    
    for ch in channels:
        # Collect all unique URLs for this channel (primary url, url_2, url_3...)
        urls_to_write = []
        if ch.get("url"):
            urls_to_write.append(ch["url"].strip())
        if ch.get("url_2"):
            urls_to_write.append(ch["url_2"].strip())
        if ch.get("url_3"):
            urls_to_write.append(ch["url_3"].strip())

        for key, val in ch.items():
            if re.match(r'^url_\d+$', key, re.I) and key not in ['url_2', 'url_3']:
                if val and isinstance(val, str):
                    urls_to_write.append(val.strip())

        # Deduplicate
        seen_u = set()
        unique_urls = []
        for u in urls_to_write:
            if u and u not in seen_u:
                seen_u.add(u)
                unique_urls.append(u)

        if not unique_urls:
            continue

        attrs_to_write = {}
        if ch.get("attrs") and isinstance(ch["attrs"], dict):
            attrs_to_write.update(ch["attrs"])
            
        if ch.get("logo"):
            attrs_to_write["tvg-logo"] = ch["logo"]
        if ch.get("group") and ch.get("group") != "General":
            attrs_to_write["group-title"] = ch["group"]
        if ch.get("status"):
            attrs_to_write["status"] = ch["status"]
            
        for key_to_del in ['logo', 'category', 'group', 'name']:
            if key_to_del in attrs_to_write:
                del attrs_to_write[key_to_del]

        entry_attrs = dict(attrs_to_write)

        attrs_str = ""
        for k, v in entry_attrs.items():
            attrs_str += f' {k}="{v}"'
        m3u += f"#EXTINF:-1{attrs_str},{ch.get('name', 'Channel')}\n"
        
        if ch.get("vlc_opts") and isinstance(ch["vlc_opts"], list):
            for opt in ch["vlc_opts"]:
                m3u += f"#EXTVLCOPT:{opt}\n"
        else:
            if "headers" in ch and isinstance(ch["headers"], dict):
                for k, v in ch["headers"].items():
                    if k.lower() == 'user-agent':
                        m3u += f"#EXTVLCOPT:http-user-agent={v}\n"
                    elif k.lower() == 'referer':
                        m3u += f"#EXTVLCOPT:http-referrer={v}\n"
                    elif k.lower() == 'origin':
                        m3u += f"#EXTVLCOPT:http-origin={v}\n"
                        
        if ch.get("kodiprops") and isinstance(ch["kodiprops"], list):
            for prop in ch["kodiprops"]:
                m3u += f"#KODIPROP:{prop}\n"
                
        if ch.get("exthttps") and isinstance(ch["exthttps"], list):
            for http in ch["exthttps"]:
                m3u += f"#EXTHTTP:{http}\n"
        elif "headers" in ch and isinstance(ch["headers"], dict) and len(ch["headers"]) > 0:
            import json
            m3u += f"#EXTHTTP:{json.dumps(ch['headers'])}\n"
                
        for u_str in unique_urls:
            m3u += f"{u_str}\n"
        m3u += "\n"
        
    return m3u

def is_generic_channel_name(name):
    norm = re.sub(r'\s+', ' ', (name or '').strip().lower())
    return bool(re.match(r'^channel\s*\d+$', norm, re.I) or re.match(r'^stream\s*\d+$', norm, re.I) or norm == 'channel')

def get_channel_key(name, url):
    norm_name = re.sub(r'\s+', ' ', (name or '').strip().lower())
    clean_name_key = re.sub(r'[^a-z0-9]', '', norm_name)

    if not is_generic_channel_name(name) and len(clean_name_key) > 2:
        return clean_name_key

    lower_url = (url or '').lower()
    path_parts = lower_url.split('/')
    for part in path_parts:
        clean_part = re.sub(r'\.m3u8?.*$', '', part)
        clean_part = re.sub(r'[^a-z0-9]', '', clean_part)
        if len(clean_part) > 3 and clean_part not in ['index', 'chunks', 'live', 'playlist', 'stream', 'master', 'mono', '720', '1080', 'hls', 'http', 'https']:
            base_kw = re.sub(r'\d+$', '', clean_part)
            if len(base_kw) > 3:
                return base_kw
            return clean_part

    return clean_name_key or 'channel'

def extract_urls_from_channel(ch):
    urls = []
    if ch.get("url"):
        urls.append(ch["url"].strip())
    if ch.get("url_2"):
        urls.append(ch["url_2"].strip())
    if ch.get("url_3"):
        urls.append(ch["url_3"].strip())

    for k, v in ch.items():
        if re.match(r'^url_\d+$', k, re.I) and k not in ['url_2', 'url_3']:
            if v and isinstance(v, str):
                urls.append(v.strip())

    seen = set()
    res = []
    for u in urls:
        if u and u not in seen:
            seen.add(u)
            res.append(u)
    return res

def merge_all_playlists(parsed_sources):
    """
    Merges multiple parsed sources and consolidates multi-server URLs into url, url_2, url_3...
    """
    if not parsed_sources:
        return []

    grouped_map = {}
    channel_order = []

    for s_idx, src in enumerate(parsed_sources):
        src_name = src.get("source_name", f"Playlist {s_idx + 1}")
        src_channels = src.get("channels", [])

        for ch in src_channels:
            ch_urls = extract_urls_from_channel(ch)
            if not ch_urls:
                continue

            primary_url = ch_urls[0]
            raw_name = ch.get("name", "Channel")
            key = get_channel_key(raw_name, primary_url)

            if key not in grouped_map:
                grouped_map[key] = {
                    "key": key,
                    "name": raw_name,
                    "logo": ch.get("logo") or "",
                    "group": ch.get("group") if ch.get("group") != "General" else "General",
                    "urls": list(ch_urls),
                    "source_names": {src_name},
                    "attrs": dict(ch.get("attrs") or {}),
                    "headers": ch.get("headers"),
                    "vlc_opts": ch.get("vlc_opts"),
                    "kodiprops": ch.get("kodiprops"),
                    "status": ch.get("status")
                }
                grouped_map[key]["attrs"]["source-playlist"] = src_name
                grouped_map[key]["attrs"]["playlist-role"] = "default" if s_idx == 0 else "subsequent"
                channel_order.append(key)
            else:
                existing = grouped_map[key]
                existing["source_names"].add(src_name)

                if is_generic_channel_name(existing["name"]) and not is_generic_channel_name(raw_name):
                    existing["name"] = raw_name
                if not existing["logo"] and ch.get("logo"):
                    existing["logo"] = ch["logo"]
                if (not existing["group"] or existing["group"] == "General") and ch.get("group") and ch["group"] != "General":
                    existing["group"] = ch["group"]

                for u in ch_urls:
                    if u not in existing["urls"]:
                        existing["urls"].append(u)

    merged_channels = []
    for key in channel_order:
        item = grouped_map[key]
        urls = item["urls"]

        ch_obj = {
            "name": item["name"],
            "logo": item["logo"] or "",
            "group": item["group"] or "General",
            "url": urls[0]
        }

        if len(urls) > 1:
            ch_obj["url_2"] = urls[1]
        if len(urls) > 2:
            ch_obj["url_3"] = urls[2]
        if len(urls) > 3:
            for idx_u in range(3, len(urls)):
                ch_obj[f"url_{idx_u + 1}"] = urls[idx_u]

        ch_obj["attrs"] = dict(item["attrs"])
        ch_obj["attrs"]["total-servers"] = str(len(urls))
        ch_obj["attrs"]["sources"] = ", ".join(sorted(list(item["source_names"])))

        if item.get("headers"): ch_obj["headers"] = item["headers"]
        if item.get("vlc_opts"): ch_obj["vlc_opts"] = item["vlc_opts"]
        if item.get("kodiprops"): ch_obj["kodiprops"] = item["kodiprops"]
        if item.get("status"): ch_obj["status"] = item["status"]

        merged_channels.append(ch_obj)

    return merged_channels


def main():
    print("Starting automated playlist synchronization...")
    
    # List of supported configuration filenames in priority order
    possible_config_files = ["device.json", "playlists.json", "playlist.json", "config.json"]
    config_file = None
    
    for filename in possible_config_files:
        if os.path.exists(filename):
            config_file = filename
            break
            
    if not config_file:
        print(f"Error: No configuration file found. Please create one of: {', '.join(possible_config_files)}")
        return
        
    print(f"Loading settings from: {config_file}")
    with open(config_file, "r", encoding="utf-8") as f:
        config_data = json.load(f)
        
    BRANDING["Last_update"] = datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    
    parsed_sources = []

    for idx, item in enumerate(config_data.get("playlists", [])):
        name = item.get("name", f"Playlist {idx + 1}")
        url = item.get("url")
        print(f"Processing playlist #{idx + 1}: {name}...")
        
        raw_content = fetch_content(url)
        if not raw_content:
            print(f"Warning: Could not fetch channels from {url}")
            continue
            
        # Parse based on content type
        channels = []
        trimmed = raw_content.strip()
        
        if trimmed.startswith('#EXTM3U'):
            channels = parse_m3u(raw_content)
        else:
            try:
                json_data = json.loads(raw_content)
                channels = parse_json_playlist(json_data)
            except Exception:
                if '#EXTINF' in raw_content or 'http' in raw_content:
                    channels = parse_m3u(raw_content)
                    
        if not channels:
            print(f"Warning: No channels detected in {name}")
            continue
            
        print(f"Extracted {len(channels)} channels from {name}.")
        
        parsed_sources.append({
            "source_name": name,
            "channels": channels
        })

        # Generate individual files for backup/reference as well
        clean_channels_for_json = []
        for ch in channels:
            clean_ch = {
                "name": ch.get("name", ""),
                "logo": ch.get("logo", ""),
                "url": ch.get("url", ""),
                "group": ch.get("group", "General")
            }
            if ch.get("url_raw"):
                clean_ch["url_raw"] = ch["url_raw"]
            if ch.get("headers") and isinstance(ch["headers"], dict) and len(ch["headers"]) > 0:
                clean_ch["headers"] = ch["headers"]
            if ch.get("attrs") and isinstance(ch["attrs"], dict) and len(ch["attrs"]) > 0:
                clean_ch["attrs"] = ch["attrs"]
            if ch.get("vlc_opts") and isinstance(ch["vlc_opts"], list) and len(ch["vlc_opts"]) > 0:
                clean_ch["vlc_opts"] = ch["vlc_opts"]
            if ch.get("kodiprops") and isinstance(ch["kodiprops"], list) and len(ch["kodiprops"]) > 0:
                clean_ch["kodiprops"] = ch["kodiprops"]
            if ch.get("status"):
                clean_ch["status"] = ch["status"]
            clean_channels_for_json.append(clean_ch)
            
        json_output = {
            "status": BRANDING["status"],
            "owner": BRANDING["owner"],
            "telegram": BRANDING["telegram"],
            "website": BRANDING["website"],
            "developer": BRANDING["developer"],
            "version": BRANDING["version"],
            "name": name,
            "channels_amount": len(clean_channels_for_json),
            "Last_update": BRANDING["Last_update"],
            "channels": clean_channels_for_json
        }
        
        with open(f"{name}.json", "w", encoding="utf-8") as out_f:
            json.dump(json_output, out_f, indent=2, ensure_ascii=False)
            
        m3u_content = generate_m3u_file(BRANDING, channels, name)
        with open(f"{name}.m3u", "w", encoding="utf-8") as out_f:
            out_f.write(m3u_content)

    # --- NOW GENERATE THE MASTER CONSOLIDATED MERGED PLAYLIST ---
    if parsed_sources:
        print("\nMerging all playlists into a single unified master playlist...")
        merged_channels = merge_all_playlists(parsed_sources)
        print(f"Total merged channels: {len(merged_channels)}")

        # 1. Output Consolidated unified_playlist.json
        clean_merged_json = []
        for ch in merged_channels:
            clean_ch = {
                "name": ch.get("name", ""),
                "logo": ch.get("logo", ""),
                "url": ch.get("url", ""),
                "group": ch.get("group", "General")
            }
            if ch.get("url_raw"):
                clean_ch["url_raw"] = ch["url_raw"]
            if ch.get("headers") and isinstance(ch["headers"], dict) and len(ch["headers"]) > 0:
                clean_ch["headers"] = ch["headers"]
            if ch.get("attrs") and isinstance(ch["attrs"], dict) and len(ch["attrs"]) > 0:
                clean_ch["attrs"] = ch["attrs"]
            if ch.get("vlc_opts") and isinstance(ch["vlc_opts"], list) and len(ch["vlc_opts"]) > 0:
                clean_ch["vlc_opts"] = ch["vlc_opts"]
            if ch.get("kodiprops") and isinstance(ch["kodiprops"], list) and len(ch["kodiprops"]) > 0:
                clean_ch["kodiprops"] = ch["kodiprops"]
            if ch.get("status"):
                clean_ch["status"] = ch["status"]
            clean_merged_json.append(clean_ch)

        master_json_output = {
            "status": BRANDING["status"],
            "owner": BRANDING["owner"],
            "telegram": BRANDING["telegram"],
            "website": BRANDING["website"],
            "developer": BRANDING["developer"],
            "version": BRANDING["version"],
            "name": "unified_playlist",
            "channels_amount": len(clean_merged_json),
            "Last_update": BRANDING["Last_update"],
            "channels": clean_merged_json
        }

        # Write unified_playlist.json
        with open("unified_playlist.json", "w", encoding="utf-8") as out_f:
            json.dump(master_json_output, out_f, indent=2, ensure_ascii=False)

        # Write unified_playlist.m3u
        master_m3u_content = generate_m3u_file(BRANDING, merged_channels, "unified_playlist")
        with open("unified_playlist.m3u", "w", encoding="utf-8") as out_f:
            out_f.write(master_m3u_content)

        print("Successfully created unified_playlist.m3u and unified_playlist.json!")

if __name__ == "__main__":
    main()
