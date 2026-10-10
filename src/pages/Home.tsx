import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, Video, Upload, Sparkles, Radio, Users } from 'lucide-react';
import api from '../lib/api';
import EmptyState from '../components/EmptyState';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL?.replace(/\/api\/?$/, '') || '';

const getThumbnailUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:')) return url;
  const pathPart = url.startsWith('/') ? url : `/${url}`;
  return `${API_BASE_URL}${pathPart}`;
};

export default function HomePage({ searchQuery = '', isSearching = false, setIsSearching = () => {} }: any) {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLive, setActiveLive] = useState<any>(null);

  // Cek siaran langsung yang sedang aktif
  useEffect(() => {
    api.get('/live/active')
      .then(res => {
        if (res.data?.active && res.data?.streams?.length > 0) {
          setActiveLive(res.data.streams[0]);
        } else {
          setActiveLive(null);
        }
      })
      .catch(() => setActiveLive(null));
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setIsSearching(false);
      api.get('/videos')
        .then(res => {
          setVideos(res.data);
          setLoading(false);
        })
        .catch(err => {
          console.error("Failed to load videos:", err);
          setLoading(false);
        });
      return;
    }

    setIsSearching(true);
    const delayDebounce = setTimeout(() => {
      api.get(`/search?q=${searchQuery}`)
        .then(res => {
          setVideos(res.data);
        })
        .catch(err => console.error('Pencarian gagal:', err))
        .finally(() => setIsSearching(false));
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  if (loading) {
    return (
      <div className="w-full">
        {/* SKELETON GRID: Adapts seamlessly to all viewports */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-y-10 md:gap-x-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse flex flex-col gap-3">
              <div className="w-full aspect-video bg-white/5 rounded-2xl border border-white/5"></div>
              <div className="flex gap-3 px-1">
                <div className="w-11 h-11 bg-white/5 rounded-full shrink-0"></div>
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-white/5 rounded w-3/4"></div>
                  <div className="h-3 bg-white/5 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Banner Khusus Siaran Langsung Sedang Berlangsung */}
      {activeLive && (
        <div className="mb-8 p-5 md:p-6 rounded-2xl bg-gradient-to-r from-red-950/70 via-neutral-900 to-[#121212] border border-red-500/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-2xl shadow-red-950/30">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-2xl bg-red-600/20 border border-red-500/50 flex items-center justify-center text-red-500 shadow-lg shadow-red-600/20">
                <Radio size={28} className="animate-pulse" />
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 text-[9px] font-black bg-red-600 text-white rounded-full uppercase tracking-wider animate-bounce shadow-md">
                LIVE
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                  SEDANG BERLANGSUNG
                </span>
                <span className="text-xs text-neutral-400 font-medium flex items-center gap-1">
                  <Users size={12} className="text-red-400" />
                  {activeLive.viewerCount || 1} penonton sedang menonton
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-black text-white line-clamp-1">{activeLive.title}</h2>
              <p className="text-xs text-neutral-400 line-clamp-1 mt-0.5">
                Kreator: <strong className="text-white">{activeLive.user?.name || activeLive.firstName || 'Wiji Prabowo'}</strong> • Kategori: {activeLive.category || 'Gaming / Entertainment'}
              </p>
            </div>
          </div>
          <Link 
            to={`/live/${activeLive.streamKey}`}
            className="px-6 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-sm flex items-center gap-2 transition-all shadow-xl shadow-red-600/30 shrink-0 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Radio size={16} />
            <span>Tonton Siaran Langsung</span>
          </Link>
        </div>
      )}

      {/* Header Utama */}
      <div className="mb-6 md:mb-8 flex items-center justify-between px-1">
        <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">Recommended for you</h1>
      </div>
      
      {/* VIDEO GRID: Flawless mobile & desktop scaling */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 md:gap-x-6 md:gap-y-10">
        {videos.map((video: any) => {
          const isVideoLive = video.status === 'live';
          const targetUrl = isVideoLive ? `/live` : `/video/${video.id}`;

          return (
            <Link to={targetUrl} key={video.id} className="group flex flex-col gap-3 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-2xl">
              {/* Thumbnail Wrapper */}
              <div className={`relative w-full aspect-video rounded-2xl bg-neutral-800/80 overflow-hidden outline outline-1 ${isVideoLive ? 'outline-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)]' : 'outline-white/5 group-hover:outline-brand-500/50 group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]'} transition-all duration-300`}>
                {video.thumbnail_url ? (
                  <img 
                    src={getThumbnailUrl(video.thumbnail_url)} 
                    alt={video.title} 
                    className="w-full h-full object-contain bg-black group-hover:scale-105 transition-transform duration-500 ease-out" 
                    loading="lazy"
                  />
                ) : (
                  <video 
                    src={video.url} 
                    className="w-full h-full object-contain bg-black group-hover:scale-105 transition-transform duration-500 ease-out"
                    muted
                    playsInline
                  />
                )}

                {/* Status Badge */}
                {isVideoLive ? (
                  <div className="absolute bottom-2 right-2 bg-red-600 text-white text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-md shadow-lg border border-red-400/30 flex items-center gap-1.5 animate-pulse uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-white"></span>
                    LIVE
                  </div>
                ) : (
                  <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md text-white text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md shadow-lg border border-white/10">
                    {video.status === 'ready' ? 'HD' : 'Processing'}
                  </div>
                )}
              </div>
              
              {/* Metadata Section */}
              <div className="flex gap-3.5 px-1 items-start">
                <div className={`w-10 h-10 md:w-11 md:h-11 rounded-full ${isVideoLive ? 'bg-red-600' : 'bg-brand-600'} flex items-center justify-center font-bold text-white shrink-0 outline outline-1 outline-white/10 shadow-inner overflow-hidden`}>
                  {video.firstName ? video.firstName[0].toUpperCase() : 'U'}
                </div>
                <div className="flex flex-col overflow-hidden pt-0.5">
                  <h3 className="text-white font-bold text-[15px] md:text-base leading-snug group-hover:text-brand-400 transition-colors line-clamp-2" title={video.title}>
                    {video.title}
                  </h3>
                  <p className="text-neutral-400 font-medium text-[13px] md:text-sm mt-1.5 flex items-center gap-1.5 truncate">
                    {video.firstName} {video.lastName}
                  </p>
                  <p className="text-neutral-500 text-[12px] md:text-[13px] mt-0.5 font-medium truncate">
                    {isVideoLive ? (
                      <span className="text-red-400 font-bold flex items-center gap-1">
                        🔴 Sedang berlangsung • Siaran Langsung
                      </span>
                    ) : (
                      `${video.views || 0} views • ${new Date(video.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                    )}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}

        {videos.length === 0 && (
          <div className="col-span-full py-8">
            {searchQuery ? (
              <EmptyState
                icon={Search}
                badge="Hasil Pencarian"
                title={`Tidak Ada Video untuk "${searchQuery}"`}
                description="Kami tidak menemukan video yang cocok dengan kata kunci pencarian Anda saat ini."
                tip="Periksa kembali ejaan kata kunci, gunakan istilah yang lebih ringkas atau umum, atau telusuri video berdasarkan kategori."
                actionText="Jelajahi Semua Video"
                actionLink="/"
                secondaryActionText="Lihat Kategori Trending"
                secondaryActionLink="/explore"
              />
            ) : (
              <EmptyState
                icon={Video}
                badge="Beranda OmniHub"
                title="Belum Ada Video yang Dipublikasikan"
                description="Platform OmniHub saat ini belum memiliki konten video publik. Jadilah kreator pertama yang mempublikasikan karya video Anda di sini!"
                tip="Anda dapat mengunggah video dalam format MP4, MKV, atau WebM dengan dukungan pemrosesan multi-resolusi otomatis."
                actionText="Upload Video Sekarang"
                actionLink="/upload"
                actionIcon={Upload}
                secondaryActionText="Buka Creator Studio"
                secondaryActionLink="/creator-studio"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
