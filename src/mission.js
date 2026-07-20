export const MISSION_TIMINGS = Object.freeze({
  reconSeconds: 9,
  poisonSeconds: 300,
  vaultBreachSeconds: 150,
  reinforcementHoldSeconds: 60,
});

export const TECHNICIAN_IDS = Object.freeze({
  poison: 'poison_technician',
  vault: 'vault_technician',
});

const DEFAULT_HOSTILE_COUNT = 20;

export const OBJECTIVES = Object.freeze({
  recon: 'Global Hawk EO/IR reconnaissance in progress',
  stop_technical_team: 'Stop the poison transfer, or close the municipal supply valve before its vault is lost',
  hold_reinforcements: 'Hold the secured objective until the response force arrives',
  ending: 'Municipal water threat contained',
  failed: 'Operation CLEARWATER failed',
});

const STAGES = Object.freeze([
  'recon',
  'stop_technical_team',
  'hold_reinforcements',
  'ending',
  'failed',
]);

const INTERACTION_ALIASES = Object.freeze({
  neutralize_poison: 'neutralize_poison',
  poison: 'neutralize_poison',
  stop_poison: 'neutralize_poison',
  stop_poison_injection: 'neutralize_poison',
  poison_injection: 'neutralize_poison',
  poison_injection_machine: 'neutralize_poison',
  injection_controls: 'neutralize_poison',
  injection_console: 'neutralize_poison',
  chemical_dosing: 'neutralize_poison',
  purge: 'neutralize_poison',
  cancel_purge: 'neutralize_poison',
  purge_override: 'neutralize_poison',
  close_supply_valve: 'close_supply_valve',
  valve: 'close_supply_valve',
  shut_supply: 'close_supply_valve',
  supply_valve: 'close_supply_valve',
  supply_wheel: 'close_supply_valve',
  main_valve: 'close_supply_valve',
  main_supply: 'close_supply_valve',
  emergency_shutoff: 'close_supply_valve',
  demolish_backdoor_main_pipe: 'demolish_backdoor_main_pipe',
  demolish_backdoor_pipe: 'demolish_backdoor_main_pipe',
  backdoor_pipe: 'demolish_backdoor_main_pipe',
  demolish_pipe: 'demolish_backdoor_main_pipe',
  pipe_demolition: 'demolish_backdoor_main_pipe',
  sever_supply_main: 'demolish_backdoor_main_pipe',
});

const RADIO = Object.freeze({
  opening: Object.freeze([
    Object.freeze({ speaker: 'HAWK SEVEN AIRCREW', text: 'Clearwater, Hawk Seven. We are on station. Starting the infrared sweep now.', duration: 4.4 }),
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Twenty signatures. Eighteen gunmen in stolen guardian uniforms, plus two technical specialists.', duration: 5.8 }),
  ]),
  infiltration: Object.freeze([
    Object.freeze({ speaker: 'HAWK SEVEN AIRCREW', text: 'Clearwater, targets marked: the dosing machine, the valve vault, and the backdoor city main.', duration: 5.4 }),
    Object.freeze({ speaker: 'MAJOR REYES', text: 'The two specialists lead the work, but any hostile who reaches their controls can continue it. Poison has five minutes; the vault has two-thirty.', duration: 7.4 }),
    Object.freeze({ speaker: 'MARA', text: 'Inserting from the northwest dogleg. I only need the critical systems secure until the response force arrives.', duration: 5.3 }),
  ]),
  poisonStopped: Object.freeze([
    Object.freeze({ speaker: 'MARA', text: 'Poison process stopped. The city main is still clean.', duration: 3.7 }),
  ]),
  vaultSecured: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Vault breach has stopped. The municipal wheel remains usable.', duration: 4.0 }),
  ]),
  poisonReleased: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Poison transfer complete. Close the supply valve before the vault is lost.', duration: 5.2 }),
  ]),
  vaultBreached: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'The valve vault is breached. If poison transfers too, the backdoor main becomes the final cutoff.', duration: 6.0 }),
  ]),
  fallback: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Both safeguards failed. Plan C: demolish the marked backdoor pipe and sever the city feed.', duration: 6.2 }),
  ]),
  holdTechnicians: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Poison transfer is stopped. The remaining cell is turning back toward the process hall. Hold for reinforcement.', duration: 6.2 }),
  ]),
  operationRecaptured: Object.freeze([
    Object.freeze({ speaker: 'MAJOR REYES', text: 'Hostile operator back on the dosing controls. Poison transfer is restarting. Retake the machine now.', duration: 6.2 }),
  ]),
  holdValve: Object.freeze([
    Object.freeze({ speaker: 'MARA', text: 'Supply wheel seated. Nothing leaves the plant. Holding the vault for the response force.', duration: 5.2 }),
  ]),
  holdPipe: Object.freeze([
    Object.freeze({ speaker: 'MARA', text: 'Backdoor main severed. City feed is dry. Holding the breach point.', duration: 4.7 }),
  ]),
  response: Object.freeze([
    Object.freeze({ speaker: 'RESPONSE ONE', text: 'Clearwater, this is Response One. We have the perimeter and both buildings. Your objective is secure.', duration: 6.0 }),
  ]),
});

function cleanInteractionId(value) {
  if (value && typeof value === 'object') value = value.interactionId ?? value.id ?? value.name ?? '';
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return INTERACTION_ALIASES[key] ?? key;
}

function positiveDuration(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

function finiteStep(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, 1);
}

function cloneLine(line) {
  return line ? { speaker: line.speaker, text: line.text, duration: line.duration, channel: line.channel } : null;
}

/**
 * Owns CLEARWATER's independent poison/vault clocks and its three valid
 * outcomes. Threat clocks advance only while a living hostile is physically
 * at the relevant controls; named specialists can be replaced by nearby
 * guards, so location rather than an immutable character ID owns the threat.
 */
export class MissionDirector {
  constructor(callbacks = {}) {
    this.callbacks = typeof callbacks === 'function' ? { onEvent: callbacks } : callbacks ?? {};
    this.started = false;
    this.complete = false;
    this.failed = false;
    this.stage = 'recon';
    this.stageElapsed = 0;
    this.elapsed = 0;
    this.outcome = null;

    this.poisonTotal = positiveDuration(this.callbacks.poisonSeconds, MISSION_TIMINGS.poisonSeconds);
    this.vaultTotal = positiveDuration(this.callbacks.vaultSeconds ?? this.callbacks.vaultBreachSeconds, MISSION_TIMINGS.vaultBreachSeconds);
    this.holdTotal = positiveDuration(this.callbacks.holdSeconds ?? this.callbacks.defenseSeconds, MISSION_TIMINGS.reinforcementHoldSeconds);
    this.poisonRemaining = this.poisonTotal;
    this.vaultRemaining = this.vaultTotal;
    this.holdRemaining = this.holdTotal;
    this.operationRetakeDelay = positiveDuration(this.callbacks.operationRetakeSeconds, 2.5);
    this.poisonRetakeProgress = 0;

    this.expectedHostiles = Math.max(1, Math.floor(Number(this.callbacks.expectedHostiles) || DEFAULT_HOSTILE_COUNT));
    this.neutralizedIds = new Set();
    this.technicianIds = new Set(Object.values(TECHNICIAN_IDS));
    this.operationalPresence = {
      poison: { operating: true, operatorIds: [TECHNICIAN_IDS.poison] },
      vault: { operating: true, operatorIds: [TECHNICIAN_IDS.vault] },
    };
    this.lastThreatSignature = '';
    this.lastDefenseSecond = null;
    this.radioQueue = [];
    this.currentRadio = null;
    this.radioRemaining = 0;
    this.radioGap = 0;
    this.snapshots = [];

    this.flags = {
      reconComplete: false,
      poisonTechnicianNeutralized: false,
      vaultTechnicianNeutralized: false,
      poisonPrevented: false,
      poisonNeutralized: false,
      poisonReleased: false,
      vaultSecured: false,
      vaultBreached: false,
      supplyShutOff: false,
      supplyValveClosed: false,
      waterSupplyStopped: false,
      backdoorPipeDemolished: false,
      pipeDemolished: false,
      counterattackActive: false,
      defenseComplete: false,
      planBActive: false,
      planCActive: false,
      siteCleared: false,
      purgeCancelled: false,
      jammerDisabled: false,
      powerRestored: false,
      ledgerTransmitted: false,
      ruskCaptured: false,
    };

    this.stats = {
      elapsedSeconds: 0,
      objectivesCompleted: 0,
      enemiesNeutralized: 0,
      expectedHostiles: this.expectedHostiles,
      requiredNeutralizations: 2,
      remainingHostiles: this.expectedHostiles,
      techniciansNeutralized: 0,
      headshots: 0,
      surrenderedEnemies: 0,
      outcome: null,
      poisonPrevented: false,
      poisonReleased: false,
      vaultSecured: false,
      vaultBreached: false,
      supplyShutOff: false,
      backdoorPipeDemolished: false,
      counterattackSurvived: false,
      secondsBeforeRelease: this.poisonTotal,
      secondsBeforeVaultBreach: this.vaultTotal,
      residentsProtected: 0,
      serviceInterrupted: false,
      defenseNeutralized: 0,
      ledgerTransmitted: false,
      ruskCaptured: false,
      plantOutput: 0,
      reservoirDelivery: 0,
      residentsSupplied: 0,
      siteCleared: false,
    };
  }

  get defenseRemaining() {
    return this.holdRemaining;
  }

  set defenseRemaining(value) {
    const next = Number(value);
    if (Number.isFinite(next)) this.holdRemaining = Math.max(0, next);
  }

  start() {
    if (this.started) return this.getState();
    this.started = true;
    this._queueRadio(RADIO.opening);
    this._emit('onStart', this.getState());
    this._emit('onReconStarted', {
      duration: MISSION_TIMINGS.reconSeconds,
      hostileCount: this.expectedHostiles,
      technicianIds: { ...TECHNICIAN_IDS },
    }, this.getState());
    this._snapshot('mission_started');
    this._announceStage('global_hawk_pass');
    this._pumpRadio();
    return this.getState();
  }

  update(dt) {
    if (!this.started) return this.getState();
    const seconds = finiteStep(dt);
    this._updateRadio(seconds);
    if (this.complete || this.failed || seconds <= 0) return this.getState();

    this.elapsed += seconds;
    this.stageElapsed += seconds;
    this.stats.elapsedSeconds = this.elapsed;

    if (this.stage === 'recon') {
      if (this.stageElapsed >= MISSION_TIMINGS.reconSeconds) this.completeRecon();
      return this.getState();
    }

    if (this.stage === 'stop_technical_team') {
      if (this._poisonClockActive()) {
        this.poisonRemaining = Math.max(0, this.poisonRemaining - seconds);
        this.stats.secondsBeforeRelease = this.poisonRemaining;
        if (this.poisonRemaining <= 0) this._releasePoison();
      }
      if (this._vaultClockActive()) {
        this.vaultRemaining = Math.max(0, this.vaultRemaining - seconds);
        this.stats.secondsBeforeVaultBreach = this.vaultRemaining;
        if (this.vaultRemaining <= 0) this._breachVault();
      }
      this._emitThreatTimers();
      this._evaluateFallback();
    } else if (this.stage === 'hold_reinforcements') {
      if (this.outcome === 'technicians_secured') {
        // A returned operator continues the physical work. The unused vault
        // can still be breached, and an enemy who holds the dosing console for
        // a short uninterrupted interval reverses the player's software stop.
        if (
          !this.flags.vaultSecured && !this.flags.vaultBreached &&
          this.operationalPresence.vault.operating
        ) {
          this.vaultRemaining = Math.max(0, this.vaultRemaining - seconds);
          this.stats.secondsBeforeVaultBreach = this.vaultRemaining;
          if (this.vaultRemaining <= 0) this._breachVault();
        }
        if (
          this.flags.poisonPrevented && !this.flags.poisonReleased &&
          this.operationalPresence.poison.operating
        ) {
          this.poisonRetakeProgress = Math.min(
            this.operationRetakeDelay,
            this.poisonRetakeProgress + seconds,
          );
          if (this.poisonRetakeProgress >= this.operationRetakeDelay) {
            this.retakeOperation('poison', { reason: 'operator_held_controls' });
            return this.getState();
          }
        } else {
          this.poisonRetakeProgress = 0;
        }
      }
      this.holdRemaining = Math.max(0, this.holdRemaining - seconds);
      this._emitDefenseTimer(true);
      if (this.holdRemaining <= 0) this._completeHold();
    }

    return this.getState();
  }

  completeRecon() {
    if (!this.started || this.complete || this.failed || this.stage !== 'recon') return false;
    this.flags.reconComplete = true;
    this._emit('onReconComplete', {
      hostileCount: this.expectedHostiles,
      gunmen: Math.max(0, this.expectedHostiles - 2),
      technicians: { ...TECHNICIAN_IDS },
    }, this.getState());
    this._queueRadio(RADIO.infiltration);
    this._advance('stop_technical_team', 'thermal_recon_complete');
    this._emit('onThreatTimers', this._threatTimerPayload(), this.getState());
    this._emit('onPoisonCountdownStarted', this.getState().poison, this.getState());
    this._emit('onVaultCountdownStarted', this.getState().vault, this.getState());
    this._pumpRadio();
    return true;
  }

  canInteract(id) {
    if (!this.started || this.complete || this.failed || this.stage !== 'stop_technical_team') return false;
    const interaction = cleanInteractionId(id);
    if (interaction === 'neutralize_poison') return this._poisonThreatOpen();
    if (interaction === 'close_supply_valve') {
      return !this.flags.vaultBreached && !this.flags.supplyShutOff && !this.flags.backdoorPipeDemolished;
    }
    if (interaction === 'demolish_backdoor_main_pipe') {
      return this.flags.poisonReleased && this.flags.vaultBreached && !this.flags.backdoorPipeDemolished;
    }
    return false;
  }

  interact(id) {
    const interaction = cleanInteractionId(id);
    if (!this.canInteract(interaction)) return false;
    this.stats.objectivesCompleted += 1;
    this._emit('onInteract', interaction, this.stage, this.getState());

    if (interaction === 'neutralize_poison') {
      this._stopPoison('injection_machine_isolated');
      this._evaluateTechnicianSuccess();
    } else if (interaction === 'close_supply_valve') {
      this.flags.supplyShutOff = true;
      this.flags.supplyValveClosed = true;
      this.flags.waterSupplyStopped = true;
      this.flags.vaultSecured = true;
      this.flags.planBActive = true;
      this.stats.supplyShutOff = true;
      this.stats.vaultSecured = true;
      this.stats.serviceInterrupted = true;
      this._emit('onSupplyShutOff', { interactionId: interaction }, this.getState());
      this._emit('onVaultSecured', { reason: 'supply_valve_closed', interactionId: interaction }, this.getState());
      this._startHold('valve_closed');
    } else if (interaction === 'demolish_backdoor_main_pipe') {
      this.flags.backdoorPipeDemolished = true;
      this.flags.pipeDemolished = true;
      this.flags.waterSupplyStopped = true;
      this.flags.planCActive = true;
      this.stats.backdoorPipeDemolished = true;
      this.stats.serviceInterrupted = true;
      this._emit('onPipeDemolished', { interactionId: interaction }, this.getState());
      this._startHold('pipe_demolished');
    }

    this._emitThreatTimers(true);
    this._pumpRadio();
    return true;
  }

  enemyDown(enemy = {}) {
    const data = typeof enemy === 'string' ? { id: enemy } : enemy ?? {};
    const surrendered = Boolean(data.surrendered || data.nonlethal || data.captured);
    const id = String(data.id ?? data.name ?? '').trim();

    if (surrendered) {
      this.stats.surrenderedEnemies += 1;
      this._emit('onEnemySurrendered', data, this.getState());
      return this.getState();
    }
    if (id && this.neutralizedIds.has(id)) return this.getState();
    if (id) this.neutralizedIds.add(id);

    this.stats.enemiesNeutralized += 1;
    this.stats.defenseNeutralized = this.stats.enemiesNeutralized;
    this.stats.remainingHostiles = Math.max(0, this.expectedHostiles - this.stats.enemiesNeutralized);
    if (data.headshot) this.stats.headshots += 1;

    if (id === TECHNICIAN_IDS.poison && !this.flags.poisonTechnicianNeutralized) {
      this.flags.poisonTechnicianNeutralized = true;
      this.stats.techniciansNeutralized += 1;
      this._emit('onTechnicianNeutralized', { type: 'poison', id }, this.getState());
    } else if (id === TECHNICIAN_IDS.vault && !this.flags.vaultTechnicianNeutralized) {
      this.flags.vaultTechnicianNeutralized = true;
      this.stats.techniciansNeutralized += 1;
      this._emit('onTechnicianNeutralized', { type: 'vault', id }, this.getState());
    }

    this._emit('onEnemyDown', data, this.getState());
    this._evaluateTechnicianSuccess();
    this._evaluateFullClearSuccess();
    this._emitThreatTimers(true);
    return this.getState();
  }

  setOperationalPresence(status = {}) {
    for (const type of ['poison', 'vault']) {
      const source = status?.[type];
      if (source == null) continue;
      this.operationalPresence[type] = {
        operating: typeof source === 'boolean' ? source : Boolean(source.operating),
        operatorIds: Array.isArray(source?.operatorIds) ? [...source.operatorIds] : [],
        assignedOperatorId: source?.assignedOperatorId ?? null,
        position: source?.position ?? null,
        radius: Number(status.radius) || null,
      };
    }
    return {
      poison: { ...this.operationalPresence.poison },
      vault: { ...this.operationalPresence.vault },
    };
  }

  retakeOperation(type, event = {}) {
    const operation = String(type ?? '').toLowerCase();
    if (
      operation !== 'poison' || this.stage !== 'hold_reinforcements' ||
      this.complete || this.failed || this.outcome !== 'technicians_secured' ||
      this.flags.poisonReleased || !this.flags.poisonPrevented ||
      this.flags.supplyShutOff || this.flags.backdoorPipeDemolished
    ) return false;

    this.flags.poisonPrevented = false;
    this.flags.poisonNeutralized = false;
    this.flags.purgeCancelled = false;
    this.flags.counterattackActive = false;
    this.stats.poisonPrevented = false;
    this.stats.counterattackSurvived = false;
    this.stats.outcome = null;
    this.stats.objectivesCompleted = Math.max(0, this.stats.objectivesCompleted - 2);
    this.outcome = null;
    this.holdRemaining = this.holdTotal;
    this.poisonRetakeProgress = 0;
    this._emitDefenseTimer(false);
    this._queueRadio(RADIO.operationRecaptured);
    this._advance('stop_technical_team', event.reason ?? 'poison_controls_recaptured');
    const payload = {
      type: operation,
      operatorId: event.operatorId ?? null,
      reason: event.reason ?? 'poison_controls_recaptured',
      remaining: this.poisonRemaining,
    };
    this._emit('onOperationRecaptured', payload, this.getState());
    this._emitThreatTimers(true);
    this._pumpRadio();
    return true;
  }

  setExpectedHostiles(count) {
    const next = Math.max(1, Math.floor(Number(count) || 0));
    if (!Number.isFinite(next)) return this.expectedHostiles;
    this.expectedHostiles = next;
    this.stats.expectedHostiles = next;
    this.stats.remainingHostiles = Math.max(0, next - this.stats.enemiesNeutralized);
    return next;
  }

  activatePlanB() {
    if (!this.started || this.complete || this.failed || this.flags.poisonReleased) return false;
    if (this.stage === 'recon') this.completeRecon();
    this.poisonRemaining = 0;
    this._releasePoison();
    this._emitThreatTimers(true);
    return true;
  }

  ruskSurrender() {
    return false;
  }

  fail(reason = 'operator_lost') {
    if (!this.started || this.complete || this.failed) return false;
    this.failed = true;
    this.outcome = 'failed';
    this.stats.outcome = 'failed';
    this.flags.counterattackActive = false;
    this._emitDefenseTimer(false);
    this._emitThreatTimers(true);
    this._advance('failed', reason);
    const state = this.getState();
    this._emit('onFailed', reason, state);
    this._emit('onComplete', state);
    return true;
  }

  getState() {
    const remainingHostiles = Math.max(0, this.expectedHostiles - this.stats.enemiesNeutralized);
    const poison = this._poisonState();
    const vault = this._vaultState();
    const defenseActive = this.stage === 'hold_reinforcements' && !this.complete && !this.failed;
    return {
      started: this.started,
      complete: this.complete,
      failed: this.failed,
      outcome: this.outcome,
      stage: this.stage,
      stageIndex: STAGES.indexOf(this.stage),
      stageElapsed: this.stageElapsed,
      elapsed: this.elapsed,
      objective: this._objectiveText(),
      interactionId: this._preferredInteraction(),
      requiredNeutralizations: 2,
      remainingHostiles,
      recon: {
        active: this.stage === 'recon',
        total: MISSION_TIMINGS.reconSeconds,
        remaining: Math.max(0, MISSION_TIMINGS.reconSeconds - this.stageElapsed),
        hostileCount: this.expectedHostiles,
        technicianCount: 2,
      },
      poison,
      vault,
      technicians: {
        poison: {
          id: TECHNICIAN_IDS.poison,
          neutralized: this.flags.poisonTechnicianNeutralized,
          threatResolved: this.flags.poisonPrevented && !this.flags.poisonReleased,
        },
        vault: {
          id: TECHNICIAN_IDS.vault,
          neutralized: this.flags.vaultTechnicianNeutralized,
          threatResolved: this.flags.vaultSecured ||
            (this.flags.vaultBreached && this.flags.vaultTechnicianNeutralized),
        },
        neutralized: this.stats.techniciansNeutralized,
        required: 2,
        allNeutralized: this.flags.poisonTechnicianNeutralized && this.flags.vaultTechnicianNeutralized,
      },
      operators: {
        poison: { ...this.operationalPresence.poison },
        vault: { ...this.operationalPresence.vault },
      },
      planB: {
        active: this.flags.planBActive || this.flags.poisonReleased,
        valveUnlocked: this.canInteract('close_supply_valve'),
        supplyShutOff: this.flags.supplyShutOff,
      },
      planC: {
        active: this.flags.planCActive || (this.flags.poisonReleased && this.flags.vaultBreached),
        demolitionUnlocked: this.canInteract('demolish_backdoor_main_pipe'),
        pipeDemolished: this.flags.backdoorPipeDemolished,
      },
      counterattack: {
        active: defenseActive,
        route: defenseActive ? this.outcome : null,
        total: this.holdTotal,
        remaining: this.holdRemaining,
      },
      hold: {
        active: defenseActive,
        total: this.holdTotal,
        remaining: this.holdRemaining,
        complete: this.flags.defenseComplete,
        operationRetakeProgress: this.poisonRetakeProgress,
        operationRetakeDelay: this.operationRetakeDelay,
      },
      defense: {
        active: defenseActive,
        total: this.holdTotal,
        remaining: this.holdRemaining,
        kind: 'reinforcement_hold',
      },
      radio: { current: cloneLine(this.currentRadio), queued: this.radioQueue.length },
      flags: { ...this.flags },
      stats: { ...this.stats, remainingHostiles },
      snapshots: this.snapshots.map((snapshot) => ({ ...snapshot, stats: { ...snapshot.stats } })),
    };
  }

  _poisonThreatOpen() {
    return this.stage === 'stop_technical_team' && !this.flags.poisonPrevented && !this.flags.poisonReleased &&
      !this.flags.supplyShutOff && !this.flags.backdoorPipeDemolished;
  }

  _poisonClockActive() {
    return this._poisonThreatOpen() && this.operationalPresence.poison.operating;
  }

  _vaultClockActive() {
    return this.stage === 'stop_technical_team' && !this.flags.vaultSecured && !this.flags.vaultBreached &&
      !this.flags.supplyShutOff && !this.flags.backdoorPipeDemolished &&
      this.operationalPresence.vault.operating;
  }

  _poisonState() {
    const stoppedByIsolation = this.flags.supplyShutOff || this.flags.backdoorPipeDemolished;
    return {
      active: this._poisonClockActive(),
      operatorPresent: this.operationalPresence.poison.operating,
      operatorIds: [...this.operationalPresence.poison.operatorIds],
      total: this.poisonTotal,
      remaining: this.poisonRemaining,
      technicianId: TECHNICIAN_IDS.poison,
      technicianNeutralized: this.flags.poisonTechnicianNeutralized,
      prevented: this.flags.poisonPrevented,
      neutralized: this.flags.poisonPrevented,
      stopped: this.flags.poisonPrevented || stoppedByIsolation,
      released: this.flags.poisonReleased,
      failed: this.flags.poisonReleased,
      status: this.flags.poisonReleased ? 'POISON RELEASED' : this.flags.poisonPrevented ? 'PROCESS STOPPED' : stoppedByIsolation ? 'CITY FEED ISOLATED' : this.operationalPresence.poison.operating ? 'POISON PROCESS ACTIVE' : 'AWAITING NEARBY OPERATOR',
    };
  }

  _vaultState() {
    const stoppedByIsolation = this.flags.supplyShutOff || this.flags.backdoorPipeDemolished;
    return {
      active: this._vaultClockActive(),
      operatorPresent: this.operationalPresence.vault.operating,
      operatorIds: [...this.operationalPresence.vault.operatorIds],
      total: this.vaultTotal,
      remaining: this.vaultRemaining,
      technicianId: TECHNICIAN_IDS.vault,
      technicianNeutralized: this.flags.vaultTechnicianNeutralized,
      secured: this.flags.vaultSecured || this.flags.supplyShutOff,
      stopped: this.flags.vaultSecured || stoppedByIsolation,
      breached: this.flags.vaultBreached,
      failed: this.flags.vaultBreached,
      status: this.flags.vaultBreached ? 'VAULT BREACHED' : this.flags.vaultSecured ? 'VAULT SECURED' : stoppedByIsolation ? 'SUPPLY STOPPED' : this.operationalPresence.vault.operating ? 'VAULT BREACH ACTIVE' : 'AWAITING NEARBY OPERATOR',
    };
  }

  _threatTimerPayload() {
    return {
      visible: this.stage === 'stop_technical_team',
      poison: this._poisonState(),
      vault: this._vaultState(),
    };
  }

  _emitThreatTimers(force = false) {
    const payload = this._threatTimerPayload();
    const signature = [
      payload.visible,
      Math.ceil(payload.poison.remaining), payload.poison.status,
      payload.poison.operatorPresent,
      Math.ceil(payload.vault.remaining), payload.vault.status,
      payload.vault.operatorPresent,
    ].join('|');
    if (!force && signature === this.lastThreatSignature) return;
    this.lastThreatSignature = signature;
    this._emit('onThreatTimers', payload, this.getState());
    this._emit('onPoisonTimer', payload.poison, this.getState());
    this._emit('onVaultTimer', payload.vault, this.getState());
    this._emit('onEvent', 'threat_timers', payload, this.getState());
  }

  _emitDefenseTimer(active) {
    const displayed = Math.ceil(this.holdRemaining);
    if (active && displayed === this.lastDefenseSecond) return;
    this.lastDefenseSecond = active ? displayed : null;
    const payload = {
      active,
      remaining: this.holdRemaining,
      displayed,
      total: this.holdTotal,
      kind: 'reinforcement_hold',
    };
    this._emit('onDefenseTimer', payload, this.getState());
    this._emit('onEvent', 'defense_timer', payload, this.getState());
  }

  _stopPoison(reason) {
    if (this.flags.poisonPrevented || this.flags.poisonReleased) return false;
    this.flags.poisonPrevented = true;
    this.flags.poisonNeutralized = true;
    this.flags.purgeCancelled = true;
    this.stats.poisonPrevented = true;
    this.stats.secondsBeforeRelease = this.poisonRemaining;
    this._queueRadio(RADIO.poisonStopped);
    const payload = { reason, remaining: this.poisonRemaining, interactionId: 'neutralize_poison' };
    this._emit('onPoisonPrevented', payload, this.getState());
    this._emit('onPurgeCancelled', this.getState());
    return true;
  }

  _secureVault(reason) {
    if (this.flags.vaultSecured || this.flags.vaultBreached) return false;
    this.flags.vaultSecured = true;
    this.stats.vaultSecured = true;
    this.stats.secondsBeforeVaultBreach = this.vaultRemaining;
    this._queueRadio(RADIO.vaultSecured);
    this._emit('onVaultSecured', { reason, remaining: this.vaultRemaining }, this.getState());
    return true;
  }

  _releasePoison() {
    if (this.flags.poisonPrevented || this.flags.poisonReleased) return false;
    this.poisonRemaining = 0;
    this.flags.poisonReleased = true;
    this.flags.planBActive = true;
    this.stats.poisonReleased = true;
    this.stats.secondsBeforeRelease = 0;
    this._queueRadio(RADIO.poisonReleased);
    this._emit('onPoisonReleased', this.getState());
    this._emit('onPlanBActivated', this.getState());
    return true;
  }

  _breachVault() {
    if (this.flags.vaultSecured || this.flags.vaultBreached) return false;
    this.vaultRemaining = 0;
    this.flags.vaultBreached = true;
    this.stats.vaultBreached = true;
    this.stats.secondsBeforeVaultBreach = 0;
    this._queueRadio(RADIO.vaultBreached);
    this._emit('onVaultBreached', this.getState());
    return true;
  }

  _evaluateTechnicianSuccess() {
    if (this.stage !== 'stop_technical_team') return false;
    // The valve is Plan B for contaminated water, not a second requirement
    // after clean water has already been secured. As soon as poison transfer is
    // prevented, every vault state (active, secured, or already breached) is a
    // valid primary containment route. Surviving specialists simply join the
    // counterattack during the reinforcement hold.
    const poisonThreatResolved = this.flags.poisonPrevented && !this.flags.poisonReleased;
    if (!poisonThreatResolved) return false;
    return this._startHold('technicians_secured');
  }

  _evaluateFallback() {
    if (!this.flags.poisonReleased || !this.flags.vaultBreached || this.flags.planCActive) return false;
    this.flags.planCActive = true;
    this._queueRadio(RADIO.fallback);
    this._emit('onFallbackActivated', {
      interactionId: 'demolish_backdoor_main_pipe',
      reason: 'poison_released_and_vault_breached',
    }, this.getState());
    this._announceStage('final_pipe_cutoff_unlocked');
    return true;
  }

  _startHold(route) {
    if (this.complete || this.failed || this.stage === 'hold_reinforcements') return false;
    this.outcome = route;
    this.stats.outcome = route;
    this.flags.counterattackActive = true;
    this.holdRemaining = this.holdTotal;
    this.stats.objectivesCompleted += 1;
    if (route === 'technicians_secured') this._queueRadio(RADIO.holdTechnicians);
    else if (route === 'valve_closed') this._queueRadio(RADIO.holdValve);
    else this._queueRadio(RADIO.holdPipe);
    this._advance('hold_reinforcements', `${route}_counterattack`);
    const targetKey = route === 'technicians_secured'
      ? 'POISON_INJECTION_MACHINE'
      : route === 'valve_closed'
        ? 'SUPPLY_VALVE'
        : 'BACKDOOR_MAIN_PIPE';
    const interactionId = route === 'technicians_secured'
      ? 'neutralize_poison'
      : route === 'valve_closed'
        ? 'close_supply_valve'
        : 'demolish_backdoor_main_pipe';
    const payload = {
      route,
      outcome: route,
      targetKey,
      interactionId,
      total: this.holdTotal,
      remaining: this.holdRemaining,
      remainingHostiles: Math.max(0, this.expectedHostiles - this.stats.enemiesNeutralized),
    };
    this._emit('onCounterattackStarted', payload, this.getState());
    this._emit('onHoldStarted', payload, this.getState());
    this._emitThreatTimers(true);
    this._emitDefenseTimer(true);
    this._pumpRadio();
    this._evaluateFullClearSuccess();
    return true;
  }

  _evaluateFullClearSuccess() {
    if (this.complete || this.failed ||
        !['stop_technical_team', 'hold_reinforcements'].includes(this.stage)) return false;
    if (this.stats.remainingHostiles > 0) return false;
    // A direct clear is valid only before either active process has completed
    // its destructive countdown. Existing containment routes retain their
    // authored outcome rules even if (for example) the unused vault was lost.
    if (this.stage === 'stop_technical_team' &&
        (this.flags.poisonReleased || this.flags.vaultBreached)) return false;

    // No living hostile means both technical stations are genuinely unstaffed:
    // both timers are stopped and no counterattack can materialise afterward.
    this.flags.siteCleared = true;
    this.stats.siteCleared = true;
    for (const type of ['poison', 'vault']) {
      this.operationalPresence[type] = {
        ...this.operationalPresence[type],
        operating: false,
        operatorIds: [],
        assignedOperatorId: null,
      };
    }
    if (this.stage === 'stop_technical_team') {
      return this._completeDirectSiteClear();
    }
    return this._completeHold('all_hostiles_down_both_operations_stopped');
  }

  _completeDirectSiteClear() {
    if (this.stage !== 'stop_technical_team' || this.complete || this.failed) return false;
    this.outcome = 'site_cleared';
    this.stats.outcome = 'site_cleared';
    this.flags.counterattackActive = false;
    this.flags.defenseComplete = true;
    this.stats.objectivesCompleted += 1;
    this.stats.residentsProtected = 218000;
    this.stats.residentsSupplied = 218000;
    this.stats.plantOutput = 100;
    this.stats.reservoirDelivery = 100;
    this.stats.serviceInterrupted = false;
    this.stats.elapsedSeconds = this.elapsed;
    this._queueRadio(RADIO.response);
    this._advance('ending', 'all_hostiles_down_both_timers_stopped');
    this.complete = true;
    this._emitThreatTimers(true);
    this._snapshot('all_hostiles_down_both_timers_stopped');
    const state = this.getState();
    this._emit('onEnding', state.stats, state);
    this._emit('onComplete', state);
    return true;
  }

  _completeHold(completionReason = 'response_force_arrived') {
    if (this.stage !== 'hold_reinforcements' || this.complete || this.failed) return false;
    this.holdRemaining = 0;
    this.flags.counterattackActive = false;
    this.flags.defenseComplete = true;
    this.stats.counterattackSurvived = true;
    this.stats.residentsProtected = 218000;
    this.stats.residentsSupplied = this.outcome === 'technicians_secured' ? 218000 : 0;
    this.stats.plantOutput = this.outcome === 'technicians_secured' ? 100 : 0;
    this.stats.reservoirDelivery = this.outcome === 'technicians_secured' ? 100 : 0;
    this.stats.serviceInterrupted = this.outcome !== 'technicians_secured';
    this.stats.elapsedSeconds = this.elapsed;
    this._emitDefenseTimer(false);
    this._queueRadio(RADIO.response);
    this._advance('ending', completionReason);
    this.complete = true;
    this._snapshot(
      completionReason === 'response_force_arrived'
        ? 'municipal_water_threat_contained'
        : completionReason,
    );
    const state = this.getState();
    this._emit('onReinforcementsArrived', { route: this.outcome }, state);
    this._emit('onEnding', state.stats, state);
    this._emit('onComplete', state);
    return true;
  }

  _preferredInteraction() {
    if (this.stage !== 'stop_technical_team') return null;
    if (this.flags.poisonReleased && this.flags.vaultBreached) return 'demolish_backdoor_main_pipe';
    if (this.flags.poisonReleased && !this.flags.vaultBreached) return 'close_supply_valve';
    if (this._poisonClockActive()) return 'neutralize_poison';
    if (!this.flags.vaultBreached && !this.flags.supplyShutOff) return 'close_supply_valve';
    return null;
  }

  _objectiveText() {
    if (this.stage === 'recon') return OBJECTIVES.recon;
    if (this.stage === 'hold_reinforcements') {
      return `${OBJECTIVES.hold_reinforcements} — ${this._formatTime(this.holdRemaining)}`;
    }
    if (this.stage === 'ending') return OBJECTIVES.ending;
    if (this.stage === 'failed') return OBJECTIVES.failed;
    if (this.flags.poisonReleased && this.flags.vaultBreached) {
      return 'PLAN C: demolish the marked backdoor main pipe, then hold for reinforcement';
    }
    if (this.flags.poisonReleased) {
      return this.flags.vaultSecured
        ? 'Poison released — close the secured supply valve to isolate the city'
        : `Poison released — close the supply valve before vault breach ${this._formatTime(this.vaultRemaining)}`;
    }
    if (this.flags.vaultBreached) {
      return `Valve vault lost — stop poison release ${this._formatTime(this.poisonRemaining)} to preserve the city`;
    }
    if (this.flags.poisonPrevented) {
      return `Poison process stopped — stop the vault operator or close the valve ${this._formatTime(this.vaultRemaining)}`;
    }
    if (this.flags.vaultSecured) {
      return `Valve vault secured — stop the poison operator or isolate the machine ${this._formatTime(this.poisonRemaining)}`;
    }
    return `Stop the poison transfer or close the valve — poison ${this._formatTime(this.poisonRemaining)} / vault ${this._formatTime(this.vaultRemaining)}`;
  }

  _advance(nextStage, reason) {
    this._snapshot(reason);
    this.stage = nextStage;
    this.stageElapsed = 0;
    this._announceStage(reason);
  }

  _announceStage(reason) {
    const state = this.getState();
    this._emit('onStage', this.stage, state, reason);
    this._emit('onObjective', state.objective, this.stage, state);
    const stageCallback = this.callbacks.stages?.[this.stage];
    if (typeof stageCallback === 'function') stageCallback(state, reason);
    this._emit('onEvent', 'stage', { stage: this.stage, reason, objective: state.objective }, state);
  }

  _queueRadio(lines) {
    for (const line of lines ?? []) {
      this.radioQueue.push({
        speaker: line.speaker,
        text: line.text,
        duration: Math.max(1, Number(line.duration) || 3.5),
        channel: line.channel ?? 'radio',
      });
    }
  }

  _updateRadio(dt) {
    if (this.currentRadio) {
      this.radioRemaining -= dt;
      if (this.radioRemaining <= 0) {
        const finished = this.currentRadio;
        this.currentRadio = null;
        this.radioGap = 0.28;
        this._emit('onSubtitleEnd', cloneLine(finished));
      }
    } else if (this.radioGap > 0) {
      this.radioGap = Math.max(0, this.radioGap - dt);
    }
    this._pumpRadio();
  }

  _pumpRadio() {
    if (this.currentRadio || this.radioGap > 0 || this.radioQueue.length === 0) return;
    this.currentRadio = this.radioQueue.shift();
    this.radioRemaining = this.currentRadio.duration;
    const line = cloneLine(this.currentRadio);
    this._emit('onRadio', line, this.getState());
    this._emit('onSubtitle', line, this.getState());
    this._emit('onEvent', 'radio', line, this.getState());
  }

  _snapshot(reason) {
    const snapshot = {
      reason,
      stage: this.stage,
      outcome: this.outcome,
      elapsed: Number(this.elapsed.toFixed(3)),
      objective: this._objectiveText(),
      stats: { ...this.stats, elapsedSeconds: Number(this.elapsed.toFixed(3)) },
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 48) this.snapshots.shift();
    this._emit('onSnapshot', { ...snapshot, stats: { ...snapshot.stats } });
    return snapshot;
  }

  _emit(name, ...args) {
    const callback = this.callbacks?.[name];
    if (typeof callback !== 'function') return;
    try {
      callback(...args);
    } catch (error) {
      console.warn(`[CLEARWATER] ${name} callback failed`, error);
    }
  }

  _formatTime(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
}

export default MissionDirector;
