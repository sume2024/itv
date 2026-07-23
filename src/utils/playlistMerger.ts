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
 * Merges multiple playlists according to the user's rule:
 * 1. Playlist #1 is the Default Playlist. All channels from it are added first.
 * 2. Subsequent Playlists (#2, #3...):
 *    - If channel name matches a channel in the Default Playlist AND has a DIFFERENT stream URL, add it as a new stream entry.
 *    - If channel name matches AND stream URL is IDENTICAL, skip it as exact duplicate.
 *    - If channel name is not in the Default Playlist, add it directly.
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

  const defaultSource = sources[0]; // Playlist #1 is the DEFAULT playlist
  let defaultSourceChannelsCount = 0;
  let subsequentSourcesChannelsCount = 0;
  let newChannelsAdded = 0;
  let variantStreamsAdded = 0;
  let exactDuplicatesSkipped = 0;

  // --- STEP 1: Add all channels from Playlist #1 (Default Playlist) ---
  if (defaultSource && defaultSource.channels) {
    defaultSourceChannelsCount = defaultSource.channels.length;
    for (const ch of defaultSource.channels) {
      if (!ch.url) continue;

      const normName = normalizeName(ch.name);

      if (!defaultChannelUrlsByName.has(normName)) {
        defaultChannelUrlsByName.set(normName, new Set());
      }
      defaultChannelUrlsByName.get(normName)!.add(ch.url.trim());
      globalSeenUrls.add(ch.url.trim());
      channelVariantCounters.set(normName, 1);

      mergedChannels.push({
        ...ch,
        group: ch.group || 'General',
        attrs: {
          ...(ch.attrs || {}),
          'source-playlist': defaultSource.name,
          'playlist-role': 'default'
        }
      });

      logs.push({
        type: 'default',
        channelName: ch.name,
        sourceName: defaultSource.name,
        url: ch.url,
        reason: 'ডিফল্ট প্লেলিস্টের মূল চ্যানেল হিসেবে যুক্ত করা হয়েছে'
      });
    }
  }

  // --- STEP 2: Process subsequent playlists (#2, #3, etc.) ---
  for (let sIdx = 1; sIdx < sources.length; sIdx++) {
    const src = sources[sIdx];
    if (!src || !src.channels) continue;

    subsequentSourcesChannelsCount += src.channels.length;

    for (const ch of src.channels) {
      if (!ch.url) continue;

      const trimmedUrl = ch.url.trim();
      const normName = normalizeName(ch.name);
      const isNameInDefault = defaultChannelUrlsByName.has(normName);

      // Check if exact stream URL already exists in merged list
      if (globalSeenUrls.has(trimmedUrl)) {
        exactDuplicatesSkipped++;
        logs.push({
          type: 'duplicate',
          channelName: ch.name,
          sourceName: src.name,
          url: ch.url,
          reason: 'ডিফল্ট বা পূর্ববর্তী প্লেলিস্টে একই চ্যানেল ও স্ট্রিম লিঙ্ক বিদ্যমান থাকায় স্কিপ করা হয়েছে'
        });
        continue;
      }

      if (isNameInDefault) {
        // Channel name matches Default Playlist, BUT has a DIFFERENT stream link!
        // As requested: "হুবহু মিলে গেলে যদি সে চ্যানেলটি স্ট্রিম লিঙ্ক ভিন্ন হয় তাহলে সেটিকেও এড করবে"
        variantStreamsAdded++;
        globalSeenUrls.add(trimmedUrl);

        const currentCount = (channelVariantCounters.get(normName) || 1) + 1;
        channelVariantCounters.set(normName, currentCount);

        const displayName = renameVariantsWithSuffix
          ? `${ch.name} (Server ${currentCount})`
          : ch.name;

        mergedChannels.push({
          ...ch,
          name: displayName,
          group: ch.group || 'General',
          attrs: {
            ...(ch.attrs || {}),
            'source-playlist': src.name,
            'playlist-role': 'variant-stream'
          }
        });

        logs.push({
          type: 'variant',
          channelName: displayName,
          sourceName: src.name,
          url: ch.url,
          reason: `ডিফল্ট চ্যানেলের নাম ('${ch.name}') এক কিন্তু স্ট্রিম লিঙ্ক ভিন্ন হওয়ায় অতিরিক্ত স্ট্রিম লিংক হিসেবে যুক্ত করা হয়েছে (সোর্স: ${src.name})`
        });
      } else {
        // Brand new channel not in Default Playlist
        newChannelsAdded++;
        globalSeenUrls.add(trimmedUrl);

        mergedChannels.push({
          ...ch,
          group: ch.group || 'General',
          attrs: {
            ...(ch.attrs || {}),
            'source-playlist': src.name,
            'playlist-role': 'new-channel'
          }
        });

        logs.push({
          type: 'new',
          channelName: ch.name,
          sourceName: src.name,
          url: ch.url,
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
