'use client';
import * as React from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
import type { Video } from '@kimo/client';
import { mediaTime, safeMediaUrl } from '@/lib/delivery/format';
import styles from './delivery.module.css';

export function VideoPlayer({ video }: { video: Video }) {
  const element = React.useRef<HTMLVideoElement>(null);
  const container = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [buffered, setBuffered] = React.useState<
    readonly { start: number; end: number }[]
  >([]);
  const [hoverTime, setHoverTime] = React.useState<number>();
  const [message, setMessage] = React.useState('');
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  React.useEffect(() => {
    const changed = () =>
      setIsFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const generation = React.useRef(0);
  React.useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [video.url]);
  const sync = () => {
    const media = element.current;
    if (!media) return;
    setPlaying(!media.paused && !media.ended);
    setTime(media.currentTime);
    setDuration(Number.isFinite(media.duration) ? media.duration : 0);
    setVolume(media.volume);
    setMuted(media.muted);
    setRate(media.playbackRate);
    const ranges = [];
    for (let i = 0; i < media.buffered.length; i++)
      ranges.push({
        start: media.buffered.start(i),
        end: media.buffered.end(i),
      });
    setBuffered(ranges);
  };
  const toggle = async () => {
    const media = element.current;
    if (!media) return;
    const current = generation.current;
    if (!media.paused) {
      media.pause();
      return;
    }
    try {
      await media.play();
      if (current === generation.current) setMessage('');
    } catch {
      if (current === generation.current)
        setMessage('playback could not start. press play to try again.');
    }
  };
  const seek = (value: number) => {
    const media = element.current;
    if (media && Number.isFinite(media.duration))
      media.currentTime = Math.max(0, Math.min(media.duration, value));
  };
  const fullscreen = async () => {
    const current = generation.current;
    try {
      if (
        document.fullscreenElement === container.current &&
        typeof document.exitFullscreen === 'function'
      )
        await document.exitFullscreen();
      else if (typeof container.current?.requestFullscreen === 'function')
        await container.current.requestFullscreen();
      else setMessage('fullscreen is not available in this browser.');
    } catch {
      if (current === generation.current)
        setMessage('unable to enter fullscreen.');
    }
  };
  const toggleMute = () => {
    if (element.current) element.current.muted = !element.current.muted;
  };
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target !== event.currentTarget &&
      target.closest(
        'input,select,textarea,[contenteditable="true"],[role="menu"]',
      )
    )
      return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (
      (key === ' ' || key === 'Enter') &&
      target instanceof HTMLElement &&
      target.closest('button,a') &&
      !target.hasAttribute('data-play-surface')
    )
      return;
    if (key === ' ' || key === 'k') void toggle();
    else if (key === 'j') seek((element.current?.currentTime ?? 0) - 10);
    else if (key === 'l') seek((element.current?.currentTime ?? 0) + 10);
    else if (key === 'f') void fullscreen();
    else if (key === 'm') toggleMute();
    else return;
    event.preventDefault();
  };
  const safeUrl = safeMediaUrl(video.url);
  return (
    <div
      ref={container}
      onKeyDownCapture={keyboard}
      className={styles.player}
      data-playing={playing}
      data-portrait={video.height > video.width || undefined}
      style={{ aspectRatio: `${video.width} / ${video.height}` }}
    >
      <div className={styles.keySurface}>
        <video
          ref={element}
          src={safeUrl}
          poster={safeMediaUrl(video.posterUrl)}
          controls={false}
          playsInline
          preload="metadata"
          onWaiting={() => setWaiting(true)}
          onCanPlay={() => setWaiting(false)}
          onPlaying={() => {
            setWaiting(false);
            sync();
          }}
          onLoadedMetadata={sync}
          onDurationChange={sync}
          onTimeUpdate={sync}
          onProgress={sync}
          onPlay={sync}
          onPause={sync}
          onEnded={sync}
          onSeeking={sync}
          onSeeked={sync}
          onVolumeChange={sync}
          onRateChange={sync}
          onError={() =>
            setMessage(
              'the video could not be loaded. the media link may need refreshing.',
            )
          }
          aria-label={video.title}
        >
          <track
            kind="captions"
            label="no captions supplied"
            src="data:text/vtt,WEBVTT%0A%0A"
          />
        </video>
        <button
          type="button"
          className={styles.playSurface}
          aria-label="video player. Space or K play, J and L seek, F fullscreen, M mute"
          data-play-surface
          onClick={() => void toggle()}
        />
        {!playing && (
          <button
            type="button"
            className={styles.centerPlay}
            aria-label="play video"
            onClick={() => void toggle()}
          >
            <Play aria-hidden="true" />
          </button>
        )}
        <div className={styles.controls} aria-label="playback controls">
          <button
            type="button"
            aria-label={playing ? 'pause' : 'play'}
            onClick={() => void toggle()}
          >
            {playing ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
          <div className={styles.scrub}>
            <div className={styles.track} aria-hidden="true">
              {duration > 0 &&
                buffered.map((range, index) => (
                  <span
                    key={index}
                    className={styles.buffer}
                    style={{
                      left: `${(range.start / duration) * 100}%`,
                      width: `${((range.end - range.start) / duration) * 100}%`,
                    }}
                  />
                ))}
              <span
                className={styles.played}
                style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
              />
            </div>
            <input
              aria-label="seek"
              type="range"
              min={0}
              max={duration || 0}
              step="0.01"
              value={Math.min(time, duration)}
              disabled={!duration}
              onChange={(event) => seek(Number(event.target.value))}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setHoverTime(
                  Math.max(
                    0,
                    Math.min(
                      duration,
                      ((event.clientX - rect.left) / rect.width) * duration,
                    ),
                  ),
                );
              }}
              onPointerLeave={() => setHoverTime(undefined)}
              onFocus={() => setHoverTime(time)}
              onBlur={() => setHoverTime(undefined)}
            />
            {hoverTime !== undefined && (
              <output className={styles.timeTooltip}>
                {mediaTime(hoverTime)}
              </output>
            )}
          </div>
          <span className={styles.time}>
            {mediaTime(time)} / {mediaTime(duration)}
          </span>
          <button
            type="button"
            aria-label={muted ? 'unmute' : 'mute'}
            onClick={toggleMute}
          >
            {muted ? (
              <VolumeX aria-hidden="true" />
            ) : (
              <Volume2 aria-hidden="true" />
            )}
          </button>
          <input
            className={styles.volume}
            type="range"
            aria-label="volume"
            min={0}
            max={1}
            step="0.01"
            value={muted ? 0 : volume}
            onChange={(event) => {
              const media = element.current;
              if (media) {
                media.volume = Number(event.target.value);
                media.muted = false;
              }
            }}
          />
          <label className={styles.speed}>
            <span className={styles.srOnly}>playback speed</span>
            <select
              aria-label="playback speed"
              value={rate}
              onChange={(event) => {
                if (element.current)
                  element.current.playbackRate = Number(event.target.value);
              }}
            >
              {[0.5, 1, 1.25, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={isFullscreen ? 'exit fullscreen' : 'fullscreen'}
            onClick={() => void fullscreen()}
          >
            <Maximize aria-hidden="true" />
          </button>
        </div>
      </div>
      {waiting && (
        <span className={styles.buffering} role="status">
          buffering
        </span>
      )}
      {message && (
        <p className={styles.playerMessage} role="status">
          {message}
        </p>
      )}
      {!safeUrl && <p role="alert">this media URL is not supported.</p>}
    </div>
  );
}
