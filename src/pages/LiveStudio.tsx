import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import { 
  Radio, 
  Tv, 
  Users, 
  Clock, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  ExternalLink, 
  Send, 
  Settings, 
  Activity, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  RefreshCw,
  Sparkles,
  MessageSquare,
  Play,
  Zap,
  RotateCcw
} from 'lucide-react';

interface ChatMessage {
  id: string;
  userId: number;
  userName: string;
  avatarUrl: string;
  message: string;
  timestamp: string;
  isCreator?: boolean;
}

const LiveStudio: React.FC = () => {
  const currentIp = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  
  // Baca akun pengguna yang sedang login dari localStorage
  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  });

  const creatorName = currentUser 
    ? `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email?.split('@')[0] || 'Kreator OmniHub'
    : 'Kreator OmniHub';
  const defaultStreamKey = currentUser?.id ? `stream_key_${currentUser.id}` : 'stream_key_wiji_hub';
  const defaultTitle = `Live Stream ${creatorName}`;
  const defaultDesc = `Siaran langsung resmi dari channel ${creatorName}`;

  const [liveData, setLiveData] = useState({
    isLive: false,
    rtmpUrl: `rtmp://${currentIp}:1935/live`,
    streamKey: defaultStreamKey,
    title: defaultTitle,
    category: 'Gaming / Entertainment',
    description: defaultDesc,
    flvUrl: `/api/live/stream/${defaultStreamKey}.flv`,
    hlsUrl: `/live/${defaultStreamKey}/index.m3u8`,
    viewerCount: 0,
    startedAt: null as string | null
  });

  const [editTitle, setEditTitle] = useState(defaultTitle);
  const [editCategory, setEditCategory] = useState('Gaming / Entertainment');
  const [editDescription, setEditDescription] = useState(defaultDesc);
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [showKey, setShowKey] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [durationString, setDurationString] = useState('00:00:00');
  const [isVideoBuffering, setIsVideoBuffering] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.8);

  // Streaming Engine States
  const [streamProtocol, setStreamProtocol] = useState<'FLV' | 'HLS'>('FLV');
  const [playBlocked, setPlayBlocked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputChat, setInputChat] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mpegtsPlayerRef = useRef<mpegts.Player | null>(null);
  const hlsPlayerRef = useRef<Hls | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // 0. Sinkronisasi identitas kreator yang login ke server
  useEffect(() => {
    if (currentUser?.id) {
      axios.post('/api/live/update', {
        userId: currentUser.id,
        streamKey: defaultStreamKey,
        title: defaultTitle,
        description: defaultDesc
      }).catch(() => {});
    }
  }, [currentUser?.id]);

  // 1. Inisialisasi Socket.IO untuk Real-Time Sync & Live Chat
  useEffect(() => {
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.emit('join_live_room');

    socket.on('live_status_change', (data: any) => {
      console.log('[LIVE STUDIO] Realtime status change:', data);
      setLiveData(prev => ({
        ...prev,
        isLive: Boolean(data.isLive),
        streamKey: data.streamKey || prev.streamKey,
        title: data.title || prev.title,
        startedAt: data.startedAt || prev.startedAt,
        flvUrl: data.flvUrl || `/api/live/stream/${data.streamKey || prev.streamKey}.flv`,
        hlsUrl: data.hlsUrl || `/live/${data.streamKey || prev.streamKey}/index.m3u8`
      }));
    });

    socket.on('live_viewer_count', (data: any) => {
      if (typeof data.count === 'number') {
        setLiveData(prev => ({ ...prev, viewerCount: data.count }));
      }
    });

    socket.on('new_live_chat', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      }, 50);
    });

    // Ambil histori chat awal
    axios.get('/api/live/chat')
      .then(res => {
        if (res.data?.success && Array.isArray(res.data.messages)) {
          setChatMessages(res.data.messages);
        }
      })
      .catch(() => {});

    return () => {
      socket.emit('leave_live_room');
      socket.disconnect();
    };
  }, []);

  // 2. Polling status live sebagai fallback heartbeat setiap 2.5 detik
  useEffect(() => {
    let isMounted = true;
    const fetchStatus = () => {
      axios.get('/api/live/status')
        .then(res => {
          if (!isMounted || !res.data) return;
          const d = res.data;
          setLiveData(prev => ({
            ...prev,
            isLive: Boolean(d.isLive),
            rtmpUrl: d.rtmpUrl || prev.rtmpUrl,
            streamKey: d.streamKey || prev.streamKey,
            title: d.title || prev.title,
            category: d.category || prev.category,
            description: d.description || prev.description,
            viewerCount: typeof d.viewerCount === 'number' ? d.viewerCount : prev.viewerCount,
            startedAt: d.startedAt || prev.startedAt,
            flvUrl: d.flvUrl || prev.flvUrl,
            hlsUrl: d.hlsUrl || prev.hlsUrl
          }));

          if (d.title && d.title !== 'Live Stream Wiji Prabowo') {
            setEditTitle(d.title);
          }
          if (d.category) {
            setEditCategory(d.category);
          }
          if (d.description && d.description !== 'Siaran langsung resmi dari OmniHub Live Studio') {
            setEditDescription(d.description);
          }
        })
        .catch(err => console.error('[STUDIO] Polling status failed:', err));
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // 3. Timer Durasi Siaran Langsung (Count-up timer)
  useEffect(() => {
    if (!liveData.isLive) {
      setDurationString('00:00:00');
      return;
    }

    const startTime = liveData.startedAt ? new Date(liveData.startedAt).getTime() : Date.now();
    const timer = setInterval(() => {
      const diffSecs = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      const hrs = Math.floor(diffSecs / 3600);
      const mins = Math.floor((diffSecs % 3600) / 60);
      const secs = diffSecs % 60;
      setDurationString(
        `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [liveData.isLive, liveData.startedAt]);

  // 4. Video Player Engine (mpegts.js Low-Latency FLV + HLS fallback)
  useEffect(() => {
    if (!liveData.isLive) {
      if (mpegtsPlayerRef.current) {
        try { mpegtsPlayerRef.current.destroy(); } catch (e) {}
        mpegtsPlayerRef.current = null;
      }
      if (hlsPlayerRef.current) {
        try { hlsPlayerRef.current.destroy(); } catch (e) {}
        hlsPlayerRef.current = null;
      }
      setIsVideoBuffering(false);
      setPlayBlocked(false);
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    setIsVideoBuffering(true);
    setPlayBlocked(false);
    let isCleanedUp = false;
    let initialTimer: any = null;
    let watchdogTimer: any = null;

    const streamKey = liveData.streamKey || 'stream_key_wiji_hub';
    const flvStreamUrl = `/api/live/stream/${streamKey}.flv`;
    const hlsStreamUrl = `/live/${streamKey}/index.m3u8`;

    // Pastikan DOM video diset muted agar lolos policy autoplay browser
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.playsInline = true;

    const dismissBuffering = () => {
      setIsVideoBuffering(false);
      setPlayBlocked(false);
    };

    videoEl.addEventListener('playing', dismissBuffering);
    videoEl.addEventListener('canplay', dismissBuffering);
    videoEl.addEventListener('loadeddata', dismissBuffering);
    const onTimeUpdate = () => {
      if (videoEl.currentTime > 0) dismissBuffering();
    };
    videoEl.addEventListener('timeupdate', onTimeUpdate);

    const startHls = () => {
      if (isCleanedUp || !videoEl) return;
      setStreamProtocol('HLS');

      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (mpegtsPlayerRef.current) {
        try { mpegtsPlayerRef.current.destroy(); } catch (e) {}
        mpegtsPlayerRef.current = null;
      }

      if (Hls.isSupported()) {
        if (hlsPlayerRef.current) {
          try { hlsPlayerRef.current.destroy(); } catch (e) {}
        }
        const hls = new Hls({
          manifestLoadingTimeOut: 5000,
          manifestLoadingMaxRetry: 10,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 4,
          maxBufferLength: 4,
          enableWorker: false // Worker nonaktif agar kebal CSP
        });
        hlsPlayerRef.current = hls;
        hls.loadSource(hlsStreamUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          dismissBuffering();
          videoEl.muted = true;
          videoEl.play().catch(err => {
            console.warn('[STUDIO HLS] Autoplay blocked:', err);
            setPlayBlocked(true);
            setIsVideoBuffering(false);
          });
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          dismissBuffering();
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                break;
            }
          }
        });
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = hlsStreamUrl;
        videoEl.play().catch(() => {
          setPlayBlocked(true);
          setIsVideoBuffering(false);
        });
      }
    };

    const startMpegts = () => {
      if (isCleanedUp || !videoEl) return;

      if (mpegtsPlayerRef.current) {
        try { mpegtsPlayerRef.current.destroy(); } catch (e) {}
        mpegtsPlayerRef.current = null;
      }

      if (mpegts.isSupported()) {
        try {
          setStreamProtocol('FLV');
          const player = mpegts.createPlayer({
            type: 'flv',
            isLive: true,
            url: flvStreamUrl
          }, {
            enableWorker: false, // JANGAN gunakan worker agar tidak terbentur CSP / blob worker crash
            lazyLoad: false,
            seekType: 'range',
            autoCleanupSourceBuffer: true,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 2.5,
            liveBufferLatencyMinRemain: 0.3
          });

          mpegtsPlayerRef.current = player;
          player.attachMediaElement(videoEl);
          player.load();

          videoEl.muted = true;
          const playPromise = player.play();
          if (playPromise && typeof (playPromise as any).catch === 'function') {
            (playPromise as any).catch((err: any) => {
              console.warn('[STUDIO] mpegts play interrupted or autoplay blocked:', err);
              if (err?.name === 'NotAllowedError') {
                setPlayBlocked(true);
                setIsVideoBuffering(false);
              }
            });
          }

          player.on(mpegts.Events.ERROR, (errType: any, errDetail: any) => {
            console.warn('[STUDIO] mpegts error encountered, switching to HLS...', errType, errDetail);
            startHls();
          });

          // Watchdog: jika setelah 2.5 detik belum memutar frame pertama (currentTime masih 0), otomatis fallback ke HLS
          watchdogTimer = setTimeout(() => {
            if (!isCleanedUp && (videoEl.paused || videoEl.currentTime === 0)) {
              console.log('[STUDIO] FLV initial frames taking >2.5s, switching to HLS stream fallback...');
              startHls();
            }
          }, 2500);

        } catch (e) {
          console.error('[STUDIO] Failed to init mpegts player, trying HLS:', e);
          startHls();
        }
      } else {
        startHls();
      }
    };

    if (streamProtocol === 'HLS') {
      startHls();
    } else {
      initialTimer = setTimeout(startMpegts, 300);
    }

    return () => {
      isCleanedUp = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (watchdogTimer) clearTimeout(watchdogTimer);

      videoEl.removeEventListener('playing', dismissBuffering);
      videoEl.removeEventListener('canplay', dismissBuffering);
      videoEl.removeEventListener('loadeddata', dismissBuffering);
      videoEl.removeEventListener('timeupdate', onTimeUpdate);

      if (mpegtsPlayerRef.current) {
        try { mpegtsPlayerRef.current.destroy(); } catch (e) {}
        mpegtsPlayerRef.current = null;
      }
      if (hlsPlayerRef.current) {
        try { hlsPlayerRef.current.destroy(); } catch (e) {}
        hlsPlayerRef.current = null;
      }
    };
  }, [liveData.isLive, liveData.streamKey, refreshKey, streamProtocol]);

  // Handle Controls & Streaming Helpers
  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
    }
  };

  const handleManualPlay = () => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      const p = videoRef.current.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          setIsVideoBuffering(false);
          setPlayBlocked(false);
        }).catch((e) => console.warn('Studio manual play failed:', e));
      } else {
        setIsVideoBuffering(false);
        setPlayBlocked(false);
      }
    }
  };

  const toggleProtocol = () => {
    setIsVideoBuffering(true);
    setStreamProtocol(prev => prev === 'FLV' ? 'HLS' : 'FLV');
  };

  const handleRefreshStream = () => {
    setIsVideoBuffering(true);
    setRefreshKey(prev => prev + 1);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val === 0) {
        videoRef.current.muted = true;
        setIsMuted(true);
      } else {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (!document.fullscreenElement) {
        videoRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Simpan Metadata Siaran
  const handleSaveMeta = async () => {
    setIsSavingMeta(true);
    setSaveSuccess(false);
    try {
      await axios.post('/api/live/update', {
        userId: currentUser?.id || 1,
        streamKey: liveData.streamKey,
        title: editTitle,
        category: editCategory,
        description: editDescription
      });
      setLiveData(prev => ({
        ...prev,
        title: editTitle,
        category: editCategory,
        description: editDescription
      }));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Save meta error:', err);
    } finally {
      setIsSavingMeta(false);
    }
  };

  // Kirim Pesan Chat sebagai Kreator
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputChat.trim() || !socketRef.current) return;

    socketRef.current.emit('send_live_chat', {
      userId: currentUser?.id || 1,
      userName: `${creatorName} (Host)`,
      avatarUrl: currentUser?.avatar_url || '',
      message: inputChat.trim(),
      isCreator: true
    });

    setInputChat('');
  };

  const dynamicRtmpUrl = typeof window !== 'undefined' ? `rtmp://${window.location.hostname}:1935/live` : 'rtmp://localhost:1935/live';
  const publicViewerUrl = typeof window !== 'undefined' ? `${window.location.origin}/live/${liveData.streamKey}` : `/live/${liveData.streamKey}`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8 font-sans">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-600/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-lg shadow-red-600/10">
            <Radio size={24} className={liveData.isLive ? 'animate-pulse text-red-500' : 'text-neutral-500'} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              Ruang Kontrol Siaran Langsung
            </h1>
            <p className="text-xs text-neutral-400">
              OmniHub Live Studio • Channel: <span className="font-bold text-white">{creatorName}</span>
            </p>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div className="flex items-center gap-3">
          {liveData.isLive && (
            <div className="flex items-center gap-4 bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl text-xs">
              <div className="flex items-center gap-2 text-neutral-300 font-medium">
                <Clock size={15} className="text-red-500" />
                <span className="font-mono font-bold text-white">{durationString}</span>
              </div>
              <div className="w-px h-4 bg-neutral-800"></div>
              <div className="flex items-center gap-2 text-neutral-300 font-medium">
                <Users size={15} className="text-brand-400" />
                <span className="font-bold text-white">{liveData.viewerCount}</span>
                <span className="text-neutral-500">Penonton</span>
              </div>
            </div>
          )}

          <div className={`px-4 py-2 rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-md ${
            liveData.isLive 
              ? 'bg-red-600 text-white shadow-red-600/30 animate-pulse' 
              : 'bg-neutral-900 border border-neutral-800 text-neutral-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${liveData.isLive ? 'bg-white' : 'bg-neutral-500'}`}></span>
            {liveData.isLive ? 'LIVE ON AIR' : 'OFFLINE'}
          </div>

          <a 
            href={publicViewerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 text-xs font-bold transition-all"
          >
            <ExternalLink size={14} />
            <span>Halaman Penonton</span>
          </a>
        </div>
      </div>

      {/* Grid Konten Utama: 2 Kolom Besar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        
        {/* Kolom 1 & 2: Layar Preview Player & Pengaturan */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Layar Player Preview (Video) */}
          <div 
            onClick={handleManualPlay}
            className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl flex items-center justify-center group cursor-pointer"
          >
            {liveData.isLive ? (
              <>
                <video 
                  ref={videoRef}
                  autoPlay 
                  playsInline
                  muted={isMuted}
                  className="w-full h-full object-contain bg-black"
                />

                {/* Tombol Play Besar jika Autoplay Diblokir Browser */}
                {playBlocked && (
                  <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-30 p-4 text-center pointer-events-auto">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleManualPlay();
                      }}
                      className="flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-red-600 hover:bg-red-500 text-white text-sm font-black uppercase tracking-wider shadow-2xl shadow-red-600/50 hover:scale-105 active:scale-95 transition-all"
                    >
                      <Play size={20} className="fill-white" />
                      <span>Putar Preview Siaran Langsung</span>
                    </button>
                    <p className="text-xs text-neutral-300 max-w-sm">
                      Klik untuk memulai pemutaran sinyal siaran langsung di ruang kontrol
                    </p>
                  </div>
                )}

                {/* Buffering Indicator */}
                {isVideoBuffering && !playBlocked && (
                  <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
                    <div className="w-10 h-10 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin"></div>
                    <p className="text-sm font-bold text-white">Menyinkronkan feed sinyal streaming...</p>
                    <p className="text-xs text-neutral-400">
                      {streamProtocol === 'FLV' ? 'Memuat frame video ultra-low latency' : 'Mode HLS stream aktif'}
                    </p>
                    <div className="flex items-center gap-2 mt-2 pointer-events-auto">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleManualPlay();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/10 transition-colors"
                      >
                        <Play size={13} className="fill-white" />
                        <span>Paksa Putar</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProtocol();
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-200 text-xs font-bold flex items-center gap-1.5 border border-white/10 transition-colors"
                      >
                        <Tv size={13} />
                        <span>Ganti ke {streamProtocol === 'FLV' ? 'HLS' : 'Low Latency'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Overlay Controls */}
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-auto"
                >
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={toggleMute}
                      className="p-2 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-white transition-colors"
                      title={isMuted ? "Aktifkan Suara" : "Matikan Suara"}
                    >
                      {isMuted ? <VolumeX size={18} className="text-red-400" /> : <Volume2 size={18} />}
                    </button>
                    <input 
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-20 accent-red-500 cursor-pointer"
                    />
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-600 text-white uppercase tracking-wider">
                      PREVIEW KREATOR
                    </span>

                    <button
                      onClick={toggleProtocol}
                      className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 text-[11px] font-bold transition-colors"
                    >
                      {streamProtocol === 'FLV' ? (
                        <>
                          <Zap size={12} className="text-amber-400" />
                          <span>FLV Latency</span>
                        </>
                      ) : (
                        <>
                          <Tv size={12} className="text-blue-400" />
                          <span>HLS Mode</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleRefreshStream}
                      className="p-2 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
                      title="Segarkan Feed"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button 
                      onClick={handleFullscreen}
                      className="p-2 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-white transition-colors"
                      title="Layar Penuh"
                    >
                      <Maximize2 size={18} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center p-8 max-w-lg mx-auto">
                <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mx-auto mb-4">
                  <Tv size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Hubungkan Encoder untuk Memulai Live</h3>
                <p className="text-sm text-neutral-400 leading-relaxed mb-6">
                  Buka OBS Studio atau Streamlabs di komputer atau HP Anda, lalu salin URL RTMP dan Kunci Streaming di bawah ke pengaturan siaran.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                  Menunggu sinyal RTMP dari encoder...
                </div>
              </div>
            )}
          </div>

          {/* Panel Setelan RTMP & Kunci Streaming */}
          <div className="bg-[#121212] p-6 rounded-2xl border border-neutral-800 space-y-5">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Settings size={18} className="text-brand-500" />
                Setelan Encoder Streaming
              </h3>
              <span className="text-xs text-neutral-400">Protokol RTMP Standard (OBS / Streamlabs / Prism)</span>
            </div>

            <div className="space-y-4">
              {/* URL RTMP Server */}
              <div>
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
                  URL Server RTMP
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={dynamicRtmpUrl} 
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm flex-1 font-mono text-neutral-200 focus:outline-none focus:border-brand-500 transition-colors"
                  />
                  <button 
                    onClick={() => handleCopy(dynamicRtmpUrl, 'url')}
                    className="w-full sm:w-auto bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center sm:justify-start gap-2 transition-colors shrink-0"
                  >
                    {copiedField === 'url' ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copiedField === 'url' ? 'Tersalin!' : 'Salin URL'}</span>
                  </button>
                </div>
              </div>

              {/* Kunci Streaming (Stream Key) */}
              <div>
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
                  Kunci Streaming (Stream Key)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex gap-2 flex-1 w-full">
                    <input 
                      type={showKey ? 'text' : 'password'} 
                      readOnly 
                      value={liveData.streamKey} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm flex-1 font-mono text-neutral-200 focus:outline-none focus:border-brand-500 tracking-wider"
                    />
                    <button 
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="bg-neutral-800 hover:bg-neutral-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-neutral-300 shrink-0"
                      title={showKey ? 'Sembunyikan' : 'Tampilkan'}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleCopy(liveData.streamKey, 'key')}
                    className="w-full sm:w-auto bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center sm:justify-start gap-2 transition-colors shrink-0"
                  >
                    {copiedField === 'key' ? <Check size={16} /> : <Copy size={16} />}
                    <span>{copiedField === 'key' ? 'Tersalin!' : 'Salin Key'}</span>
                  </button>
                </div>
              </div>

              {/* Tautan Publik Penonton */}
              <div>
                <label className="text-xs font-bold text-neutral-400 uppercase tracking-wider block mb-1.5">
                  Tautan Siaran Publik (Bagikan ke Penonton)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={publicViewerUrl} 
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm flex-1 font-mono text-neutral-200 focus:outline-none"
                  />
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
                    <button 
                      type="button"
                      onClick={() => handleCopy(publicViewerUrl, 'link')}
                      className="w-full sm:w-auto bg-neutral-800 hover:bg-neutral-700 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors text-white"
                    >
                      {copiedField === 'link' ? <Check size={16} /> : <Copy size={16} />}
                      <span>Salin</span>
                    </button>
                    <a 
                      href={publicViewerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full sm:w-auto bg-red-600 hover:bg-red-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors text-white"
                    >
                      <ExternalLink size={16} />
                      <span>Buka</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tips Panduan Setup OBS & Streamlabs Mobile */}
          <div className="bg-[#121212] p-6 rounded-2xl border border-neutral-800">
            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Sparkles size={16} className="text-amber-400" />
              Petunjuk Cepat Hubungkan Encoder:
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-neutral-400">
              <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800 space-y-1.5">
                <p className="font-bold text-white text-sm">💻 OBS Studio (Komputer / Laptop):</p>
                <p>1. Buka <strong>Settings &gt; Stream</strong> di OBS Studio.</p>
                <p>2. Pilih Service: <strong>Custom...</strong></p>
                <p>3. Masukkan Server: <code className="text-brand-400">{liveData.rtmpUrl}</code></p>
                <p>4. Masukkan Stream Key: <code className="text-brand-400">{liveData.streamKey}</code></p>
                <p>5. Klik tombol <strong>Start Streaming</strong> di OBS.</p>
              </div>

              <div className="bg-neutral-900/60 p-4 rounded-xl border border-neutral-800 space-y-1.5">
                <p className="font-bold text-white text-sm">📱 Streamlabs / Prism (HP Mobile):</p>
                <p>1. Buka Menu <strong>Settings &gt; Streaming Platform</strong>.</p>
                <p>2. Pilih <strong>Custom RTMP Server</strong>.</p>
                <p>3. Masukkan URL RTMP Server yang tertera di atas.</p>
                <p>4. Masukkan Kunci Streaming di atas.</p>
                <p>5. Pastikan HP berada di jaringan WiFi yang sama dengan server.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Kolom 3: Metadata Siaran & Real-Time Live Chat Box */}
        <div className="space-y-6">
          
          {/* Form Edit Metadata Siaran */}
          <div className="bg-[#121212] p-6 rounded-2xl border border-neutral-800 space-y-4">
            <h3 className="text-base font-bold text-white border-b border-neutral-800 pb-3 flex items-center gap-2">
              <Activity size={18} className="text-brand-400" />
              Informasi Siaran
            </h3>

            <div>
              <label className="text-xs font-bold text-neutral-400 block mb-1">JUDUL SIARAN</label>
              <input 
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Masukkan judul siaran langsung..."
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-brand-500 font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-400 block mb-1">KATEGORI</label>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-brand-500 font-medium"
              >
                <option value="Gaming / Entertainment">Gaming / Entertainment</option>
                <option value="Music / Performance">Music / Performance</option>
                <option value="Education / Tutorial">Education / Tutorial</option>
                <option value="Technology & Coding">Technology & Coding</option>
                <option value="Just Chatting / Talkshow">Just Chatting / Talkshow</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-400 block mb-1">DESKRIPSI</label>
              <textarea 
                rows={3}
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Tulis deskripsi atau link media sosial..."
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <button
              onClick={handleSaveMeta}
              disabled={isSavingMeta}
              className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md"
            >
              {isSavingMeta ? <RefreshCw size={14} className="animate-spin" /> : null}
              <span>{saveSuccess ? 'Berhasil Disimpan!' : 'Simpan Informasi Siaran'}</span>
            </button>
          </div>

          {/* Kotak Obrolan Siaran Langsung (Live Chat Box) */}
          <div className="bg-[#121212] rounded-2xl border border-neutral-800 flex flex-col h-[460px] overflow-hidden">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/40">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-red-500" />
                <h3 className="text-sm font-bold text-white">Obrolan Langsung (Live Chat)</h3>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
                {chatMessages.length} Pesan
              </span>
            </div>

            {/* Pesan Chat List */}
            <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 text-xs no-scrollbar">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 p-4">
                  <MessageSquare size={24} className="mb-2 opacity-40" />
                  <p className="font-medium">Belum ada pesan obrolan.</p>
                  <p className="text-[11px]">Pesan dari penonton akan muncul seketika di sini.</p>
                </div>
              ) : (
                chatMessages.map(msg => (
                  <div key={msg.id} className="flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center text-[10px] font-bold text-white shrink-0 uppercase border border-neutral-700">
                      {msg.userName.slice(0, 1)}
                    </div>
                    <div className="flex-1 leading-relaxed">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${msg.isCreator ? 'text-red-400' : 'text-neutral-300'}`}>
                          {msg.userName}
                        </span>
                        {msg.isCreator && (
                          <span className="text-[9px] bg-red-600/30 text-red-400 border border-red-500/30 px-1 py-0.2 rounded font-bold">
                            HOST
                          </span>
                        )}
                        <span className="text-[10px] text-neutral-500 ml-auto">{msg.timestamp}</span>
                      </div>
                      <p className="text-neutral-200 mt-0.5 break-words">{msg.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input Chat Kreator */}
            <form onSubmit={handleSendChat} className="p-3 border-t border-neutral-800 bg-neutral-900/40 flex gap-2">
              <input 
                type="text" 
                value={inputChat}
                onChange={e => setInputChat(e.target.value)}
                placeholder="Kirim pesan sebagai Host..." 
                className="bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white flex-1 focus:outline-none focus:border-red-500"
              />
              <button 
                type="submit"
                disabled={!inputChat.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-40 p-2 rounded-xl text-white transition-colors"
                title="Kirim Pesan"
              >
                <Send size={15} />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
};

export default LiveStudio;
