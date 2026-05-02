import * as THREE from 'three';
import { SpriteSheetAnimator } from './SpriteSheetAnimator.js';

/**
 * Drives a Three.js Sprite through named animation states (run, lane_left,
 * rainbow, pass, ...). Each state owns its own texture + animator. One-shot
 * states return to `defaultState` when they finish.
 */
export class PlayerSpriteController {
  constructor({ sprite, defaultState = 'run' }) {
    this.sprite = sprite;
    this.defaultState = defaultState;
    this.states = new Map();
    this.currentState = null;
    this.currentAnimator = null;
  }

  /**
   * Register a named state with its texture, frame count, fps, and loop flag.
   */
  registerState(name, { texture, frames, fps, loop }) {
    this.states.set(name, { texture, frames, fps, loop });
  }

  /**
   * Set the current animation state. One-shot states reset to the start;
   * setting the same state that's currently playing as a loop is a no-op.
   */
  setState(name) {
    const def = this.states.get(name);
    if (!def) {
      console.warn(`PlayerSpriteController: unknown state "${name}"`);
      return;
    }
    if (this.currentState === name && def.loop) return;

    this.sprite.material.map = def.texture;
    this.sprite.material.needsUpdate = true;
    this.currentAnimator = new SpriteSheetAnimator({
      texture: def.texture,
      frames: def.frames,
      fps: def.fps,
      loop: def.loop,
      onComplete: def.loop ? null : () => this.setState(this.defaultState),
    });
    this.currentState = name;
  }

  isPlayingOneShot() {
    if (!this.currentAnimator) return false;
    return !this.currentAnimator.loop && !this.currentAnimator.finished;
  }

  update(dt) {
    if (this.currentAnimator) this.currentAnimator.update(dt);
  }
}
