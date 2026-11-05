/** Coalesce only the startup burst. At 128 kbit/s, 16 kB is about one second
 * of MP3 audio. The provider usually generates this faster than real time;
 * one useful packet avoids a tiny first fragment racing the next network packet.
 * No samples are decoded, dropped, synthesized again or time-stretched here. */
export async function* bufferSpeechStart(source: AsyncIterable<Uint8Array>, minimumBytes = 16000): AsyncGenerator<Uint8Array> {
  let pending: Uint8Array[] = [], length = 0, started = minimumBytes <= 0;
  const join = () => { const bytes = new Uint8Array(length); let offset = 0; for (const part of pending) { bytes.set(part, offset); offset += part.length; } pending = []; length = 0; return bytes; };
  for await (const chunk of source) {
    if (started) { yield chunk; continue; }
    pending.push(chunk); length += chunk.length;
    if (length >= minimumBytes) {
      started = true; const burst = join();
      // Joining a small prefix to a maximum-size provider event must not exceed
      // the browser's existing 512 KiB decoded-chunk bound.
      for (let at = 0; at < burst.length; at += 512 * 1024) yield burst.subarray(at, at + 512 * 1024);
    }
  }
  // A short complete response must never wait for bytes that will not arrive.
  if (length) yield join();
}
