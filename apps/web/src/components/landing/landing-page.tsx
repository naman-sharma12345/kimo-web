'use client';
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowUp,
  ArrowUpRight,
  Film,
  Mic,
  Paperclip,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { AttachmentChip } from '@/components/ui/attachment-chip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogActions,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { persistSession, useUploads } from '@/lib/uploads';
import { durations, easings, spring } from '@/lib/motion';
import {
  fileAccept,
  fileKind,
  landingLimits,
  samplePrompts,
  validateAttachments,
} from '@/lib/landing-validation';
import { useSession } from '@/stores/session';
import { BrandMark } from './brand';
import { ComposerSettings, type Aspect } from './composer-settings';
import '@/styles/ui.css';
import '@/styles/landing.css';
import { landingTiming } from './timing';
const examples = [
  { label: 'trip montage', Icon: Film },
  { label: 'podcast to shorts', Icon: Mic },
  { label: 'product teaser', Icon: Sparkles },
];
interface LocalAttachment {
  file: File;
  id: string;
  preview?: string;
}
export function LandingPage() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { notify } = useToast();
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<LocalAttachment[]>(() =>
    useUploads
      .getState()
      .items.map((item) => ({ file: item.file, id: item.localId })),
  );
  const [aspect, setAspect] = useState<Aspect>('auto');
  const [duration, setDuration] = useState<number>();
  const [focused, setFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [composerEntered, setComposerEntered] = useState(false);
  const [placeholder, setPlaceholder] = useState(0);
  const [placeholderFading, setPlaceholderFading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [exitTarget, setExitTarget] = useState({ y: 0, scaleY: 1 });
  const filesRef = useRef(files);
  filesRef.current = files;
  const uploadItems = useUploads((state) => state.items);
  const inFlight = useRef(false);
  const sessionStarted = useRef(false);
  const dragDepth = useRef(0);
  const attach = useCallback(
    (incoming: File[]) => {
      if (inFlight.current) return;
      const result = validateAttachments(
        filesRef.current.map((item) => item.file),
        incoming,
      );
      result.errors.forEach((message) => notify({ message, tone: 'error' }));
      if (!result.accepted.length) return;
      const ids = useUploads.getState().add(result.accepted);
      const additions = result.accepted.map((file, index) => ({
        file,
        id: ids[index] ?? crypto.randomUUID(),
        preview: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined,
      }));
      filesRef.current = [...filesRef.current, ...additions];
      setFiles(filesRef.current);
    },
    [notify],
  );
  useEffect(
    () => () => {
      filesRef.current.forEach((item) => {
        if (item.preview) URL.revokeObjectURL(item.preview);
      });
    },
    [],
  );
  useEffect(() => {
    if (matchMedia('(pointer:fine) and (min-width:641px)').matches)
      textarea.current?.focus();
  }, []);
  useEffect(() => {
    if (hasInteracted || prompt || reduced) {
      setPlaceholderFading(false);
      return;
    }
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setPlaceholderFading(true);
      fadeTimer = setTimeout(() => {
        setPlaceholder((value) => (value + 1) % samplePrompts.length);
        setPlaceholderFading(false);
      }, durations.d3 * 1000);
    }, landingTiming.placeholderMs);
    return () => {
      clearInterval(timer);
      clearTimeout(fadeTimer);
    };
  }, [hasInteracted, prompt, reduced]);
  useEffect(() => {
    const node = textarea.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    }
  }, [prompt]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'u') {
        event.preventDefault();
        input.current?.click();
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
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length) {
        event.preventDefault();
        attach(pasted);
      }
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
  }, [attach]);
  async function send() {
    if (inFlight.current || (!prompt.trim() && !files.length)) return;
    inFlight.current = true;
    const bounds = composerRef.current?.getBoundingClientRect();
    if (bounds && composerRef.current) {
      const pill = parseFloat(
        getComputedStyle(composerRef.current).getPropertyValue('--space-48'),
      );
      setExitTarget({
        y: window.innerHeight / 2 - bounds.top - bounds.height / 2,
        scaleY: pill / bounds.height,
      });
    }
    setSending(true);
    try {
      const text = prompt.trim() || 'make a great video from these';
      // A restored previous session must not cause a new landing prompt to reuse its id.
      // Reset only once, so a navigation/storage failure never creates a duplicate session.
      if (!sessionStarted.current) {
        useUploads.setState({ session: undefined });
        sessionStarted.current = true;
      }
      const session = await useUploads.getState().startSession({
        prompt: text,
        aspect,
        ...(duration ? { durationHint: duration } : {}),
      });
      const preserved = {
        ...session,
        prompt: prompt.trim() ? prompt : session.prompt,
      };
      persistSession(preserved);
      useUploads.setState({ session: preserved });
      try {
        useSession.getState().save(preserved);
      } catch {
        useSession.setState({ draft: preserved });
      }
      await new Promise((resolve) =>
        setTimeout(resolve, (reduced ? durations.d3 : durations.d5) * 1000),
      );
      const navigate = () =>
        router.push(`/warmup/${encodeURIComponent(session.sessionId)}`);
      if (document.startViewTransition) document.startViewTransition(navigate);
      else navigate();
    } catch {
      setSending(false);
      inFlight.current = false;
      notify({
        message:
          'couldn’t start a session. your files are still here, try again.',
        tone: 'error',
      });
    }
  }
  function remove(id: string) {
    useUploads.getState().cancel(id);
    filesRef.current = filesRef.current.filter((item) => {
      if (item.id !== id) return true;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return false;
    });
    setFiles(filesRef.current);
  }
  return (
    <div
      className="landing-page"
      data-ready="true"
      data-sending={sending || undefined}
      data-focused={focused || undefined}
      data-typing={!!prompt || undefined}
    >
      <div className="film-grain" aria-hidden="true" />
      <nav className="landing-nav" aria-label="main">
        <Link href="/" className="brand">
          <BrandMark />
          kimo
        </Link>
        <div className="landing-nav-links">
          <a href="#how-it-works">how it works</a>
          <a
            href="https://github.com/naman-sharma12345/kimo"
            target="_blank"
            rel="noreferrer"
          >
            github <ArrowUpRight />
          </a>
          <Button size="sm" onClick={() => setSignIn(true)}>
            sign in
          </Button>
        </div>
      </nav>
      <main>
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="hero-copy">
            <Pill variant="live">ai video editor · open source</Pill>
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
            <motion.div
              ref={composerRef}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              animate={
                reduced
                  ? { opacity: sending ? 0 : 1, scale: 1 }
                  : {
                      opacity: 1,
                      scale: 1,
                      y: sending ? exitTarget.y : 0,
                      scaleY: sending ? exitTarget.scaleY : 1,
                    }
              }
              transition={
                reduced
                  ? { duration: durations.d3 }
                  : sending
                    ? { duration: durations.d5, ease: easings.in }
                    : {
                        ...spring.soft,
                        delay: composerEntered
                          ? 0
                          : landingTiming.composerEnter,
                      }
              }
              onAnimationComplete={() => setComposerEntered(true)}
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
                }}
                aria-label="attach files"
              />
              {!!files.length && (
                <div
                  className="composer-attachments"
                  data-two-rows={files.length > 3 || undefined}
                >
                  {files.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={
                        reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      transition={
                        reduced
                          ? { duration: durations.d2 }
                          : {
                              ...spring.snappy,
                              delay: index * landingTiming.attachmentStagger,
                            }
                      }
                    >
                      <AttachmentChip
                        name={item.file.name}
                        meta={`${(item.file.size / 1024 ** 2).toFixed(1)} MB`}
                        kind={fileKind(item.file)}
                        thumbnail={
                          uploadItems.find(
                            (upload) => upload.localId === item.id,
                          )?.meta.thumbBlobUrl ?? item.preview
                        }
                        progress={
                          (uploadItems.find(
                            (upload) => upload.localId === item.id,
                          )?.progress ?? 0) * 100
                        }
                        onRemove={() => remove(item.id)}
                      />
                    </motion.div>
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
                disabled={sending}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.blur();
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label="attach files"
                  tooltip="attach files · ⌘ U"
                  onClick={() => input.current?.click()}
                >
                  <Paperclip />
                </Button>
                <ComposerSettings
                  aspect={aspect}
                  setAspect={setAspect}
                  duration={duration}
                  setDuration={setDuration}
                />
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
                  tooltip="start editing · ↵"
                  disabled={sending || (!prompt.trim() && !files.length)}
                  onClick={() => void send()}
                >
                  <ArrowUp />
                </Button>
              </div>
            </motion.div>
          </div>
          <div className="example-prompts">
            {examples.map(({ label, Icon }, index) => (
              <button
                key={label}
                onClick={() => {
                  const text = samplePrompts[index] ?? '';
                  setPrompt(text);
                  requestAnimationFrame(() => {
                    textarea.current?.focus();
                    textarea.current?.setSelectionRange(
                      text.length,
                      text.length,
                    );
                  });
                }}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
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
      <Dialog open={signIn} onOpenChange={setSignIn}>
        <DialogContent>
          <DialogTitle>accounts are coming soon.</DialogTitle>
          <DialogDescription>you can use kimo without one.</DialogDescription>
          <DialogActions>
            <Button onClick={() => setSignIn(false)}>ok</Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
      {dragging && (
        <div className="landing-drop-overlay">
          <div>
            <Upload />
            <p>drop to add to your video</p>
            <span>video, images, audio, pdf · up to 2 GB each</span>
          </div>
        </div>
      )}
    </div>
  );
}
