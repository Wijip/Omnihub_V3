import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { List, Plus, Play, ChevronRight, Search, Filter, MoreVertical, Trash2, Edit3, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoCardSkeleton } from '../components/Skeleton';
import { cn } from '../lib/utils';
import EmptyState from '../components/EmptyState';

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchPlaylists = async () => {
      setLoading(true);
      try {
        const res = await api.get('/playlists');
        setPlaylists(Array.isArray(res.data) ? res.data : []);
      } catch (err: any) {
        setError(err.response?.status === 401 ? 'Please login to view your playlists' : 'Failed to load playlists');
      } finally {
        setLoading(false);
      }
    };
    fetchPlaylists();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      const res = await api.post('/playlists', { title: newTitle, description: newDesc });
      setPlaylists([res.data, ...playlists]);
      setNewTitle('');
      setNewDesc('');
      setShowCreate(false);
    } catch (err) {
      console.error('Failed to create playlist');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredPlaylists = playlists.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (error) return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <EmptyState
        icon={AlertCircle}
        badge="Autentikasi"
        title="Masuk untuk Melihat Playlist"
        description="Fitur pengelolaan playlist membutuhkan sesi login akun OmniHub Anda."
        tip="Dengan login, Anda dapat menyimpan video favorit tanpa batas dan membuat playlist khusus sesuai kategori yang Anda sukai."
        actionText="Masuk ke Akun Anda"
        actionLink="/auth"
        secondaryActionText="Kembali ke Beranda"
        secondaryActionLink="/"
      />
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10 md:space-y-16 pb-24">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 text-[10px] font-black uppercase tracking-widest">
            <List size={12} /> Your Collections
          </div>
          <h1 className="text-3xl md:text-5xl font-black font-display tracking-tight text-neutral-900 dark:text-white">
            My Playlists
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 font-medium max-w-md">
            Organize your favorite videos into custom collections and share them with the world.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-full sm:w-64 group">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-brand-600 transition-colors" />
            <input 
              type="text"
              placeholder="Search playlists..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-3 bg-brand-600 text-white px-8 py-4 rounded-2xl font-black hover:bg-brand-700 transition-all shadow-xl shadow-brand-500/20 active:scale-95"
          >
            <Plus size={22} /> Create New
          </button>
        </div>
      </div>

      {/* Create Modal Overlay */}
      <AnimatePresence>
        {showCreate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreate(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xl glass rounded-[3rem] border border-neutral-100 dark:border-neutral-800 overflow-hidden shadow-2xl"
            >
              <div className="p-8 md:p-12 space-y-8">
                <div className="space-y-2">
                  <h2 className="text-3xl font-black font-display text-neutral-900 dark:text-white">New Playlist</h2>
                  <p className="text-neutral-500 dark:text-neutral-400 font-medium">Define your collection's identity.</p>
                </div>

                <form onSubmit={handleCreate} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 ml-1">Playlist Title</label>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="e.g. My Favorite Music"
                      required
                      className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 rounded-2xl py-4 px-6 font-black text-lg focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:bg-white dark:focus:bg-black focus:border-brand-500 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-neutral-400 ml-1">Description</label>
                    <textarea
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      placeholder="What's this collection about?"
                      className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-100 dark:border-neutral-800 rounded-2xl py-4 px-6 font-medium text-base focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:bg-white dark:focus:bg-black focus:border-brand-500 transition-all min-h-[120px] resize-none"
                    />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="flex-1 px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all active:scale-95"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!newTitle.trim() || isSubmitting}
                      className="flex-1 bg-brand-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-brand-700 shadow-xl shadow-brand-500/20 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isSubmitting ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Create Playlist'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {[...Array(8)].map((_, i) => <VideoCardSkeleton key={i} />)}
        </div>
      ) : filteredPlaylists.length === 0 ? (
        <EmptyState
          icon={List}
          badge="Koleksi Playlist"
          title={searchQuery ? 'Tidak Ada Playlist yang Cocok' : 'Belum Ada Koleksi Playlist'}
          description={
            searchQuery
              ? `Tidak ditemukan playlist yang cocok dengan pencarian "${searchQuery}".`
              : 'Mulai atur dan simpan video favorit Anda ke dalam koleksi playlist khusus.'
          }
          tip="Anda dapat membuat beberapa playlist untuk berbagai topik seperti Musik, Tutorial, atau Video Favorit."
          actionText={searchQuery ? 'Hapus Pencarian' : 'Buat Playlist Pertama'}
          onAction={() => {
            if (searchQuery) setSearchQuery('');
            else setShowCreate(true);
          }}
          secondaryActionText={searchQuery ? 'Buat Playlist Baru' : 'Jelajahi Beranda'}
          onSecondaryAction={searchQuery ? () => setShowCreate(true) : undefined}
          secondaryActionLink={searchQuery ? undefined : '/'}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filteredPlaylists.map((playlist, idx) => (
            <motion.div
              key={playlist.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, type: 'spring', damping: 20 }}
              className="group"
            >
              <Link to={`/playlist/${playlist.id}`} className="block space-y-6">
                <div className="relative aspect-video bg-neutral-100 dark:bg-neutral-900 rounded-[2.5rem] overflow-hidden shadow-sm group-hover:shadow-2xl group-hover:-translate-y-2 transition-all duration-500 border border-neutral-100 dark:border-neutral-800">
                  {playlist.videos?.[0]?.thumbnail_url ? (
                    <img 
                      src={playlist.videos[0].thumbnail_url} 
                      alt={playlist.title} 
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-200 dark:text-neutral-800">
                      <Play size={64} fill="currentColor" className="opacity-10 group-hover:opacity-20 transition-opacity" />
                    </div>
                  )}
                  
                  {/* Overlay for playlist count */}
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />
                  <div className="absolute bottom-4 right-4 bg-black/80 backdrop-blur-xl text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest border border-white/10 flex items-center gap-2">
                    <List size={14} /> {playlist.video_count || 0} Videos
                  </div>
                  
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-2xl scale-75 group-hover:scale-100 transition-transform duration-500">
                      <Play fill="black" className="text-black ml-1" size={24} />
                    </div>
                  </div>
                </div>
                
                <div className="px-2 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="font-black text-neutral-900 dark:text-white line-clamp-1 leading-tight text-xl group-hover:text-brand-600 transition-colors tracking-tight font-display">
                      {playlist.title}
                    </h3>
                    <button className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl text-neutral-400 transition-colors shrink-0">
                      <MoreVertical size={18} />
                    </button>
                  </div>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm font-medium line-clamp-2 leading-relaxed">
                    {playlist.description || 'No description provided for this collection.'}
                  </p>
                  <div className="flex items-center gap-2 text-brand-600 dark:text-brand-400 font-black text-[10px] uppercase tracking-[0.2em] pt-2 group-hover:translate-x-2 transition-transform duration-300">
                    View Collection <ChevronRight size={16} />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
