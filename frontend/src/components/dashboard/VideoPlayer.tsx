import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Maximize,
  Minimize,
  PanelTopClose,
  PanelTopOpen,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useI18n } from '../../context/I18nContext';

type VideoPlayerProps = {
  src: string;
  title: string;
  className?: string;
};

type VideoBookmark = {
  id: string;
  time: number;
  note: string;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200;
const SEEK_STEP_SECONDS = 10;
const SEEK_SEQUENCE_WINDOW_MS = 800;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00';

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');

  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${formattedMinutes}:${formattedSeconds}`
    : `${formattedMinutes}:${formattedSeconds}`;
}

export function VideoPlayer({ src, title, className = '' }: VideoPlayerProps) {
  const { t, direction } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const notesPanelRef = useRef<HTMLDivElement>(null);
  const retryTimerRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const rippleTimerRef = useRef<number | null>(null);
  const tapSequenceRef = useRef<{ direction: 'backward' | 'forward'; count: number } | null>(null);
  const seekAccumulatorRef = useRef<{ direction: 'backward' | 'forward'; amount: number } | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTime, setNoteTime] = useState(0);
  const [bookmarks, setBookmarks] = useState<VideoBookmark[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [seekRipple, setSeekRipple] = useState<{ direction: 'backward' | 'forward'; amount: number } | null>(null);
  const bookmarkStorageKey = `video-${src}`;

  const hasOpenOverlay = isSpeedMenuOpen || isNotesPanelOpen;

  const revealControls = () => {
    setShowControls(true);
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }

    if (isPlaying && !hasOpenOverlay) {
      controlsHideTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }

    pendingSeekRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setBufferedTime(0);
    setRetryCount(0);
    setHasError(false);
    setIsBuffering(true);
    setIsPlaying(false);
    setIsTheaterMode(false);
    setShowControls(true);
    tapSequenceRef.current = null;
    seekAccumulatorRef.current = null;
    setIsNotesPanelOpen(false);
    setNoteDraft('');
    setNoteTime(0);
    video.load();

    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      if (rippleTimerRef.current !== null) {
        window.clearTimeout(rippleTimerRef.current);
      }
    };
  }, [src]);

  useEffect(() => {
    revealControls();

    return () => {
      if (controlsHideTimerRef.current !== null) {
        window.clearTimeout(controlsHideTimerRef.current);
        controlsHideTimerRef.current = null;
      }
    };
  }, [isPlaying, hasOpenOverlay]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedBookmarks = window.localStorage.getItem(bookmarkStorageKey);
      if (!storedBookmarks) {
        setBookmarks([]);
        return;
      }

      const parsedBookmarks: unknown = JSON.parse(storedBookmarks);
      if (!Array.isArray(parsedBookmarks)) {
        setBookmarks([]);
        return;
      }

      const validBookmarks = parsedBookmarks.filter((bookmark): bookmark is VideoBookmark => (
        typeof bookmark === 'object'
        && bookmark !== null
        && typeof (bookmark as VideoBookmark).id === 'string'
        && typeof (bookmark as VideoBookmark).time === 'number'
        && Number.isFinite((bookmark as VideoBookmark).time)
        && typeof (bookmark as VideoBookmark).note === 'string'
      ));
      setBookmarks(validBookmarks);
    } catch {
      setBookmarks([]);
    }
  }, [bookmarkStorageKey]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isSpeedMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!speedMenuRef.current?.contains(event.target as Node)) {
        setIsSpeedMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSpeedMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isSpeedMenuOpen]);

  useEffect(() => {
    if (!isNotesPanelOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!notesPanelRef.current?.contains(event.target as Node)) {
        setIsNotesPanelOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNotesPanelOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isNotesPanelOpen]);

  const updateBufferedTime = () => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0) return;

    for (let index = video.buffered.length - 1; index >= 0; index -= 1) {
      if (video.buffered.start(index) <= video.currentTime) {
        setBufferedTime(video.buffered.end(index));
        return;
      }
    }

    setBufferedTime(video.buffered.end(video.buffered.length - 1));
  };

  const playVideo = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      await video.play();
      setHasError(false);
    } catch {
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void playVideo();
    } else {
      video.pause();
    }
  };

  const seekTo = (value: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    const wasPlaying = !video.paused;
    const target = Math.min(Math.max(value, 0), video.duration);
    pendingSeekRef.current = target;
    setCurrentTime(target);
    setIsBuffering(true);

    try {
      video.currentTime = target;
    } catch {
      return;
    }

    if (wasPlaying) void playVideo();
  };

  const skipBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;

    seekTo(video.currentTime + seconds);
  };

  const performAccumulatedSeek = (direction: 'backward' | 'forward') => {
    const previous = seekAccumulatorRef.current;
    const amount = previous?.direction === direction
      ? previous.amount + SEEK_STEP_SECONDS
      : SEEK_STEP_SECONDS;

    seekAccumulatorRef.current = { direction, amount };
    skipBy(direction === 'forward' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS);
    setSeekRipple({ direction, amount });

    if (rippleTimerRef.current !== null) window.clearTimeout(rippleTimerRef.current);
    rippleTimerRef.current = window.setTimeout(() => {
      tapSequenceRef.current = null;
      seekAccumulatorRef.current = null;
      setSeekRipple(null);
      rippleTimerRef.current = null;
    }, SEEK_SEQUENCE_WINDOW_MS);
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-player-controls]')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;

    const isPhysicalLeft = event.clientX - bounds.left < bounds.width / 2;
    const isRtl = document.documentElement.dir === 'rtl';
    const direction = (isRtl ? isPhysicalLeft : !isPhysicalLeft) ? 'forward' : 'backward';
    const previous = tapSequenceRef.current;
    const count = previous?.direction === direction ? previous.count + 1 : 1;
    tapSequenceRef.current = { direction, count };

    if (count % 2 === 0) {
      performAccumulatedSeek(direction);
    }
    revealControls();
  };

  const handlePlayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement;
    const isInteractiveTarget = target !== event.currentTarget
      && Boolean(target.closest('button, input, textarea, select, a'));
    if (isInteractiveTarget) return;

    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && key !== 'j' && key !== 'l') return;

    event.preventDefault();
    const isRtl = document.documentElement.dir === 'rtl';
    const isForward = event.key === 'ArrowLeft'
      ? isRtl
      : event.key === 'ArrowRight'
        ? !isRtl
        : key === 'l';
    performAccumulatedSeek(isForward ? 'forward' : 'backward');
    revealControls();
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    if (pendingSeekRef.current !== null) {
      video.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
      void playVideo();
    }
  };

  const handleError = () => {
    const video = videoRef.current;
    if (!video) return;

    setIsPlaying(false);
    if (retryCount >= MAX_RETRIES) {
      setHasError(true);
      setIsBuffering(false);
      return;
    }

    const target = Number.isFinite(video.currentTime) ? video.currentTime : pendingSeekRef.current ?? 0;
    pendingSeekRef.current = target;
    setRetryCount((count) => count + 1);
    setIsBuffering(true);
    retryTimerRef.current = window.setTimeout(() => {
      video.load();
      void playVideo();
    }, RETRY_DELAY_MS * (retryCount + 1));
  };

  const retryPlayback = () => {
    setRetryCount(0);
    setHasError(false);
    pendingSeekRef.current = currentTime;
    const video = videoRef.current;
    if (!video) return;
    video.load();
    void playVideo();
  };

  const setPlayerVolume = (value: number) => {
    const nextVolume = Math.min(Math.max(value, 0), 1);
    setVolume(nextVolume);
    if (videoRef.current) videoRef.current.volume = nextVolume;
  };

  const setPlayerRate = (value: number) => {
    setPlaybackRate(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
    setIsSpeedMenuOpen(false);
  };

  const openNoteComposer = () => {
    const capturedTime = videoRef.current?.currentTime ?? currentTime;
    videoRef.current?.pause();
    setNoteTime(capturedTime);
    setNoteDraft('');
    setIsNotesPanelOpen(true);
  };

  const saveBookmark = () => {
    const trimmedNote = noteDraft.trim();
    if (!trimmedNote) return;

    const nextBookmark: VideoBookmark = {
      id: `${Date.now()}-${noteTime}`,
      time: noteTime,
      note: trimmedNote,
    };
    setBookmarks((current) => {
      const nextBookmarks = [
      ...current,
        nextBookmark,
      ].sort((left, right) => left.time - right.time);

      try {
        window.localStorage.setItem(bookmarkStorageKey, JSON.stringify(nextBookmarks));
      } catch {
      }

      return nextBookmarks;
    });
    setNoteDraft('');
  };

  const deleteBookmark = (bookmarkId: string) => {
    setBookmarks((current) => {
      const nextBookmarks = current.filter((bookmark) => bookmark.id !== bookmarkId);

      try {
        window.localStorage.setItem(bookmarkStorageKey, JSON.stringify(nextBookmarks));
      } catch {
      }

      return nextBookmarks;
    });
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (bufferedTime / duration) * 100 : 0;
  const volumePercent = volume * 100;
  const isRtl = direction === 'rtl';
  const seekRippleIsOnPhysicalLeft = isRtl
    ? seekRipple?.direction === 'forward'
    : seekRipple?.direction === 'backward';

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handlePlayerKeyDown}
      onClick={handleCanvasClick}
      onMouseEnter={revealControls}
      onMouseMove={revealControls}
      className={`group relative aspect-video w-full overflow-hidden bg-black text-white shadow-sm transition-[max-width,transform] duration-500 ease-out ${isTheaterMode ? 'max-w-none scale-[1.01]' : 'max-w-full'} ${className}`}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        src={src}
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => {
          setCurrentTime(videoRef.current?.currentTime ?? 0);
          updateBufferedTime();
        }}
        onProgress={updateBufferedTime}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onStalled={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={() => setIsPlaying(false)}
        onError={handleError}
        aria-label={title}
      />

      {seekRipple && (
        <div
          key={`${seekRipple.direction}-${seekRipple.amount}`}
          className={`pointer-events-none absolute inset-y-0 flex w-1/2 items-center justify-center ${seekRippleIsOnPhysicalLeft ? 'left-0' : 'right-0'}`}
          aria-live="polite"
        >
          <div className={`flex h-28 w-36 animate-ping-once flex-col items-center justify-center bg-black/50 text-white backdrop-blur-sm ${seekRippleIsOnPhysicalLeft ? 'rounded-e-full' : 'rounded-s-full'}`}>
            {seekRippleIsOnPhysicalLeft ? <ChevronsLeft className="h-9 w-9" aria-hidden="true" /> : <ChevronsRight className="h-9 w-9" aria-hidden="true" />}
            <span className="mt-1 text-sm font-semibold">{seekRipple.direction === 'forward' ? `+${seekRipple.amount}s` : `-${seekRipple.amount}s`}</span>
          </div>
        </div>
      )}

      {isBuffering && !hasError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" role="status" aria-label={t('common.videoBuffering')} />
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <AlertCircle className="h-8 w-8 text-amber-400" aria-hidden="true" />
          <p className="text-sm text-white">{t('common.videoLoadError')}</p>
          <button type="button" onClick={retryPlayback} className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/20">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('common.retryPlayback')}
          </button>
        </div>
      )}

      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="relative mb-3 h-1.5">
          <div className="absolute inset-0 rounded-full bg-white/25" />
          <div className="absolute inset-y-0 start-0 rounded-full bg-white/40" style={{ width: `${Math.min(bufferedPercent, 100)}%` }} />
          <div className="absolute inset-y-0 start-0 rounded-full bg-primary-400" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="absolute inset-0 h-1.5 w-full cursor-pointer appearance-none bg-transparent accent-primary-400"
            aria-label={t('common.seekVideo')}
          />
        </div>

        <div data-player-controls="true" className="flex items-center gap-2 text-xs">
          <button type="button" onClick={togglePlay} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={isPlaying ? t('common.pauseVideo') : t('common.playVideo')} title={isPlaying ? t('common.pause') : t('common.play')}>
            {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <span className="min-w-[92px] tabular-nums text-white/90">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <button type="button" onClick={() => setPlayerVolume(volume > 0 ? 0 : 1)} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={volume > 0 ? t('common.muteVideo') : t('common.unmuteVideo')} title={volume > 0 ? t('common.mute') : t('common.unmute')}>
            {volume > 0 ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
          </button>
          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setPlayerVolume(Number(event.target.value))} className="hidden w-20 accent-primary-400 sm:block" aria-label={t('common.volume')} style={{ backgroundSize: `${volumePercent}% 100%` }} />
          <div ref={speedMenuRef} className="relative ms-auto">
            <button
              type="button"
              onClick={() => setIsSpeedMenuOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded border border-white/20 bg-black/50 px-1.5 py-1 text-xs text-white/90 outline-none transition-colors hover:bg-black/70 focus:ring-2 focus:ring-white"
              aria-haspopup="menu"
              aria-expanded={isSpeedMenuOpen}
              aria-label={t('common.playbackSpeed')}
            >
              <span>{playbackRate}x</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isSpeedMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {isSpeedMenuOpen && (
              <div
                className="absolute bottom-full end-0 z-20 mb-2 min-w-36 origin-bottom-right animate-scale-in rounded-lg border border-[color:var(--popover-border)] bg-[color:var(--popover)] p-1 text-[color:var(--popover-foreground)] shadow-xl"
                role="menu"
                aria-label={t('common.playbackSpeed')}
              >
                {PLAYBACK_RATES.map((rate) => {
                  const isActive = rate === playbackRate;
                  const label = rate === 1 ? t('common.normalSpeed') : `${rate}x`;

                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setPlayerRate(rate)}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-start text-xs transition-colors hover:bg-[color:var(--popover-accent)] hover:text-[color:var(--popover-accent-foreground)] focus:outline-none focus:ring-2 focus:ring-primary-500/60 ${isActive ? 'bg-[color:var(--popover-accent)] font-semibold text-[color:var(--popover-accent-foreground)]' : ''}`}
                      role="menuitemradio"
                      aria-checked={isActive}
                    >
                      <span>{label}</span>
                      {isActive && <Check className="h-3.5 w-3.5 text-primary-500" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div ref={notesPanelRef} className="relative">
            {isNotesPanelOpen && (
              <div className="absolute bottom-full end-0 z-30 mb-2 flex max-h-[min(22rem,70vh)] w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-[color:var(--popover-border)] bg-[color:var(--popover)] p-3 text-[color:var(--popover-foreground)] shadow-2xl sm:w-80 animate-scale-in">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{t('common.bookmarkNote')}</p>
                    <p className="text-[11px] opacity-65">{formatTime(noteTime)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsNotesPanelOpen(false)}
                    className="rounded p-1 text-current/60 transition-colors hover:bg-[color:var(--popover-accent)] hover:text-current focus:outline-none focus:ring-2 focus:ring-primary-500/60"
                    aria-label={t('common.close')}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex gap-2">
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveBookmark();
                    }}
                    rows={2}
                    placeholder={t('common.notePlaceholder')}
                    className="min-w-0 flex-1 resize-none rounded-lg border border-[color:var(--popover-border)] bg-transparent px-2.5 py-2 text-xs outline-none placeholder:text-current/45 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={saveBookmark}
                    disabled={!noteDraft.trim()}
                    className="self-end rounded-lg bg-primary-600 px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('common.saveNote')}
                  </button>
                </div>

                <div className="border-t border-[color:var(--popover-border)] pt-2">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-60">{t('common.savedBookmarks')}</p>
                  {bookmarks.length === 0 ? (
                    <p className="text-xs opacity-60">{t('common.noBookmarks')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {bookmarks.map((bookmark) => (
                        <div key={bookmark.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[color:var(--popover-accent)]">
                          <button
                            type="button"
                            onClick={() => seekTo(bookmark.time)}
                            className="shrink-0 rounded bg-primary-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/60 dark:text-primary-300"
                            aria-label={`${t('common.seekBookmark')} ${formatTime(bookmark.time)}`}
                          >
                            {formatTime(bookmark.time)}
                          </button>
                          <p className="min-w-0 flex-1 break-words text-xs leading-5">{bookmark.note}</p>
                          <button
                            type="button"
                            onClick={() => deleteBookmark(bookmark.id)}
                            className="shrink-0 rounded p-1 text-current/50 transition-colors hover:bg-red-500/10 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/60"
                            aria-label={t('common.deleteBookmark')}
                            title={t('common.deleteBookmark')}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={openNoteComposer}
              className={`rounded p-1.5 transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white ${isNotesPanelOpen ? 'text-primary-300' : 'text-white/90'}`}
              aria-label={t('common.bookmarkNote')}
              title={t('common.bookmarkNote')}
            >
              <Bookmark className="h-4 w-4" fill={isNotesPanelOpen ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setIsTheaterMode((mode) => !mode)}
            className="rounded p-1.5 text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white"
            aria-label={isTheaterMode ? t('common.exitTheaterMode') : t('common.theaterMode')}
            title={isTheaterMode ? t('common.exitTheaterMode') : t('common.theaterMode')}
          >
            {isTheaterMode ? <PanelTopClose className="h-4 w-4" aria-hidden="true" /> : <PanelTopOpen className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={isFullscreen ? t('common.exitFullscreen') : t('common.enterFullscreen')} title={isFullscreen ? t('common.exitFullscreen') : t('common.fullscreen')}>
            {isFullscreen ? <Minimize className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {!isBuffering && !hasError && !isPlaying && currentTime === 0 && (
        <button type="button" onClick={togglePlay} className="absolute start-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-600 p-4 shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white" aria-label={t('common.playVideo')}>
          <Play className="h-6 w-6 fill-current" aria-hidden="true" />
        </button>
      )}

      {isPlaying && currentTime > 0 && <span className="sr-only"><Check /> {t('common.videoPlaying')}</span>}
    </div>
  );
}
