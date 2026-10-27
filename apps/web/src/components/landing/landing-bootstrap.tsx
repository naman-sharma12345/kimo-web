'use client';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Film,
  Mic,
  Paperclip,
  Sparkles,
  Upload,
  SlidersHorizontal,
  FileText,
  Play,
  X,
} from 'lucide-react';
import { BrandMark } from './brand';
import {
  fileAccept,
  fileKind,
  landingLimits,
  samplePrompts,
  validateAttachments,
} from '@/lib/landing-validation';
import { landingTiming } from './timing';
import type { LandingPageProps } from './landing-page';
import '@/styles/ui.css';
import '@/styles/landing.css';

// Native controls intentionally do not import the UI tooltip/dialog/motion graph.
function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly,
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<'button'> & {
  variant?: string;
  size?: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ui-button ui-button-${variant} ${className}`}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      {...props}
    >
      <span className="ui-button-label">{children}</span>
    </button>
  );
}
function FilePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (preview)
    return (
      <span
        className="ui-attachment-image"
        style={{ backgroundImage: `url(${JSON.stringify(preview)})` }}
      />
    );
  if (fileKind(file) === 'audio')
    return (
      <span className="ui-waveform">
        {Array.from({ length: 12 }, (_, index) => (
          <i key={index} />
        ))}
      </span>
    );
  return <FileText />;
}
const examples = [
  { label: 'trip montage', Icon: Film },
  { label: 'podcast to shorts', Icon: Mic },
  { label: 'product teaser', Icon: Sparkles },
];
type Ready = {
  Page: React.ComponentType<LandingPageProps>;
  Providers: React.ComponentType<{ children: React.ReactNode }>;
};
async function importInteraction(): Promise<Ready> {
  const [page, providers] = await Promise.all([
    import('./landing-page'),
    import('@/app/interactive-providers'),
  ]);
  return { Page: page.LandingPage, Providers: providers.InteractiveProviders };
}
export function LandingBootstrap({
  loadInteraction = importInteraction,
}: { loadInteraction?: () => Promise<Ready> } = {}) {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [focused, setFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [placeholder, setPlaceholder] = useState(0);
  const [placeholderFading, setPlaceholderFading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [ready, setReady] = useState<Ready>();
  const interactive = !!ready && !picking && !composing && !dragging;
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const pending = useRef(false);
  const alive = useRef(true);
  const sendIntent = useRef(false);
  const signIn = useRef(false);
  const control = useRef<string | undefined>(undefined);
  const dragDepth = useRef(0);
  const activate = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(false);
    // This is the ONLY value import of either interactive graph. Never call on focus/mount/idle.
    void loadInteraction()
      .then((components) => {
        if (alive.current) {
          setReady(components);
          setLoading(false);
        }
      })
      .catch(() => {
        pending.current = false;
        sendIntent.current = false;
        if (alive.current) {
          setLoading(false);
          setError(true);
        }
      });
  }, [loadInteraction]);
  const attach = useCallback(
    (incoming: File[]) => {
      const result = validateAttachments(filesRef.current, incoming);
      filesRef.current = [...filesRef.current, ...result.accepted];
      setFiles(filesRef.current);
      setErrors(result.errors);
      activate();
    },
    [activate],
  );
  const pick = useCallback(() => {
    setPicking(true);
    input.current?.click(); // Must stay synchronous within the native user gesture.
    activate();
  }, [activate]);
  function settings(name: string) {
    control.current = name;
    activate();
  }
  function requestSend() {
    if (!prompt.trim() && !files.length) return;
    sendIntent.current = true;
    activate();
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (interactive) return;
    const picker = input.current;
    const cancel = () => setPicking(false);
    picker?.addEventListener('cancel', cancel);
    if (matchMedia('(pointer:fine) and (min-width:641px)').matches)
      textarea.current?.focus();
    return () => {
      picker?.removeEventListener('cancel', cancel);
    };
  }, [interactive]);
  React.useLayoutEffect(() => {
    const node = textarea.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    }
  }, [prompt]);
  useEffect(() => {
    if (interactive) return;
    if (
      hasInteracted ||
      prompt ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setPlaceholderFading(false);
      return;
    }
    let fade: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setPlaceholderFading(true);
      fade = setTimeout(
        () => {
          setPlaceholder((value) => (value + 1) % samplePrompts.length);
          setPlaceholderFading(false);
        },
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--dur-3',
          ),
        ),
      );
    }, landingTiming.placeholderMs);
    return () => {
      clearInterval(timer);
      clearTimeout(fade);
    };
  }, [hasInteracted, prompt, interactive]);
  useEffect(() => {
    if (interactive) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        pick();
      }
    };
    const enter = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }
    };
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      attach(Array.from(event.dataTransfer.files));
    };
    const paste = (event: ClipboardEvent) => {
      const incoming = Array.from(event.clipboardData?.files ?? []);
      if (incoming.length) {
        event.preventDefault();
        attach(incoming);
      } else if (event.target === textarea.current) activate();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [activate, attach, pick, interactive]);
  if (ready && interactive) {
    const node = textarea.current;
    const active = document.activeElement;
    const initialFocus =
      active instanceof HTMLElement
        ? {
            name: active.getAttribute('aria-label') ?? active.textContent ?? '',
            start: node?.selectionStart ?? 0,
            end: node?.selectionEnd ?? 0,
            direction: node?.selectionDirection ?? 'none',
            scrollTop: node?.scrollTop ?? 0,
          }
        : undefined;
    return (
      <ready.Providers>
        <ready.Page
          activated
          initialPrompt={prompt}
          initialFiles={files}
          initialSignIn={signIn.current}
          initialSend={sendIntent.current}
          initialFocus={initialFocus}
          initialControl={control.current}
          initialErrors={errors}
        />
      </ready.Providers>
    );
  }
  return (
    <div
      className="landing-page"
      data-bootstrap="true"
      data-ready="true"

      data-focused={focused || undefined}
      data-typing={!!prompt || undefined}
    >
      <div className="film-grain" aria-hidden="true" />
      <nav className="landing-nav" aria-label="main">
        <a href="/" className="brand">
          <BrandMark />
          kimo
        </a>
        <div className="landing-nav-links">
          <a href="#how-it-works">how it works</a>
          <a
            href="https://github.com/naman-sharma12345/kimo"
            target="_blank"
            rel="noreferrer"
          >
            github <ArrowUpRight />
          </a>
          <Button
            size="sm"
            onClick={() => {
              signIn.current = true;
              activate();
            }}
          >
            sign in
          </Button>
        </div>
      </nav>
      <main>
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="hero-copy">
            <span className="ui-pill" data-variant="live">
              <span className="ui-pill-dot" aria-hidden="true" />
              ai video editor · open source
            </span>
            <h1 id="landing-heading">
              <span>tell it the video.</span>
              <span>
                watch it get <em>made.</em>
              </span>
            </h1>
            <p className="hero-subtext">
              drop in your clips, photos and music. kimo cuts, captions, grades
              and scores it while you watch, and you can step in at any second.
            </p>
          </div>
          <div className="composer-anchor">
            <div className="horizon-glow" aria-hidden="true" />
            <div
              className="landing-composer"
              onFocusCapture={() => {
                setFocused(true);
                setHasInteracted(true);
              }}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setFocused(false);
              }}
            >
              <input
                ref={input}
                type="file"
                multiple
                accept={fileAccept}
                hidden
                onChange={(event) => {
                  attach(Array.from(event.target.files ?? []));
                  event.target.value = '';
                  setPicking(false);
                }}
                aria-label="attach files"
              />
              {!!files.length && (
                <div
                  className="composer-attachments"
                  data-two-rows={files.length > 3 || undefined}
                >
                  {files.map((item, index) => (
                    <div key={index}>
                      <div className="ui-attachment">
                        <span
                          className="ui-attachment-thumbnail"
                          aria-hidden="true"
                        >
                          <FilePreview file={item} />
                          {fileKind(item) === 'video' && (
                            <Play className="ui-attachment-play" />
                          )}
                        </span>
                        <span className="ui-attachment-copy">
                          <span
                            className="ui-attachment-name"
                            title={item.name}
                          >
                            {item.name}
                          </span>
                          <span className="ui-attachment-meta">
                            {(item.size / 1024 ** 2).toFixed(1)} MB
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`remove ${item.name}`}
                          className="ui-attachment-remove"
                          onClick={() =>
                            setFiles((current) =>
                              current.filter(
                                (_, position) => position !== index,
                              ),
                            )
                          }
                        >
                          <X aria-hidden="true" />
                        </Button>
                        <span
                          role="progressbar"
                          aria-label={`upload ${item.name}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={0}
                          className="ui-attachment-progress"
                        >
                          <span style={{ width: '0%' }} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textarea}
                aria-label="describe your video"
                placeholder={samplePrompts[placeholder]}
                data-placeholder-fading={placeholderFading || undefined}
                value={prompt}
                maxLength={landingLimits.characters}
                rows={2}

                onChange={(event) => {
                  setPrompt(event.target.value);
                  activate();
                }}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    requestSend();
                  }
                }}
              />
              <div className="composer-bottom">
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label="attach files"
                  title="attach files · ⌘ U"
                  onClick={pick}
                >
                  <Paperclip />
                </Button>
                <div className="composer-desktop-settings">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="aspect ratio: auto"
                    onClick={() => settings('aspect ratio: auto')}
                  >
                    <svg
                      className="aspect-frame"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <rect
                        x="1"
                        y="1"
                        width="14"
                        height="14"
                        rx="2"
                        stroke="currentColor"
                      />
                    </svg>
                    auto
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => settings('any length')}
                  >
                    any length
                  </Button>
                </div>
                <div className="composer-mobile-settings">
                  <Button
                    variant="ghost"
                    iconOnly
                    aria-label="video settings"
                    onClick={() => settings('video settings')}
                  >
                    <SlidersHorizontal />
                  </Button>
                </div>
                <span className="composer-spacer" />
                {prompt.length >= 3600 && (
                  <span
                    className="composer-counter"
                    data-limit={prompt.length === 4000 || undefined}
                  >
                    {prompt.length} / 4000
                  </span>
                )}
                <span className="composer-hint">drop files anywhere</span>
                <Button
                  variant="primary"
                  className="composer-send"
                  iconOnly
                  aria-label="start editing"
                  title="start editing · ↵"
                  disabled={!prompt.trim() && !files.length}
                  onClick={requestSend}
                >
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </div>
          <div className="example-prompts">
            {examples.map(({ label, Icon }, index) => (
              <button
                key={label}
                onClick={() => {
                  const text = samplePrompts[index] ?? '';
                  setPrompt(text);
                  activate();
                  if (textarea.current) textarea.current.value = text;
                  textarea.current?.focus();
                  textarea.current?.setSelectionRange(text.length, text.length);
                }}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
          <p className="landing-privacy">
            by sending, you agree that your files are processed by ai models.
            don’t upload anything private. <a href="/privacy">privacy</a>
          </p>
        </section>
        <section id="how-it-works" className="how-it-works">
          <h2>how it works</h2>
          <div className="how-grid">
            {[
              {
                title: 'say it',
                body: 'describe the video and drop in anything you have. no timeline skills needed.',
                Icon: Mic,
              },
              {
                title: 'watch it',
                body: 'every cut, caption and colour change shows up live. nothing hidden, nothing to wait for.',
                Icon: Film,
              },
              {
                title: 'steer it',
                body: 'jump in mid-edit, rewrite any word, ask for changes. render in 1080p when it’s right.',
                Icon: Sparkles,
              },
            ].map(({ title, body, Icon }) => (
              <article key={title}>
                <div
                  className="how-still"
                  role="img"
                  aria-label={`${title} preview placeholder`}
                >
                  <Icon />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>kimo · open source video editing</span>
        <div>
          <a href="https://github.com/naman-sharma12345/kimo">github</a>
          <a href="https://getkimo.tech">getkimo.tech</a>
        </div>
      </footer>
      {dragging && (
        <div className="landing-drop-overlay">
          <div>
            <Upload />
            <p>drop to add to your video</p>
            <span>video, images, audio, pdf · up to 2 GB each</span>
          </div>
        </div>
      )}
      <div className="landing-bootstrap-status" aria-live="polite">
        {loading && <span role="status">loading editor…</span>}
        {error && (
          <span role="alert">
            couldn’t load the editor. your input is still here.{' '}
            <button
              type="button"
              onClick={() => {
                sendIntent.current = false;
                activate();
              }}
            >
              try again
            </button>
          </span>
        )}
        {errors.map((message) => (
          <span role="alert" key={message}>
            {message}
          </span>
        ))}
      </div>
    </div>
  );
}
