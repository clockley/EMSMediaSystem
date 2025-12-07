// audioFx.js - Combined Audio FX utilities
/**
 * Attach a cubic soft-clip WaveShaper to a video element.
 * Fails gracefully if already attached.
 * @param {HTMLMediaElement} videoElement
 * @param {number} [gain=1.0] Optional pre-gain multiplier before wave shaping
 * @param {number} [curveLength=16384] Resolution of the WaveShaper curve
 * @returns {{ audioCtx: AudioContext, gainNode: GainNode, waveshaper: WaveShaperNode }}
 */

// WeakMap to track attached elements
const _attachedCubicElements = new WeakMap();

export function attachCubicWaveShaper(videoElement, gain = 1.0, curveLength = 16384) {
  if (!videoElement) throw new Error("Video element is required.");

  // Check if already attached
  if (_attachedCubicElements.has(videoElement)) {
    console.warn('Cubic waveshaper is already attached to this element.');
    return _attachedCubicElements.get(videoElement);
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Create source from video element
  const source = audioCtx.createMediaElementSource(videoElement);

  // Optional gain node before shaping
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = gain;

  // Create WaveShaperNode
  const waveshaper = audioCtx.createWaveShaper();
  waveshaper.curve = makeCubicCurve(curveLength);
  waveshaper.oversample = '4x';

  // Connect nodes: Video -> Gain -> WaveShaper -> Destination
  source.connect(gainNode).connect(waveshaper).connect(audioCtx.destination);

  // Track this attachment
  _attachedCubicElements.set(videoElement, { audioCtx, gainNode, waveshaper });

  return { audioCtx, gainNode, waveshaper };
}

/**
* Generate a cubic soft-clipping curve: y = x - x^3/3
* @param {number} length Length of the curve array
* @returns {Float32Array}
*/
function makeCubicCurve(length = 16384) {
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i * 2) / length - 1;
    curve[i] = x - (x * x * x) / 3;
  }
  return curve;
}

/**
* FadeOut class - Smoothly fades out media elements
*/
export class FadeOut {
  #mediaElements = new WeakMap();
  #duration;
  #interval = 50;
  #debug = false;

  constructor(duration = 3, debug = false) {
    this.#duration = duration;
    this.#debug = debug;
  }

  attach(mediaEl) {
    if (!(mediaEl instanceof HTMLMediaElement)) {
      throw new TypeError('Expected an HTMLMediaElement');
    }
    if (!this.#mediaElements.has(mediaEl)) {
      this.#mediaElements.set(mediaEl, { intervalId: null });
    }
  }

  fade(mediaEl, onComplete = null) {
    const record = this.#mediaElements.get(mediaEl);
    if (!record) return;

    if (record.intervalId !== null) clearInterval(record.intervalId);

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

        if (this.#debug) console.log('[FadeOut] Fade complete, media paused');
        if (typeof onComplete === 'function') onComplete();
      }
    }, this.#interval);
  }

  cancel(mediaEl) {
    const record = this.#mediaElements.get(mediaEl);
    if (record && record.intervalId !== null) {
      clearInterval(record.intervalId);
      record.intervalId = null;
    }
  }

  detach(mediaEl) {
    this.cancel(mediaEl);
    this.#mediaElements.delete(mediaEl);
  }

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