'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { BreadController } from './bread-controller';
import type { BreadViewModel } from '@/domain/view-model';
export function useBread(): BreadViewModel {
  const ref = useRef<BreadController | null>(null);
  if (!ref.current) ref.current = new BreadController();
  const controller = ref.current;
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.initialize(); return () => controller.dispose(); }, [controller]);
  useEffect(() => { const onHide = () => controller.end(); window.addEventListener('pagehide', onHide); return () => window.removeEventListener('pagehide', onHide); }, [controller]);
  useEffect(() => { const onVisibility = () => { if (document.hidden) controller.pauseForBackground(); }; document.addEventListener('visibilitychange', onVisibility); return () => document.removeEventListener('visibilitychange', onVisibility); }, [controller]);
  return view;
}
