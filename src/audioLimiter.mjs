/*
Copyright (C) 2025 Christian Lockley
This library is free software; you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Lesser General Public License for more details.

You should have received a copy of the GNU General Public License
along with this library. If not, see <https://www.gnu.org/licenses/>.
*/

export class AudioLimiter {
    #ctx;
    #compressor;
    #gain;
    #ceilingGain;
    #attachedElements = new WeakSet();

    /**
     * @param {number} thresholdDb - Compressor threshold in dB (default -6)
     * @param {number} outputGain - Master output gain (default 0.95)
     * @param {number} knee - Soft knee width in dB (default 6)
     */
    constructor(thresholdDb = -3, outputGain = 0.95, knee = 6) {
        this.#ctx = new (window.AudioContext || window.webkitAudioContext)();

        // Compressor / Limiter with soft knee
        this.#compressor = this.#ctx.createDynamicsCompressor();
        this.#compressor.threshold.setValueAtTime(thresholdDb, this.#ctx.currentTime);
        this.#compressor.knee.setValueAtTime(knee, this.#ctx.currentTime);
        this.#compressor.ratio.setValueAtTime(12, this.#ctx.currentTime);
        this.#compressor.attack.setValueAtTime(0.003, this.#ctx.currentTime);
        this.#compressor.release.setValueAtTime(0.25, this.#ctx.currentTime);

        // Ceiling gain node to prevent 0 dBFS clipping
        this.#ceilingGain = this.#ctx.createGain();
        this.#ceilingGain.gain.setValueAtTime(outputGain, this.#ctx.currentTime);

        // Connect: Compressor → Ceiling Gain → Destination
        this.#compressor.connect(this.#ceilingGain);
        this.#ceilingGain.connect(this.#ctx.destination);
    }

    /**
     * Attach limiter to a media element
     * @param {HTMLMediaElement} mediaEl
     */
    attach(mediaEl) {
        if (!(mediaEl instanceof HTMLMediaElement)) {
            throw new TypeError('Expected an HTMLMediaElement');
        }

        if (this.#attachedElements.has(mediaEl)) return;

        const source = this.#ctx.createMediaElementSource(mediaEl);
        source.connect(this.#compressor);
        this.#attachedElements.add(mediaEl);

        if (this.#ctx.state === 'suspended') {
            this.#ctx.resume().catch(err =>
                console.warn('AudioContext resume failed:', err)
            );
        }

        // Cleanup when element is removed from DOM
        const observer = new MutationObserver(() => {
            if (!document.contains(mediaEl)) {
                try { source.disconnect(); } catch { }
                observer.disconnect();
            }
        });
        observer.observe(document, { childList: true, subtree: true });
    }

    /**
     * Dispose the limiter and close AudioContext
     */
    async dispose() {
        try { await this.#ctx.close(); } catch (e) {
            console.warn('Error closing AudioContext:', e);
        }
    }
}
