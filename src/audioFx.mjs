/**
 * FadeOut class - Smoothly fades out media elements
 * Handles both volume and opacity transitions
 */
export class FadeOut {
  /** @type {WeakMap<HTMLMediaElement, {intervalId: number|null}>} */
  #mediaElements = new WeakMap();
  
  /** @type {number} */
  #duration;
  
  /** @type {number} */
  #interval = 50;
  
  /** @type {boolean} */
  #debug = false;

  /**
   * Creates a new FadeOut instance
   * @param {number} [duration=3] - Duration of the fade in seconds
   * @param {boolean} [debug=false] - Enable debug logging
   */
  constructor(duration = 3, debug = false) {
    this.#duration = duration;
    this.#debug = debug;
  }

  /**
   * Attach a media element to enable fade-out functionality
   * @param {HTMLMediaElement} mediaEl - The audio or video element to attach
   * @throws {TypeError} If mediaEl is not an HTMLMediaElement
   */
  attach(mediaEl) {
    if (!(mediaEl instanceof HTMLMediaElement)) {
      throw new TypeError('Expected an HTMLMediaElement');
    }

    if (!this.#mediaElements.has(mediaEl)) {
      this.#mediaElements.set(mediaEl, { 
        intervalId: null
      });
    }
  }

  /**
   * Start fading out the media element
   * @param {HTMLMediaElement} mediaEl - The media element to fade out
   * @param {Function} [onComplete=null] - Callback function to execute when fade completes
   * @returns {void}
   */
  fade(mediaEl, onComplete = null) {
    const record = this.#mediaElements.get(mediaEl);
    if (!record) return;

    if (record.intervalId !== null) {
      clearInterval(record.intervalId);
    }

    const initialVolume = mediaEl.volume;
    if (initialVolume <= 0) return;

    const steps = Math.ceil((this.#duration * 1000) / this.#interval);
    const stepAmount = initialVolume / steps;
    let currentStep = 0;

    record.intervalId = setInterval(() => {
      if (!mediaEl) {
        clearInterval(record.intervalId);
        return;
      }

      currentStep++;
      const newVolume = Math.max(0, initialVolume - stepAmount * currentStep);
      mediaEl.volume = newVolume;
      mediaEl.style.opacity = newVolume;

      if (this.#debug) {
        console.log(`[FadeOut] Volume: ${newVolume.toFixed(2)}, Opacity: ${newVolume.toFixed(2)}`);
      }

      if (newVolume <= 0 || currentStep >= steps) {
        clearInterval(record.intervalId);
        record.intervalId = null;
        mediaEl.volume = 0;
        mediaEl.style.opacity = 0;
        mediaEl.pause();
        mediaEl.currentTime = mediaEl.duration;
        mediaEl.dispatchEvent(new Event('ended'));
        mediaEl.style.opacity = 1;

        if (this.#debug) {
          console.log('[FadeOut] Fade complete, media paused');
        }

        if (typeof onComplete === 'function') onComplete();
      }
    }, this.#interval);
  }

  /**
   * Cancel an in-progress fade
   * @param {HTMLMediaElement} mediaEl - The media element to cancel fade for
   * @returns {void}
   */
  cancel(mediaEl) {
    const record = this.#mediaElements.get(mediaEl);
    if (!record) return;

    if (record.intervalId !== null) {
      clearInterval(record.intervalId);
      record.intervalId = null;
    }
  }

  /**
   * Detach a media element and cancel any in-progress fade
   * @param {HTMLMediaElement} mediaEl - The media element to detach
   * @returns {void}
   */
  detach(mediaEl) {
    this.cancel(mediaEl);
    this.#mediaElements.delete(mediaEl);
  }

  /**
   * Detach all media elements
   * @returns {void}
   */
  detachAll() {
    for (const mediaEl of this.#mediaElements.keys()) {
      this.detach(mediaEl);
    }
  }
}

/**
 * Usage example:
 * @example
 * import { FadeOut } from './fadeout.js';
 * 
 * const fadeOut = new FadeOut(3); // 3 second fade
 * const video = document.querySelector('video');
 * 
 * // Set safe volume to prevent distortion
 * video.volume = 0.7;
 * 
 * // Attach and fade when needed
 * fadeOut.attach(video);
 * fadeOut.fade(video, () => {
 *   console.log('Fade complete!');
 * });
 */