/** Quiet local ringback, only after the user starts a call. Never a network/paid audio request. */
export function startDialTone(context: AudioContext): () => void {
  const tones: OscillatorNode[] = [];
  let gain: GainNode | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const tone of tones) {
      tone.onended = null;
      try { tone.stop(); } catch { /* ended naturally */ }
      tone.disconnect();
    }
    gain?.disconnect();
  };
  try {
    gain = context.createGain();
    gain.connect(context.destination);
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    for (const offset of [0, 3.4]) {
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.012, now + offset + 0.03);
      gain.gain.setValueAtTime(0.012, now + offset + 0.75);
      gain.gain.linearRampToValueAtTime(0, now + offset + 0.81);
    }
    for (const frequency of [425, 450]) {
      const tone = context.createOscillator();
      tones.push(tone);
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.onended = stop;
      tone.start(now);
      tone.stop(now + 4.3);
    }
  } catch { stop(); /* Ringback is optional; a browser can still carry a call without it. */ }
  return stop;
}
