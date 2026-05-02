import * as THREE from 'three';

/**
 * Plays a horizontal sprite strip on a Three.js Sprite (or any material with a `map`).
 *
 * Each strip is laid out left-to-right with N square cells. We drive the
 * texture's `repeat` and `offset` to expose one cell at a time, then advance
 * the cell index based on `dt` and `fps`.
 *
 * Loop animations replay forever. One-shot animations clamp to the last frame
 * and call `onComplete()` once when they finish.
 */
export class SpriteSheetAnimator {
  constructor({ texture, frames, fps, loop = true, onComplete = null }) {
    this.texture = texture;
    this.frames = frames;
    this.fps = fps;
    this.loop = loop;
    this.onComplete = onComplete;

    this.currentFrame = 0;
    this.elapsed = 0;
    this.finished = false;

    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.repeat.set(1 / frames, 1);
    this.texture.offset.set(0, 0);
    this.texture.needsUpdate = true;
  }

  reset() {
    this.currentFrame = 0;
    this.elapsed = 0;
    this.finished = false;
    this.texture.offset.x = 0;
  }

  update(dt) {
    if (this.finished) return;
    this.elapsed += dt;
    const frameDuration = 1 / this.fps;
    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      this.currentFrame++;
      if (this.currentFrame >= this.frames) {
        if (this.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = this.frames - 1;
          this.finished = true;
          this.texture.offset.x = this.currentFrame / this.frames;
          if (this.onComplete) this.onComplete();
          return;
        }
      }
    }
    this.texture.offset.x = this.currentFrame / this.frames;
  }
}

/**
 * Loads a sprite sheet PNG, returns a configured Texture and an Animator.
 * The Animator is wired to the texture's repeat/offset; you assign the same
 * texture to a SpriteMaterial to have the cell appear on the sprite.
 */
export function loadSpriteSheet(loader, url, { frames, fps, loop = true, onComplete = null }) {
  const texture = loader.load(url);
  const animator = new SpriteSheetAnimator({ texture, frames, fps, loop, onComplete });
  return { texture, animator };
}
