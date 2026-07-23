import { Channel, StandardPlaylist, PlaylistBranding } from '../types';

export interface PlaylistSourceItem {
  id: string;
  name: string;
  url?: string;
  content?: string;
  channels: Channel[];
  isDefault?: boolean;
}

export interface MergeResult {
  mergedPlaylist: StandardPlaylist;
  stats: {
    totalSources: number;
    defaultSourceChannelsCount: number;
    subsequentSourcesChannelsCount: number;
    consolidatedChannelObjectsCount: number;
    totalDistinctStreamUrls: number;
    multiServerChannelsCount: number;
  };
  channelBreakdownLogs: Array<{
    type: 'default' | 'multi-server' | 'new';
    channelName: string;
    sourceName: string;
    url: string;
    reason: string;
  }>;
}

/**
 * Normalizes channel name by stripping server/resolution tags and prefixes.
 */
function normalizeName(name: string): string {
  if (!name) return '';
  let cleaned = name.trim();

  // Remove country/genre prefixes like "BD:", "IN:", "BANGLA:", "01."
  cleaned = cleaned.replace(/^(bd|in|uk|us|bangla|sports|news|tv|hd|fhd)\s*[:\-\|]\s*/i, '');
  cleaned = cleaned.replace(/^\d+[\.\-\)]\s*/, '');

  // Remove server tags like "(Server 1)", "(Server 2)", "[Server 2]", "(S1)", "[S2]"
  cleaned = cleaned.replace(/[\(\[\{]?(server|s)\s*\d+[\)\]\}]?/gi, '');

  // Remove quality/resolution tags like "HD", "FHD", "4K", "1080p", "720p", "SD", "RAW"
  cleaned = cleaned.replace(/[\(\[\{]?(hd|fhd|uhd|sd|4k|1080p|720p|576p|360p|raw|hevc|h265|h264|vip|backup|alt)[\)\]\}]?/gi, '');

  return cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a name is generic like "Channel 106", "Channel 107", "Stream 1"
 */
function isGenericChannelName(name: string): boolean {
  if (!name) return true;
  const norm = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    /^channel\s*\d*$/i.test(norm) ||
    /^stream\s*\d*$/i.test(norm) ||
    /^server\s*\d*$/i.test(norm) ||
    /^link\s*\d*$/i.test(norm) ||
    norm === 'channel' ||
    norm === 'stream' ||
    norm === 'tv'
  );
}

/**
 * Extracts a channel keyword slug from URL path
 */
function extractSlugFromUrl(url: string): string {
  if (!url) return '';
  try {
    const lowerUrl = url.toLowerCase();
    const pathParts = lowerUrl.split('/');
    for (let i = pathParts.length - 1; i >= 0; i--) {
      let part = pathParts[i];
      part = part.split('?')[0];
      part = part.replace(/\.(m3u8?|ts|mpd|m3u|flv|mp4|mkv)$/i, '');
      part = part.replace(/_(abr|720|1080|576|480|360|hls|mono|live|chunks|index|stream|playlist|master)/gi, '');
      part = part.replace(/(abr|720|1080|576|480|360|hls|mono|live|chunks|index|stream|playlist|master)_/gi, '');
      const cleanPart = part.replace(/[^a-z0-9]/g, '');

      const genericWords = ['index', 'chunks', 'live', 'playlist', 'stream', 'master', 'mono', '720', '1080', 'hls', 'http', 'https', 'video', 'channel', 'output'];
      if (cleanPart.length > 2 && !genericWords.includes(cleanPart)) {
        const baseKeyword = cleanPart.replace(/\d+$/, '');
        if (baseKeyword.length > 2) {
          return baseKeyword;
        }
        return cleanPart;
      }
    }
  } catch (e) {
    // Ignore
  }
  return '';
}

/**
 * Extracts a normalized channel key/slug from name and stream URL.
 * Matches channels with same name or channels where URL path contains specific channel keyword.
 */
function getChannelKey(name: string, url: string): string {
  const isGeneric = isGenericChannelName(name);
  const nameSlug = normalizeName(name);
  const urlSlug = extractSlugFromUrl(url);

  if (!isGeneric && nameSlug.length > 2) {
    return nameSlug;
  }

  if (urlSlug.length > 2) {
    return urlSlug;
  }

  return nameSlug || urlSlug || 'channel';
}

/**
 * Collects all URLs from a channel object (url, url_2, url_3, extra_urls...)
 */
function extractAllUrlsFromChannel(ch: Channel): string[] {
  const urls: string[] = [];
  if (ch.url) urls.push(ch.url.trim());
  if (ch.url_2) urls.push(ch.url_2.trim());
  if (ch.url_3) urls.push(ch.url_3.trim());

  if (ch.extra_urls && Array.isArray(ch.extra_urls)) {
    for (const u of ch.extra_urls) {
      if (u && typeof u === 'string') urls.push(u.trim());
    }
  }

  // Check dynamic url_4, url_5... keys
  for (const key of Object.keys(ch)) {
    if (/^url_\d+$/i.test(key) && key !== 'url_2' && key !== 'url_3') {
      const val = ch[key];
      if (val && typeof val === 'string') urls.push(val.trim());
    }
  }

  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * Merges multiple playlists and consolidates multi-server URLs for each channel:
 * Outputs channel objects with "url", "url_2", "url_3", "url_4"...
 */
export function mergePlaylistsWithDefaultRule(
  sources: { name: string; channels: Channel[] }[],
  branding: PlaylistBranding,
  renameVariantsWithSuffix: boolean = false
): MergeResult {
  if (!sources || sources.length === 0) {
    const today = new Date().toISOString().split('T')[0];
    return {
      mergedPlaylist: {
        branding: { ...branding, channels_amount: 0, Last_update: today },
        channels: []
      },
      stats: {
        totalSources: 0,
        defaultSourceChannelsCount: 0,
        subsequentSourcesChannelsCount: 0,
        consolidatedChannelObjectsCount: 0,
        totalDistinctStreamUrls: 0,
        multiServerChannelsCount: 0
      },
      channelBreakdownLogs: []
    };
  }

  const logs: MergeResult['channelBreakdownLogs'] = [];

  // Internal structure to hold grouped channel data
  interface GroupedChannel {
    key: string;
    name: string;
    logo: string;
    group: string;
    urls: string[]; // Distinct list of stream URLs
    sourceNames: Set<string>;
    attrs: Record<string, string>;
    headers?: Record<string, string>;
    vlc_opts?: string[];
    kodiprops?: string[];
    status?: string;
  }

  const groupedMap = new Map<string, GroupedChannel>();
  const channelOrderKeys: string[] = [];

  let defaultSourceChannelsCount = 0;
  let subsequentSourcesChannelsCount = 0;

  // Process all sources in order (Playlist #1 is Default)
  for (let sIdx = 0; sIdx < sources.length; sIdx++) {
    const src = sources[sIdx];
    if (!src || !src.channels) continue;

    if (sIdx === 0) {
      defaultSourceChannelsCount += src.channels.length;
    } else {
      subsequentSourcesChannelsCount += src.channels.length;
    }

    for (const ch of src.channels) {
      const chUrls = extractAllUrlsFromChannel(ch);
      if (chUrls.length === 0) continue;

      const primaryUrl = chUrls[0];
      const key = getChannelKey(ch.name, primaryUrl);

      if (!groupedMap.has(key)) {
        // Create new grouped channel
        const newGrouped: GroupedChannel = {
          key,
          name: ch.name,
          logo: ch.logo || '',
          group: ch.group && ch.group !== 'General' ? ch.group : 'General',
          urls: [...chUrls],
          sourceNames: new Set([src.name]),
          attrs: {
            ...(ch.attrs || {}),
            'source-playlist': src.name,
            'playlist-role': sIdx === 0 ? 'default' : 'subsequent'
          },
          headers: ch.headers,
          vlc_opts: ch.vlc_opts,
          kodiprops: ch.kodiprops,
          status: ch.status
        };

        groupedMap.set(key, newGrouped);
        channelOrderKeys.push(key);

        logs.push({
          type: sIdx === 0 ? 'default' : 'new',
          channelName: ch.name,
          sourceName: src.name,
          url: primaryUrl,
          reason: `চ্যানেল '${ch.name}' মূল প্লেলিস্ট হিসেবে যুক্ত করা হয়েছে`
        });
      } else {
        // Group exists: add new distinct URLs to this channel!
        const existing = groupedMap.get(key)!;
        existing.sourceNames.add(src.name);

        // Update name/logo/group if existing was generic or empty
        if (isGenericChannelName(existing.name) && !isGenericChannelName(ch.name)) {
          existing.name = ch.name;
        }
        if (!existing.logo && ch.logo) {
          existing.logo = ch.logo;
        }
        if ((!existing.group || existing.group === 'General') && ch.group && ch.group !== 'General') {
          existing.group = ch.group;
        }

        // Add distinct new URLs
        let addedCount = 0;
        for (const u of chUrls) {
          if (!existing.urls.includes(u)) {
            existing.urls.push(u);
            addedCount++;

            logs.push({
              type: 'multi-server',
              channelName: existing.name,
              sourceName: src.name,
              url: u,
              reason: `'${existing.name}' চ্যানেলের জন্য অতিরিক্ত সার্ভার লিঙ্ক (url_${existing.urls.length}) হিসেবে যুক্ত করা হয়েছে`
            });
          }
        }
      }
    }
  }

  // Convert grouped map into final Channel list with url, url_2, url_3...
  const mergedChannels: Channel[] = [];
  let multiServerCount = 0;
  let totalDistinctUrls = 0;

  for (const key of channelOrderKeys) {
    const item = groupedMap.get(key)!;
    totalDistinctUrls += item.urls.length;

    if (item.urls.length > 1) {
      multiServerCount++;
    }

    const finalChannel: Channel = {
      name: item.name,
      logo: item.logo || '',
      group: item.group || 'General',
      url: item.urls[0],
      attrs: {
        ...item.attrs,
        'total-servers': String(item.urls.length),
        'sources': Array.from(item.sourceNames).join(', ')
      }
    };

    // Add url_2, url_3, url_4... for additional server streams
    if (item.urls.length > 1) {
      finalChannel.url_2 = item.urls[1];
    }
    if (item.urls.length > 2) {
      finalChannel.url_3 = item.urls[2];
    }
    if (item.urls.length > 3) {
      const extra: string[] = [];
      for (let i = 3; i < item.urls.length; i++) {
        finalChannel[`url_${i + 1}`] = item.urls[i];
        extra.push(item.urls[i]);
      }
      finalChannel.extra_urls = extra;
    }

    if (item.headers) finalChannel.headers = item.headers;
    if (item.vlc_opts) finalChannel.vlc_opts = item.vlc_opts;
    if (item.kodiprops) finalChannel.kodiprops = item.kodiprops;
    if (item.status) finalChannel.status = item.status;

    mergedChannels.push(finalChannel);
  }

  const today = new Date().toISOString().split('T')[0];

  const updatedBranding: PlaylistBranding = {
    ...branding,
    channels_amount: mergedChannels.length,
    Last_update: today
  };

  return {
    mergedPlaylist: {
      branding: updatedBranding,
      channels: mergedChannels
    },
    stats: {
      totalSources: sources.length,
      defaultSourceChannelsCount,
      subsequentSourcesChannelsCount,
      consolidatedChannelObjectsCount: mergedChannels.length,
      totalDistinctStreamUrls: totalDistinctUrls,
      multiServerChannelsCount: multiServerCount
    },
    channelBreakdownLogs: logs
  };
}
