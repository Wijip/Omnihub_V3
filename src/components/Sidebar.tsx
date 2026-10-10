import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Compass,
  ListVideo,
  History,
  Clock,
  ThumbsUp,
  Upload,
  Radio,
  Video,
  LayoutDashboard,
  BarChart2,
  TrendingUp,
  Settings,
  User,
  UserCircle2,
  Flame,
  Music2,
  Gamepad2,
  GraduationCap,
  Cpu,
  Flag,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  user: any;
  isCollapsed?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
}

interface SubscribedChannel {
  subscription_id: number;
  leader_id: number;
  channel_name: string;
  avatar_url?: string | null;
  video_count?: number;
  hasUnread?: boolean;
}

export default function Sidebar({ user, isCollapsed = false, onClose, isMobile = false }: SidebarProps) {
  const location = useLocation();
  const [channels, setChannels] = useState<SubscribedChannel[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [showAllSubs, setShowAllSubs] = useState(false);
  const [showAllExplore, setShowAllExplore] = useState(false);

  // Ambil subscriptions dinamis dari database untuk user yang sedang login
  useEffect(() => {
    let isMounted = true;

    const fetchSubscriptions = async () => {
      if (!user) {
        if (isMounted) setChannels([]);
        return;
      }

      const token = localStorage.getItem('token') || localStorage.getItem('omnihub_token');
      if (!token) {
        if (isMounted) setChannels([]);
        return;
      }

      try {
        if (isMounted) setLoadingSubs(true);
        const res = await fetch('/api/user/subscriptions', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.success && Array.isArray(data.subscriptions)) {
            setChannels(data.subscriptions.map((s: any) => ({
              subscription_id: s.subscription_id,
              leader_id: s.leader_id,
              channel_name: s.channel_name || `Channel #${s.leader_id}`,
              avatar_url: s.avatar_url,
              video_count: Number(s.video_count) || 0,
              hasUnread: Boolean(s.hasUnread)
            })));
          } else {
            if (isMounted) setChannels([]);
          }
        } else {
          if (isMounted) setChannels([]);
        }
      } catch (e) {
        if (isMounted) setChannels([]);
      } finally {
        if (isMounted) setLoadingSubs(false);
      }
    };

    fetchSubscriptions();

    // Dengarkan event subscription_updated saat user klik Subscribe di halaman video
    const handleSubChange = () => {
      fetchSubscriptions();
    };

    window.addEventListener('subscription_updated', handleSubChange);
    window.addEventListener('storage', handleSubChange);

    return () => {
      isMounted = false;
      window.removeEventListener('subscription_updated', handleSubChange);
      window.removeEventListener('storage', handleSubChange);
    };
  }, [user]);

  const visibleSubs = showAllSubs ? channels : channels.slice(0, 7);

  // --- COLLAPSED MINI SIDEBAR MODE (Desktop YouTube Style) ---
  if (isCollapsed && !isMobile) {
    return (
      <aside className="w-[72px] h-full bg-[#0f0f0f] border-r border-white/5 flex flex-col items-center py-3 select-none shrink-0 transition-all duration-200 overflow-y-auto no-scrollbar z-30">
        <MiniSidebarItem to="/" icon={<Home size={22} />} label="Beranda" active={location.pathname === '/'} />
        <MiniSidebarItem to="/explore" icon={<Compass size={22} />} label="Eksplorasi" active={location.pathname === '/explore'} />
        <MiniSidebarItem to="/live" icon={<Radio size={22} className="text-red-500" />} label="Live" active={location.pathname.startsWith('/live')} />
        <MiniSidebarItem to={user ? "/playlists" : "/auth"} icon={<ListVideo size={22} />} label="Langganan" active={location.pathname === '/playlists'} />
        <MiniSidebarItem to={user ? "/channel" : "/auth"} icon={<User size={22} />} label={user ? "Anda" : "Login"} active={location.pathname === '/channel'} />
      </aside>
    );
  }

  // --- EXPANDED SIDEBAR (Full YouTube Style) ---
  return (
    <aside 
      className={cn(
        "h-full bg-[#0f0f0f] border-r border-white/5 flex flex-col text-neutral-200 select-none overflow-y-auto no-scrollbar transition-all duration-300 z-30",
        isMobile ? "w-full" : "w-60 md:w-64 shrink-0"
      )}
    >
      {/* Mobile Header Bar */}
      {isMobile && (
        <div className="p-4 flex items-center justify-between border-b border-white/10 shrink-0">
          <Link to="/" onClick={onClose} className="flex items-center gap-2.5 text-white font-black text-xl tracking-tighter">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center text-white shadow-md shadow-brand-500/20">
              <Video fill="currentColor" size={15} />
            </div>
            <span className="font-display">OmniHub</span>
          </Link>
          <button 
            onClick={onClose} 
            className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      <div className="p-3 flex flex-col gap-0.5 text-sm">
        {/* ==================================================== */}
        {/* BAGIAN 1: MENU UTAMA (HOME & EXPLORE)               */}
        {/* ==================================================== */}
        <SidebarLinkItem 
          to="/" 
          icon={<Home size={20} />} 
          label={user ? "Beranda" : "Home"} 
          isActive={location.pathname === '/'} 
          onClick={onClose} 
        />
        <SidebarLinkItem 
          to="/explore" 
          icon={<Compass size={20} />} 
          label={user ? "Shorts / Explore" : "Shorts"} 
          isActive={location.pathname === '/explore'} 
          onClick={onClose} 
        />
        <SidebarLinkItem 
          to="/live" 
          icon={<Radio size={20} className="text-red-500 animate-pulse" />} 
          label="Live Streaming" 
          isActive={location.pathname.startsWith('/live')} 
          onClick={onClose} 
        />

        {/* JIKA BELUM LOGIN: Tambahkan Subscriptions, You, History di atas promo card (Gambar 1) */}
        {!user && (
          <>
            <SidebarLinkItem 
              to="/auth" 
              icon={<ListVideo size={20} />} 
              label="Subscriptions" 
              isActive={false} 
              onClick={onClose} 
            />
            <SidebarLinkItem 
              to="/auth" 
              icon={<UserCircle2 size={20} />} 
              label="You" 
              isActive={false} 
              onClick={onClose} 
            />
            <SidebarLinkItem 
              to="/auth" 
              icon={<History size={20} />} 
              label="History" 
              isActive={location.pathname === '/history'} 
              onClick={onClose} 
            />
          </>
        )}

        <Divider />

        {/* ==================================================== */}
        {/* BAGIAN 2A: BELUM LOGIN -> PROMO SIGN-IN BOX (GAMBAR 1) */}
        {/* ==================================================== */}
        {!user && (
          <>
            <div className="px-3 py-2 flex flex-col gap-3">
              <p className="text-sm text-neutral-300 leading-snug">
                Sign in to like videos, comment, and subscribe.
              </p>
              <Link 
                to="/auth" 
                onClick={onClose}
                className="flex items-center gap-2 px-3.5 py-1.5 border border-blue-500/50 hover:bg-blue-500/10 text-blue-400 font-semibold rounded-full text-sm w-fit transition-all active:scale-95 shadow-sm"
              >
                <UserCircle2 size={18} className="text-blue-400" />
                <span>Sign in</span>
              </Link>
            </div>
            <Divider />
          </>
        )}

        {/* ==================================================== */}
        {/* BAGIAN 2B: SUDAH LOGIN -> SUBSCRIPTION (GAMBAR 2)     */}
        {/* ==================================================== */}
        {user && (
          <>
            <div className="px-3 py-1 flex items-center justify-between group cursor-pointer hover:text-white">
              <Link to="/playlists" onClick={onClose} className="flex items-center gap-1.5 font-semibold text-sm text-white">
                <span>Subscription</span>
                <ChevronRight size={16} className="text-neutral-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              {loadingSubs && channels.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-500 animate-pulse">
                  Memuat langganan...
                </div>
              ) : channels.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-400">
                  Belum ada langganan
                </div>
              ) : (
                visibleSubs.map((sub) => {
                  const isActive = location.pathname === '/search' && location.search.includes(encodeURIComponent(sub.channel_name));
                  return (
                    <Link
                      key={sub.subscription_id}
                      to={`/search?q=${encodeURIComponent(sub.channel_name)}`}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-xl text-neutral-300 hover:bg-white/10 hover:text-white transition-colors group",
                        isActive && "bg-white/10 text-white font-medium"
                      )}
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden shrink-0 shadow-sm">
                        {sub.avatar_url ? (
                          <img src={sub.avatar_url} alt={sub.channel_name} className="w-full h-full object-cover" />
                        ) : (
                          sub.channel_name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <span className="truncate text-sm font-medium flex-1 group-hover:text-white">
                        {sub.channel_name}
                      </span>
                      {sub.hasUnread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 ml-auto" />
                      )}
                    </Link>
                  );
                })
              )}

              {channels.length > 7 && (
                <button
                  onClick={() => setShowAllSubs(!showAllSubs)}
                  className="flex items-center gap-4 px-3 py-2 rounded-xl text-neutral-400 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium w-full text-left"
                >
                  {showAllSubs ? (
                    <>
                      <ChevronUp size={18} />
                      <span>Sembunyikan</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown size={18} />
                      <span>Tampilkan lebih banyak...</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <Divider />

            {/* ==================================================== */}
            {/* BAGIAN 3B: SUDAH LOGIN -> ANDA > (LIBRARY / GAMBAR 2)  */}
            {/* ==================================================== */}
            <div className="px-3 py-1 flex items-center justify-between group cursor-pointer hover:text-white">
              <Link to="/channel" onClick={onClose} className="flex items-center gap-1.5 font-semibold text-sm text-white">
                <span>Anda</span>
                <ChevronRight size={16} className="text-neutral-400 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              <SidebarLinkItem to="/channel" icon={<User size={19} />} label="Channel Anda" isActive={location.pathname === '/channel'} onClick={onClose} />
              <SidebarLinkItem to="/history" icon={<History size={19} />} label="Histori" isActive={location.pathname === '/history'} onClick={onClose} />
              <SidebarLinkItem to="/playlists" icon={<ListVideo size={19} />} label="Playlist" isActive={location.pathname === '/playlists'} onClick={onClose} />
              <SidebarLinkItem to="/watch-later" icon={<Clock size={19} />} label="Tonton nanti" isActive={location.pathname === '/watch-later'} onClick={onClose} />
              <SidebarLinkItem to="/liked" icon={<ThumbsUp size={19} />} label="Video yang disukai" isActive={location.pathname === '/liked'} onClick={onClose} />
              <SidebarLinkItem to="/studio" icon={<Video size={19} />} label="Video Anda" isActive={location.pathname === '/studio'} onClick={onClose} />
              <SidebarLinkItem to="/creator-studio" icon={<LayoutDashboard size={19} />} label="Creator Studio" isActive={location.pathname === '/creator-studio'} onClick={onClose} />
              <SidebarLinkItem to="/studio/live" icon={<Radio size={19} className="text-red-500" />} label="Siaran Langsung" isActive={location.pathname === '/studio/live'} onClick={onClose} />
              <SidebarLinkItem to="/upload" icon={<Upload size={19} className="text-brand-400" />} label="Upload Video" isActive={location.pathname === '/upload'} onClick={onClose} />
            </div>

            <Divider />
          </>
        )}

        {/* ==================================================== */}
        {/* BAGIAN 4: ADMIN ONLY SECTION (KHUSUS ROLE ADMIN)     */}
        {/* ==================================================== */}
        {user?.role === 'admin' && (
          <>
            <div className="px-3 py-1 flex items-center justify-between group cursor-pointer hover:text-white">
              <span className="font-semibold text-sm text-brand-400 flex items-center gap-1.5">
                <span>Admin Control</span>
                <ChevronRight size={16} className="text-brand-500" />
              </span>
            </div>

            <div className="flex flex-col gap-0.5 mt-1">
              <SidebarLinkItem to="/admin" icon={<BarChart2 size={19} className="text-blue-400" />} label="Admin Dashboard" isActive={location.pathname === '/admin'} onClick={onClose} />
              <SidebarLinkItem to="/admin/reports" icon={<TrendingUp size={19} className="text-emerald-400" />} label="Reporting & Trend" isActive={location.pathname === '/admin/reports'} onClick={onClose} />
              <SidebarLinkItem to="/admin/logs" icon={<Settings size={19} className="text-amber-400" />} label="System Health" isActive={location.pathname === '/admin/logs'} onClick={onClose} />
            </div>

            <Divider />
          </>
        )}

        {/* ==================================================== */}
        {/* BAGIAN 5: EKSPLORASI / EXPLORE KATEGORI              */}
        {/* ==================================================== */}
        <div className="px-3 py-1">
          <span className="font-semibold text-sm text-white">
            {user ? "Eksplorasi" : "Explore"}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 mt-1">
          <SidebarLinkItem to="/explore?category=trending" icon={<Flame size={19} className="text-orange-500" />} label={user ? "Trending" : "Hype / Trending"} isActive={location.search.includes('trending')} onClick={onClose} />
          <SidebarLinkItem to="/explore?category=4" icon={<Music2 size={19} className="text-rose-400" />} label={user ? "Musik" : "Music"} isActive={location.search.includes('category=4')} onClick={onClose} />
          <SidebarLinkItem to="/explore?category=3" icon={<Gamepad2 size={19} className="text-indigo-400" />} label={user ? "Game" : "Movies & Gaming"} isActive={location.search.includes('category=3')} onClick={onClose} />
          
          {showAllExplore && (
            <>
              <SidebarLinkItem to="/explore?category=2" icon={<GraduationCap size={19} className="text-amber-400" />} label={user ? "Edukasi" : "Education"} isActive={location.search.includes('category=2')} onClick={onClose} />
              <SidebarLinkItem to="/explore?category=5" icon={<Cpu size={19} className="text-teal-400" />} label={user ? "Teknologi" : "Technology"} isActive={location.search.includes('category=5')} onClick={onClose} />
            </>
          )}

          <button
            onClick={() => setShowAllExplore(!showAllExplore)}
            className="flex items-center gap-4 px-3 py-2 rounded-xl text-neutral-400 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium w-full text-left"
          >
            {showAllExplore ? (
              <>
                <ChevronUp size={18} />
                <span>Sembunyikan</span>
              </>
            ) : (
              <>
                <ChevronDown size={18} />
                <span>{user ? "Tampilkan lebih banyak" : "Show more"}</span>
              </>
            )}
          </button>
        </div>

        <Divider />

        {/* ==================================================== */}
        {/* BAGIAN 6: MORE FROM OMNIHUB                          */}
        {/* ==================================================== */}
        <div className="px-3 py-1">
          <span className="font-semibold text-sm text-white">
            {user ? "Lainnya dari OmniHub" : "More from YouTube"}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 mt-1">
          <SidebarLinkItem to="/creator-studio" icon={<Video size={19} className="text-red-500" />} label="OmniHub Studio" isActive={location.pathname === '/creator-studio'} onClick={onClose} />
          <SidebarLinkItem to="/studio/live" icon={<Radio size={19} className="text-red-500" />} label="Live Streaming" isActive={location.pathname === '/studio/live'} onClick={onClose} />
          <SidebarLinkItem to="/admin/reports" icon={<Flag size={19} className="text-neutral-400" />} label={user ? "Laporan & Feedback" : "Report history"} isActive={false} onClick={onClose} />
        </div>

        <Divider />

        {/* ==================================================== */}
        {/* BAGIAN 7: FOOTER LINKS YOUTUBE STYLE                 */}
        {/* ==================================================== */}
        <div className="px-3 py-2 text-[11px] text-neutral-400 flex flex-wrap gap-x-2 gap-y-1 font-medium leading-relaxed">
          <span className="hover:text-neutral-300 cursor-pointer">About</span>
          <span className="hover:text-neutral-300 cursor-pointer">Press</span>
          <span className="hover:text-neutral-300 cursor-pointer">Copyright</span>
          <span className="hover:text-neutral-300 cursor-pointer">Contact us</span>
          <span className="hover:text-neutral-300 cursor-pointer">Creators</span>
          <span className="hover:text-neutral-300 cursor-pointer">Advertise</span>
          <span className="hover:text-neutral-300 cursor-pointer">Developers</span>
        </div>

        <div className="px-3 text-[11px] text-neutral-400 flex flex-wrap gap-x-2 gap-y-1 font-medium leading-relaxed">
          <span className="hover:text-neutral-300 cursor-pointer">Terms</span>
          <span className="hover:text-neutral-300 cursor-pointer">Privacy</span>
          <span className="hover:text-neutral-300 cursor-pointer">Policy & Safety</span>
        </div>

        <div className="px-3 pt-3 pb-6 text-[11px] text-neutral-400">
          © 2026 OmniHub LLC
        </div>
      </div>
    </aside>
  );
}

// Helper Divider
function Divider() {
  return <div className="h-px bg-white/10 my-2 mx-1" />;
}

// Helper Link Item Standar YouTube
function SidebarLinkItem({
  to,
  icon,
  label,
  isActive,
  onClick
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 px-3 py-2.5 rounded-xl transition-all text-sm group",
        isActive
          ? "bg-white/15 text-white font-bold shadow-sm"
          : "text-neutral-300 hover:bg-white/10 hover:text-white font-medium"
      )}
    >
      <div className={cn("transition-transform duration-200 group-hover:scale-105 shrink-0", isActive && "text-brand-400")}>
        {icon}
      </div>
      <span className="truncate">{label}</span>
    </Link>
  );
}

// Helper Mini Sidebar Item (Icon di atas, teks kecil di bawah)
function MiniSidebarItem({
  to,
  icon,
  label,
  active
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "w-16 py-3.5 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-medium group",
        active
          ? "bg-white/15 text-white font-bold"
          : "text-neutral-400 hover:bg-white/10 hover:text-white"
      )}
    >
      <div className="group-hover:scale-110 transition-transform">{icon}</div>
      <span className="truncate max-w-[60px] text-center">{label}</span>
    </Link>
  );
}
