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
    #sources = new WeakMap();

    constructor(thresholdDb = -3, outputGain = 0.95, knee = 6) {
        this.#ctx = new (window.AudioContext || window.webkitAudioContext)();

        this.#compressor = this.#ctx.createDynamicsCompressor();
        this.#compressor.threshold.setValueAtTime(thresholdDb, this.#ctx.currentTime);
        this.#compressor.knee.setValueAtTime(knee, this.#ctx.currentTime);
        this.#compressor.ratio.setValueAtTime(12, this.#ctx.currentTime);
        this.#compressor.attack.setValueAtTime(0.003, this.#ctx.currentTime);
        this.#compressor.release.setValueAtTime(0.25, this.#ctx.currentTime);

        this.#ceilingGain = this.#ctx.createGain();
        this.#ceilingGain.gain.setValueAtTime(outputGain, this.#ctx.currentTime);

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

        let record = this.#sources.get(mediaEl);

        // If the source is missing or disconnected, recreate it
        if (!record || record.disconnected) {
            const source = this.#ctx.createMediaElementSource(mediaEl);
            source.connect(this.#compressor);

            // Setup mutation observer
            const observer = new MutationObserver(() => {
                if (!document.contains(mediaEl)) {
                    try { source.disconnect(); } catch { }
                    record.disconnected = true;
                } else if (record.disconnected) {
                    // If element was reattached, reconnect it
                    try { source.connect(this.#compressor); } catch { }
                    record.disconnected = false;
                }
            });

            observer.observe(document, { childList: true, subtree: true });
            record = { source, observer, disconnected: false };
            this.#sources.set(mediaEl, record);
        }

        if (this.#ctx.state === 'suspended') {
            this.#ctx.resume().catch(err =>
                console.warn('AudioContext resume failed:', err)
            );
        }
    }

    /**
     * Dispose the limiter and close AudioContext
     */
    async dispose() {
        for (const [el, { source, observer }] of this.#sources.entries()) {
            try { source.disconnect(); } catch { }
            observer?.disconnect?.();
        }
        this.#sources = new WeakMap();
        try { await this.#ctx.close(); } catch (e) {
            console.warn('Error closing AudioContext:', e);
        }
    }
}
