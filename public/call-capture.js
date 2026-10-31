// PCM stays in the browser. No network, storage, analysis of emotions, or microphone echo.
class BreadCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.armed = false; this.buffer = new Float32Array(1024); this.offset = 0; this.epoch = 0;
    this.port.onmessage = ({ data }) => { this.armed = data.armed === true; this.epoch = data.epoch; this.offset = 0; };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!this.armed || !samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.offset++] = samples[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage({ samples: this.buffer, epoch: this.epoch, at: (currentFrame + i + 1 - this.buffer.length) / sampleRate }, [this.buffer.buffer]);
        this.buffer = new Float32Array(1024); this.offset = 0;
      }
    }
    return true; // Outputs remain zero: the user's mic is never routed to their speakers.
  }
}
registerProcessor('bread-capture', BreadCapture);
