(function (root) {
  'use strict';
  const profiles = Object.freeze([
    Object.freeze({ name: 'high', dpr: 2, maxPixels: 3000000, motes: 148, dust: 22 }),
    Object.freeze({ name: 'balanced', dpr: 1.5, maxPixels: 1700000, motes: 108, dust: 16 }),
    Object.freeze({ name: 'light', dpr: 1, maxPixels: 1000000, motes: 76, dust: 12 })
  ]);
  class Controller {
    constructor() { this.level = 0; this.changes = 0; this.reset(); }
    get profile() { return profiles[this.level]; }
    reset() { this.elapsed = 0; this.frames = 0; this.slowWindows = 0; this.grace = 1800; }
    observe(deltaMs, active) {
      // Ignore loading, countdown, pauses, manual test stepping and tab switches.
      if (!active || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 500) { this.reset(); return false; }
      if (this.grace > 0) { this.grace -= deltaMs; return false; }
      this.elapsed += deltaMs; this.frames++;
      if (this.elapsed < 1800) return false;
      const averageMs = this.elapsed / this.frames;
      this.elapsed = this.frames = 0;
      this.slowWindows = averageMs > 22 ? this.slowWindows + 1 : 0;
      if (this.slowWindows < 2 || this.level >= profiles.length - 1) return false;
      this.level++; this.changes++; this.reset(); return true;
      // Keep the lighter setting until reload, avoiding visible quality oscillation
      // and repeated overload when the 30-second chord section starts.
    }
    ratio(width, height, deviceRatio) {
      return Math.min(deviceRatio || 1, this.profile.dpr, Math.sqrt(this.profile.maxPixels / Math.max(1, width * height)));
    }
  }
  const api = { Controller, profiles };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HwarakQuality = api;
})(typeof window === 'object' ? window : globalThis);
