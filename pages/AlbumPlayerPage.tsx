import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Instagram,
  Loader2,
  Music2,
  Pause,
  Play,
  Share2,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Ticket,
  X,
  Youtube
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import {
  DEFAULT_MOCK_ALBUM_SLUG,
  fetchAlbumBySlug,
  type AlbumActionCard,
  type AlbumLinks,
  type AlbumPayload
} from '../services/albumData';
import { useAlbumAudioPlayer } from '../services/albumAudioPlayer';

type PageState = 'loading' | 'ready' | 'not-found';
type AlbumTab = 'album' | 'merch' | 'artist';
type ActiveSheet = 'merch' | 'tickets' | null;

const TAB_OPTIONS: { id: AlbumTab; label: string }[] = [
  { id: 'album', label: 'Album' },
  { id: 'merch', label: 'Merch' },
  { id: 'artist', label: 'Artist' }
];

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const openExternal = (url?: string) => {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
};

const SocialButton: React.FC<{
  href?: string;
  label: string;
  icon: React.ReactNode;
}> = ({ href, label, icon }) => {
  const disabled = !href;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => openExternal(href)}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border text-slate-100 transition-all ${
        disabled
          ? 'cursor-not-allowed border-slate-800 bg-slate-900/50 text-slate-600'
          : 'border-slate-700 bg-slate-900/80 hover:border-slate-500 hover:bg-slate-800 active:scale-95'
      }`}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
};

const ActionButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}> = ({ label, icon, onClick, disabled }) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] transition-all ${
        disabled
          ? 'cursor-not-allowed border border-slate-800 bg-slate-900/40 text-slate-600'
          : 'border border-slate-700 bg-slate-900/80 text-slate-100 hover:border-slate-500 hover:bg-slate-800 active:scale-95'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};

const SheetCard: React.FC<{
  card: AlbumActionCard;
  fallbackUrl?: string;
}> = ({ card, fallbackUrl }) => {
  const ctaUrl = card.url || fallbackUrl;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80">
      {card.image ? (
        <img src={card.image} alt={card.title} className="h-32 w-full object-cover" />
      ) : null}
      <div className="space-y-2 p-4">
        <p className="text-base font-black tracking-tight text-slate-100">{card.title}</p>
        {card.subtitle ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{card.subtitle}</p> : null}
        {card.description ? <p className="text-sm text-slate-300">{card.description}</p> : null}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-400">
          {card.price ? <span className="rounded-full bg-slate-800 px-2 py-1">{card.price}</span> : null}
          {card.date ? <span className="rounded-full bg-slate-800 px-2 py-1">{card.date}</span> : null}
          {card.location ? <span className="rounded-full bg-slate-800 px-2 py-1">{card.location}</span> : null}
        </div>
        {ctaUrl ? (
          <button
            type="button"
            onClick={() => openExternal(ctaUrl)}
            className="mt-1 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-950 transition-all hover:bg-emerald-400 active:scale-95"
          >
            {card.ctaLabel || 'Open'}
          </button>
        ) : null}
      </div>
    </div>
  );
};

const BottomSheet: React.FC<{
  open: boolean;
  title: string;
  cards: AlbumActionCard[];
  fallbackUrl?: string;
  onClose: () => void;
}> = ({ open, title, cards, fallbackUrl, onClose }) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-black/60"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[2rem] border border-slate-800 bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-700" />
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black tracking-tight text-slate-100">{title}</h3>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-300 hover:border-slate-500 hover:text-white"
                aria-label="Close sheet"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1 tap-native-scroll">
              {cards.map((card) => (
                <SheetCard key={card.id} card={card} fallbackUrl={fallbackUrl} />
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const getArtistBio = (album: AlbumPayload | null) => {
  if (!album) return '';
  return `${album.artist} is delivering an exclusive Tap-Album listening session for fans, limited to this edition drop.`;
};

const getPrimaryDuration = (duration: number, trackDuration?: number) => {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (Number.isFinite(trackDuration) && Number(trackDuration) > 0) return Number(trackDuration);
  return 0;
};

const AlbumPlayerPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [album, setAlbum] = useState<AlbumPayload | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeTab, setActiveTab] = useState<AlbumTab>('album');
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'shared'>('idle');
  const [shareError, setShareError] = useState<string | null>(null);

  const {
    currentTrack,
    currentTrackIndex,
    currentTime,
    duration,
    isPlaying,
    isBuffering,
    loadAlbum,
    playTrack,
    togglePlayback,
    playNext,
    playPrevious,
    seekTo
  } = useAlbumAudioPlayer();

  useEffect(() => {
    const normalizedSlug = String(slug || '').trim();
    if (!normalizedSlug) {
      setPageState('not-found');
      setAlbum(null);
      return;
    }

    let cancelled = false;
    setPageState('loading');
    setActiveTab('album');
    setActiveSheet(null);

    const run = async () => {
      try {
        const payload = await fetchAlbumBySlug(normalizedSlug);
        if (cancelled) return;
        setAlbum(payload);
        setPageState('ready');
      } catch (error) {
        console.warn('[ALBUM_ROUTE] album fetch failed', error);
        if (cancelled) return;
        setAlbum(null);
        setPageState('not-found');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!album) return;
    loadAlbum(album);
  }, [album, loadAlbum]);

  const queue = album?.tracks ?? [];
  const merchCards = album?.merchCards ?? [];
  const ticketCards = album?.ticketCards ?? [];
  const sheetMerchCards = merchCards.length > 0
    ? merchCards
    : album?.links.merch
      ? [{
          id: 'merch-fallback',
          title: 'Official Merch',
          description: 'Shop collectible items connected to this drop.',
          ctaLabel: 'Shop',
          url: album.links.merch
        }]
      : [];
  const sheetTicketCards = ticketCards.length > 0
    ? ticketCards
    : album?.links.tickets
      ? [{
          id: 'tickets-fallback',
          title: 'Tour Tickets',
          description: 'View official ticket options for upcoming shows.',
          ctaLabel: 'Get Tickets',
          url: album.links.tickets
        }]
      : [];

  const activeDuration = useMemo(
    () => getPrimaryDuration(duration, currentTrack?.duration),
    [duration, currentTrack?.duration]
  );

  const handleShare = async () => {
    if (!album) return;
    setShareError(null);
    setShareStatus('idle');
    const shareUrl = window.location.href;
    const shareData = {
      title: `${album.title} - ${album.artist}`,
      text: `Listen to ${album.title} by ${album.artist} on Tap-Album.`,
      url: shareUrl
    };

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share(shareData);
        setShareStatus('shared');
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareStatus('copied');
        return;
      }
      setShareError('Sharing is unavailable on this device.');
    } catch (error) {
      const name = String((error as any)?.name || '').toLowerCase();
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          setShareStatus('copied');
          return;
        } catch {
          // Fall through to final error state.
        }
      }
      if (name === 'aborterror') {
        setShareError(null);
        return;
      }
      console.warn('[ALBUM_ROUTE] share failed', error);
      setShareError('Share unavailable on this device.');
    }
  };

  const socialLinks: { key: keyof AlbumLinks; label: string; icon: React.ReactNode }[] = [
    { key: 'instagram', label: 'Instagram', icon: <Instagram size={18} /> },
    { key: 'tiktok', label: 'TikTok', icon: <Music2 size={18} /> },
    { key: 'youtube', label: 'YouTube', icon: <Youtube size={18} /> }
  ];

  if (pageState === 'loading') {
    return (
      <div className="tap-full-height bg-slate-950 text-slate-50 flex items-center justify-center px-6">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-3 text-sm font-semibold text-slate-200">
          <Loader2 size={18} className="animate-spin text-emerald-300" />
          Loading album...
        </div>
      </div>
    );
  }

  if (!album || pageState === 'not-found') {
    return (
      <div className="tap-full-height bg-slate-950 text-slate-50 flex items-center justify-center px-6 text-center">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-7">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Album unavailable</p>
          <h1 className="mt-3 text-2xl font-black tracking-tight">We could not find that Tap-Album.</h1>
          <p className="mt-3 text-sm text-slate-300">
            Start with mock slug:
            <span className="ml-1 rounded bg-slate-800 px-2 py-1 text-emerald-300">/album/{DEFAULT_MOCK_ALBUM_SLUG}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tap-full-height relative overflow-x-hidden bg-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.25),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.2),transparent_45%)]" />
      <div className="relative mx-auto w-full max-w-md px-4 pb-44 pt-8">
        <AnimatePresence mode="wait">
          {activeTab === 'album' && (
            <motion.section
              key="album-tab"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[30px] border border-slate-700/80 bg-slate-900/70 shadow-[0_30px_100px_rgba(15,23,42,0.65)]">
                <img
                  src={album.cover}
                  alt={`${album.title} cover`}
                  className="h-full w-full object-cover animate-[spin_26s_linear_infinite]"
                  style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                />
              </div>

              <motion.div layout className="mt-6 text-center">
                <h1 className="text-3xl font-black tracking-tight">{album.title}</h1>
                <p className="mt-1 text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">{album.artist}</p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200">
                  <span>{`Edition #${album.editionNumber} / ${album.editionTotal}`}</span>
                  <span className="h-1 w-1 rounded-full bg-emerald-300" />
                  <span>Tap-Album Exclusive</span>
                </div>
                <div className="mt-2 flex flex-col items-center justify-center gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-200">
                    <BadgeCheck size={13} className="text-emerald-300" />
                    Verified Drop
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Only on Tap-Album
                  </span>
                </div>
              </motion.div>

              <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900/75 p-4">
                <div className="flex items-center gap-3 text-xs font-semibold text-slate-300">
                  <span className="w-11 tabular-nums">{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    min={0}
                    max={activeDuration || 0}
                    step={0.1}
                    value={Math.min(currentTime, activeDuration || 0)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    className="tap-progress h-2 w-full"
                    aria-label="Track progress"
                  />
                  <span className="w-11 text-right tabular-nums">{formatTime(activeDuration)}</span>
                </div>

                <div className="mt-5 flex items-center justify-center gap-5">
                  <button
                    type="button"
                    onClick={() => void playPrevious()}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-100 transition-all hover:border-slate-500 hover:bg-slate-800 active:scale-95"
                    aria-label="Previous track"
                  >
                    <SkipBack size={20} />
                  </button>

                  <button
                    type="button"
                    onClick={() => void togglePlayback()}
                    className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-slate-950 shadow-[0_10px_30px_rgba(16,185,129,0.45)] transition-all hover:bg-emerald-400 active:scale-95"
                    aria-label={isPlaying ? 'Pause track' : 'Play track'}
                  >
                    {isPlaying ? <Pause size={34} /> : <Play size={34} className="translate-x-0.5" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => void playNext()}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/70 text-slate-100 transition-all hover:border-slate-500 hover:bg-slate-800 active:scale-95"
                    aria-label="Next track"
                  >
                    <SkipForward size={20} />
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  <ActionButton
                    label="Merch"
                    icon={<ShoppingBag size={15} />}
                    disabled={merchCards.length === 0 && !album.links.merch}
                    onClick={() => setActiveSheet('merch')}
                  />
                  <ActionButton
                    label="Tickets"
                    icon={<Ticket size={15} />}
                    disabled={ticketCards.length === 0 && !album.links.tickets}
                    onClick={() => setActiveSheet('tickets')}
                  />
                  <ActionButton
                    label="Share"
                    icon={<Share2 size={15} />}
                    onClick={() => void handleShare()}
                  />
                </div>
                {(shareStatus !== 'idle' || shareError) && (
                  <p className={`mt-3 text-center text-[11px] font-semibold ${shareError ? 'text-red-300' : 'text-emerald-300'}`}>
                    {shareError || (shareStatus === 'copied' ? 'Album link copied.' : 'Thanks for sharing.')}
                  </p>
                )}

                <div className="mt-5 flex items-center justify-center gap-3">
                  {socialLinks.map((link) => (
                    <SocialButton
                      key={link.key}
                      href={album.links[link.key]}
                      label={link.label}
                      icon={link.icon}
                    />
                  ))}
                </div>

                {isBuffering && (
                  <p className="mt-4 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Buffering...
                  </p>
                )}
              </div>

              <motion.div layout className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="mb-2 flex items-center justify-between px-2">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Queue</p>
                  <p className="text-[11px] font-semibold text-slate-500">{queue.length} tracks</p>
                </div>

                <div className="space-y-2">
                  {queue.map((track, index) => {
                    const isCurrent = currentTrackIndex === index;
                    const shouldDeEmphasize = isPlaying && !isCurrent;
                    const displayDuration = Number(track.duration) > 0 ? Number(track.duration) : 0;

                    return (
                      <motion.button
                        layout
                        key={track.id}
                        type="button"
                        onClick={() => void playTrack(index)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-3 transition-all ${
                          isCurrent
                            ? 'border-emerald-400/40 bg-emerald-500/10 py-3'
                            : 'border-slate-800 bg-slate-900/70'
                        } ${shouldDeEmphasize ? 'py-2 opacity-45 scale-[0.98]' : 'py-3 opacity-100'} `}
                      >
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${
                            isCurrent ? 'bg-emerald-400/20 text-emerald-200' : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1 text-left">
                          <p className={`truncate text-sm font-semibold ${isCurrent ? 'text-white' : 'text-slate-300'}`}>{track.title}</p>
                          <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{formatTime(displayDuration)}</p>
                        </div>
                        {isCurrent && isPlaying ? (
                          <span className="inline-flex items-center gap-1 pr-1">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 [animation-delay:120ms]" />
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 [animation-delay:240ms]" />
                          </span>
                        ) : (
                          <Play size={16} className="text-slate-500" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            </motion.section>
          )}

          {activeTab === 'merch' && (
            <motion.section
              key="merch-tab"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="space-y-4"
            >
              <div className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Album Merch</p>
                <h2 className="mt-3 text-2xl font-black">Exclusive drops for this edition.</h2>
                <p className="mt-3 text-sm text-slate-300">Keep this as a focused conversion tab for store and ticket actions.</p>
              </div>
              <div className="grid gap-3">
                <ActionButton
                  label="Merch"
                  icon={<ShoppingBag size={16} />}
                  disabled={merchCards.length === 0 && !album.links.merch}
                  onClick={() => setActiveSheet('merch')}
                />
                <ActionButton
                  label="Tickets"
                  icon={<Ticket size={16} />}
                  disabled={ticketCards.length === 0 && !album.links.tickets}
                  onClick={() => setActiveSheet('tickets')}
                />
              </div>
            </motion.section>
          )}

          {activeTab === 'artist' && (
            <motion.section
              key="artist-tab"
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="space-y-4"
            >
              <div className="rounded-3xl border border-slate-800 bg-slate-900/75 p-5">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Artist</p>
                <h2 className="mt-3 text-2xl font-black">{album.artist}</h2>
                <p className="mt-3 text-sm text-slate-300">{getArtistBio(album)}</p>
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/75 p-4">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Socials</p>
                <div className="mt-4 flex items-center gap-3">
                  {socialLinks.map((link) => (
                    <SocialButton
                      key={link.key}
                      href={album.links[link.key]}
                      label={link.label}
                      icon={link.icon}
                    />
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <BottomSheet
        open={activeSheet === 'merch'}
        title="Merch"
        cards={sheetMerchCards}
        fallbackUrl={album.links.merch}
        onClose={() => setActiveSheet(null)}
      />
      <BottomSheet
        open={activeSheet === 'tickets'}
        title="Tickets"
        cards={sheetTicketCards}
        fallbackUrl={album.links.tickets}
        onClose={() => setActiveSheet(null)}
      />

      <AnimatePresence>
        {isPlaying && currentTrack && activeTab !== 'album' && (
          <motion.button
            key="mini-player"
            type="button"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.22 }}
            onClick={() => setActiveTab('album')}
            className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-[calc(100%-1.5rem)] max-w-md items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-left shadow-2xl backdrop-blur"
          >
            <img src={album.cover} alt="" className="h-11 w-11 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">{currentTrack.title}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{album.artist}</p>
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-300">Now Playing</span>
          </motion.button>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-around px-4 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] pt-3">
          {TAB_OPTIONS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.2em] transition-all ${
                  active
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_6px_24px_rgba(16,185,129,0.35)]'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AlbumPlayerPage;
