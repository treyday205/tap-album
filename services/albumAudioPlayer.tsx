import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { AlbumPayload, AlbumTrack } from './albumData';

type AlbumAudioPlayerContextValue = {
  album: AlbumPayload | null;
  currentTrack: AlbumTrack | null;
  currentTrackIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  loadAlbum: (album: AlbumPayload) => void;
  playTrack: (trackIndex: number) => Promise<void>;
  togglePlayback: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (timeInSeconds: number) => void;
};

const AlbumAudioPlayerContext = createContext<AlbumAudioPlayerContextValue | null>(null);

const clampTrackIndex = (index: number, length: number) => {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
};

const resolveAudioSrc = (url: string) => {
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return url;
  }
};

type AlbumAudioPlayerProviderProps = {
  children: React.ReactNode;
};

export const AlbumAudioPlayerProvider: React.FC<AlbumAudioPlayerProviderProps> = ({ children }) => {
  const [album, setAlbum] = useState<AlbumPayload | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const albumRef = useRef<AlbumPayload | null>(null);
  const currentTrackIndexRef = useRef(0);

  const stopAndResetAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }, []);

  const syncStateForTrack = useCallback((track: AlbumTrack | null) => {
    setCurrentTime(0);
    setDuration(Number.isFinite(Number(track?.duration)) ? Number(track?.duration) : 0);
  }, []);

  const attachTrackSource = useCallback((trackIndex: number) => {
    const activeAlbum = albumRef.current;
    const audio = audioRef.current;
    if (!activeAlbum || !audio || activeAlbum.tracks.length === 0) return null;

    const boundedIndex = clampTrackIndex(trackIndex, activeAlbum.tracks.length);
    const track = activeAlbum.tracks[boundedIndex];
    const nextSrc = resolveAudioSrc(track.audioUrl);

    currentTrackIndexRef.current = boundedIndex;
    setCurrentTrackIndex(boundedIndex);
    syncStateForTrack(track);

    if (audio.src !== nextSrc) {
      audio.src = track.audioUrl;
      audio.load();
    }

    return track;
  }, [syncStateForTrack]);

  const playTrack = useCallback(async (trackIndex: number) => {
    const activeAlbum = albumRef.current;
    const audio = audioRef.current;
    if (!activeAlbum || !audio || activeAlbum.tracks.length === 0) return;

    const track = attachTrackSource(trackIndex);
    if (!track) return;

    try {
      await audio.play();
      setIsPlaying(true);
      setIsBuffering(false);
    } catch (error) {
      setIsPlaying(false);
      setIsBuffering(false);
      console.warn('[ALBUM_PLAYER] playTrack failed', error);
    }
  }, [attachTrackSource]);

  const togglePlayback = useCallback(async () => {
    const activeAlbum = albumRef.current;
    const audio = audioRef.current;
    if (!activeAlbum || !audio || activeAlbum.tracks.length === 0) return;

    if (!audio.src) {
      await playTrack(currentTrackIndexRef.current);
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (error) {
        setIsPlaying(false);
        console.warn('[ALBUM_PLAYER] togglePlayback play failed', error);
      }
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }, [playTrack]);

  const playNext = useCallback(async () => {
    const activeAlbum = albumRef.current;
    if (!activeAlbum || activeAlbum.tracks.length === 0) return;
    const nextIndex = currentTrackIndexRef.current + 1;
    if (nextIndex >= activeAlbum.tracks.length) return;
    await playTrack(nextIndex);
  }, [playTrack]);

  const playPrevious = useCallback(async () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    const activeAlbum = albumRef.current;
    if (!activeAlbum || activeAlbum.tracks.length === 0) return;
    const prevIndex = Math.max(currentTrackIndexRef.current - 1, 0);
    await playTrack(prevIndex);
  }, [playTrack]);

  const seekTo = useCallback((timeInSeconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(timeInSeconds)) return;
    const bounded = Math.max(0, Math.min(timeInSeconds, Number.isFinite(audio.duration) ? audio.duration : timeInSeconds));
    audio.currentTime = bounded;
    setCurrentTime(bounded);
  }, []);

  const loadAlbum = useCallback((nextAlbum: AlbumPayload) => {
    const previousSlug = albumRef.current?.slug;
    const nextTracks = nextAlbum.tracks || [];
    albumRef.current = nextAlbum;
    setAlbum(nextAlbum);

    if (nextTracks.length === 0) {
      currentTrackIndexRef.current = 0;
      setCurrentTrackIndex(0);
      syncStateForTrack(null);
      stopAndResetAudio();
      setIsPlaying(false);
      setIsBuffering(false);
      return;
    }

    if (previousSlug !== nextAlbum.slug) {
      currentTrackIndexRef.current = 0;
      setCurrentTrackIndex(0);
      syncStateForTrack(nextTracks[0]);
      stopAndResetAudio();
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, [stopAndResetAudio, syncStateForTrack]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    };

    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleWaiting = () => {
      setIsBuffering(true);
    };

    const handlePlaying = () => {
      setIsBuffering(false);
    };

    const handleEnded = () => {
      const activeAlbum = albumRef.current;
      if (!activeAlbum || activeAlbum.tracks.length === 0) return;

      const nextIndex = currentTrackIndexRef.current + 1;
      if (nextIndex < activeAlbum.tracks.length) {
        void playTrack(nextIndex);
        return;
      }

      setIsPlaying(false);
      setIsBuffering(false);
      setCurrentTime(0);
    };

    const handleError = () => {
      setIsBuffering(false);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('loadedmetadata', handleDurationChange);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('loadedmetadata', handleDurationChange);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [playTrack]);

  const currentTrack =
    album && album.tracks.length > 0
      ? album.tracks[clampTrackIndex(currentTrackIndex, album.tracks.length)]
      : null;

  const contextValue = useMemo<AlbumAudioPlayerContextValue>(() => {
    return {
      album,
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
    };
  }, [
    album,
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
  ]);

  return (
    <AlbumAudioPlayerContext.Provider value={contextValue}>
      {children}
    </AlbumAudioPlayerContext.Provider>
  );
};

export const useAlbumAudioPlayer = () => {
  const context = useContext(AlbumAudioPlayerContext);
  if (!context) {
    throw new Error('useAlbumAudioPlayer must be used inside AlbumAudioPlayerProvider.');
  }
  return context;
};
