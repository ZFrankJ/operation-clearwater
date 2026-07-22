import * as THREE from 'three';

const EPSILON = 0.001;
const DEFAULT_KEYS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  jump: ['Space'],
  interact: ['KeyE'],
});

function isEditableTarget(target) {
  return Boolean(
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
  );
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function asVector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback?.clone?.() ?? null;
}

/**
 * Pointer-lock first-person controller with a compact, deterministic collision model.
 * Player position is stored at the feet; the camera is derived from it each frame.
 */
export class PlayerController {
  constructor(camera, domElement, world = {}, callbacks = {}) {
    if (!camera?.isCamera) throw new TypeError('PlayerController requires a THREE camera.');
    if (!domElement?.requestPointerLock) {
      throw new TypeError('PlayerController requires a pointer-lock capable DOM element.');
    }

    this.camera = camera;
    this.domElement = domElement;
    this.world = world ?? {};
    this.callbacks = callbacks ?? {};

    // The visible shoulders are wider than the old 34 cm movement capsule.
    // Keep a little living-body clearance so sleeves and the camera cannot
    // appear to enter a wall even though the feet position technically stops.
    this.radius = 0.41;
    this.standingHeight = 1.78;
    this.crouchingHeight = 1.18;
    this.standingEyeHeight = 1.62;
    this.crouchingEyeHeight = 1.02;
    this.maxStepHeight = 0.38;
    this.walkSpeed = 4.55;
    this.sprintSpeed = 7.15;
    this.crouchSpeed = 2.25;
    this.jumpSpeed = 5.7;
    this.gravity = -18.5;

    const cameraFeet = new THREE.Vector3(
      camera.position.x,
      camera.position.y - this.standingEyeHeight,
      camera.position.z,
    );
    this.position = asVector3(this.world.spawn, cameraFeet) ?? cameraFeet;
    this.velocity = new THREE.Vector3();
    this.checkpoint = this.position.clone();

    this.maxHealth = 120;
    this.maxArmor = 120;
    this.health = 120;
    this.armor = 120;
    this.difficulty = 'normal';
    this.startingArmor = 120;
    this.alive = true;
    this.lowHealthThreshold = 0.35;
    this.minimumMobility = 0.58;
    this.deathElapsed = 0;
    this.deathDuration = 1.45;
    this.deathSide = 1;

    this.enabled = true;
    this.locked = document.pointerLockElement === domElement;
    this.paused = false;
    this.grounded = false;
    this.crouched = false;
    this.currentEyeHeight = this.standingEyeHeight;

    camera.rotation.order = 'YXZ';
    this.pitch = THREE.MathUtils.clamp(camera.rotation.x, -1.52, 1.52);
    this.yaw = camera.rotation.y;
    this.checkpointPitch = this.pitch;
    this.checkpointYaw = this.yaw;
    this.lookSway = new THREE.Vector2();
    this.walkCycle = 0;
    this.cameraMotion = { x: 0, y: 0, roll: 0, pitch: 0 };

    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.interactionTarget = null;
    this.interactionProgress = 0;
    this.interactionConsumed = false;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._bodyBox = new THREE.Box3();
    this._tempBox = new THREE.Box3();
    this._lastState = null;

    this._handlers = {
      keydown: (event) => this._onKeyDown(event),
      keyup: (event) => this._onKeyUp(event),
      mousemove: (event) => this._onMouseMove(event),
      pointerlockchange: () => this._onPointerLockChange(),
      pointerlockerror: (event) => this._emit('onPointerLockError', event),
      blur: () => this._clearInputs(),
      contextmenu: (event) => {
        if (this.locked) event.preventDefault();
      },
    };

    document.addEventListener('keydown', this._handlers.keydown);
    document.addEventListener('keyup', this._handlers.keyup);
    document.addEventListener('mousemove', this._handlers.mousemove);
    document.addEventListener('pointerlockchange', this._handlers.pointerlockchange);
    document.addEventListener('pointerlockerror', this._handlers.pointerlockerror);
    window.addEventListener('blur', this._handlers.blur);
    domElement.addEventListener('contextmenu', this._handlers.contextmenu);

    const ground = this._groundHeightAt(this.position.x, this.position.z, this.position.y);
    if (ground !== null && Math.abs(ground - this.position.y) <= this.maxStepHeight) {
      this.position.y = ground;
      this.grounded = true;
    }
    this._applyCamera(0);
  }

  lock() {
    if (!this.enabled || this.locked) return Promise.resolve();
    try {
      const result = this.domElement.requestPointerLock({ unadjustedMovement: true });
      if (result?.catch) {
        return result.catch(() => {
          try {
            return Promise.resolve(this.domElement.requestPointerLock()).catch(() => undefined);
          } catch {
            return undefined;
          }
        });
      }
      return Promise.resolve(result);
    } catch {
      try {
        return Promise.resolve(this.domElement.requestPointerLock()).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    }
  }

  unlock() {
    if (document.pointerLockElement === this.domElement) document.exitPointerLock();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this._clearInputs();
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  setPaused(paused, unlockPointer = false) {
    const next = Boolean(paused);
    if (next === this.paused) return;
    this.paused = next;
    this._clearInputs();
    if (next && unlockPointer) this.unlock();
    this._emit('onPause', next, this.getState());
  }

  setCheckpoint(position = this.position, orientation = {}) {
    this.checkpoint.copy(asVector3(position, this.position));
    this.checkpointYaw = numberOr(orientation.yaw, this.yaw);
    this.checkpointPitch = THREE.MathUtils.clamp(numberOr(orientation.pitch, this.pitch), -1.52, 1.52);
    this._emit('onCheckpoint', this.checkpoint.clone());
  }

  setDifficulty(profile = {}) {
    const previousMax = Math.max(1, this.maxHealth);
    const healthRatio = this.alive ? this.health / previousMax : 0;
    const previousMaxArmor = Math.max(1, this.maxArmor);
    const armorRatio = this.alive ? this.armor / previousMaxArmor : 0;
    this.difficulty = String(profile.id ?? 'normal');
    this.maxHealth = Math.max(1, numberOr(profile.playerHealth, 120));
    this.maxArmor = Math.max(0, numberOr(profile.startingArmor, 120));
    this.startingArmor = this.maxArmor;
    this.health = this.alive
      ? THREE.MathUtils.clamp(this.maxHealth * healthRatio, 1, this.maxHealth)
      : 0;
    this.armor = this.alive
      ? THREE.MathUtils.clamp(this.maxArmor * armorRatio, 0, this.maxArmor)
      : 0;
    return this.getState();
  }

  reset(position = this.checkpoint, options = {}) {
    if (position && !position.isVector3 && !Array.isArray(position) && !Number.isFinite(position.x)) {
      options = position;
      position = this.checkpoint;
    }
    this.position.copy(asVector3(position, this.checkpoint));
    this.velocity.set(0, 0, 0);
    this.yaw = numberOr(options.yaw, this.checkpointYaw);
    this.pitch = THREE.MathUtils.clamp(numberOr(options.pitch, this.checkpointPitch), -1.52, 1.52);
    this.health = options.keepHealth ? Math.max(1, this.health) : this.maxHealth;
    this.armor = options.keepArmor
      ? THREE.MathUtils.clamp(this.armor, 0, this.maxArmor)
      : THREE.MathUtils.clamp(numberOr(options.armor, this.startingArmor), 0, this.maxArmor);
    this.alive = true;
    this.deathElapsed = 0;
    this.deathSide = 1;
    this.grounded = false;
    this.crouched = false;
    this.currentEyeHeight = this.standingEyeHeight;
    this.interactionTarget = null;
    this.interactionProgress = 0;
    this.interactionConsumed = false;
    this._clearInputs();
    this._applyCamera(0);
    this._emit('onReset', this.getState());
    return this.getState();
  }

  applyDamage(amount, options = {}) {
    if (typeof amount === 'object') {
      options = amount;
      amount = options.amount;
    }
    const incoming = Math.max(0, numberOr(amount, 0));
    if (!this.alive || incoming <= 0) return 0;

    const armorRatio = options.ignoreArmor ? 0 : THREE.MathUtils.clamp(
      numberOr(options.armorRatio, 0.62),
      0,
      1,
    );
    const absorbed = Math.min(this.armor, incoming * armorRatio);
    const healthDamage = incoming - absorbed;
    this.armor = Math.max(0, this.armor - absorbed);
    this.health = Math.max(0, this.health - healthDamage);

    const event = {
      incoming,
      absorbed,
      healthDamage,
      source: options.source ?? null,
      direction: asVector3(options.direction),
      state: this.getState(),
    };
    this._emit('onDamage', event);

    if (this.health <= 0) {
      this.alive = false;
      this.deathElapsed = 0;
      const direction = event.direction;
      if (direction?.lengthSq?.() > 1e-8) {
        const cameraRight = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        this.deathSide = Math.sign(direction.dot(cameraRight)) || 1;
      }
      this.velocity.set(0, 0, 0);
      this._clearInputs();
      this._emit('onDeath', event);
    }
    return healthDamage;
  }

  heal(amount, armorAmount = 0) {
    if (typeof amount === 'object') {
      armorAmount = amount.armor ?? 0;
      amount = amount.health ?? 0;
    }
    const previousHealth = this.health;
    const previousArmor = this.armor;
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, numberOr(amount, 0)));
    this.armor = Math.min(this.maxArmor, this.armor + Math.max(0, numberOr(armorAmount, 0)));
    if (this.health > 0) this.alive = true;
    const restored = {
      health: this.health - previousHealth,
      armor: this.armor - previousArmor,
      state: this.getState(),
    };
    this._emit('onHeal', restored);
    return restored;
  }

  isDown(...codes) {
    return codes.flat().some((code) => this.keys.has(code));
  }

  consumeInput(code) {
    const hadInput = this.pressed.has(code);
    this.pressed.delete(code);
    return hadInput;
  }

  consumeInputs() {
    const snapshot = {
      down: new Set(this.keys),
      pressed: new Set(this.pressed),
      released: new Set(this.released),
    };
    this.pressed.clear();
    this.released.clear();
    return snapshot;
  }

  update(dt) {
    dt = THREE.MathUtils.clamp(numberOr(dt, 0), 0, 0.05);
    const active = this.enabled && this.locked && !this.paused && this.alive;

    if (!this.alive) this.deathElapsed = Math.min(this.deathDuration, this.deathElapsed + dt);

    if (active) {
      this._updateStance(dt);
      this._updateMovement(dt);
      this._updateInteraction(dt);
    } else {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, 14, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, 14, dt);
      this._clearInteraction();
    }

    this._applyCamera(dt);

    const killY = numberOr(this.world.killY, -30);
    if (this.position.y < killY && this.alive) {
      const handled = this._emit('onFall', this.position.clone());
      if (handled !== true) this.reset(this.checkpoint);
    }

    this.pressed.clear();
    this.released.clear();
    this._lastState = this.getState();
    this._emit('onState', this._lastState);
    return this._lastState;
  }

  getState() {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    return {
      position: this.position.clone(),
      feetPosition: this.position.clone(),
      velocity: this.velocity.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      grounded: this.grounded,
      crouched: this.crouched,
      sprinting: this._isSprinting(horizontalSpeed),
      moving: horizontalSpeed > 0.12,
      speed: horizontalSpeed,
      mobility: this._mobilityMultiplier(),
      lowHealth: this.alive && this.health / this.maxHealth < this.lowHealthThreshold,
      deathProgress: this.alive ? 0 : THREE.MathUtils.clamp(this.deathElapsed / this.deathDuration, 0, 1),
      health: this.health,
      maxHealth: this.maxHealth,
      armor: this.armor,
      maxArmor: this.maxArmor,
      difficulty: this.difficulty,
      alive: this.alive,
      locked: this.locked,
      paused: this.paused,
      enabled: this.enabled,
      checkpoint: this.checkpoint.clone(),
      checkpointYaw: this.checkpointYaw,
      checkpointPitch: this.checkpointPitch,
      cameraBob: { ...this.cameraMotion },
      interaction: this.interactionTarget ? {
        id: this.interactionTarget.id,
        prompt: this.interactionTarget.prompt ?? 'Interact',
        progress: this.interactionProgress,
      } : null,
    };
  }

  dispose() {
    document.removeEventListener('keydown', this._handlers.keydown);
    document.removeEventListener('keyup', this._handlers.keyup);
    document.removeEventListener('mousemove', this._handlers.mousemove);
    document.removeEventListener('pointerlockchange', this._handlers.pointerlockchange);
    document.removeEventListener('pointerlockerror', this._handlers.pointerlockerror);
    window.removeEventListener('blur', this._handlers.blur);
    this.domElement.removeEventListener('contextmenu', this._handlers.contextmenu);
    this._clearInputs();
  }

  _onKeyDown(event) {
    if (isEditableTarget(event.target)) return;
    if (!this.keys.has(event.code)) this.pressed.add(event.code);
    this.keys.add(event.code);

    if (event.code === 'KeyP' && !event.repeat) {
      event.preventDefault();
      this.setPaused(!this.paused, !this.paused);
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  }

  _onKeyUp(event) {
    this.keys.delete(event.code);
    this.released.add(event.code);
    if (DEFAULT_KEYS.interact.includes(event.code)) {
      this.interactionProgress = 0;
      this.interactionConsumed = false;
    }
  }

  _onMouseMove(event) {
    if (!this.enabled || !this.locked || this.paused || !this.alive) return;
    const sensitivity = numberOr(this.callbacks.mouseSensitivity, 0.00205);
    this.yaw -= event.movementX * sensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * sensitivity,
      -Math.PI * 0.485,
      Math.PI * 0.485,
    );
    this.lookSway.x = THREE.MathUtils.clamp(this.lookSway.x + event.movementX * 0.00018, -0.025, 0.025);
    this.lookSway.y = THREE.MathUtils.clamp(this.lookSway.y + event.movementY * 0.00012, -0.018, 0.018);
  }

  _onPointerLockChange() {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.domElement;
    if (wasLocked === this.locked) return;
    this._clearInputs();
    if (this.locked) this.paused = false;
    else if (wasLocked) this.paused = true;
    this._emit('onLockChange', this.locked, this.getState());
    this._emit('onPause', this.paused, this.getState());
  }

  _clearInputs() {
    this.keys.clear();
    this.pressed.clear();
    this.released.clear();
    this.interactionProgress = 0;
    this.interactionConsumed = false;
  }

  _updateStance(dt) {
    const wantsCrouch = this.isDown(DEFAULT_KEYS.crouch);
    if (wantsCrouch) this.crouched = true;
    else if (this.crouched && this._canOccupy(this.position, this.standingHeight)) this.crouched = false;

    const targetEye = this.crouched ? this.crouchingEyeHeight : this.standingEyeHeight;
    this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, targetEye, 18, dt);
  }

  _updateMovement(dt) {
    const forwardInput = Number(this.isDown(DEFAULT_KEYS.forward)) - Number(this.isDown(DEFAULT_KEYS.backward));
    const sideInput = Number(this.isDown(DEFAULT_KEYS.right)) - Number(this.isDown(DEFAULT_KEYS.left));
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._wish.copy(this._forward).multiplyScalar(forwardInput).addScaledVector(this._right, sideInput);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    const sprinting = !this.crouched && forwardInput > 0 && this.isDown(DEFAULT_KEYS.sprint);
    const maxSpeed = (this.crouched ? this.crouchSpeed : sprinting ? this.sprintSpeed : this.walkSpeed) *
      this._mobilityMultiplier();
    const targetX = this._wish.x * maxSpeed;
    const targetZ = this._wish.z * maxSpeed;
    const responsiveness = this.grounded ? (this._wish.lengthSq() ? 18 : 24) : 4.5;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetX, responsiveness, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetZ, responsiveness, dt);

    if (this.consumeInput('Space') && this.grounded && !this.crouched) {
      this.velocity.y = this.jumpSpeed;
      this.grounded = false;
      this._emit('onJump');
    }

    this._moveHorizontal('x', this.velocity.x * dt);
    this._moveHorizontal('z', this.velocity.z * dt);

    const previousY = this.position.y;
    this.velocity.y = Math.max(-35, this.velocity.y + this.gravity * dt);
    this.position.y += this.velocity.y * dt;
    this._resolveVertical(previousY);
  }

  _moveHorizontal(axis, amount) {
    if (Math.abs(amount) < 1e-7) return;
    this.position[axis] += amount;
    const height = this.crouched ? this.crouchingHeight : this.standingHeight;
    this._setBodyBox(this.position, height, this._bodyBox);

    for (const collider of this.world.colliders ?? []) {
      if (collider?.blocking === false) continue;
      const box = this._colliderBox(collider);
      if (!box || !this._bodyBox.intersectsBox(box)) continue;

      const rise = box.max.y - this.position.y;
      const stepLike = rise > EPSILON && rise <= this.maxStepHeight + EPSILON &&
        box.min.y <= this.position.y + 0.12;
      if (stepLike) continue;

      if (axis === 'x') {
        this.position.x = amount > 0
          ? Math.min(this.position.x, box.min.x - this.radius - EPSILON)
          : Math.max(this.position.x, box.max.x + this.radius + EPSILON);
        this.velocity.x = 0;
      } else {
        this.position.z = amount > 0
          ? Math.min(this.position.z, box.min.z - this.radius - EPSILON)
          : Math.max(this.position.z, box.max.z + this.radius + EPSILON);
        this.velocity.z = 0;
      }
      this._setBodyBox(this.position, height, this._bodyBox);
    }
  }

  _resolveVertical(previousY) {
    const height = this.crouched ? this.crouchingHeight : this.standingHeight;

    if (this.velocity.y > 0) {
      this._setBodyBox(this.position, height, this._bodyBox);
      for (const collider of this.world.colliders ?? []) {
        if (collider?.blocking === false) continue;
        const box = this._colliderBox(collider);
        if (!box || !this._bodyBox.intersectsBox(box)) continue;
        if (box.min.y <= previousY + height * 0.45) continue;
        this.position.y = Math.min(this.position.y, box.min.y - height - EPSILON);
        this.velocity.y = 0;
      }
    }

    const referenceY = Math.max(previousY, this.position.y);
    const ground = this._groundHeightAt(this.position.x, this.position.z, referenceY);
    if (ground === null) {
      this.grounded = false;
      return;
    }

    const canStep = this.grounded && this.velocity.y <= 0 &&
      ground >= previousY - 0.08 && ground <= previousY + this.maxStepHeight + EPSILON;
    const crossedGround = this.velocity.y <= 0 && this.position.y <= ground &&
      previousY >= ground - this.maxStepHeight;

    if (canStep || crossedGround) {
      this.position.y = ground;
      if (!this.grounded && this.velocity.y < -5) this._emit('onLand', Math.abs(this.velocity.y));
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  _groundHeightAt(x, z, currentY) {
    let best = null;
    const accept = (height) => {
      if (!Number.isFinite(height)) return;
      if (height > currentY + this.maxStepHeight + 0.02) return;
      if (best === null || height > best) best = height;
    };

    if (typeof this.world.getGroundHeight === 'function') {
      const result = this.world.getGroundHeight(x, z, currentY);
      accept(typeof result === 'number' ? result : result?.y);
    }

    for (const floor of this.world.floors ?? []) {
      if (!floor || floor.enabled === false) continue;
      const bounds = floor.box?.isBox3 ? floor.box : null;
      const minX = numberOr(floor.minX, bounds?.min.x ?? -Infinity);
      const maxX = numberOr(floor.maxX, bounds?.max.x ?? Infinity);
      const minZ = numberOr(floor.minZ, bounds?.min.z ?? -Infinity);
      const maxZ = numberOr(floor.maxZ, bounds?.max.z ?? Infinity);
      if (x < minX - this.radius * 0.2 || x > maxX + this.radius * 0.2 ||
          z < minZ - this.radius * 0.2 || z > maxZ + this.radius * 0.2) continue;

      if (typeof floor.heightAt === 'function') {
        accept(floor.heightAt(x, z, currentY));
        continue;
      }
      if (floor.type === 'stairs' && Number.isFinite(floor.steps)) {
        const axis = floor.axis === 'x' ? 'x' : 'z';
        const min = axis === 'x' ? minX : minZ;
        const max = axis === 'x' ? maxX : maxZ;
        const value = axis === 'x' ? x : z;
        const direction = floor.direction === -1 ? -1 : 1;
        const t = THREE.MathUtils.clamp((value - min) / Math.max(EPSILON, max - min), 0, 0.999999);
        const index = Math.floor((direction > 0 ? t : 1 - t) * floor.steps);
        accept(numberOr(floor.baseY, floor.y ?? 0) + index * numberOr(floor.stepHeight, 0.18));
        continue;
      }
      accept(numberOr(floor.y, bounds?.max.y));
    }

    // Low authored boxes can double as curbs or stair treads.
    for (const collider of this.world.colliders ?? []) {
      if (collider?.blocking === false) continue;
      const box = this._colliderBox(collider);
      if (!box || x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      const rise = box.max.y - currentY;
      if (rise <= this.maxStepHeight + EPSILON) accept(box.max.y);
    }
    return best;
  }

  _colliderBox(collider) {
    if (!collider) return null;
    if (collider.isBox3) return collider;
    if (collider.box?.isBox3) return collider.box;
    if (collider.min && collider.max) {
      const min = asVector3(collider.min);
      const max = asVector3(collider.max);
      if (min && max) return this._tempBox.set(min, max);
    }
    if (collider.isObject3D) return this._tempBox.setFromObject(collider);
    if (collider.mesh?.isObject3D) return this._tempBox.setFromObject(collider.mesh);
    return null;
  }

  _setBodyBox(position, height, target) {
    return target.set(
      new THREE.Vector3(position.x - this.radius, position.y + 0.035, position.z - this.radius),
      new THREE.Vector3(position.x + this.radius, position.y + height, position.z + this.radius),
    );
  }

  _canOccupy(position, height) {
    this._setBodyBox(position, height, this._bodyBox);
    for (const collider of this.world.colliders ?? []) {
      if (collider?.blocking === false) continue;
      const box = this._colliderBox(collider);
      if (!box || !this._bodyBox.intersectsBox(box)) continue;
      if (box.max.y <= position.y + this.maxStepHeight) continue;
      return false;
    }
    return true;
  }

  _updateInteraction(dt) {
    const target = this._findInteractionTarget();
    if (target !== this.interactionTarget) {
      this.interactionTarget = target;
      this.interactionProgress = 0;
      this.interactionConsumed = false;
      this._emit('onInteractionTarget', target);
    }
    if (!target) return;

    if (!this.isDown(DEFAULT_KEYS.interact)) {
      this.interactionProgress = 0;
      this.interactionConsumed = false;
      this._emit('onInteractionProgress', target, 0);
      return;
    }

    const holdDuration = Math.max(0.05, numberOr(target.holdDuration, 0.7));
    this.interactionProgress = Math.min(1, this.interactionProgress + dt / holdDuration);
    this._emit('onInteractionProgress', target, this.interactionProgress);
    if (this.interactionProgress < 1 || this.interactionConsumed) return;

    this.interactionConsumed = true;
    try {
      target.action?.(this, this.world, target);
      this._emit('onInteract', target, this);
    } catch (error) {
      this._emit('onInteractionError', error, target);
    }
  }

  _findInteractionTarget() {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null;
    let bestScore = Infinity;

    for (const item of this.world.interactables ?? []) {
      if (!item || item.enabled === false || item.completed === true) continue;
      const point = asVector3(item.position, item.mesh?.getWorldPosition?.(new THREE.Vector3()));
      if (!point) continue;
      const delta = point.sub(origin);
      const distance = delta.length();
      const radius = numberOr(item.radius, 2.25);
      if (distance > radius) continue;
      const facing = distance > EPSILON ? delta.normalize().dot(forward) : 1;
      if (distance > 0.9 && facing < 0.2) continue;
      const score = distance * (1.35 - Math.max(0, facing));
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  _clearInteraction() {
    if (this.interactionTarget) this._emit('onInteractionTarget', null);
    this.interactionTarget = null;
    this.interactionProgress = 0;
    this.interactionConsumed = false;
  }

  _applyCamera(dt) {
    if (!this.alive) {
      const progress = THREE.MathUtils.smoothstep(
        THREE.MathUtils.clamp(this.deathElapsed / this.deathDuration, 0, 1),
        0,
        1,
      );
      const eyeHeight = THREE.MathUtils.lerp(this.currentEyeHeight, 0.3, progress);
      this.camera.position.set(this.position.x, this.position.y + eyeHeight, this.position.z);
      this.camera.rotation.set(
        this.pitch + THREE.MathUtils.lerp(0, -0.34, progress),
        this.yaw,
        this.deathSide * THREE.MathUtils.lerp(0, 1.08, progress),
        'YXZ',
      );
      this.camera.updateMatrixWorld();
      return;
    }

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && speed > 0.15 && this.enabled && !this.paused;
    if (moving) this.walkCycle += dt * (6.8 + speed * 1.05);

    const pace = THREE.MathUtils.clamp(speed / this.sprintSpeed, 0, 1);
    const crouchFactor = this.crouched ? 0.42 : 1;
    const targetBobY = moving ? Math.sin(this.walkCycle * 2) * 0.026 * pace * crouchFactor : 0;
    const targetBobX = moving ? Math.cos(this.walkCycle) * 0.012 * pace * crouchFactor : 0;
    const targetRoll = moving ? Math.sin(this.walkCycle) * 0.006 * pace : 0;
    this.cameraMotion.x = THREE.MathUtils.damp(this.cameraMotion.x, targetBobX, 15, dt);
    this.cameraMotion.y = THREE.MathUtils.damp(this.cameraMotion.y, targetBobY, 15, dt);
    this.cameraMotion.roll = THREE.MathUtils.damp(this.cameraMotion.roll, targetRoll, 12, dt);
    this.cameraMotion.pitch = THREE.MathUtils.damp(
      this.cameraMotion.pitch,
      moving ? Math.abs(Math.cos(this.walkCycle * 2)) * 0.0025 * pace : 0,
      12,
      dt,
    );
    this.lookSway.multiplyScalar(Math.exp(-dt * 11));

    this.camera.position.set(
      this.position.x,
      this.position.y + this.currentEyeHeight + this.cameraMotion.y,
      this.position.z,
    );
    this.camera.rotation.set(
      this.pitch + this.cameraMotion.pitch + this.lookSway.y,
      this.yaw,
      this.cameraMotion.roll - this.lookSway.x,
      'YXZ',
    );
    this.camera.updateMatrixWorld();
  }

  _isSprinting(speed = Math.hypot(this.velocity.x, this.velocity.z)) {
    return !this.crouched && this.isDown(DEFAULT_KEYS.sprint) &&
      speed > this.walkSpeed * this._mobilityMultiplier() * 1.08;
  }

  _mobilityMultiplier() {
    const healthRatio = THREE.MathUtils.clamp(this.health / Math.max(1, this.maxHealth), 0, 1);
    if (healthRatio >= this.lowHealthThreshold) return 1;
    return THREE.MathUtils.lerp(
      this.minimumMobility,
      1,
      healthRatio / Math.max(0.01, this.lowHealthThreshold),
    );
  }

  _emit(name, ...args) {
    const callback = this.callbacks?.[name];
    if (typeof callback !== 'function') return undefined;
    try {
      return callback(...args);
    } catch (error) {
      console.error(`PlayerController ${name} callback failed`, error);
      return undefined;
    }
  }
}

export default PlayerController;
