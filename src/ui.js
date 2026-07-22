const ELEMENT_IDS = Object.freeze({
  loadingScreen: 'loading-screen',
  loadingBar: 'loading-bar',
  loadingStatus: 'loading-status',
  startScreen: 'start-screen',
  startButton: 'start-button',
  qualitySelect: 'quality-select',
  aimSelect: 'aim-select',
  difficultySelect: 'difficulty-select',
  muteToggle: 'mute-toggle',
  hud: 'hud',
  healthFill: 'health-fill',
  healthValue: 'health-value',
  armorValue: 'armor-value',
  ammoCurrent: 'ammo-current',
  ammoReserve: 'ammo-reserve',
  aimMode: 'aim-mode',
  objectiveKicker: 'objective-kicker',
  objectiveText: 'objective-text',
  objectiveDistance: 'objective-distance',
  locationLabel: 'location-label',
  defenseTimer: 'defense-timer',
  threatTimers: 'threat-timers',
  poisonClock: 'poison-clock',
  poisonClockValue: 'poison-clock-value',
  poisonClockStatus: 'poison-clock-status',
  vaultClock: 'vault-clock',
  vaultClockValue: 'vault-clock-value',
  vaultClockStatus: 'vault-clock-status',
  crosshair: 'crosshair',
  hitmarker: 'hitmarker',
  subtitle: 'subtitle',
  subtitleSpeaker: 'subtitle-speaker',
  subtitleText: 'subtitle-text',
  interact: 'interact',
  interactLabel: 'interact-label',
  interactProgress: 'interact-progress',
  toastLayer: 'toast-layer',
  damageVignette: 'damage-vignette',
  deathVeil: 'death-veil',
  thermalOverlay: 'thermal-overlay',
  thermalDroneLabel: 'thermal-drone-label',
  thermalScanStatus: 'thermal-scan-status',
  thermalCountLabel: 'thermal-count-label',
  thermalCount: 'thermal-count',
  thermalSector: 'thermal-sector',
  thermalProgress: 'thermal-progress',
  pauseScreen: 'pause-screen',
  resumeButton: 'resume-button',
  restartButton: 'restart-button',
  endingScreen: 'ending-screen',
  endingEyebrow: 'ending-eyebrow',
  endingTitle: 'ending-title',
  endingStats: 'ending-stats',
  endingWaterLabel: 'ending-water-label',
  endingWaterValue: 'ending-water-value',
  endingSupplyLabel: 'ending-supply-label',
  endingSupplyValue: 'ending-supply-value',
  endingResidentsLabel: 'ending-residents-label',
  endingResidentsValue: 'ending-residents-value',
  replayButton: 'replay-button',
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function formatClock(seconds) {
  const value = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

/** DOM-only presentation layer. Every method is safe when an optional node is absent. */
export class UI {
  constructor(root = globalThis.document ?? null) {
    this.root = root;
    this.el = {};
    for (const [name, id] of Object.entries(ELEMENT_IDS)) {
      this.el[name] = root?.getElementById?.(id) ?? null;
      // Button/select handles are also exposed directly for simple integration.
      if (/(Button|Select|Toggle)$/.test(name)) this[name] = this.el[name];
    }

    this.subtitleTimer = 0;
    this.hitmarkerTimer = 0;
    this.damageTimer = 0;
    this.lastObjective = '';
    this.inGame = false;
    this.hudState = {
      health: 100,
      maxHealth: 100,
      armor: 50,
      ammo: 30,
      reserve: 120,
    };

    this.el.subtitle?.setAttribute('aria-live', 'polite');
    this.el.toastLayer?.setAttribute('aria-live', 'polite');
    this.el.loadingBar?.setAttribute('role', 'progressbar');
  }

  loading(progress = 0, status = 'Preparing Ridgewatch waterworks…') {
    let visible = true;
    if (progress && typeof progress === 'object') {
      status = progress.status ?? status;
      visible = progress.visible ?? true;
      progress = progress.progress ?? progress.value ?? 0;
    } else if (progress === false) {
      visible = false;
      progress = 1;
    }

    const numeric = Number(progress);
    const normalized = clamp(Number.isFinite(numeric) ? (numeric > 1 ? numeric / 100 : numeric) : 0, 0, 1);
    this._show(this.el.loadingScreen, visible);
    if (!visible && !this.inGame) {
      this._show(this.el.startScreen, true);
      const briefingPanel = this.el.startScreen?.querySelector?.('.briefing-panel');
      if (briefingPanel) briefingPanel.scrollTop = 0;
    }
    if (this.el.loadingBar) {
      this.el.loadingBar.style.width = `${(normalized * 100).toFixed(1)}%`;
      this.el.loadingBar.style.setProperty('--progress', String(normalized));
      this.el.loadingBar.setAttribute('aria-valuemin', '0');
      this.el.loadingBar.setAttribute('aria-valuemax', '100');
      this.el.loadingBar.setAttribute('aria-valuenow', String(Math.round(normalized * 100)));
    }
    this._text(this.el.loadingStatus, status);
    return normalized;
  }

  start(initialHUD = null) {
    this.inGame = true;
    this._show(this.el.loadingScreen, false);
    this._show(this.el.startScreen, false);
    this._show(this.el.pauseScreen, false);
    this._show(this.el.endingScreen, false);
    this.showThermalScan(false);
    this._show(this.el.hud, true);
    this.setDeathVeil(0);
    this._show(this.el.crosshair, true);
    this._setBodyState('playing');
    if (initialHUD && typeof initialHUD === 'object') this.setHUD(initialHUD);
  }

  setHUD(state = {}) {
    if (typeof state === 'number') state = { health: state };
    const incoming = { ...state };
    if (incoming.ammo == null && incoming.ammoCurrent != null) incoming.ammo = incoming.ammoCurrent;
    if (incoming.reserve == null && incoming.ammoReserve != null) incoming.reserve = incoming.ammoReserve;
    this.hudState = { ...this.hudState, ...incoming };
    state = this.hudState;
    const health = clamp(Number(state.health ?? 100) || 0, 0, Number(state.maxHealth ?? 100) || 100);
    const maxHealth = Math.max(1, Number(state.maxHealth ?? 100) || 100);
    const healthPercent = clamp((health / maxHealth) * 100, 0, 100);
    const armor = Math.max(0, Math.round(Number(state.armor ?? 0) || 0));
    const current = Math.max(0, Math.round(Number(state.ammo ?? state.ammoCurrent ?? 0) || 0));
    const reserve = Math.max(0, Math.round(Number(state.reserve ?? state.ammoReserve ?? 0) || 0));

    if (this.el.healthFill) {
      this.el.healthFill.style.width = `${healthPercent.toFixed(1)}%`;
      this.el.healthFill.style.setProperty('--health', String(healthPercent / 100));
      this.el.healthFill.classList.toggle('critical', healthPercent <= 25);
    }
    this._text(this.el.healthValue, Math.ceil(health));
    this._text(this.el.armorValue, armor);
    this._text(this.el.ammoCurrent, current);
    this._text(this.el.ammoReserve, reserve);
    if (state.location != null) this._text(this.el.locationLabel, state.location);
    if (state.aimMagnification != null) this._text(this.el.aimMode, `${state.aimMagnification}× AIM`);
    if (state.objective != null) this.setObjective(state.objective);
    if (state.defense != null) this.setDefenseTimer(state.defense);
  }

  setObjective(objective, kicker = 'CURRENT OBJECTIVE', distance = null) {
    if (objective && typeof objective === 'object') {
      distance = objective.distance ?? distance;
      kicker = objective.kicker ?? objective.label ?? kicker;
      objective = objective.text ?? objective.objective ?? '';
    }
    const text = String(objective ?? '');
    this._text(this.el.objectiveKicker, kicker);
    this._text(this.el.objectiveText, text);

    if (distance == null || distance === '' || !Number.isFinite(Number(distance))) {
      this._show(this.el.objectiveDistance, false);
    } else {
      this._text(this.el.objectiveDistance, `${Math.max(0, Math.round(Number(distance)))} m`);
      this._show(this.el.objectiveDistance, true);
    }

    if (text && text !== this.lastObjective && this.el.objectiveText) {
      this.lastObjective = text;
      const node = this.el.objectiveText;
      node.classList.remove('objective-update');
      this._nextFrame(() => node.classList.add('objective-update'));
    }
  }

  showSubtitle(speaker, text, duration = 4000) {
    if (speaker && typeof speaker === 'object') {
      duration = speaker.duration ?? duration;
      text = speaker.text;
      speaker = speaker.speaker;
    }
    if (!text) {
      this._clearTimer('subtitleTimer');
      this._show(this.el.subtitle, false);
      return;
    }

    this._text(this.el.subtitleSpeaker, String(speaker ?? 'RADIO'));
    this._text(this.el.subtitleText, text);
    this._show(this.el.subtitle, true);
    this._clearTimer('subtitleTimer');
    const milliseconds = Number(duration) <= 30 ? Number(duration) * 1000 : Number(duration);
    this.subtitleTimer = globalThis.setTimeout?.(() => {
      this._show(this.el.subtitle, false);
      this.subtitleTimer = 0;
    }, Math.max(800, milliseconds || 4000));
  }

  setInteract(label, visible = true, progress = 0) {
    if (typeof label === 'boolean') {
      const requestedVisibility = label;
      label = typeof visible === 'string' ? visible : 'INTERACT';
      visible = requestedVisibility;
    } else if (label && typeof label === 'object') {
      progress = label.progress ?? progress;
      visible = label.visible ?? true;
      label = label.label ?? label.text ?? 'INTERACT';
    } else if (label === false || label == null) {
      visible = false;
      label = '';
    } else if (typeof visible === 'number') {
      progress = visible;
      visible = true;
    }

    this._text(this.el.interactLabel, label);
    this._show(this.el.interact, Boolean(visible));
    const amount = clamp(Number(progress) || 0, 0, 1);
    if (this.el.interactProgress) {
      this.el.interactProgress.style.width = `${(amount * 100).toFixed(1)}%`;
      this.el.interactProgress.style.setProperty('--progress', String(amount));
    }
  }

  hitMarker(kind = 'hit') {
    const marker = this.el.hitmarker;
    if (!marker) return;
    if (typeof kind === 'boolean') kind = kind ? 'headshot' : 'hit';
    this._clearTimer('hitmarkerTimer');
    marker.classList.remove('headshot', 'kill', 'hit');
    marker.classList.add('active', 'is-active', String(kind || 'hit'));
    marker.hidden = false;
    this.hitmarkerTimer = globalThis.setTimeout?.(() => {
      marker.classList.remove('active', 'is-active', 'headshot', 'kill', 'hit');
      marker.hidden = true;
      this.hitmarkerTimer = 0;
    }, kind === 'kill' ? 180 : 110);
  }

  damage(amount = 0.35, direction = null) {
    const vignette = this.el.damageVignette;
    if (!vignette) return;
    this._clearTimer('damageTimer');
    const raw = Math.abs(Number(amount) || 0.35);
    const intensity = clamp(raw > 1 ? raw / 100 : raw, 0.18, 1);
    vignette.style.setProperty('--damage', String(intensity));
    vignette.style.setProperty('--damage-opacity', String(0.2 + intensity * 0.58));
    if (direction != null) vignette.dataset.direction = String(direction);
    this._show(vignette, true);
    vignette.classList.add('is-active');
    this.damageTimer = globalThis.setTimeout?.(() => {
      vignette.classList.remove('is-active');
      this._show(vignette, false);
      this.damageTimer = 0;
    }, 170 + intensity * 280);
  }

  setDeathVeil(progress = 0) {
    const veil = this.el.deathVeil;
    if (!veil) return;
    const amount = clamp(Number(progress) || 0, 0, 1);
    const rawClose = clamp((amount - 0.08) / 0.92, 0, 1);
    const close = rawClose * rawClose * (3 - 2 * rawClose);
    const travel = (1 - close) * 100;
    const top = veil.querySelector?.('i');
    const bottom = veil.querySelector?.('b');
    if (top) top.style.transform = `translateY(${-travel}%)`;
    if (bottom) bottom.style.transform = `translateY(${travel}%)`;
    veil.style.backgroundColor = `rgba(0,0,0,${(amount * 0.78).toFixed(3)})`;
    veil.dataset.progress = amount.toFixed(3);
    this._show(veil, amount > 0);
  }

  toast(message, type = 'info', duration = 2600) {
    if (!message || !this.el.toastLayer || !this.root?.createElement) return null;
    if (type && typeof type === 'object') {
      duration = type.duration ?? duration;
      type = type.type ?? 'info';
    }
    const item = this.root.createElement('div');
    item.className = `toast toast-${type}`;
    item.setAttribute('role', type === 'warning' || type === 'error' ? 'alert' : 'status');
    item.textContent = String(message);
    this.el.toastLayer.appendChild(item);
    this._nextFrame(() => item.classList.add('visible'));
    globalThis.setTimeout?.(() => {
      item.classList.remove('visible');
      globalThis.setTimeout?.(() => item.remove(), 300);
    }, Math.max(500, Number(duration) || 2600));
    return item;
  }

  pause(paused = true) {
    paused = Boolean(paused);
    this._show(this.el.pauseScreen, paused);
    this._show(this.el.crosshair, !paused && this.inGame);
    this._setBodyState(paused ? 'paused' : 'playing');
    if (paused) this.el.resumeButton?.focus?.();
  }

  showEnding(result = {}) {
    const stats = result?.stats ?? result ?? {};
    const failed = Boolean(result?.failed ?? stats?.failed);
    const outcome = this._endingOutcome(result, stats);
    this.inGame = false;
    this.setDeathVeil(0);
    this.showThermalScan(false);
    this._show(this.el.hud, false);
    this._show(this.el.crosshair, false);
    this._show(this.el.pauseScreen, false);
    this._show(this.el.endingScreen, true);
    this._setBodyState('ending');
    if (failed) this._renderFailureOutcome(stats);
    else this._renderEndingOutcome(outcome, stats);
    this._renderEndingStats(stats);
    globalThis.setTimeout?.(() => this.el.replayButton?.focus?.(), 350);
  }

  /**
   * Global Hawk presentation hook. Main may pass false to hide, true to show,
   * or { visible, count, status, sector, progress, complete, droneLabel }.
   */
  showThermalScan(scan = true) {
    const data = scan && typeof scan === 'object' ? scan : { visible: Boolean(scan) };
    const visible = data.visible ?? true;
    const progress = clamp(Number(data.progress ?? (data.complete ? 1 : 0)) || 0, 0, 1);
    this._show(this.el.thermalOverlay, Boolean(visible));
    this.root?.body?.classList.toggle('thermal-active', Boolean(visible));
    if (data.droneLabel != null) this._text(this.el.thermalDroneLabel, data.droneLabel);
    if (data.status != null) this._text(this.el.thermalScanStatus, data.status);
    if (data.count != null) this._text(this.el.thermalCount, String(Math.max(0, Math.round(Number(data.count) || 0))).padStart(2, '0'));
    if (data.countLabel != null) this._text(this.el.thermalCountLabel, data.countLabel);
    if (data.sector != null) this._text(this.el.thermalSector, data.sector);
    if (this.el.thermalProgress) this.el.thermalProgress.style.width = `${(progress * 100).toFixed(1)}%`;
    this.el.thermalOverlay?.classList.toggle('scan-complete', Boolean(data.complete));
    return Boolean(visible);
  }

  setThermalScan(scan = true) {
    return this.showThermalScan(scan);
  }

  setDefenseTimer(seconds, active = true) {
    const payload = seconds && typeof seconds === 'object' ? seconds : null;
    if (seconds === true && typeof active === 'number') {
      seconds = active;
      active = true;
    } else if (seconds && typeof seconds === 'object') {
      active = seconds.active ?? true;
      seconds = seconds.remaining ?? seconds.displayed ?? seconds.seconds ?? 0;
    } else if (seconds === false || seconds == null) {
      active = false;
      seconds = 0;
    }
    const timer = this.el.defenseTimer;
    if (!timer) return;
    const remaining = Math.max(0, Number(seconds) || 0);
    const timerValue = timer.querySelector?.('strong') ?? timer.querySelector?.('[data-timer-value]');
    const timerLabel = timer.querySelector?.('small');
    const timerStatus = timer.querySelector?.('span');
    const kind = payload?.kind ?? null;
    this._text(timerValue ?? timer, formatClock(remaining));
    if (kind === 'reinforcement_hold') {
      this._text(timerLabel, 'RESPONSE FORCE');
      this._text(timerStatus, 'HOLD SECURED OBJECTIVE');
    }
    this._show(timer, Boolean(active));
    timer.classList.toggle('urgent', Boolean(active) && remaining <= 10);
    timer.classList.toggle('critical', Boolean(active) && remaining <= 5);
  }

  setThreatTimers(state = false) {
    if (!state || state === false) {
      this._show(this.el.threatTimers, false);
      return false;
    }
    const data = typeof state === 'object' ? state : {};
    const poison = data.poison ?? data.threats?.poison ?? null;
    const vault = data.vault ?? data.threats?.vault ?? data.breach ?? null;
    const visible = data.visible ?? Boolean(poison || vault);
    this._show(this.el.threatTimers, visible);
    if (!visible) return false;

    const renderClock = (element, valueElement, statusElement, clock, labels) => {
      if (!element || !clock) {
        this._show(element, false);
        return;
      }
      this._show(element, true);
      const failed = Boolean(clock.failed || clock.released || clock.breached || clock.complete === false && clock.remaining <= 0);
      const stopped = Boolean(clock.stopped || clock.prevented || clock.neutralized || clock.secured || clock.complete === true);
      const active = Boolean(clock.active) && !failed && !stopped;
      const remaining = Math.max(0, Number(clock.remaining ?? clock.seconds ?? 0) || 0);
      this._text(valueElement, failed ? labels.failed : stopped ? labels.stopped : formatClock(remaining));
      this._text(statusElement, String(
        clock.status ?? (failed ? labels.failedStatus : stopped ? labels.stoppedStatus : labels.activeStatus),
      ).toUpperCase());
      element.classList.toggle('active', active);
      element.classList.toggle('urgent', active && remaining <= 30);
      element.classList.toggle('failed', failed);
      element.classList.toggle('stopped', stopped);
    };

    renderClock(this.el.poisonClock, this.el.poisonClockValue, this.el.poisonClockStatus, poison, {
      failed: 'RELEASED', stopped: 'STOPPED', activeStatus: 'TECH ACTIVE',
      failedStatus: 'CONTAMINATED', stoppedStatus: 'INJECTION HALTED',
    });
    renderClock(this.el.vaultClock, this.el.vaultClockValue, this.el.vaultClockStatus, vault, {
      failed: 'BREACHED', stopped: 'SECURED', activeStatus: 'TECH ACTIVE',
      failedStatus: 'VALVE DISABLED', stoppedStatus: 'BREACH HALTED',
    });
    return true;
  }

  onStart(handler) {
    return this._listen(this.el.startButton, 'click', handler);
  }

  onResume(handler) {
    return this._listen(this.el.resumeButton, 'click', handler);
  }

  onRestart(handler) {
    return this._listen(this.el.restartButton, 'click', handler);
  }

  onReplay(handler) {
    return this._listen(this.el.replayButton, 'click', handler);
  }

  getStartOptions() {
    const selectedDifficulty = String(this.el.difficultySelect?.value ?? 'normal').toLowerCase();
    return {
      quality: this.el.qualitySelect?.value ?? 'high',
      aimMagnification: Number(this.el.aimSelect?.value ?? 2),
      difficulty: ['easy', 'normal', 'hard', 'extreme'].includes(selectedDifficulty)
        ? selectedDifficulty
        : 'normal',
      muted: Boolean(this.el.muteToggle?.checked),
    };
  }

  _renderEndingStats(stats) {
    const container = this.el.endingStats;
    if (!container) return;
    container.textContent = '';
    const outcome = this._endingOutcome(stats, stats);
    const interrupted = outcome !== 'safe';
    const contaminated = stats.poisonReleased === true || stats.contaminated === true;
    const vaultLostButUnneeded = outcome === 'safe' && stats.vaultBreached === true;
    const rows = stats.rows ?? [
      ['WATER STATUS', contaminated ? 'CONTAMINATED / ISOLATED' : interrupted ? 'SAFE / ISOLATED' : 'SAFE'],
      [
        outcome === 'pipe' ? 'BACKDOOR MAIN' : vaultLostButUnneeded ? 'VALVE VAULT' : 'SUPPLY WHEEL',
        outcome === 'pipe' ? 'SEVERED' : vaultLostButUnneeded ? 'BREACHED / NOT REQUIRED' : outcome === 'emergency' ? 'CLOSED' : 'STANDBY',
      ],
      ['RESIDENTS PROTECTED', Math.round(Number(stats.residentsProtected ?? stats.residentsSupplied ?? 218000)).toLocaleString('en-US')],
      ['HOSTILES NEUTRALIZED', Math.max(0, Math.round(Number(stats.enemiesNeutralized ?? stats.kills ?? 0)))],
      ['MISSION TIME', formatClock(stats.elapsedSeconds ?? stats.elapsed ?? 0)],
    ];

    for (const [label, value] of rows) {
      const row = this.root.createElement('div');
      const key = this.root.createElement('span');
      const result = this.root.createElement('strong');
      row.className = 'ending-stat stat-row';
      key.className = 'ending-stat-label stat-label';
      result.className = 'ending-stat-value stat-value';
      key.textContent = String(label);
      result.textContent = String(value);
      row.append(key, result);
      container.appendChild(row);
    }
  }

  _endingOutcome(result, stats = result ?? {}) {
    const reason = String(
      result?.reason ?? result?.endingReason ?? result?.outcome ??
      stats?.reason ?? stats?.endingReason ?? stats?.outcome ?? '',
    ).toLowerCase();
    const pipe = stats?.backdoorPipeDemolished === true || stats?.pipeDemolished === true ||
      /pipe.?demolish|demolish.*pipe|backdoor.?main|main.?sever/.test(reason);
    if (pipe) return 'pipe';
    if (stats?.siteCleared === true && stats?.poisonReleased !== true && stats?.vaultBreached !== true) {
      return 'safe';
    }
    const emergency = stats?.planB === true || stats?.contaminated === true ||
      stats?.poisonReleased === true || stats?.poisonPrevented === false ||
      stats?.waterSafe === false || stats?.emergencyShutoff === true ||
      stats?.supplyShutOff === true || stats?.serviceInterrupted === true ||
      /plan.?b|contamin|poison(?:ed|_released)|shut.?off|supply.?wheel|supply.?isolated|main.?closed/.test(reason);
    return emergency ? 'emergency' : 'safe';
  }

  _renderEndingOutcome(outcome, stats) {
    const pipe = outcome === 'pipe';
    const emergency = outcome === 'emergency' || pipe;
    const contaminated = stats?.poisonReleased === true || stats?.contaminated === true;
    const vaultLostButUnneeded = !emergency && stats?.vaultBreached === true;
    this.el.endingScreen?.classList.toggle('ending-emergency', emergency);
    this.el.endingScreen?.classList.toggle('ending-pipe', pipe);
    this.el.endingScreen?.classList.remove('ending-failure');
    if (this.el.endingScreen) this.el.endingScreen.dataset.outcome = outcome;
    this._text(this.el.endingEyebrow, pipe
      ? 'PLAN C COMPLETE / BACKDOOR MAIN SEVERED'
      : emergency
        ? contaminated
          ? 'PLAN B COMPLETE / CONTAMINATED MAIN ISOLATED'
          : 'PLAN B COMPLETE / CLEAN SUPPLY PREEMPTIVELY ISOLATED'
        : vaultLostButUnneeded
          ? 'PRIMARY PLAN COMPLETE / WATER SAFE / BACKUP VAULT LOST'
          : 'PRIMARY PLAN COMPLETE / WATER SAFE');
    if (this.el.endingTitle) {
      this.el.endingTitle.innerHTML = pipe
        ? 'THE MAIN IS<br /><span>SEVERED.</span>'
        : emergency
          ? 'THE LINE IS<br /><span>SEALED.</span>'
          : 'THE POISON<br />NEVER <span>FLOWED.</span>';
    }
    this._text(this.el.endingWaterLabel, 'WATER STATUS');
    this._text(this.el.endingWaterValue, contaminated ? 'CONTAMINATED / ISOLATED' : emergency ? 'SAFE / ISOLATED' : 'SAFE');
    this._text(this.el.endingSupplyLabel, pipe ? 'BACKDOOR MAIN' : emergency ? 'EMERGENCY SUPPLY' : vaultLostButUnneeded ? 'VALVE VAULT' : 'SUPPLY MAIN');
    this._text(this.el.endingSupplyValue, pipe ? 'DEMOLISHED' : emergency ? 'SHUT OFF' : vaultLostButUnneeded ? 'BREACHED / NOT REQUIRED' : 'FLOWING');
    this._text(this.el.endingResidentsLabel, 'RESIDENTS PROTECTED');
    this._text(
      this.el.endingResidentsValue,
      Math.round(Number(stats.residentsProtected ?? stats.residentsSupplied ?? 218000)).toLocaleString('en-US'),
    );
    this._text(this.el.replayButton, 'PLAY AGAIN');
  }

  _renderFailureOutcome(stats = {}) {
    const mode = String(stats.difficulty ?? 'hard').toUpperCase();
    this.el.endingScreen?.classList.remove('ending-emergency', 'ending-pipe');
    this.el.endingScreen?.classList.add('ending-failure');
    if (this.el.endingScreen) this.el.endingScreen.dataset.outcome = 'failure';
    this._text(this.el.endingEyebrow, `${mode} MODE / OPERATOR DOWN / NO CHECKPOINT`);
    if (this.el.endingTitle) this.el.endingTitle.innerHTML = 'ONE LIFE<br /><span>EXPENDED.</span>';
    this._text(this.el.endingWaterLabel, 'MISSION STATUS');
    this._text(this.el.endingWaterValue, 'FAILED');
    this._text(this.el.endingSupplyLabel, 'DIFFICULTY');
    this._text(this.el.endingSupplyValue, `${mode} / ONE LIFE`);
    this._text(this.el.endingResidentsLabel, 'CHECKPOINTS');
    this._text(this.el.endingResidentsValue, 'DISABLED');
    this._text(this.el.replayButton, `RESTART ${mode} RUN`);
  }

  _show(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    element.classList.toggle('is-hidden', !visible);
    element.classList.toggle('visible', Boolean(visible));
    element.classList.toggle('is-visible', Boolean(visible));
  }

  _text(element, value) {
    if (element) element.textContent = String(value ?? '');
  }

  _clearTimer(name) {
    if (!this[name]) return;
    globalThis.clearTimeout?.(this[name]);
    this[name] = 0;
  }

  _nextFrame(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(callback);
    } else {
      globalThis.setTimeout?.(callback, 0);
    }
  }

  _listen(element, event, handler) {
    if (!element || typeof handler !== 'function') return () => {};
    element.addEventListener(event, handler);
    return () => element.removeEventListener(event, handler);
  }

  _setBodyState(state) {
    const body = this.root?.body;
    if (!body) return;
    body.dataset.gameState = state;
    body.classList.toggle('game-running', state === 'playing');
    body.classList.toggle('game-paused', state === 'paused');
    body.classList.toggle('game-ending', state === 'ending');
  }
}

export default UI;
