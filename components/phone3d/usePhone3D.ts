'use client';

import { useEffect, useState } from 'react';

/**
 * Whether to try the 3D phone at all. False on the server and on the first client render, so the drawn
 * phone is what hydrates; true after mount unless:
 *
 *   ?phone=svg     the drawn phone, for comparing against the fallback
 *   no WebGL 2     three.js 0.187 needs it
 *   Save-Data      the browser asked for less to download
 *
 * Trying is not committing: until the model is up the drawn phone stays, and any failure keeps it.
 */
export function usePhone3D(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(allowed());
  }, []);
  return on;
}

function allowed(): boolean {
  if (new URLSearchParams(window.location.search).get('phone') === 'svg') return false;
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}
