(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HwarakMusic = api;
})(globalThis, function () {
  'use strict';
  function position(time, track) {
    const t = Math.max(0, time), span = track.loopEnd - track.loopStart;
    return t < track.loopEnd ? t : track.loopStart + (t - track.loopEnd) % span;
  }
  class Player {
    constructor(url, track, environment = globalThis) {
      this.url = url; this.track = track; this.env = environment;
      this.context = null; this.buffer = null; this.source = null; this.gain = null;
      this.origin = 0; this.enabled = true; this.loading = null; this.error = null;
    }
    prepare() {
      if (this.loading) return this.loading;
      this.loading = (async () => {
        const Context = this.env.AudioContext || this.env.webkitAudioContext;
        if (!Context) throw new Error('이 브라우저에서는 음악 재생을 지원하지 않아요.');
        this.context ||= new Context({ latencyHint: 'interactive' });
        this.gain ||= this.context.createGain(); this.gain.gain.value = this.enabled ? .75 : 0;
        this.gain.connect(this.context.destination);
        const response = await this.env.fetch(this.url);
        if (!response.ok) throw new Error('음악을 불러오지 못했어요.');
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (buffer.duration < this.track.loopEnd) throw new Error('음악 파일 길이가 맞지 않아요.');
        // Blend the quiet pre-beat tails; do not move beats or overlap their attacks.
        const end = Math.round(this.track.loopEnd * buffer.sampleRate), start = Math.round(this.track.loopStart * buffer.sampleRate);
        const fade = Math.round(this.track.loopFade * buffer.sampleRate);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const pcm = buffer.getChannelData(channel);
          for (let i = 0; i < fade; i++) {
            const alpha = i / Math.max(1, fade - 1);
            pcm[end - fade + i] = pcm[end - fade + i] * (1 - alpha) + pcm[start - fade + i] * alpha;
          }
        }
        this.buffer = buffer; this.error = null; return true;
      })().catch(error => { this.error = error.message; return false; });
      return this.loading;
    }
    async unlock() {
      // Call resume synchronously inside the click/key event, before awaiting data.
      const resume = this.context?.resume();
      await resume; return !!this.buffer && this.context?.state === 'running';
    }
    audibleNow() {
      const ctx = this.context, now = this.env.performance.now();
      const stamp = ctx.getOutputTimestamp?.();
      if (stamp?.contextTime > 0 && stamp.performanceTime > 0 && Math.abs(now - stamp.performanceTime) < 500) {
        return Math.min(ctx.currentTime, stamp.contextTime + (now - stamp.performanceTime) / 1000);
      }
      return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    start(time) {
      this.stop();
      if (!this.buffer || this.context.state !== 'running') return false;
      const source = this.context.createBufferSource(); source.buffer = this.buffer;
      source.loop = true; source.loopStart = this.track.loopStart; source.loopEnd = this.track.loopEnd;
      source.connect(this.gain);
      // The same audio timeline drives the visible notes and the input judgement.
      this.origin = this.context.currentTime + .025 - time;
      this.startTime = time;
      source.start(this.origin + Math.max(0, time), position(time, this.track));
      this.source = source; return true;
    }
    stop() {
      if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (this.gain) this.gain.gain.setTargetAtTime(enabled ? .75 : 0, this.context.currentTime, .01);
    }
    time() { return this.source ? Math.max(this.startTime, this.audibleNow() - this.origin) : null; }
    snapshot() { const t = this.time(); return { loaded: !!this.buffer, playing: !!this.source, enabled: this.enabled,
      contextState: this.context?.state || 'unavailable', bpm: this.track.bpm, offset: this.track.beatOffset,
      time: t == null ? null : +t.toFixed(4), position: t == null ? null : +position(t, this.track).toFixed(4), error: this.error }; }
  }
  return { Player, position };
});
