import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Gamepad2, Zap, Pause, Play, Loader2 } from 'lucide-react';
import { io } from 'socket.io-client';

export function GamingModeToggle() {
  const [gamingMode, setGamingMode] = useState<boolean>(false);
  const [isTranscoding, setIsTranscoding] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [toggling, setToggling] = useState<boolean>(false);

  useEffect(() => {
    // 1. Fetch initial state from /api/settings
    const fetchStatus = async () => {
      try {
        const res = await api.get('/settings');
        if (res.data) {
          setGamingMode(Boolean(res.data.gaming_mode));
          setIsTranscoding(Boolean(res.data.isTranscodingActive));
          setPendingCount(Number(res.data.pendingVideosCount) || 0);
        }
      } catch (err) {
        console.error('Failed to fetch gaming mode setting:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    // 2. Real-time WebSocket synchronization
    const socket = io(window.location.origin);
    socket.on('gaming_mode_updated', (data: { gaming_mode: boolean; isTranscodingActive: boolean }) => {
      setGamingMode(Boolean(data.gaming_mode));
      setIsTranscoding(Boolean(data.isTranscodingActive));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    const nextState = !gamingMode;

    try {
      const res = await api.post('/settings/gaming-mode', { enabled: nextState });
      if (res.data && res.data.success) {
        setGamingMode(res.data.gaming_mode);
        setIsTranscoding(res.data.isTranscodingActive);
      }
    } catch (err) {
      console.error('Failed to toggle gaming mode:', err);
      alert('Gagal mengubah status Gaming Mode');
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-400">
        <Loader2 className="w-5 h-5 animate-spin text-brand-500" />
        <span className="text-xs font-bold uppercase tracking-wider">Memuat Resource Manager...</span>
      </div>
    );
  }

  return (
    <div className={`p-6 rounded-3xl border transition-all duration-300 ${
      gamingMode 
        ? 'bg-gradient-to-br from-purple-950/40 to-neutral-900 border-purple-500/40 shadow-[0_0_30px_rgba(168,85,247,0.15)]' 
        : 'bg-gradient-to-br from-brand-950/30 to-neutral-900 border-brand-500/30 shadow-[0_0_30px_rgba(255,115,0,0.1)]'
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Header & Status */}
        <div className="flex items-start gap-4">
          <div className={`p-3.5 rounded-2xl border transition-colors ${
            gamingMode 
              ? 'bg-purple-500/20 border-purple-500/40 text-purple-400' 
              : 'bg-brand-500/20 border-brand-500/40 text-brand-400'
          }`}>
            <Gamepad2 className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-white font-display">
                Gaming Mode Resource Manager
              </h3>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                gamingMode 
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}>
                {gamingMode ? 'PAUSED (GAMING)' : 'ACTIVE (ENCODING)'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 font-medium mt-1">
              {gamingMode 
                ? 'Antrean FFmpeg dijeda total. 100% VRAM GPU (RTX 3050) dialokasikan penuh untuk Game & Aplikasi berat.' 
                : 'Smart Queue memproses 1 video pada satu waktu menggunakan akselerasi hardware NVIDIA NVENC.'}
            </p>
          </div>
        </div>

        {/* Toggle Switch */}
        <div className="flex items-center gap-4 self-end sm:self-center">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative flex items-center w-16 h-8 rounded-full p-1 transition-colors duration-300 focus:outline-none ${
              gamingMode ? 'bg-purple-600' : 'bg-neutral-800'
            } ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={gamingMode ? 'Klik untuk matikan Gaming Mode' : 'Klik untuk nyalakan Gaming Mode'}
          >
            <div
              className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300 flex items-center justify-center ${
                gamingMode ? 'translate-x-8 text-purple-600' : 'translate-x-0 text-neutral-600'
              }`}
            >
              {toggling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : gamingMode ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Mini Diagnostic Indicators */}
      <div className="mt-4 pt-4 border-t border-neutral-800/80 flex flex-wrap items-center gap-6 text-xs text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">GPU Encoder:</span>
          <span className="font-semibold text-neutral-200">NVIDIA NVENC (h264_nvenc)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Concurrency Limit:</span>
          <span className="font-semibold text-neutral-200">1 Video Max</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Transcoder Status:</span>
          <span className={`inline-flex items-center gap-1.5 font-bold ${
            isTranscoding ? 'text-amber-400' : 'text-neutral-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isTranscoding ? 'bg-amber-400 animate-pulse' : 'bg-neutral-600'
            }`} />
            {isTranscoding ? 'Encoding in progress' : 'Idle'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Pending Queue:</span>
          <span className="font-semibold text-brand-400">{pendingCount} video(s)</span>
        </div>
      </div>
    </div>
  );
}
