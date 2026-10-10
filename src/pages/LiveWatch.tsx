import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import api from '../lib/api';
import { io, Socket } from 'socket.io-client';
import mpegts from 'mpegts.js';
import Hls from 'hls.js';
import { 
  Radio, 
  Users, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  ThumbsUp, 
  Share2, 
  MessageSquare, 
  Send, 
  Check, 
  Sparkles,
  ArrowLeft,
  Bell,
  Clock,
  Play,
  RotateCcw,
  Zap,
  Tv
} from 'lucide-react';
import EmptyState from '../components/EmptyState';

interface ChatMessage {
  id: string;
  userId: number;
  userName: string;
  avatarUrl: string;
  message: string;
  timestamp: string;
  isCreator?: boolean;
}

export default function LiveWatch() {
  const { streamKey: routeKey } = useParams<{ streamKey?: string }>();
  const [streamInfo, setStreamInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(24);
  const [subscribed, setSubscribed] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Streaming Engine States
  const [streamProtocol, setStreamProtocol] = useState<'FLV' | 'HLS'>('FLV');
  const [playBlocked, setPlayBlocked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Helper Format Subscriber Count
  const formatSubscribers = (count: number) => {
    const n = Number(count) || 0;
    if (n <= 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  // Ambil user login saat ini dari localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    } catch (e) {}
  }, []);

  // 1. Fetch Status Live & Inisialisasi Socket
  useEffect(() => {
    let isMounted = true;

    const checkLive = async () => {
      try {
        const token = localStorage.getItem('token') || localStorage.getItem('omnihub_token');
        const headers = (token && token !== 'undefined') ? { Authorization: `Bearer ${token}` } : {};
        const res = await axios.get('/api/live/status', { headers });
        if (!isMounted) return;

        if (res.data) {
          setIsLive(Boolean(res.data.isLive));
          setStreamInfo(res.data);
          setViewerCount(res.data.viewerCount || 1);
          if (res.data.creator) {
            setSubscriberCount(res.data.creator.subscriberCount || 0);
          }
          if (typeof res.data.isSubscribed === 'boolean') {
            setSubscribed(res.data.isSubscribed);
          }
        }
      } catch (err) {
        console.error('Failed to get live status:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    checkLive();
    const interval = setInterval(checkLive, 3000);

    // Socket Setup
    const socket = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.emit('join_live_room');

    socket.on('live_status_change', (data: any) => {
      setIsLive(Boolean(data.isLive));
      if (data.isLive) {
        setStreamInfo((prev: any) => ({
          ...prev,
          ...data,
          isLive: true
        }));
        if (data.creator) {
          setSubscriberCount(data.creator.subscriberCount || 0);
        }
      }
    });

    socket.on('live_meta_updated', (data: any) => {
      setStreamInfo((prev: any) => ({
        ...prev,
        title: data.title || prev?.title,
        category: data.category || prev?.category,
        description: data.description !== undefined ? data.description : prev?.description,
        creator: data.creator || prev?.creator
      }));
      if (data.creator) {
        setSubscriberCount(data.creator.subscriberCount || 0);
      }
    });

    socket.on('live_viewer_count', (data: any) => {
      if (typeof data.count === 'number') {
        setViewerCount(Math.max(1, data.count));
      }
    });

    socket.on('new_live_chat', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      }, 50);
    });

    // Ambil histori chat awal
    axios.get('/api/live/chat')
      .then(res => {
        if (isMounted && res.data?.success && Array.isArray(res.data.messages)) {
          setMessages(res.data.messages);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      clearInterval(interval);
      socket.emit('leave_live_room');
      socket.disconnect();
    };
  }, []);

  // 2. Player Controller (mpegts.js FLV + Hls.js fallback)
  useEffect(() => {
    if (!isLive || !streamInfo) {
      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch (e) {}
        mpegtsRef.current = null;
      }
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (e) {}
        hlsRef.current = null;
      }
      setIsBuffering(false);
      setPlayBlocked(false);
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    setIsBuffering(true);
    setPlayBlocked(false);
    let isCleanedUp = false;
    let initialTimer: any = null;
    let watchdogTimer: any = null;

    const streamKey = routeKey || streamInfo.streamKey || 'stream_key_wiji_hub';
    const flvUrl = `/api/live/stream/${streamKey}.flv`;
    const hlsUrl = `/live/${streamKey}/index.m3u8`;

    // Pastikan attribute muted diaktifkan di raw DOM agar lolos Autoplay Policy browser
    videoEl.muted = true;
    videoEl.defaultMuted = true;
    videoEl.playsInline = true;

    const dismissBuffering = () => {
      setIsBuffering(false);
      setPlayBlocked(false);
    };

    videoEl.addEventListener('playing', dismissBuffering);
    videoEl.addEventListener('canplay', dismissBuffering);
    videoEl.addEventListener('loadeddata', dismissBuffering);
    const onTimeUpdate = () => {
      if (videoEl.currentTime > 0) {
        dismissBuffering();
      }
    };
    videoEl.addEventListener('timeupdate', onTimeUpdate);

    const startHls = () => {
      if (isCleanedUp || !videoEl) return;
      setStreamProtocol('HLS');

      if (watchdogTimer) clearTimeout(watchdogTimer);
      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch (e) {}
        mpegtsRef.current = null;
      }

      if (Hls.isSupported()) {
        if (hlsRef.current) {
          try { hlsRef.current.destroy(); } catch (e) {}
        }
        const hls = new Hls({
          manifestLoadingTimeOut: 5000,
          manifestLoadingMaxRetry: 10,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 4,
          maxBufferLength: 4,
          enableWorker: false // Nonaktifkan worker agar aman dari batasan CSP
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          dismissBuffering();
          videoEl.muted = true;
          videoEl.play().catch(err => {
            console.warn('[HLS] Autoplay blocked, menunggu interaksi pengguna:', err);
            setPlayBlocked(true);
            setIsBuffering(false);
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
        videoEl.src = hlsUrl;
        videoEl.play().catch(() => {
          setPlayBlocked(true);
          setIsBuffering(false);
        });
        videoEl.onplaying = dismissBuffering;
      }
    };

    const startMpegts = () => {
      if (isCleanedUp || !videoEl) return;

      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch (e) {}
        mpegtsRef.current = null;
      }

      if (mpegts.isSupported()) {
        try {
          setStreamProtocol('FLV');
          const player = mpegts.createPlayer({
            type: 'flv',
            isLive: true,
            url: flvUrl
          }, {
            enableWorker: false, // JANGAN gunakan worker agar tidak terbentur CSP / blob worker crash
            lazyLoad: false,
            seekType: 'range',
            autoCleanupSourceBuffer: true,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 2.5,
            liveBufferLatencyMinRemain: 0.3
          });

          mpegtsRef.current = player;
          player.attachMediaElement(videoEl);
          player.load();

          videoEl.muted = true;
          const playPromise = player.play();
          if (playPromise && typeof (playPromise as any).catch === 'function') {
            (playPromise as any).catch((err: any) => {
              console.warn('[LIVE WATCH] mpegts play interrupted or autoplay blocked:', err);
              if (err?.name === 'NotAllowedError') {
                setPlayBlocked(true);
                setIsBuffering(false);
              }
            });
          }

          player.on(mpegts.Events.ERROR, (errType: any, errDetail: any) => {
            console.warn('[LIVE WATCH] mpegts.js error, falling back to HLS:', errType, errDetail);
            startHls();
          });

          // Watchdog: jika setelah 2.5 detik belum memutar frame pertama (currentTime masih 0), otomatis fallback ke HLS
          watchdogTimer = setTimeout(() => {
            if (!isCleanedUp && (videoEl.paused || videoEl.currentTime === 0)) {
              console.log('[LIVE WATCH] FLV initial frames taking >2.5s, switching to HLS stream fallback...');
              startHls();
            }
          }, 2500);

        } catch (e) {
          console.warn('[LIVE WATCH] Exception starting mpegts, fallback to HLS:', e);
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

      if (mpegtsRef.current) {
        try { mpegtsRef.current.destroy(); } catch (e) {}
        mpegtsRef.current = null;
      }
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch (e) {}
        hlsRef.current = null;
      }
    };
  }, [isLive, streamInfo?.streamKey, routeKey, refreshKey, streamProtocol]);

  // Controls
  const toggleMute = () => {
    if (videoRef.current) {
      const next = !isMuted;
      videoRef.current.muted = next;
      setIsMuted(next);
    }
  };

  const handleManualPlay = () => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      const p = videoRef.current.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          setIsBuffering(false);
          setPlayBlocked(false);
        }).catch((e) => console.warn('Manual play failed:', e));
      } else {
        setIsBuffering(false);
        setPlayBlocked(false);
      }
    }
  };

  const toggleProtocol = () => {
    setIsBuffering(true);
    setStreamProtocol(prev => prev === 'FLV' ? 'HLS' : 'FLV');
  };

  const handleRefreshStream = () => {
    setIsBuffering(true);
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

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (!document.fullscreenElement) {
        videoRef.current.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  const handleToggleSubscribe = async () => {
    if (!currentUser) {
      alert('Silakan login terlebih dahulu untuk subscribe channel ini.');
      return;
    }
    const leaderId = streamInfo?.creator?.id || streamInfo?.hostUserId;
    if (!leaderId) return;

    if (currentUser.id === leaderId) {
      return;
    }

    try {
      const res = await api.post('/subscriptions/toggle', { leaderId });
      if (res.data && res.data.success) {
        setSubscribed(res.data.isSubscribed);
        setSubscriberCount(res.data.subscriberCount);
        window.dispatchEvent(new Event('subscription_updated'));
      }
    } catch (err: any) {
      console.error('Gagal toggle subscribe:', err);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleLike = () => {
    if (!liked) {
      setLikeCount(prev => prev + 1);
      setLiked(true);
    } else {
      setLikeCount(prev => prev - 1);
      setLiked(false);
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;

    const senderName = currentUser 
      ? `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || currentUser.email 
      : 'Penonton OmniHub';

    socketRef.current.emit('send_live_chat', {
      userId: currentUser?.id || 0,
      userName: senderName,
      avatarUrl: currentUser?.avatar_url || '',
      message: chatInput.trim(),
      isCreator: false
    });

    setChatInput('');
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 text-neutral-400">
        <div className="w-12 h-12 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin"></div>
        <p className="text-sm font-bold text-white">Menghubungkan ke OmniHub Live Broadcast...</p>
      </div>
    );
  }

  // Jika Siaran Tidak Aktif / Offline
  if (!isLive) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <div className="mb-6">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-bold text-neutral-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Kembali ke Beranda</span>
          </Link>
        </div>

        <EmptyState
          icon={Radio}
          badge="Live Streaming"
          title="Tidak Ada Siaran Langsung yang Aktif"
          description="Kreator saat ini sedang offline dan belum memulai siaran langsung. Anda dapat melihat kembali beberapa saat lagi atau tonton video menarik lainnya."
          tip="Aktifkan notifikasi atau tonton video rekomendasi di beranda sementara menunggu siaran berikutnya."
          actionText="Jelajahi Video Lainnya"
          actionLink="/explore"
          secondaryActionText="Kembali ke Beranda"
          secondaryActionLink="/"
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1800px] mx-auto pt-2 pb-16 px-2 md:px-6 font-sans">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Kolom 1-3: Video Player & Detail Siaran */}
        <div className="lg:col-span-3 space-y-4">
          
          {/* Layar Player Utama */}
          <div 
            onClick={handleManualPlay}
            className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl flex items-center justify-center group cursor-pointer"
          >
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
                  <span>Putar Tayangan Siaran Langsung</span>
                </button>
                <p className="text-xs text-neutral-300 max-w-sm">
                  Browser memerlukan konfirmasi klik penonton untuk memulai pemutaran sinyal live streaming.
                </p>
              </div>
            )}

            {/* Unmute Overlay Banner jika browser mematikan suara otomatis */}
            {isMuted && !isBuffering && !playBlocked && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className="absolute top-4 left-4 z-20 flex items-center gap-2 px-4 py-2 rounded-xl bg-black/80 hover:bg-black text-white text-xs font-bold border border-white/20 backdrop-blur-md transition-all shadow-lg shadow-black/50"
              >
                <VolumeX size={16} className="text-red-400 animate-pulse" />
                <span>Klik untuk Mengaktifkan Suara</span>
              </button>
            )}

            {/* Buffering Spinner dengan Bantuan Kontrol Cadangan */}
            {isBuffering && !playBlocked && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-20">
                <div className="w-12 h-12 border-4 border-red-500/30 border-t-red-500 rounded-full animate-spin"></div>
                <p className="text-sm font-bold text-white">Memuat Tayangan Siaran Langsung...</p>
                <span className="text-xs text-neutral-400 font-mono">
                  {streamProtocol === 'FLV' ? 'Ultra-Low Latency Feed' : 'HLS Stable Feed'}
                </span>

                <div className="flex items-center gap-2 mt-2 pointer-events-auto">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleManualPlay();
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/10 transition-colors"
                  >
                    <Play size={14} className="fill-white" />
                    <span>Paksa Putar</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleProtocol();
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-200 text-xs font-bold flex items-center gap-1.5 border border-white/10 transition-colors"
                  >
                    <Tv size={14} />
                    <span>Coba Mode {streamProtocol === 'FLV' ? 'HLS' : 'Low-Latency'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Custom Bottom Player Controls Bar */}
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-auto"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-red-600 px-2.5 py-1 rounded-md text-white text-xs font-black uppercase tracking-wider animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-white"></span>
                  LIVE
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={toggleMute}
                    className="p-1.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-white transition-colors"
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
                </div>

                {/* Mode Stream Selector (FLV / HLS) */}
                <button
                  onClick={toggleProtocol}
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white text-[11px] font-bold transition-colors"
                  title="Klik untuk mengganti engine stream"
                >
                  {streamProtocol === 'FLV' ? (
                    <>
                      <Zap size={13} className="text-amber-400" />
                      <span>Low Latency (FLV)</span>
                    </>
                  ) : (
                    <>
                      <Tv size={13} className="text-blue-400" />
                      <span>Stabil (HLS)</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  onClick={handleRefreshStream}
                  className="p-1.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
                  title="Segarkan Siaran"
                >
                  <RotateCcw size={16} />
                </button>
                <button 
                  onClick={toggleFullscreen}
                  className="p-1.5 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-white transition-colors"
                  title="Layar Penuh"
                >
                  <Maximize2 size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Judul & Detail Siaran */}
          <div className="bg-[#121212] p-5 rounded-2xl border border-neutral-800 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5">
                    <Radio size={12} className="animate-pulse" />
                    SEDANG BERLANGSUNG
                  </span>
                  <span className="text-xs bg-white/5 border border-white/10 px-2.5 py-0.5 rounded-full text-neutral-300 font-bold">
                    {streamInfo?.category || 'Gaming / Entertainment'}
                  </span>
                </div>
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
                  {streamInfo?.title || `Live Stream ${streamInfo?.creator?.name || 'Kreator'}`}
                </h1>
              </div>

              {/* Action Buttons: Like, Share */}
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={handleLike}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    liked 
                      ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' 
                      : 'bg-white/5 hover:bg-white/10 text-neutral-300'
                  }`}
                >
                  <ThumbsUp size={16} fill={liked ? 'currentColor' : 'none'} />
                  <span>{likeCount}</span>
                </button>

                <button 
                  onClick={handleShare}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-bold transition-all"
                >
                  {copiedLink ? <Check size={16} className="text-emerald-400" /> : <Share2 size={16} />}
                  <span>{copiedLink ? 'Tersalin!' : 'Bagikan'}</span>
                </button>
              </div>
            </div>

            {/* Bar Kreator / Channel Dinamis (YouTube Style) */}
            <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {streamInfo?.creator?.avatarUrl ? (
                  <img 
                    src={streamInfo.creator.avatarUrl} 
                    alt={streamInfo.creator.name} 
                    className="w-11 h-11 rounded-full object-cover border border-white/10 shadow-md"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-brand-600 to-red-600 flex items-center justify-center text-white font-black text-base shadow-md uppercase">
                    {(streamInfo?.creator?.name || 'K').charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                    {streamInfo?.creator?.name || 'Kreator OmniHub'}
                    <Sparkles size={14} className="text-amber-400" />
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-neutral-400">
                    <span className="flex items-center gap-1 text-red-400 font-bold">
                      <Users size={12} />
                      {viewerCount} sedang menonton
                    </span>
                    <span>•</span>
                    <span>{formatSubscribers(subscriberCount)} Pelanggan</span>
                  </div>
                </div>
              </div>

              {currentUser && currentUser.id === (streamInfo?.creator?.id || streamInfo?.hostUserId) ? (
                <Link
                  to="/studio/live"
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-200 text-xs font-bold transition-all flex items-center gap-2 border border-white/10"
                >
                  <span>Channel Anda (Studio)</span>
                </Link>
              ) : (
                <button 
                  onClick={handleToggleSubscribe}
                  className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
                    subscribed 
                      ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300' 
                      : 'bg-white text-black hover:bg-neutral-200 shadow-md hover:scale-105 active:scale-95'
                  }`}
                >
                  <Bell size={14} fill={subscribed ? 'currentColor' : 'none'} />
                  <span>{subscribed ? 'Disubscribe' : 'Subscribe'}</span>
                </button>
              )}
            </div>

            {/* Deskripsi */}
            {streamInfo?.description && (
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800/60 text-xs text-neutral-300 leading-relaxed">
                <p>{streamInfo.description}</p>
              </div>
            )}
          </div>

        </div>

        {/* Kolom 4: Live Chat Box (YouTube-Style) */}
        <div className="lg:col-span-1">
          <div className="bg-[#121212] rounded-2xl border border-neutral-800 flex flex-col h-[640px] sticky top-24 overflow-hidden shadow-2xl">
            {/* Header Chat */}
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
              <div className="flex items-center gap-2">
                <MessageSquare size={17} className="text-red-500" />
                <h2 className="text-sm font-black text-white">Live Chat</h2>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
                {messages.length} Komentar
              </span>
            </div>

            {/* Chat Messages Flow */}
            <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3.5 text-xs no-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 p-4">
                  <MessageSquare size={28} className="mb-2 opacity-30" />
                  <p className="font-bold text-neutral-400">Selamat datang di Obrolan Live!</p>
                  <p className="text-[11px] text-neutral-500 mt-1">Jadilah yang pertama mengirim pesan kepada streamer.</p>
                </div>
              ) : (
                messages.map(msg => (
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

            {/* Input Form Chat */}
            <form onSubmit={handleSendChat} className="p-3 border-t border-neutral-800 bg-neutral-900/50 flex gap-2">
              <input 
                type="text" 
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Kirim pesan di live chat..." 
                className="bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-xs text-white flex-1 focus:outline-none focus:border-red-500"
              />
              <button 
                type="submit"
                disabled={!chatInput.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-30 p-2.5 rounded-xl text-white transition-colors"
                title="Kirim Komentar"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
