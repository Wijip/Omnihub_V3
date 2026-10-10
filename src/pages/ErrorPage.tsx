import React, { useState } from 'react';
import { AlertTriangle, Search, ServerCrash, RefreshCcw, Home, Compass, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ErrorPageProps {
  type?: 404 | 500 | 'error';
  errorMessage?: string;
}

export default function ErrorPage({ type = 'error', errorMessage }: ErrorPageProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  let renderIcon = () => <AlertTriangle className="w-12 h-12 text-amber-500" />;
  let iconBgClass = "bg-amber-500/10 border-amber-500/20";
  let title = 'Informasi Tidak Tersedia';
  let description = 'Halaman atau data yang Anda tuju saat ini belum dapat ditampilkan. Silakan coba memuat ulang atau jelajahi halaman lain.';
  let helpfulTip = 'Sistem kami terus menyelaraskan data. Anda dapat mencoba kembali dalam beberapa saat.';

  const isNetworkError = errorMessage?.toLowerCase().includes('network') || errorMessage?.toLowerCase().includes('fetch');
  const isAuthError = errorMessage?.toLowerCase().includes('token') || errorMessage?.toLowerCase().includes('unauthorized') || errorMessage?.toLowerCase().includes('401');

  if (type === 404) {
    renderIcon = () => <Search className="w-12 h-12 text-blue-500" />;
    iconBgClass = "bg-blue-500/10 border-blue-500/20";
    title = 'Halaman Tidak Ditemukan';
    description = 'Maaf, halaman atau konten yang Anda cari tidak ditemukan. Halaman mungkin telah dipindahkan atau URL yang dimasukkan salah.';
    helpfulTip = 'Periksa kembali alamat URL di peramban Anda atau kembali ke Beranda OmniHub untuk mencari konten yang diinginkan.';
  } else if (type === 500 || isNetworkError) {
    renderIcon = () => <ServerCrash className="w-12 h-12 text-rose-500" />;
    iconBgClass = "bg-rose-500/10 border-rose-500/20";
    title = 'Koneksi Server Terkendala';
    description = 'Layanan OmniHub sedang memproses data atau menyegarkan koneksi ke database.';
    helpfulTip = 'Pastikan server backend sedang aktif dan coba segarkan halaman.';
  } else if (isAuthError) {
    renderIcon = () => <AlertTriangle className="w-12 h-12 text-blue-400" />;
    iconBgClass = "bg-blue-500/10 border-blue-500/20";
    title = 'Sesi Akun Telah Berakhir';
    description = 'Sesi masuk Anda telah kedaluwarsa. Silakan masuk kembali untuk melanjutkan akses.';
    helpfulTip = 'Masuk kembali dengan email dan kata sandi Anda untuk memperbarui token akses.';
  }

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-[#121212] border border-white/10 rounded-3xl shadow-2xl p-8 sm:p-12 text-center relative overflow-hidden backdrop-blur-xl">
        {/* Glow ambient background */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Icon */}
        <div className={`mx-auto w-24 h-24 rounded-3xl border ${iconBgClass} flex items-center justify-center mb-6 shadow-xl`}>
          {renderIcon()}
        </div>
        
        {/* Title & Description */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-3 tracking-tight font-display">
          {title}
        </h1>
        
        <p className="text-neutral-400 text-sm sm:text-base mb-6 leading-relaxed">
          {description}
        </p>

        {/* Helpful Tip */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 text-left text-xs text-neutral-300 mb-8 leading-relaxed">
          <strong className="text-blue-400 font-semibold block mb-1">💡 Saran Tindakan:</strong>
          {helpfulTip}
        </div>

        {/* Collapsible Technical Details (tidak menakut-nakuti user biasa) */}
        {errorMessage && (
          <div className="mb-8 text-left">
            <button
              type="button"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              className="text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5 transition-colors mx-auto"
            >
              <span>{showTechnicalDetails ? 'Sembunyikan detail teknis' : 'Lihat detail teknis (opsional)'}</span>
              {showTechnicalDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showTechnicalDetails && (
              <div className="mt-3 p-3 bg-black/60 border border-white/5 rounded-xl font-mono text-[11px] text-neutral-400 overflow-x-auto whitespace-pre-wrap break-all">
                {errorMessage}
              </div>
            )}
          </div>
        )}

        {/* Interactive Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="flex flex-1 items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 active:scale-95 text-white font-semibold rounded-full text-sm border border-white/10 transition-all shadow-sm"
          >
            <RefreshCcw className="w-4 h-4 text-neutral-400" />
            <span>Segarkan Halaman</span>
          </button>
          
          <Link
            to="/"
            className="flex flex-1 items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold rounded-full text-sm transition-all shadow-lg shadow-blue-600/25"
          >
            <Home className="w-4 h-4" />
            <span>Ke Beranda</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
