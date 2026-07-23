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
    newChannelsAdded: number;
    variantStreamsAdded: number;
    exactDuplicatesSkipped: number;
  };
  channelBreakdownLogs: Array<{
    type: 'default' | 'new' | 'variant' | 'duplicate';
    channelName: string;
    sourceName: string;
    url: string;
    reason: string;
  }>;
}

/**
 * Normalizes channel name for comparison (removes extra spaces, lowercase)
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Strips common stream quality and country tags from channel name to derive base name
 * e.g., "Zee Bangla HD (BD)" -> "zee bangla"
 * "T Sports 1080p" -> "t sports"
 * Preserves actual channel numbers like "Sony Ten 1", "Sports 18 2"
 */
function cleanBaseName(name: string): string {
  let cleaned = name.trim().toLowerCase();
  // Remove content inside brackets/parentheses e.g. (BD), [IN], (HD)
  cleaned = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  // Remove prefixes like "bd:", "in:", "us:", "uk:"
  cleaned = cleaned.replace(/^(bd|in|us|uk|in-bd|bd-in)\s*:\s*/g, '');
  // Remove quality and server keywords
  cleaned = cleaned.replace(/\b(hd|fhd|sd|4k|hevc|raw|vip|premium|backup|server|live|720p|1080p|50fps|60fps|m3u8)\b/g, ' ');
  // Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes string to a clean alphanumeric slug
 */
function toSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a channel name is generic (e.g., "Channel 106", "Channel 107", "Ch 101", "Stream 2", "Line 1")
 */
function isGenericChannelName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return /^(channel|ch|stream|server|live|line|feed)\s*[\.\-_]?\s*\d+$/i.test(trimmed) || /^\d+$/.test(trimmed);
}

interface CanonicalInfo {
  canonicalName: string;
  logo: string;
  group: string;
  slug: string;
  baseNameKey: string;
}

/**
 * Merges multiple playlists according to the user's rule:
 * 1. Playlist #1 is the Default Playlist. All channels from it are added first.
 * 2. Subsequent Playlists (#2, #3...):
 *    - If channel name matches a channel in the Default Playlist AND has a DIFFERENT stream URL, add it as a new stream entry.
 *    - If channel name matches AND stream URL is IDENTICAL, skip it as exact duplicate.
 *    - If channel name is not in the Default Playlist, add it directly.
 * 3. Smart Resolver:
 *    - Automatically identifies generic channel names like "Channel 106", "Channel 107" from stream URLs or matches.
 *    - Inherits the exact SAME channel name, logo, and group from the matching main channel!
 *    - Longer slug matching prioritization prevents false positive matches.
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
        newChannelsAdded: 0,
        variantStreamsAdded: 0,
        exactDuplicatesSkipped: 0
      },
      channelBreakdownLogs: []
    };
  }

  const mergedChannels: Channel[] = [];
  const logs: MergeResult['channelBreakdownLogs'] = [];

  // Map to store stream URLs associated with normalized channel names in the default playlist
  const defaultChannelUrlsByName = new Map<string, Set<string>>();
  // Set of all unique stream URLs added to the merged playlist
  const globalSeenUrls = new Set<string>();
  // Counter for variants per channel name
  const channelVariantCounters = new Map<string, number>();

  // Knowledge maps for canonical channels
  const canonicalByName = new Map<string, CanonicalInfo>();
  const canonicalByBaseName = new Map<string, CanonicalInfo>();
  const canonicalBySlugList: CanonicalInfo[] = [];

  // --- PRE-PASS: Build Knowledge Base of Non-Generic Channels ---
  for (const src of sources) {
    if (!src || !src.channels) continue;
    for (const ch of src.channels) {
      if (!ch.name || isGenericChannelName(ch.name)) continue;

      const norm = normalizeName(ch.name);
      const baseKey = cleanBaseName(ch.name);
      const slug = toSlug(baseKey || ch.name);

      if (!canonicalByName.has(norm)) {
        const info: CanonicalInfo = {
          canonicalName: ch.name.trim(),
          logo: ch.logo || '',
          group: ch.group || 'General',
          slug,
          baseNameKey: baseKey
        };

        canonicalByName.set(norm, info);

        if (baseKey && !canonicalByBaseName.has(baseKey)) {
          canonicalByBaseName.set(baseKey, info);
        }

        if (slug.length >= 3 && !canonicalBySlugList.some(c => c.slug === slug)) {
          canonicalBySlugList.push(info);
        }
      } else {
        // Enrich logo/group if missing
        const existing = canonicalByName.get(norm)!;
        if (!existing.logo && ch.logo) {
          existing.logo = ch.logo;
        }
        if ((!existing.group || existing.group === 'General') && ch.group && ch.group !== 'General') {
          existing.group = ch.group;
        }
      }
    }
  }

  // Sort canonical slugs by length DESCENDING so longer specific names match first (e.g. "zeebangla" before "zee")
  canonicalBySlugList.sort((a, b) => b.slug.length - a.slug.length);

  /**
   * Helper to resolve a channel (fixing generic names like "Channel 106", inheriting logo & group)
   */
  function resolveChannelInfo(ch: Channel): { name: string; logo: string; group: string } {
    let rawName = ch.name ? ch.name.trim() : '';
    let logo = ch.logo || '';
    let group = ch.group || 'General';

    const isGeneric = isGenericChannelName(rawName);
    const norm = normalizeName(rawName);
    const baseKey = cleanBaseName(rawName);

    // 1. Direct match by exact normalized name
    if (canonicalByName.has(norm)) {
      const canonical = canonicalByName.get(norm)!;
      rawName = canonical.canonicalName;
      if (!logo) logo = canonical.logo;
      if (!group || group === 'General') group = canonical.group;
      return { name: rawName, logo, group };
    }

    // 2. Match by cleaned base name (e.g., "Zee Bangla HD" matching "Zee Bangla")
    if (baseKey && canonicalByBaseName.has(baseKey)) {
      const canonical = canonicalByBaseName.get(baseKey)!;
      rawName = canonical.canonicalName;
      if (!logo) logo = canonical.logo;
      if (!group || group === 'General') group = canonical.group;
      return { name: rawName, logo, group };
    }

    // 3. If generic or unmatched name, try matching stream URL against sorted canonical slugs
    if (isGeneric || !canonicalByName.has(norm)) {
      const urlClean = toSlug(ch.url || '');
      for (const canonical of canonicalBySlugList) {
        if (canonical.slug.length >= 3 && urlClean.includes(canonical.slug)) {
          // Matched via URL! e.g., "Channel 106" -> "Zee Bangla"
          rawName = canonical.canonicalName;
          if (!logo) logo = canonical.logo;
          if (!group || group === 'General') group = canonical.group;
          return { name: rawName, logo, group };
        }
      }
    }

    return { name: rawName, logo, group };
  }

  const defaultSource = sources[0]; // Playlist #1 is the DEFAULT playlist
  let defaultSourceChannelsCount = 0;
  let subsequentSourcesChannelsCount = 0;
  let newChannelsAdded = 0;
  let variantStreamsAdded = 0;
  let exactDuplicatesSkipped = 0;

  // --- STEP 1: Add all channels from Playlist #1 (Default Playlist) ---
  if (defaultSource && defaultSource.channels) {
    defaultSourceChannelsCount = defaultSource.channels.length;
    for (const rawCh of defaultSource.channels) {
      if (!rawCh.url) continue;

      const trimmedUrl = rawCh.url.trim();
      if (globalSeenUrls.has(trimmedUrl)) {
        exactDuplicatesSkipped++;
        continue;
      }

      const resolved = resolveChannelInfo(rawCh);
      const normName = normalizeName(resolved.name);

      if (!defaultChannelUrlsByName.has(normName)) {
        defaultChannelUrlsByName.set(normName, new Set());
      }
      defaultChannelUrlsByName.get(normName)!.add(trimmedUrl);
      globalSeenUrls.add(trimmedUrl);
      
      const count = (channelVariantCounters.get(normName) || 0) + 1;
      channelVariantCounters.set(normName, count);

      const displayName = (count > 1 && renameVariantsWithSuffix)
        ? `${resolved.name} (Server ${count})`
        : resolved.name;

      mergedChannels.push({
        ...rawCh,
        name: displayName,
        logo: resolved.logo,
        group: resolved.group,
        attrs: {
          ...(rawCh.attrs || {}),
          'source-playlist': defaultSource.name,
          'playlist-role': 'default'
        }
      });

      logs.push({
        type: 'default',
        channelName: displayName,
        sourceName: defaultSource.name,
        url: rawCh.url,
        reason: 'ডিফল্ট প্লেলিস্টের মূল চ্যানেল হিসেবে যুক্ত করা হয়েছে'
      });
    }
  }

  // --- STEP 2: Process subsequent playlists (#2, #3, etc.) ---
  for (let sIdx = 1; sIdx < sources.length; sIdx++) {
    const src = sources[sIdx];
    if (!src || !src.channels) continue;

    subsequentSourcesChannelsCount += src.channels.length;

    for (const rawCh of src.channels) {
      if (!rawCh.url) continue;

      const trimmedUrl = rawCh.url.trim();

      // Check if exact stream URL already exists in merged list
      if (globalSeenUrls.has(trimmedUrl)) {
        exactDuplicatesSkipped++;
        logs.push({
          type: 'duplicate',
          channelName: rawCh.name,
          sourceName: src.name,
          url: rawCh.url,
          reason: 'ডিফল্ট বা পূর্ববর্তী প্লেলিস্টে একই চ্যানেল ও স্ট্রিম লিঙ্ক বিদ্যমান থাকায় স্কিপ করা হয়েছে'
        });
        continue;
      }

      const resolved = resolveChannelInfo(rawCh);
      const normName = normalizeName(resolved.name);
      const isNameInDefault = defaultChannelUrlsByName.has(normName);

      if (isNameInDefault) {
        // Channel name matches Default Playlist, BUT has a DIFFERENT stream link!
        variantStreamsAdded++;
        globalSeenUrls.add(trimmedUrl);

        const currentCount = (channelVariantCounters.get(normName) || 1) + 1;
        channelVariantCounters.set(normName, currentCount);

        const displayName = renameVariantsWithSuffix
          ? `${resolved.name} (Server ${currentCount})`
          : resolved.name;

        mergedChannels.push({
          ...rawCh,
          name: displayName,
          logo: resolved.logo,
          group: resolved.group,
          attrs: {
            ...(rawCh.attrs || {}),
            'source-playlist': src.name,
            'playlist-role': 'variant-stream'
          }
        });

        logs.push({
          type: 'variant',
          channelName: displayName,
          sourceName: src.name,
          url: rawCh.url,
          reason: `ডিফল্ট চ্যানেলের নাম ('${resolved.name}') এক কিন্তু স্ট্রিম লিঙ্ক ভিন্ন হওয়ায় অতিরিক্ত স্ট্রিম লিংক হিসেবে যুক্ত করা হয়েছে (সোর্স: ${src.name})`
        });
      } else {
        // Brand new channel not in Default Playlist
        newChannelsAdded++;
        globalSeenUrls.add(trimmedUrl);

        const currentCount = (channelVariantCounters.get(normName) || 0) + 1;
        channelVariantCounters.set(normName, currentCount);

        mergedChannels.push({
          ...rawCh,
          name: resolved.name,
          logo: resolved.logo,
          group: resolved.group,
          attrs: {
            ...(rawCh.attrs || {}),
            'source-playlist': src.name,
            'playlist-role': 'new-channel'
          }
        });

        logs.push({
          type: 'new',
          channelName: resolved.name,
          sourceName: src.name,
          url: rawCh.url,
          reason: `ডিফল্ট প্লেলিস্টে অনুপস্থিত নতুন চ্যানেল হিসেবে যুক্ত করা হয়েছে (সোর্স: ${src.name})`
        });
      }
    }
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
      newChannelsAdded,
      variantStreamsAdded,
      exactDuplicatesSkipped
    },
    channelBreakdownLogs: logs
  };
}
