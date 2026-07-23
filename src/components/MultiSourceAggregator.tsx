import React, { useState, useEffect, useRef } from 'react';
import { Channel, PlaylistBranding, PredefinedSource, StandardPlaylist } from '../types';
import { 
  Layers, 
  Check, 
  Copy, 
  AlertTriangle, 
  ArrowRight, 
  Loader2, 
  Search, 
  Download, 
  Plus, 
  Trash2, 
  MoveUp, 
  MoveDown, 
  Star, 
  Upload, 
  FileText, 
  Sparkles, 
  Link as LinkIcon, 
  CheckCircle2, 
  HelpCircle,
  Server,
  Globe
} from 'lucide-react';
import { generateM3U, generateJSON, parseM3U, parseJSONPlaylist } from '../utils/playlistParser';
import { mergePlaylistsWithDefaultRule, MergeResult } from '../utils/playlistMerger';

interface MultiSourceAggregatorProps {
  predefinedSources: PredefinedSource[];
  branding: PlaylistBranding;
}

export interface ManagedPlaylistSource {
  id: string;
  name: string;
  url?: string;
  channels: Channel[];
  isCustom?: boolean;
  type?: 'm3u' | 'json';
}

export const MultiSourceAggregator: React.FC<MultiSourceAggregatorProps> = ({
  predefinedSources,
  branding
}) => {
  // Playlist sources state - Playlist #1 (index 0) is DEFAULT
  const [sources, setSources] = useState<ManagedPlaylistSource[]>([]);
  const [isFetchingSources, setIsFetchingSources] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Custom input states
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [rawText, setRawText] = useState('');
  const [inputMode, setInputMode] = useState<'preset' | 'url' | 'upload' | 'text'>('preset');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rename variant suffix option
  const [renameVariantsWithSuffix, setRenameVariantsWithSuffix] = useState(true);

  // Merged result state
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [channelSelections, setChannelSelections] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [activeLogFilter, setActiveLogFilter] = useState<'all' | 'default' | 'variant' | 'new' | 'duplicate'>('all');
  
  // Export states
  const [copiedM3U, setCopiedM3U] = useState(false);
  const [copiedJSON, setCopiedJSON] = useState(false);
  const [copiedLiveUrl, setCopiedLiveUrl] = useState(false);
  const [exportFormat, setExportFormat] = useState<'m3u' | 'json'>('m3u');

  // Initialize with predefined sources on first load
  useEffect(() => {
    loadDefaultPresets();
  }, []);

  const loadDefaultPresets = async () => {
    setIsFetchingSources(true);
    setErrorMessage(null);

    try {
      // Load top 3 predefined playlists by default
      const initialPresets = predefinedSources.slice(0, 3);
      const loaded: ManagedPlaylistSource[] = [];

      for (const p of initialPresets) {
        try {
          const res = await fetch(`/api/fetch?url=${encodeURIComponent(p.url)}&name=${encodeURIComponent(p.name)}`);
          if (res.ok) {
            const data: StandardPlaylist = await res.json();
            loaded.push({
              id: p.id,
              name: p.name,
              url: p.url,
              channels: data.channels || [],
              type: p.type
            });
          }
        } catch (e) {
          console.error(`Failed to load default preset ${p.name}:`, e);
        }
      }

      setSources(loaded);
    } catch (e: any) {
      setErrorMessage('ডিফল্ট প্লেলিস্টগুলো লোড করতে সমস্যা হয়েছে।');
    } finally {
      setIsFetchingSources(false);
    }
  };

  // Run merger whenever sources or rename option change
  useEffect(() => {
    if (sources.length > 0) {
      const result = mergePlaylistsWithDefaultRule(sources, branding, renameVariantsWithSuffix);
      setMergeResult(result);

      // Reset selection maps to true for all merged channels
      const initialMap: Record<string, boolean> = {};
      result.mergedPlaylist.channels.forEach((ch, idx) => {
        initialMap[`${ch.url}-${idx}`] = true;
      });
      setChannelSelections(initialMap);
    } else {
      setMergeResult(null);
    }
  }, [sources, branding, renameVariantsWithSuffix]);

  // Add a predefined preset source
  const handleAddPresetSource = async (preset: PredefinedSource) => {
    if (sources.some(s => s.id === preset.id || s.url === preset.url)) {
      setErrorMessage(`'${preset.name}' প্লেলিস্টটি ইতোমধ্যে এড করা আছে!`);
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    setIsFetchingSources(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(preset.url)}&name=${encodeURIComponent(preset.name)}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: StandardPlaylist = await res.json();

      const newSource: ManagedPlaylistSource = {
        id: preset.id,
        name: preset.name,
        url: preset.url,
        channels: data.channels || [],
        type: preset.type
      };

      setSources(prev => [...prev, newSource]);
    } catch (e: any) {
      setErrorMessage(`'${preset.name}' লোড করা সম্ভব হয়নি। URL সঠিক কিনা পরীক্ষা করুন।`);
    } finally {
      setIsFetchingSources(false);
    }
  };

  // Add custom URL source
  const handleAddCustomUrlSource = async () => {
    if (!customUrl.trim()) {
      setErrorMessage('দয়া করে প্লেলিস্টের লিংক (URL) দিন!');
      return;
    }

    setIsFetchingSources(true);
    setErrorMessage(null);

    const playlistName = customName.trim() || `Custom Playlist ${sources.length + 1}`;

    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(customUrl.trim())}&name=${encodeURIComponent(playlistName)}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: StandardPlaylist = await res.json();

      const newSource: ManagedPlaylistSource = {
        id: `custom-url-${Date.now()}`,
        name: playlistName,
        url: customUrl.trim(),
        channels: data.channels || [],
        isCustom: true
      };

      setSources(prev => [...prev, newSource]);
      setCustomUrl('');
      setCustomName('');
    } catch (e: any) {
      setErrorMessage('কাস্টম প্লেলিস্ট লোড করতে ব্যর্থ হয়েছে। প্রক্সি দিয়ে চেষ্টা অথবা ফাইল আপলোড বিকল্প ব্যবহার করুন।');
    } finally {
      setIsFetchingSources(false);
    }
  };

  // Add file upload source (.m3u, .json)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      let channels: Channel[] = [];
      const trimmed = content.trim();
      if (trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXTINF')) {
        channels = parseM3U(content);
      } else {
        try {
          const parsedJson = JSON.parse(content);
          channels = parseJSONPlaylist(parsedJson);
        } catch (e) {
          channels = parseM3U(content);
        }
      }

      if (channels.length === 0) {
        setErrorMessage('আপলোড করা ফাইলে কোনো বৈধ চ্যানেল পাওয়া যায়নি!');
        return;
      }

      const newSource: ManagedPlaylistSource = {
        id: `file-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, "") || `Uploaded File ${sources.length + 1}`,
        channels,
        isCustom: true
      };

      setSources(prev => [...prev, newSource]);
      setErrorMessage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsText(file);
  };

  // Add raw text source
  const handleAddRawTextSource = () => {
    if (!rawText.trim()) {
      setErrorMessage('দয়া করে প্লেলিস্ট কোড পেস্ট করুন!');
      return;
    }

    let channels: Channel[] = [];
    const content = rawText.trim();
    if (content.startsWith('#EXTM3U') || content.includes('#EXTINF')) {
      channels = parseM3U(content);
    } else {
      try {
        const parsedJson = JSON.parse(content);
        channels = parseJSONPlaylist(parsedJson);
      } catch (e) {
        channels = parseM3U(content);
      }
    }

    if (channels.length === 0) {
      setErrorMessage('পেস্ট করা কোডে কোনো বৈধ চ্যানেল পাওয়া যায়নি!');
      return;
    }

    const playlistName = customName.trim() || `Pasted List ${sources.length + 1}`;
    const newSource: ManagedPlaylistSource = {
      id: `pasted-${Date.now()}`,
      name: playlistName,
      channels,
      isCustom: true
    };

    setSources(prev => [...prev, newSource]);
    setRawText('');
    setCustomName('');
    setErrorMessage(null);
  };

  // Source reordering functions
  const moveSourceUp = (index: number) => {
    if (index <= 0) return;
    setSources(prev => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveSourceDown = (index: number) => {
    if (index >= sources.length - 1) return;
    setSources(prev => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const setAsDefaultSource = (index: number) => {
    if (index === 0) return;
    setSources(prev => {
      const selected = prev[index];
      const filtered = prev.filter((_, i) => i !== index);
      return [selected, ...filtered];
    });
  };

  const removeSource = (index: number) => {
    setSources(prev => prev.filter((_, i) => i !== index));
  };

  // Channel selections
  const toggleChannelSelection = (url: string, index: number) => {
    const key = `${url}-${index}`;
    setChannelSelections(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleSelectAll = (selectAll: boolean) => {
    if (!mergeResult) return;
    const nextMap: Record<string, boolean> = {};
    mergeResult.mergedPlaylist.channels.forEach((ch, idx) => {
      nextMap[`${ch.url}-${idx}`] = selectAll;
    });
    setChannelSelections(nextMap);
  };

  const getFinalActiveChannels = (): Channel[] => {
    if (!mergeResult) return [];
    return mergeResult.mergedPlaylist.channels.filter((ch, idx) => channelSelections[`${ch.url}-${idx}`] !== false);
  };

  // Get active playlist object
  const getFinalPlaylistObject = (): StandardPlaylist => {
    const activeChs = getFinalActiveChannels();
    return {
      branding: {
        ...branding,
        channels_amount: activeChs.length,
        Last_update: new Date().toISOString().split('T')[0]
      },
      channels: activeChs
    };
  };

  // Download actions
  const downloadM3UFile = () => {
    const playlist = getFinalPlaylistObject();
    const content = generateM3U(playlist);
    const blob = new Blob([content], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${branding.name || 'unified_merged_playlist'}.m3u`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadJSONFile = () => {
    const playlist = getFinalPlaylistObject();
    const jsonObj = generateJSON(playlist);
    const content = JSON.stringify(jsonObj, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${branding.name || 'unified_merged_playlist'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyContent = (type: 'm3u' | 'json') => {
    const playlist = getFinalPlaylistObject();
    const text = type === 'm3u' ? generateM3U(playlist) : JSON.stringify(generateJSON(playlist), null, 2);
    navigator.clipboard.writeText(text);
    if (type === 'm3u') {
      setCopiedM3U(true);
      setTimeout(() => setCopiedM3U(false), 2000);
    } else {
      setCopiedJSON(true);
      setTimeout(() => setCopiedJSON(false), 2000);
    }
  };

  // Dynamic Live Proxy URL generator for combined sources
  const getLiveProxyUrl = () => {
    const remoteUrls = sources.filter(s => s.url).map(s => s.url);
    if (remoteUrls.length === 0) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const params = new URLSearchParams({
      urls: remoteUrls.join(','),
      format: exportFormat,
      name: branding.name || 'unified_playlist',
      owner: branding.owner || '',
      telegram: branding.telegram || '',
      website: branding.website || '',
      developer: branding.developer || '',
      rename_variants: renameVariantsWithSuffix ? 'true' : 'false'
    });
    return `${origin}/api/merge-playlists?${params.toString()}`;
  };

  const copyLiveProxyUrl = () => {
    const liveUrl = getLiveProxyUrl();
    if (liveUrl) {
      navigator.clipboard.writeText(liveUrl);
      setCopiedLiveUrl(true);
      setTimeout(() => setCopiedLiveUrl(false), 2000);
    }
  };

  // Filter logs for display
  const filteredLogs = (mergeResult?.channelBreakdownLogs || []).filter(l => {
    if (activeLogFilter === 'all') return true;
    return l.type === activeLogFilter;
  });

  // Filter channels for preview
  const activeChannels = getFinalActiveChannels();
  const displayedChannels = activeChannels.filter(ch =>
    ch.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (ch.group && ch.group.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div id="unified-playlist-aggregator" className="space-y-8">
      
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Layers className="w-48 h-48 text-emerald-400" />
        </div>
        
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3.5 py-1 rounded-full text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            একক সমন্বিত প্লে-লিস্ট মার্জার (Unified Playlist Aggregator)
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            সবগুলো প্লে-লিস্ট মিলিয়ে ১টি একক M3U ও JSON প্লে-লিস্ট তৈরি করুন
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            এখানে আপনার এড করা প্রতিটি প্লেলিস্টের জন্য আলাদা আলাদা JSON বা M3U ফাইল না বানিয়ে সবগুলোকে একত্র করে একটি মাস্টার প্লে-লিস্ট তৈরি করা হবে। 
            <strong>১ নম্বর প্লেলিস্টটি হবে আপনার প্রধান (ডিফল্ট) প্লেলিস্ট</strong>। পরবর্তী প্লেলিস্টের কোনো চ্যানেল যদি ডিফল্ট প্লেলিস্টের সাথে মিলে যায় এবং সেটির স্ট্রিম লিঙ্ক ভিন্ন হয়, তবে ব্যাকআপ স্ট্রিম হিসেবে সেটিও এড হবে!
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 px-3 py-1.5 rounded-xl">
              <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span>১ম সোর্স: <strong>ডিফল্ট প্লেলিস্ট</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 px-3 py-1.5 rounded-xl">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>ভিন্ন স্ট্রিম লিংক থাকলে: <strong>অটোমেটিক এড হবে</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 px-3 py-1.5 rounded-xl">
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span>আউটপুট: <strong>একক M3U & JSON</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-2xl text-xs flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button 
            onClick={() => setErrorMessage(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 bg-slate-900 rounded-lg"
          >
            বন্ধ করুন
          </button>
        </div>
      )}

      {/* Grid Layout: Left Source Manager, Right Merge Result & Export */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Playlist Sources & Order Control (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Active Sources List Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  এড করা প্লে-লিস্টসমূহ ({sources.length}টি)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  উপরে থাকা ১ম সোর্সটি ডিফল্ট প্লেলিস্ট হিসেবে গণ্য হবে
                </p>
              </div>

              {isFetchingSources && (
                <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>ডাটা লোড হচ্ছে...</span>
                </div>
              )}
            </div>

            {/* Source items list */}
            <div className="space-y-3">
              {sources.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-800 rounded-2xl text-center space-y-2">
                  <Layers className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400 font-medium">কোনো প্লেলিস্ট এড করা নেই</p>
                  <p className="text-[10px] text-slate-500">নিচের অপশনগুলো থেকে প্লেলিস্ট এড করুন</p>
                </div>
              ) : (
                sources.map((src, index) => {
                  const isDefault = index === 0;
                  return (
                    <div
                      key={src.id}
                      className={`p-3.5 rounded-2xl border transition duration-200 relative space-y-2 ${
                        isDefault
                          ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isDefault ? (
                            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
                              <Star className="w-3 h-3 fill-amber-300" />
                              ডিফল্ট প্লেলিস্ট (#১)
                            </span>
                          ) : (
                            <span className="bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                              প্লেলিস্ট #{index + 1}
                            </span>
                          )}
                          <span className="text-xs font-semibold text-slate-200 truncate">
                            {src.name}
                          </span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isDefault && (
                            <button
                              onClick={() => setAsDefaultSource(index)}
                              title="১ নম্বর ডিফল্ট প্লেলিস্ট হিসেবে সেট করুন"
                              className="p-1 hover:bg-amber-500/20 text-slate-400 hover:text-amber-300 rounded-lg transition text-[10px] flex items-center gap-0.5"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => moveSourceUp(index)}
                            disabled={index === 0}
                            title="উপরে তুলুন"
                            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 rounded-lg transition"
                          >
                            <MoveUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveSourceDown(index)}
                            disabled={index === sources.length - 1}
                            title="নিচে নামান"
                            className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 rounded-lg transition"
                          >
                            <MoveDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeSource(index)}
                            title="প্লেলিস্ট রিমুভ করুন"
                            className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition ml-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
                        <span className="font-mono text-emerald-400 font-semibold">
                          {src.channels.length}টি চ্যানেল
                        </span>
                        {src.url ? (
                          <span className="truncate max-w-[200px] text-slate-500 font-mono">
                            {src.url}
                          </span>
                        ) : (
                          <span className="bg-slate-900 border border-slate-800 px-1.5 py-0.2 rounded text-slate-400">
                            লোকাল ফাইল / টেক্সট
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Merge options toggle */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 hover:text-white transition">
                <input
                  type="checkbox"
                  checked={renameVariantsWithSuffix}
                  onChange={(e) => setRenameVariantsWithSuffix(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-emerald-500 focus:ring-emerald-500/30 w-4 h-4"
                />
                <span>ভিন্ন স্ট্রিম লিংকের ডুপ্লিকেট চ্যানেলে (Server 2) নাম যুক্ত করুন</span>
              </label>
              <p className="text-[10px] text-slate-500 pl-6">
                যেমন: T Sports এবং একই নামের আরেকটি স্ট্রিম আসুক T Sports (Server 2) হিসেবে।
              </p>
            </div>
          </div>

          {/* Add New Playlist Source Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              নতুন প্লে-লিস্ট যোগ করুন (Add More Playlists)
            </h3>

            {/* Mode selection tabs */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-medium">
              <button
                onClick={() => setInputMode('preset')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  inputMode === 'preset' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                প্রিসেট সোর্স
              </button>
              <button
                onClick={() => setInputMode('url')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  inputMode === 'url' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                URL লিংক
              </button>
              <button
                onClick={() => setInputMode('upload')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  inputMode === 'upload' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ফাইল আপলোড
              </button>
              <button
                onClick={() => setInputMode('text')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  inputMode === 'text' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                র টেক্সট
              </button>
            </div>

            {/* Mode 1: Preset */}
            {inputMode === 'preset' && (
              <div className="space-y-2">
                <span className="text-[11px] text-slate-400 block font-medium">প্রিসেট প্লেলিস্ট থেকে সিলেক্ট করে যুক্ত করুন:</span>
                <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {predefinedSources.map(p => {
                    const isAdded = sources.some(s => s.id === p.id || s.url === p.url);
                    return (
                      <div
                        key={p.id}
                        className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="font-semibold text-slate-200 truncate">{p.name}</p>
                          <span className="text-[9px] text-slate-500 font-mono">{p.category} • {p.type.toUpperCase()}</span>
                        </div>
                        <button
                          onClick={() => handleAddPresetSource(p)}
                          disabled={isAdded || isFetchingSources}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition flex-shrink-0 ${
                            isAdded
                              ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed'
                              : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 shadow-md'
                          }`}
                        >
                          {isAdded ? 'এড করা আছে' : '+ এড করুন'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Mode 2: Remote URL */}
            {inputMode === 'url' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">প্লে-লিস্টের নাম (ঐচ্ছিক):</label>
                  <input
                    type="text"
                    placeholder="যেমন: Tapmad Auto Update"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">M3U বা JSON ফাইল URL:</label>
                  <input
                    type="text"
                    placeholder="https://raw.githubusercontent.com/.../playlist.m3u"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none"
                  />
                </div>
                <button
                  onClick={handleAddCustomUrlSource}
                  disabled={isFetchingSources}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-500/10"
                >
                  {isFetchingSources ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  লিংক দিয়ে প্লেলিস্ট যোগ করুন
                </button>
              </div>
            )}

            {/* Mode 3: Upload Local File */}
            {inputMode === 'upload' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">আপনার ডিভাইস থেকে .m3u, .m3u8 অথবা .json ফাইল নির্বাচন করুন:</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m3u,.m3u8,.json,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="playlist-file-upload-input"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-8 border-2 border-dashed border-slate-800 hover:border-emerald-500/50 bg-slate-950 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer transition group"
                >
                  <Upload className="w-6 h-6 text-slate-500 group-hover:text-emerald-400 transition" />
                  <span className="text-xs text-slate-300 font-medium">কম্পিউটার/মোবাইল থেকে ফাইল পছন্দ করুন</span>
                  <span className="text-[10px] text-slate-500">সমর্থিত ফরম্যাট: M3U, M3U8, JSON</span>
                </button>
              </div>
            )}

            {/* Mode 4: Raw Text */}
            {inputMode === 'text' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">প্লে-লিস্ট নাম:</label>
                  <input
                    type="text"
                    placeholder="যেমন: My Custom List"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">M3U বা JSON কোড পেস্ট করুন:</label>
                  <textarea
                    rows={4}
                    placeholder="#EXTM3U&#10;#EXTINF:-1,T Sports&#10;https://..."
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none"
                  ></textarea>
                </div>
                <button
                  onClick={handleAddRawTextSource}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-500/10"
                >
                  <FileText className="w-4 h-4" />
                  টেক্সট থেকে প্লেলিস্ট তৈরি করুন
                </button>
              </div>
            )}

          </div>

        </div>

        {/* Right Column: Unified Single Master Playlist Results & Downloads (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Summary & Download Controls */}
          {mergeResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    মার্জড মাস্টার প্লে-লিস্ট (Single Consolidated Playlist)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    আপনার সিলেক্ট করা সকল সোর্স একত্রিত হয়ে ১টি ব্রান্ডেড ফাইল তৈরি হয়েছে
                  </p>
                </div>

                <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-xl font-mono">
                  সর্বমোট: {activeChannels.length}টি চ্যানেল
                </div>
              </div>

              {/* Stat Boxes Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">১ম সোর্স (ডিফল্ট)</span>
                  <p className="text-base font-bold text-emerald-400 font-mono">
                    {mergeResult.stats.defaultSourceChannelsCount}টি
                  </p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">নতুন যুক্ত চ্যানেল</span>
                  <p className="text-base font-bold text-teal-400 font-mono">
                    +{mergeResult.stats.newChannelsAdded}টি
                  </p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">ভিন্ন স্ট্রিম লিংক</span>
                  <p className="text-base font-bold text-amber-400 font-mono">
                    +{mergeResult.stats.variantStreamsAdded}টি
                  </p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1">
                  <span className="text-[10px] text-slate-400 block font-medium">হুবহু ডুপ্লিকেট বাদ</span>
                  <p className="text-base font-bold text-slate-500 font-mono">
                    {mergeResult.stats.exactDuplicatesSkipped}টি
                  </p>
                </div>
              </div>

              {/* Primary Single Playlist Export Buttons */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold text-slate-300 block">
                  ১ক্লিকে ডাউনলোড ও কপি করুন (Download Consolidated Files):
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Download M3U button */}
                  <button
                    onClick={downloadM3UFile}
                    className="py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/10"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    ডাউনলোড মার্জড M3U (.m3u)
                  </button>

                  {/* Download JSON button */}
                  <button
                    onClick={downloadJSONFile}
                    className="py-3 px-4 bg-teal-500 hover:bg-teal-600 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-teal-500/10"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    ডাউনলোড মার্জড JSON (.json)
                  </button>

                  {/* Copy M3U */}
                  <button
                    onClick={() => copyContent('m3u')}
                    className="py-2.5 px-4 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition"
                  >
                    {copiedM3U ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copiedM3U ? 'M3U কোড কপি হয়েছে!' : 'M3U টেক্সট কোড কপি করুন'}
                  </button>

                  {/* Copy JSON */}
                  <button
                    onClick={() => copyContent('json')}
                    className="py-2.5 px-4 bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition"
                  >
                    {copiedJSON ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    {copiedJSON ? 'JSON কোড কপি হয়েছে!' : 'JSON টেক্সট কোড কপি করুন'}
                  </button>
                </div>
              </div>

              {/* Dynamic Live Proxy Endpoint Box */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-200">সরাসরি IPTV প্লেয়ার অ্যাপে দেখার প্রক্সি লিংক (Live Proxy URL):</span>
                  </div>
                  <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[10px]">
                    <button
                      onClick={() => setExportFormat('m3u')}
                      className={`px-2 py-0.5 rounded font-bold transition ${exportFormat === 'm3u' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}
                    >
                      M3U
                    </button>
                    <button
                      onClick={() => setExportFormat('json')}
                      className={`px-2 py-0.5 rounded font-bold transition ${exportFormat === 'json' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400'}`}
                    >
                      JSON
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  TiviMate, OTT Navigator, Toffee, Kodi বা যেকোনো প্লেয়ারে এই লিংকটি দিলেই অ্যাপ অটোমেটিক সব প্লেলিস্ট মার্জ করে প্রসেস করবে:
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={getLiveProxyUrl() || 'URL জেনারেট হচ্ছে না (কমপক্ষে ১টি রিমোট সোর্স প্রয়োজন)'}
                    className="w-full bg-slate-900 border border-slate-800 text-emerald-400 text-xs font-mono px-3 py-2 rounded-xl select-all focus:outline-none"
                  />
                  <button
                    onClick={copyLiveProxyUrl}
                    disabled={!getLiveProxyUrl()}
                    className="py-2 px-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold text-xs rounded-xl transition flex items-center gap-1.5 flex-shrink-0"
                  >
                    {copiedLiveUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    কপি লিংক
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* Detailed Logs & Channel Search Preview */}
          {mergeResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Search className="w-4 h-4 text-emerald-400" />
                  সমন্বিত চ্যানেলের তালিকা ও সার্চ ({displayedChannels.length}/{activeChannels.length})
                </h3>

                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => handleSelectAll(true)}
                    className="text-slate-400 hover:text-emerald-400 font-medium"
                  >
                    সব সিলেক্ট
                  </button>
                  <span className="text-slate-700">|</span>
                  <button
                    onClick={() => handleSelectAll(false)}
                    className="text-slate-400 hover:text-red-400 font-medium"
                  >
                    সব আনসিলেক্ট
                  </button>
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="চ্যানেলের নাম বা গ্রুপ দিয়ে সার্চ করুন..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-4 py-2 text-slate-200 text-xs focus:outline-none"
                />
              </div>

              {/* Channels list with checkboxes */}
              <div className="bg-slate-950 rounded-2xl border border-slate-800 max-h-[380px] overflow-y-auto divide-y divide-slate-900 pr-1">
                {displayedChannels.map((ch, idx) => {
                  const origIdx = mergeResult.mergedPlaylist.channels.findIndex(m => m.url === ch.url && m.name === ch.name);
                  const isChecked = channelSelections[`${ch.url}-${origIdx}`] !== false;
                  const role = ch.attrs?.['playlist-role'];
                  const sourcePlaylistName = ch.attrs?.['source-playlist'];

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleChannelSelection(ch.url, origIdx)}
                      className="p-3 flex items-center justify-between hover:bg-slate-900/60 cursor-pointer transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                          isChecked ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'border-slate-800 bg-slate-900'
                        }`}>
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                        </div>

                        <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {ch.logo ? (
                            <img
                              src={ch.logo}
                              alt={ch.name}
                              className="w-full h-full object-contain"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://placehold.co/80x80/1e293b/a7f3d0?text=${encodeURIComponent(ch.name.substring(0, 2).toUpperCase())}`;
                              }}
                            />
                          ) : (
                            <span className="text-emerald-400 font-mono text-[10px] font-bold">
                              {ch.name.substring(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className={`text-xs font-semibold truncate ${isChecked ? 'text-slate-200' : 'text-slate-500 line-through'}`}>
                            {ch.name}
                          </p>
                          <span className="text-[10px] text-slate-500">
                            {ch.group || 'General'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {role === 'variant-stream' && (
                          <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-medium">
                            ভিন্ন স্ট্রিম লিংক
                          </span>
                        )}
                        {role === 'default' && (
                          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                            ডিফল্ট
                          </span>
                        )}
                        {role === 'new-channel' && (
                          <span className="text-[9px] bg-teal-500/10 text-teal-300 border border-teal-500/20 px-2 py-0.5 rounded-full font-medium">
                            নতুন
                          </span>
                        )}
                        {sourcePlaylistName && (
                          <span className="text-[9px] bg-slate-900 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded font-mono hidden sm:inline-block">
                            {sourcePlaylistName}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Log Breakdown Accordion / Details */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    মার্জ প্রসেসিং লগ (Breakdown Log)
                  </h4>

                  <div className="flex gap-1 text-[10px]">
                    <button
                      onClick={() => setActiveLogFilter('all')}
                      className={`px-2 py-0.5 rounded ${activeLogFilter === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-500'}`}
                    >
                      সব ({mergeResult.channelBreakdownLogs.length})
                    </button>
                    <button
                      onClick={() => setActiveLogFilter('variant')}
                      className={`px-2 py-0.5 rounded ${activeLogFilter === 'variant' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-500'}`}
                    >
                      ভিন্ন স্ট্রিম ({mergeResult.stats.variantStreamsAdded})
                    </button>
                    <button
                      onClick={() => setActiveLogFilter('duplicate')}
                      className={`px-2 py-0.5 rounded ${activeLogFilter === 'duplicate' ? 'bg-slate-800 text-slate-300 font-bold' : 'text-slate-500'}`}
                    >
                      বাদ পড়া ডুপ্লিকেট ({mergeResult.stats.exactDuplicatesSkipped})
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 max-h-[160px] overflow-y-auto font-mono text-[11px] space-y-1.5">
                  {filteredLogs.map((log, idx) => {
                    let badgeColor = 'text-slate-400';
                    if (log.type === 'default') badgeColor = 'text-emerald-400';
                    if (log.type === 'variant') badgeColor = 'text-amber-400 font-bold';
                    if (log.type === 'new') badgeColor = 'text-teal-400';
                    if (log.type === 'duplicate') badgeColor = 'text-slate-600';

                    return (
                      <div key={idx} className="flex items-start gap-2 border-b border-slate-900/60 pb-1">
                        <span className={`text-[10px] ${badgeColor} flex-shrink-0 uppercase font-bold`}>
                          [{log.type}]
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="text-slate-200 font-semibold">{log.channelName}</span>
                          <span className="text-slate-500 text-[10px] block font-sans">{log.reason}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
};
