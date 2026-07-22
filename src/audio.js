const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const AIRCRAFT_SAMPLE_URL = new URL('../assets/audio/jet-plane-flyby.mp3', import.meta.url).href;

/**
 * Web Audio soundscape. Call unlock() from the start-button gesture; all other
 * methods intentionally degrade to silent no-ops when audio is unavailable or
 * still blocked by the browser.
 */
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.ambientNodes = null;
    this.aircraftNodes = null;
    this.aircraftSampleBuffer = null;
    this.aircraftSampleDataPromise = this._fetchAircraftSample();
    this.ambientWanted = false;
    this.muted = false;
    this.activeVoices = new Set();
    this.voiceCatalog = [];
    this.lastVoiceSelection = null;
    this.lastEvent = null;
    this.deathSerial = 0;
    this._voiceRefreshHandler = () => this._refreshVoices();
    globalThis.speechSynthesis?.addEventListener?.('voiceschanged', this._voiceRefreshHandler);
    this._refreshVoices();
  }

  async unlock() {
    if (!this.ctx) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return false;
      try {
        this.ctx = new Context({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -12;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.18;
        this.master.gain.value = this.muted ? 0 : 0.72;
        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this.noiseBuffer = this._makeNoiseBuffer(2);
      } catch (error) {
        console.warn('[CLEARWATER] Web Audio could not be initialized', error);
        this.ctx = null;
        return false;
      }
    }

    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (error) {
      console.warn('[CLEARWATER] Web Audio remains locked', error);
      return false;
    }

    await this._prepareAircraftSample();
    if (this.ambientWanted && !this.ambientNodes) this._startAmbient();
    this._refreshVoices();
    return this.ctx.state === 'running';
  }

  ambient(enabled = true) {
    this.ambientWanted = enabled !== false;
    if (!this.ctx || this.ctx.state !== 'running') return false;
    if (this.ambientWanted) this._startAmbient();
    else this._stopAmbient();
    return true;
  }

  gunshot(options = {}) {
    if (!this._canPlay()) return false;
    if (typeof options === 'number') options = { pan: options };
    const at = this.ctx.currentTime + 0.002;
    const pan = clamp(Number(options.pan) || 0, -1, 1);
    const volume = clamp(Number(options.volume ?? 1), 0, 1.5);

    // Supersonic crack, receiver snap, and short outdoor body.
    this._noise(at, 0.052, 0.52 * volume, {
      filter: 'highpass', frequency: 720, q: 0.7, attack: 0.001, pan,
    });
    this._noise(at + 0.012, 0.19, 0.2 * volume, {
      filter: 'lowpass', frequency: 1650, q: 0.5, attack: 0.002, pan,
    });
    this._tone(at, 118, 0.16, 0.19 * volume, {
      endFrequency: 48, type: 'triangle', attack: 0.001, pan,
    });
    this._tone(at, 1780, 0.035, 0.055 * volume, {
      endFrequency: 940, type: 'square', attack: 0.001, pan,
    });
    return true;
  }

  enemyShot(distance = 12, pan = 0) {
    if (!this._canPlay()) return false;
    if (distance && typeof distance === 'object') {
      pan = distance.pan ?? pan;
      distance = distance.distance ?? 12;
    }
    const meters = Math.max(1, Number(distance) || 12);
    const level = clamp(1 / (0.9 + meters * 0.065), 0.12, 0.72);
    const at = this.ctx.currentTime + 0.002;
    pan = clamp(Number(pan) || 0, -1, 1);
    this._noise(at, 0.045, 0.36 * level, {
      filter: 'highpass', frequency: 620 + meters * 16, q: 0.8, attack: 0.001, pan,
    });
    this._noise(at + 0.014, 0.24 + Math.min(meters, 30) * 0.006, 0.15 * level, {
      filter: 'bandpass', frequency: 940, q: 0.55, attack: 0.003, pan,
    });
    this._tone(at, 104, 0.13, 0.11 * level, {
      endFrequency: 54, type: 'triangle', pan,
    });
    return true;
  }

  reload() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.01;
    this._metalClick(at, 0.85, -0.06);
    this._noise(at + 0.16, 0.07, 0.065, {
      filter: 'bandpass', frequency: 780, q: 1.2, attack: 0.002, pan: 0.03,
    });
    this._metalClick(at + 0.37, 1.1, 0.05);
    this._metalClick(at + 0.48, 0.62, 0.02);
    return true;
  }

  impact(material = 'concrete', pan = 0) {
    if (!this._canPlay()) return false;
    if (material && typeof material === 'object') {
      pan = material.pan ?? pan;
      material = material.material ?? material.type ?? 'concrete';
    }
    const at = this.ctx.currentTime + 0.002;
    const kind = String(material).toLowerCase();
    pan = clamp(Number(pan) || 0, -1, 1);

    if (/metal|steel|pipe/.test(kind)) {
      this._noise(at, 0.045, 0.14, { filter: 'highpass', frequency: 1800, q: 1.1, pan });
      this._tone(at, 2140, 0.18, 0.07, { endFrequency: 1480, type: 'sine', pan });
    } else if (/glass/.test(kind)) {
      this._noise(at, 0.11, 0.12, { filter: 'highpass', frequency: 3200, q: 0.8, pan });
      this._tone(at, 3480, 0.13, 0.055, { endFrequency: 2440, type: 'sine', pan });
    } else if (/water|brine/.test(kind)) {
      this._noise(at, 0.16, 0.095, { filter: 'lowpass', frequency: 1150, q: 0.4, attack: 0.01, pan });
    } else if (/body|fabric/.test(kind)) {
      this._noise(at, 0.075, 0.11, { filter: 'lowpass', frequency: 520, q: 0.7, pan });
      this._tone(at, 82, 0.09, 0.045, { endFrequency: 48, type: 'triangle', pan });
    } else {
      this._noise(at, 0.095, 0.13, { filter: 'bandpass', frequency: 1250, q: 0.65, pan });
      this._tone(at, 72, 0.075, 0.04, { endFrequency: 46, type: 'triangle', pan });
    }
    return true;
  }

  footstep(material = 'concrete', intensity = 1) {
    if (!this._canPlay()) return false;
    if (material && typeof material === 'object') {
      intensity = material.intensity ?? material.volume ?? intensity;
      material = material.material ?? 'concrete';
    }
    const at = this.ctx.currentTime + 0.002;
    const level = clamp(Number(intensity) || 1, 0.15, 1.4);
    const kind = String(material).toLowerCase();
    const metal = /metal|steel|grate/.test(kind);
    this._noise(at, metal ? 0.065 : 0.095, (metal ? 0.07 : 0.055) * level, {
      filter: 'bandpass', frequency: metal ? 1450 : 480, q: metal ? 1.5 : 0.7,
    });
    this._tone(at, metal ? 190 : 68, metal ? 0.12 : 0.08, 0.025 * level, {
      endFrequency: metal ? 135 : 46, type: 'triangle',
    });
    return true;
  }

  radio(kind = 'incoming') {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.005;
    const outgoing = kind === 'outgoing' || kind === 'end';
    this._noise(at, 0.13, 0.028, {
      filter: 'bandpass', frequency: 2100, q: 0.9, attack: 0.008,
    });
    this._tone(at, outgoing ? 920 : 1160, 0.07, 0.038, {
      endFrequency: outgoing ? 720 : 1420, type: 'sine',
    });
    this._tone(at + 0.095, outgoing ? 690 : 1450, 0.055, 0.025, {
      type: 'sine',
    });
    return true;
  }

  aircraftTakeoff() {
    if (!this._canPlay()) return false;
    if (this.aircraftNodes) return true;
    const at = this.ctx.currentTime + 0.01;
    const bus = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner?.() ?? null;
    bus.gain.setValueAtTime(0.0001, at);
    bus.gain.exponentialRampToValueAtTime(0.88, at + 0.42);
    if (panner) bus.connect(panner).connect(this.master);
    else bus.connect(this.master);

    const turbine = this.ctx.createOscillator();
    const turbineGain = this.ctx.createGain();
    turbine.type = 'sawtooth';
    turbine.frequency.value = 68;
    turbineGain.gain.value = 0.026;
    turbine.connect(turbineGain).connect(bus);

    const fan = this.ctx.createOscillator();
    const fanGain = this.ctx.createGain();
    fan.type = 'triangle';
    fan.frequency.value = 196;
    fanGain.gain.value = 0.012;
    fan.connect(fanGain).connect(bus);

    const rumble = this.ctx.createBufferSource();
    const rumbleFilter = this.ctx.createBiquadFilter();
    const rumbleGain = this.ctx.createGain();
    rumble.buffer = this.noiseBuffer;
    rumble.loop = true;
    rumble.playbackRate.value = 0.62;
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 360;
    rumbleFilter.Q.value = 0.65;
    rumbleGain.gain.value = 0.055;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(bus);

    const exhaust = this.ctx.createBufferSource();
    const exhaustFilter = this.ctx.createBiquadFilter();
    const exhaustGain = this.ctx.createGain();
    exhaust.buffer = this.noiseBuffer;
    exhaust.loop = true;
    exhaust.playbackRate.value = 0.9;
    exhaustFilter.type = 'bandpass';
    exhaustFilter.frequency.value = 980;
    exhaustFilter.Q.value = 0.48;
    exhaustGain.gain.value = 0.045;
    exhaust.connect(exhaustFilter).connect(exhaustGain).connect(bus);

    // Retain a quiet low-frequency UAV bed beneath the real flyby recording so
    // the large airframe still has weight without sounding synthesized.
    const whoosh = this.ctx.createBufferSource();
    const whooshFilter = this.ctx.createBiquadFilter();
    const whooshGain = this.ctx.createGain();
    whoosh.buffer = this.noiseBuffer;
    whoosh.loop = true;
    whoosh.playbackRate.value = 1.08;
    whooshFilter.type = 'bandpass';
    whooshFilter.frequency.value = 720;
    whooshFilter.Q.value = 0.34;
    whooshGain.gain.value = 0.052;
    whoosh.connect(whooshFilter).connect(whooshGain).connect(bus);

    let sampleSource = null;
    if (this.aircraftSampleBuffer) {
      sampleSource = this.ctx.createBufferSource();
      const sampleGain = this.ctx.createGain();
      sampleSource.buffer = this.aircraftSampleBuffer;
      // Align the natural Doppler peak with the aircraft's closest visual pass.
      sampleSource.playbackRate.value = 1.18;
      sampleGain.gain.value = 0.92;
      sampleSource.connect(sampleGain).connect(bus);
    }

    const sources = [turbine, fan, rumble, exhaust, whoosh];
    if (sampleSource) sources.push(sampleSource);
    sources.forEach((source) => source.start(at));
    this.aircraftNodes = {
      bus, panner, turbine, fan, rumbleFilter, exhaustFilter, whooshFilter, sampleSource, sources,
    };
    return true;
  }

  aircraftFlyby(progress = 0) {
    if (!this.aircraftNodes || !this._canPlay()) return false;
    const t = clamp(Number(progress) || 0, 0, 1);
    const pass = Math.sin(t * Math.PI);
    const at = this.ctx.currentTime;
    const { bus, panner, turbine, fan, rumbleFilter, exhaustFilter, whooshFilter } = this.aircraftNodes;
    bus.gain.setTargetAtTime(0.88 + pass * 0.28, at, 0.055);
    if (panner) panner.pan.setTargetAtTime(-0.55 + t * 1.1, at, 0.06);
    turbine.frequency.setTargetAtTime(68 + pass * 34, at, 0.065);
    fan.frequency.setTargetAtTime(196 + pass * 118, at, 0.065);
    rumbleFilter.frequency.setTargetAtTime(360 + pass * 210, at, 0.07);
    exhaustFilter.frequency.setTargetAtTime(980 + pass * 1050, at, 0.07);
    whooshFilter.frequency.setTargetAtTime(720 + pass * 1450, at, 0.055);
    return true;
  }

  aircraftStop(fadeSeconds = 0.7) {
    if (!this.aircraftNodes || !this.ctx) return false;
    const nodes = this.aircraftNodes;
    this.aircraftNodes = null;
    const at = this.ctx.currentTime;
    const fade = clamp(Number(fadeSeconds) || 0.7, 0.08, 2.5);
    nodes.bus.gain.cancelScheduledValues(at);
    nodes.bus.gain.setValueAtTime(Math.max(0.0001, nodes.bus.gain.value), at);
    nodes.bus.gain.exponentialRampToValueAtTime(0.0001, at + fade);
    for (const source of nodes.sources) {
      try { source.stop(at + fade + 0.04); } catch { /* source already stopped */ }
    }
    return true;
  }

  voice(speaker, text, options = {}) {
    if (this.muted || !String(text ?? '').trim()) return false;
    const synth = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!synth || typeof Utterance !== 'function') return false;
    try {
      if (options.interrupt) synth.cancel();
      const utterance = new Utterance(String(text));
      const identity = String(speaker ?? '').toUpperCase();
      const selectedVoice = this._selectVoice(identity);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang || 'en-US';
      } else {
        utterance.lang = 'en-US';
      }
      const officer = /MAJOR|OFFICER|RESPONSE/.test(identity);
      const voiceSpeed = 1.5;
      utterance.rate = voiceSpeed;
      utterance.pitch = /HOSTILE|SECURITY/.test(identity) ? 0.72 : officer ? 0.82 : /HAWK SEVEN|AIRCREW/.test(identity) ? 0.94 : 1;
      utterance.volume = clamp(Number(options.volume ?? (officer ? 0.84 : 0.74)), 0, 1);
      this.lastVoiceSelection = {
        speaker: String(speaker ?? ''),
        name: selectedVoice?.name ?? 'browser-default',
        lang: utterance.lang,
        rate: utterance.rate,
        pitch: utterance.pitch,
      };
      utterance.onend = utterance.onerror = () => this.activeVoices.delete(utterance);
      this.activeVoices.add(utterance);
      synth.speak(utterance);
      return true;
    } catch (error) {
      console.warn('[CLEARWATER] Speech synthesis failed', error);
      return false;
    }
  }

  enemyAlert() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.002;
    this._noise(at, 0.24, 0.13, { filter: 'bandpass', frequency: 1650, q: 0.7, attack: 0.004 });
    this._tone(at, 740, 0.13, 0.07, { endFrequency: 1120, type: 'square' });
    this._tone(at + 0.16, 1120, 0.2, 0.055, { endFrequency: 720, type: 'square' });
    this.voice('HOSTILE SECURITY', 'Contact! Intruder! All posts engage!', { volume: 0.82, interrupt: true });
    return true;
  }

  objective() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.01;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      this._tone(at + index * 0.085, frequency, 0.34, 0.045 - index * 0.004, {
        type: 'sine', attack: 0.012,
      });
    });
    return true;
  }

  powerOn() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.01;
    this._metalClick(at, 0.7, -0.1);
    this._metalClick(at + 0.18, 0.9, 0.1);
    this._noise(at + 0.2, 1.55, 0.045, {
      filter: 'lowpass', frequency: 520, q: 0.5, attack: 0.5,
    });
    this._tone(at + 0.16, 43, 1.9, 0.055, {
      endFrequency: 50, type: 'sine', attack: 0.65,
    });
    this._tone(at + 0.34, 100, 1.5, 0.018, {
      type: 'sine', attack: 0.4,
    });
    return true;
  }

  damage() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.002;
    this._tone(at, 74, 0.22, 0.2, { endFrequency: 43, type: 'sine', attack: 0.001 });
    this._noise(at, 0.12, 0.13, { filter: 'lowpass', frequency: 680, q: 0.6 });
    this._tone(at + 0.035, 840, 0.58, 0.028, {
      endFrequency: 720, type: 'sine', attack: 0.01,
    });
    return true;
  }

  death() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.002;
    this.deathSerial += 1;
    this.lastEvent = { type: 'death', serial: this.deathSerial };
    // A short voiced fall: two descending harmonics plus turbulent breath make
    // an unmistakable human-like grunt without relying on an external sample.
    this._tone(at, 172, 0.48, 0.24, { endFrequency: 66, type: 'sawtooth', attack: 0.003 });
    this._tone(at + 0.012, 92, 0.72, 0.2, { endFrequency: 34, type: 'triangle', attack: 0.004 });
    this._noise(at, 0.42, 0.31, { filter: 'bandpass', frequency: 690, q: 0.8, attack: 0.006 });
    // Body impact, two fading heartbeats, then a clear auditory shutdown tail.
    this._noise(at + 0.2, 0.28, 0.28, { filter: 'lowpass', frequency: 430, q: 0.6, attack: 0.003 });
    this._tone(at + 0.2, 58, 0.34, 0.27, { endFrequency: 31, type: 'sine', attack: 0.002 });
    [0.5, 0.94].forEach((offset, index) => {
      this._tone(at + offset, 49 - index * 7, 0.25, 0.2 - index * 0.055, {
        endFrequency: 29, type: 'sine', attack: 0.003,
      });
    });
    this._tone(at + 0.16, 1280, 1.85, 0.07, {
      endFrequency: 860, type: 'sine', attack: 0.08,
    });
    return true;
  }

  failure() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.03;
    [392, 311.13, 233.08, 174.61].forEach((frequency, index) => {
      this._tone(at + index * 0.25, frequency, 1.45, 0.055, {
        endFrequency: frequency * 0.82, type: 'triangle', attack: 0.035,
      });
    });
    this._noise(at + 0.15, 1.9, 0.045, { filter: 'lowpass', frequency: 720, q: 0.45, attack: 0.45 });
    return true;
  }

  success() {
    if (!this._canPlay()) return false;
    const at = this.ctx.currentTime + 0.04;
    const notes = [261.63, 329.63, 392, 523.25];
    notes.forEach((frequency, index) => {
      this._tone(at + index * 0.22, frequency, 2.1 - index * 0.12, 0.038, {
        type: 'sine', attack: 0.18,
      });
      this._tone(at + index * 0.22, frequency / 2, 2.3, 0.014, {
        type: 'triangle', attack: 0.25,
      });
    });
    this._noise(at, 2.0, 0.026, {
      filter: 'lowpass', frequency: 1050, q: 0.35, attack: 0.75,
    });
    return true;
  }

  ending() {
    return this.success();
  }

  stopVoices() {
    try {
      globalThis.speechSynthesis?.cancel?.();
    } catch {
      // Browsers may tear down their speech service while a page is closing.
    }
    this.activeVoices.clear();
    return true;
  }

  setMuted(muted = true) {
    this.muted = Boolean(muted);
    if (this.muted) this.stopVoices();
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, now, 0.025);
    }
    return this.muted;
  }

  _canPlay() {
    return Boolean(this.ctx && this.master && this.ctx.state === 'running');
  }

  getState() {
    return {
      contextState: this.ctx?.state ?? 'unavailable',
      muted: this.muted,
      aircraftActive: Boolean(this.aircraftNodes),
      aircraftSampleReady: Boolean(this.aircraftSampleBuffer),
      aircraftSampleActive: Boolean(this.aircraftNodes?.sampleSource),
      aircraftGain: this.aircraftNodes?.bus?.gain?.value ?? 0,
      aircraftPan: this.aircraftNodes?.panner?.pan?.value ?? 0,
      turbineFrequency: this.aircraftNodes?.turbine?.frequency?.value ?? 0,
      whooshFrequency: this.aircraftNodes?.whooshFilter?.frequency?.value ?? 0,
      voiceCatalogSize: this.voiceCatalog.length,
      lastVoiceSelection: this.lastVoiceSelection ? { ...this.lastVoiceSelection } : null,
      deathSerial: this.deathSerial,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
    };
  }

  _refreshVoices() {
    try {
      this.voiceCatalog = globalThis.speechSynthesis?.getVoices?.() ?? [];
    } catch {
      this.voiceCatalog = [];
    }
    return this.voiceCatalog;
  }

  _fetchAircraftSample() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(AIRCRAFT_SAMPLE_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`aircraft sample returned ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error) => {
        console.warn('[CLEARWATER] Aircraft sample could not be loaded; using procedural fallback', error);
        return null;
      });
  }

  async _prepareAircraftSample() {
    if (this.aircraftSampleBuffer || !this.ctx) return this.aircraftSampleBuffer;
    const data = await this.aircraftSampleDataPromise;
    if (!data) return null;
    try {
      this.aircraftSampleBuffer = await this.ctx.decodeAudioData(data.slice(0));
    } catch (error) {
      console.warn('[CLEARWATER] Aircraft sample could not be decoded; using procedural fallback', error);
    }
    return this.aircraftSampleBuffer;
  }

  _selectVoice(identity = '') {
    const voices = this.voiceCatalog.length ? this.voiceCatalog : this._refreshVoices();
    if (!voices.length) return null;
    const english = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang || ''));
    const pool = english.length ? english : voices;
    const malePreference = [
      /\bAlex\b/i, /\bDaniel\b/i, /\bAaron\b/i, /\bArthur\b/i,
      /\bReed\b/i, /\bEddy\b/i, /\bGordon\b/i, /\bRalph\b/i,
      /\bFred\b/i, /\bRishi\b/i, /Google UK English Male/i,
      /Microsoft (?:Guy|Ryan|Mark)/i,
    ];
    // Every voiced role intentionally uses the male pool, including Mara.
    // Speaker labels remain part of the story; only their performed voice is
    // unified so no browser-default female voice leaks into the radio cast.
    for (const pattern of malePreference) {
      const match = pool.find((voice) => pattern.test(voice.name || ''));
      if (match) return match;
    }
    return pool.find((voice) => voice.default) ?? pool[0];
  }

  _makeNoiseBuffer(seconds) {
    const length = Math.ceil(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.12 + white * 0.88;
      data[i] = last;
    }
    return buffer;
  }

  _startAmbient() {
    if (this.ambientNodes || !this._canPlay()) return;
    const at = this.ctx.currentTime;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, at);
    bus.gain.exponentialRampToValueAtTime(1, at + 1.4);
    bus.connect(this.master);

    const breeze = this.ctx.createBufferSource();
    const breezeFilter = this.ctx.createBiquadFilter();
    const breezeGain = this.ctx.createGain();
    breeze.buffer = this.noiseBuffer;
    breeze.loop = true;
    breezeFilter.type = 'lowpass';
    breezeFilter.frequency.value = 920;
    breezeFilter.Q.value = 0.25;
    breezeGain.gain.value = 0.038;
    breeze.connect(breezeFilter).connect(breezeGain).connect(bus);

    const sea = this.ctx.createBufferSource();
    const seaFilter = this.ctx.createBiquadFilter();
    const seaGain = this.ctx.createGain();
    sea.buffer = this.noiseBuffer;
    sea.loop = true;
    sea.playbackRate.value = 0.72;
    seaFilter.type = 'bandpass';
    seaFilter.frequency.value = 360;
    seaFilter.Q.value = 0.45;
    seaGain.gain.value = 0.027;
    sea.connect(seaFilter).connect(seaGain).connect(bus);

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(seaGain.gain);

    const hum = this.ctx.createOscillator();
    const humGain = this.ctx.createGain();
    hum.type = 'sine';
    hum.frequency.value = 50;
    humGain.gain.value = 0.012;
    hum.connect(humGain).connect(bus);

    const harmonic = this.ctx.createOscillator();
    const harmonicGain = this.ctx.createGain();
    harmonic.type = 'sine';
    harmonic.frequency.value = 100;
    harmonicGain.gain.value = 0.0035;
    harmonic.connect(harmonicGain).connect(bus);

    const sources = [breeze, sea, lfo, hum, harmonic];
    sources.forEach((source) => source.start(at));
    this.ambientNodes = { bus, sources };
  }

  _stopAmbient() {
    if (!this.ambientNodes || !this.ctx) return;
    const { bus, sources } = this.ambientNodes;
    const at = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(at);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), at);
    bus.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
    for (const source of sources) {
      try { source.stop(at + 0.8); } catch { /* source already stopped */ }
    }
    this.ambientNodes = null;
  }

  _noise(at, duration, volume, options = {}) {
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = options.rate ?? 1;
    filter.type = options.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(Math.max(20, options.frequency ?? 1000), at);
    filter.Q.value = options.q ?? 0.7;

    const attack = clamp(Number(options.attack ?? 0.001), 0.001, Math.max(0.001, duration * 0.65));
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    source.connect(filter).connect(gain);
    this._connectOutput(gain, options.pan, options.destination);
    const playable = Math.min(duration + 0.02, this.noiseBuffer.duration);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - playable);
    source.start(at, Math.random() * maxOffset, playable);
    source.stop(at + playable + 0.02);
  }

  _tone(at, frequency, duration, volume, options = {}) {
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), at);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), at + duration);
    }
    const attack = clamp(Number(options.attack ?? 0.002), 0.001, Math.max(0.001, duration * 0.65));
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    this._connectOutput(gain, options.pan, options.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  _metalClick(at, strength = 1, pan = 0) {
    this._noise(at, 0.026, 0.12 * strength, {
      filter: 'highpass', frequency: 2100, q: 1.3, pan,
    });
    this._tone(at, 1760, 0.055, 0.035 * strength, {
      endFrequency: 1180, type: 'square', pan,
    });
  }

  _connectOutput(node, pan = 0, destination = null) {
    const output = destination ?? this.master;
    if (this.ctx.createStereoPanner && Number(pan)) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(Number(pan), -1, 1);
      node.connect(panner).connect(output);
    } else {
      node.connect(output);
    }
  }
}

export { AudioSystem as Audio, AudioSystem as GameAudio };
export default AudioSystem;
