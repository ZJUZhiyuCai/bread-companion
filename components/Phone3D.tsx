'use client';

import { useEffect, useRef, useState } from 'react';
import type { PhoneEngine } from './phone3d/engine';
import { overlayBox, type PhoneLayout } from './phone3d/layouts';
import type { PhonePose } from './RedPhone';
import { useReducedMotion } from './hooks';

interface Phone3DProps {
  layout: PhoneLayout;
  pose: PhonePose;
  /** Hover / keyboard focus on the phone button. */
  lift?: boolean;
  /** Home page only: when it first appears, the handset gives one small hop — then rests for good. */
  greet?: boolean;
  className?: string;
  /** True once the 3D phone is on screen; false again if it is lost. The drawn phone steps aside only then. */
  onReady?: (ready: boolean) => void;
}

type Stage = 'loading' | 'ready' | 'failed';

// A broken graphics driver should not be retried when the user moves from the
// home screen into a call. Network failures remain retryable on the next stage.
let graphicsFailed = false;

/**
 * The Blender phone, drawn over the existing picture on a transparent canvas that never takes a pointer.
 * three.js and the model load only here, after the page is idle, and only once per page; until they are
 * up — or if anything at all goes wrong, WebGL lost included — the drawn phone is what people see and
 * press. Nothing about the call waits for it.
 */
export function Phone3D({ layout, pose, lift = false, greet = false, className = '', onReady }: Phone3DProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<PhoneEngine | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  // First-time shader/environment setup can be expensive on a software GPU.
  // Let permission + the welcome audio settle first; the SVG already dials.
  const [canInitialize, setCanInitialize] = useState(pose !== 'dialing');
  const reducedMotion = useReducedMotion();
  const input = { pose, lift, reducedMotion, greet };
  const inputRef = useRef(input);
  inputRef.current = input;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (pose !== 'dialing') setCanInitialize(true);
  }, [pose]);

  useEffect(() => {
    if (!canInitialize) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let engine: PhoneEngine | null = null;
    let graphicsStarted = false;
    // A fresh canvas per run: a context that has been released can't be picked up again.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    const stop = () => {
      engine?.dispose();
      engine = null;
      engineRef.current = null;
    };
    const fail = (why?: unknown) => {
      if (cancelled) return;
      if (graphicsStarted) graphicsFailed = true;
      stop();
      if (why && process.env.NODE_ENV !== 'production') console.warn('[phone3d] keeping the drawn phone:', why);
      setStage('failed');
      readyRef.current?.(false);
    };

    const start = async () => {
      try {
        if (graphicsFailed) { fail(); return; }
        const mod = await import('./phone3d/engine');
        const bytes = await mod.fetchPhoneModel();
        if (cancelled) return;
        if (graphicsFailed) { fail(); return; }
        graphicsStarted = true;
        engine = new mod.PhoneEngine(canvas, layout, () => fail('WebGL context lost'), () => {
          if (cancelled || !engine) return;
          // Parsing is not painting. Publish both states in the same frame so
          // the still cannot disappear while the canvas is still transparent.
          setStage('ready');
          readyRef.current?.(true);
        });
        await engine.load(bytes);
        if (cancelled || !engine) return;
        engine.setInput(inputRef.current);
        engineRef.current = engine;
      } catch (err) {
        fail(err);
      }
    };
    const cancelIdle = whenIdle(() => void start());

    return () => {
      cancelled = true;
      cancelIdle();
      stop();
      canvas.remove();
    };
  }, [layout, canInitialize]);

  useEffect(() => {
    engineRef.current?.setInput({ pose, lift, reducedMotion, greet });
  }, [pose, lift, reducedMotion, greet, stage]);

  useEffect(() => () => readyRef.current?.(false), []);

  if (stage === 'failed') return null;
  return (
    <span
      ref={hostRef}
      className={`phone3d ${className}`}
      data-state={stage}
      style={overlayBox(layout)}
      aria-hidden="true"
    />
  );
}

/** Load after the page has settled, so the 3D phone never competes with what the person just pressed. */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 1500 });
    return () => window.cancelIdleCallback(id);
  }
  const t = window.setTimeout(fn, 200);
  return () => window.clearTimeout(t);
}
