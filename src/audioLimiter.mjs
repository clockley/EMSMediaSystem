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
    #debug;

    constructor(thresholdDb = -3, outputGain = 0.95, knee = 6, debug = true) {
        this.#debug = debug;

        if (this.#debug) {
            console.log('[AudioLimiter] Initializing with params:', {
                thresholdDb,
                outputGain,
                knee
            });
        }

        this.#ctx = new (window.AudioContext || window.webkitAudioContext)();

        if (this.#debug) {
            console.log('[AudioLimiter] AudioContext created, state:', this.#ctx.state);
            console.log('[AudioLimiter] Sample rate:', this.#ctx.sampleRate);
        }

        this.#compressor = this.#ctx.createDynamicsCompressor();
        this.#compressor.threshold.setValueAtTime(thresholdDb, this.#ctx.currentTime);
        this.#compressor.knee.setValueAtTime(knee, this.#ctx.currentTime);
        this.#compressor.ratio.setValueAtTime(12, this.#ctx.currentTime);
        this.#compressor.attack.setValueAtTime(0.003, this.#ctx.currentTime);
        this.#compressor.release.setValueAtTime(0.25, this.#ctx.currentTime);

        if (this.#debug) {
            console.log('[AudioLimiter] Compressor configured:', {
                threshold: this.#compressor.threshold.value,
                knee: this.#compressor.knee.value,
                ratio: this.#compressor.ratio.value,
                attack: this.#compressor.attack.value,
                release: this.#compressor.release.value
            });
        }

        this.#ceilingGain = this.#ctx.createGain();
        this.#ceilingGain.gain.setValueAtTime(outputGain, this.#ctx.currentTime);

        if (this.#debug) {
            console.log('[AudioLimiter] Ceiling gain set to:', this.#ceilingGain.gain.value);
        }

        this.#compressor.connect(this.#ceilingGain);
        this.#ceilingGain.connect(this.#ctx.destination);

        if (this.#debug) {
            console.log('[AudioLimiter] Audio graph connected: Source → Compressor → Gain → Destination');
        }
    }

    /**
     * Attach limiter to a media element
     * @param {HTMLMediaElement} mediaEl
     */
    attach(mediaEl) {
        if (this.#debug) {
            console.log('[AudioLimiter] attach() called');
            console.log('[AudioLimiter] Media element:', mediaEl.tagName, mediaEl.src || mediaEl.currentSrc);
            console.log('[AudioLimiter] Has src:', !!(mediaEl.src || mediaEl.currentSrc));
            console.log('[AudioLimiter] ReadyState:', mediaEl.readyState);
            console.log('[AudioLimiter] AudioContext state before attach:', this.#ctx.state);
        }

        if (!(mediaEl instanceof HTMLMediaElement)) {
            const err = new TypeError('Expected an HTMLMediaElement');
            if (this.#debug) {
                console.error('[AudioLimiter] Type error:', err);
            }
            throw err;
        }

        // Warn if no source is set
        if (!mediaEl.src && !mediaEl.currentSrc) {
            const warning = 'Media element has no source set. Audio routing may not work until src is loaded.';
            if (this.#debug) {
                console.warn('[AudioLimiter]', warning);
            }
        }

        let record = this.#sources.get(mediaEl);

        if (this.#debug) {
            console.log('[AudioLimiter] Existing record found:', !!record);
            if (record) {
                console.log('[AudioLimiter] Record disconnected:', record.disconnected);
            }
        }

        // If the source is missing or disconnected, recreate it
        if (!record || record.disconnected) {
            if (this.#debug) {
                console.log('[AudioLimiter] Creating new MediaElementSource...');
            }

            try {
                const source = this.#ctx.createMediaElementSource(mediaEl);

                if (this.#debug) {
                    console.log('[AudioLimiter] ✓ MediaElementSource created successfully');
                    console.log('[AudioLimiter] Source node:', source);
                }

                source.connect(this.#compressor);

                if (this.#debug) {
                    console.log('[AudioLimiter] ✓ Source connected to compressor');
                }

                record = { source, disconnected: false };
                this.#sources.set(mediaEl, record);

                if (this.#debug) {
                    console.log('[AudioLimiter] ✓ Record stored in WeakMap');
                    console.log('[AudioLimiter] Audio will continue playing even if element is removed from DOM');
                }
            } catch (err) {
                if (this.#debug) {
                    console.error('[AudioLimiter] ✗ Failed to create MediaElementSource:', err);
                    console.error('[AudioLimiter] Common causes:');
                    console.error('[AudioLimiter]   - Element already connected to another AudioContext');
                    console.error('[AudioLimiter]   - Cross-origin media without CORS headers');
                    console.error('[AudioLimiter]   - Media source not yet loaded');
                }
                throw err;
            }
        } else {
            if (this.#debug) {
                console.log('[AudioLimiter] Using existing source, no need to recreate');
            }
        }

        if (this.#ctx.state === 'suspended') {
            if (this.#debug) {
                console.log('[AudioLimiter] AudioContext is suspended, attempting to resume...');
            }

            this.#ctx.resume()
                .then(() => {
                    if (this.#debug) {
                        console.log('[AudioLimiter] ✓ AudioContext resumed successfully, state:', this.#ctx.state);
                    }
                })
                .catch(err => {
                    if (this.#debug) {
                        console.error('[AudioLimiter] ✗ AudioContext resume failed:', err);
                        console.error('[AudioLimiter] May need user interaction (click/tap) to start audio');
                    } else {
                        console.warn('AudioContext resume failed:', err);
                    }
                });
        } else {
            if (this.#debug) {
                console.log('[AudioLimiter] AudioContext state is:', this.#ctx.state, '(no resume needed)');
            }
        }

        if (this.#debug) {
            console.log('[AudioLimiter] attach() complete');
            console.log('[AudioLimiter] Final AudioContext state:', this.#ctx.state);
        }
    }

    /**
     * Manually detach a specific media element
     * @param {HTMLMediaElement} mediaEl
     */
    detach(mediaEl) {
        if (this.#debug) {
            console.log('[AudioLimiter] detach() called for:', mediaEl.tagName);
        }

        const record = this.#sources.get(mediaEl);

        if (!record) {
            if (this.#debug) {
                console.warn('[AudioLimiter] No record found for element, nothing to detach');
            }
            return;
        }

        try {
            record.source.disconnect();
            record.disconnected = true;

            if (this.#debug) {
                console.log('[AudioLimiter] ✓ Source disconnected');
            }
        } catch (e) {
            if (this.#debug) {
                console.warn('[AudioLimiter] Error disconnecting source:', e);
            }
        }
    }

    /**
     * Set output gain (volume)
     * @param {number} gain - Gain value (0 to 1+)
     */
    setGain(gain) {
        if (this.#debug) {
            console.log('[AudioLimiter] Setting gain to:', gain);
        }
        this.#ceilingGain.gain.setValueAtTime(gain, this.#ctx.currentTime);
    }

    /**
     * Mute output
     */
    mute() {
        if (this.#debug) {
            console.log('[AudioLimiter] Muting output');
        }
        this.#ceilingGain.gain.setValueAtTime(0, this.#ctx.currentTime);
    }

    /**
     * Unmute output
     * @param {number} gain - Gain value to restore (default 0.95)
     */
    unmute(gain = 0.95) {
        if (this.#debug) {
            console.log('[AudioLimiter] Unmuting output to gain:', gain);
        }
        this.#ceilingGain.gain.setValueAtTime(gain, this.#ctx.currentTime);
    }

    /**
     * Dispose the limiter and close AudioContext
     */
    async dispose() {
        if (this.#debug) {
            console.log('[AudioLimiter] dispose() called');
            console.log('[AudioLimiter] Disconnecting all sources...');
        }

        let disconnectCount = 0;
        for (const [el, { source }] of this.#sources.entries()) {
            try {
                source.disconnect();
                disconnectCount++;
                if (this.#debug) {
                    console.log('[AudioLimiter] Disconnected source for:', el.tagName);
                }
            } catch (e) {
                if (this.#debug) {
                    console.warn('[AudioLimiter] Error disconnecting source:', e);
                }
            }
        }

        if (this.#debug) {
            console.log('[AudioLimiter] Disconnected', disconnectCount, 'source(s)');
        }

        this.#sources = new WeakMap();

        if (this.#debug) {
            console.log('[AudioLimiter] Closing AudioContext...');
        }

        try {
            await this.#ctx.close();
            if (this.#debug) {
                console.log('[AudioLimiter] ✓ AudioContext closed, state:', this.#ctx.state);
            }
        } catch (e) {
            if (this.#debug) {
                console.error('[AudioLimiter] ✗ Error closing AudioContext:', e);
            } else {
                console.warn('Error closing AudioContext:', e);
            }
        }

        if (this.#debug) {
            console.log('[AudioLimiter] dispose() complete');
        }
    }
}