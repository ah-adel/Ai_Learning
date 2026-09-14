import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';

type VideoPlayerProps = {
  src: string;
  title: string;
  className?: string;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const retryTimerRef = useRef<number | null>(null);
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    video.load();

    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [src]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

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

    const target = Math.min(Math.max(value, 0), video.duration);
    pendingSeekRef.current = target;
    setCurrentTime(target);
    setIsBuffering(true);

    try {
      video.currentTime = target;
    } catch {
      return;
    }

    void playVideo();
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

  return (
    <div
      ref={containerRef}
      className={`group relative aspect-video overflow-hidden bg-black text-white shadow-sm ${className}`}
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

      {isBuffering && !hasError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" role="status" aria-label="Buffering" />
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <AlertCircle className="h-8 w-8 text-amber-400" aria-hidden="true" />
          <p className="text-sm text-white">The video could not be loaded.</p>
          <button type="button" onClick={retryPlayback} className="btn-secondary border-white/20 bg-white/10 text-white hover:bg-white/20">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry playback
          </button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-10 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <div className="relative mb-3 h-1.5">
          <div className="absolute inset-0 rounded-full bg-white/25" />
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${Math.min(bufferedPercent, 100)}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary-400" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="absolute inset-0 h-1.5 w-full cursor-pointer appearance-none bg-transparent accent-primary-400"
            aria-label="Seek video"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={togglePlay} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={isPlaying ? 'Pause video' : 'Play video'} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <span className="min-w-[92px] tabular-nums text-white/90">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <button type="button" onClick={() => setPlayerVolume(volume > 0 ? 0 : 1)} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={volume > 0 ? 'Mute video' : 'Unmute video'} title={volume > 0 ? 'Mute' : 'Unmute'}>
            {volume > 0 ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
          </button>
          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => setPlayerVolume(Number(event.target.value))} className="hidden w-20 accent-primary-400 sm:block" aria-label="Volume" style={{ backgroundSize: `${volumePercent}% 100%` }} />
          <label className="ml-auto flex items-center gap-1.5 text-white/80">
            <span className="sr-only">Playback speed</span>
            <select value={playbackRate} onChange={(event) => setPlayerRate(Number(event.target.value))} className="rounded border border-white/20 bg-black/50 px-1.5 py-1 text-xs text-white outline-none focus:ring-2 focus:ring-white" aria-label="Playback speed">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void toggleFullscreen()} className="rounded p-1.5 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize className="h-4 w-4" aria-hidden="true" /> : <Maximize className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {!isBuffering && !hasError && !isPlaying && currentTime === 0 && (
        <button type="button" onClick={togglePlay} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-600 p-4 shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white" aria-label="Play video">
          <Play className="h-6 w-6 fill-current" aria-hidden="true" />
        </button>
      )}

      {isPlaying && currentTime > 0 && <span className="sr-only"><Check /> Video playing</span>}
    </div>
  );
}
