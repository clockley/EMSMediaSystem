/*
Copyright (C) 2019-2024 Christian Lockley

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const COEFFICIENT_PROFILES = {
  stable: { kP: 0.5, kI: 0.05, kD: 0.15 },
  oscillating: { kP: 0.35, kI: 0.03, kD: 0.22 },
  lagging: { kP: 0.65, kI: 0.1, kD: 0.12 },
  systemStress: { kP: 0.4, kI: 0.04, kD: 0.2 },
};

export class PIDController {
  constructor(video, callbacks = {}) {
    this.video = video;
    this.isActiveMediaWindow = callbacks.isActiveMediaWindow || (() => false);
    this.beginPidSeekSuppression =
      callbacks.beginPidSeekSuppression || (() => {});

    this.patterns = {
      STABLE: "stable",
      OSCILLATING: "oscillating",
      LAGGING: "lagging",
      SYSTEM_STRESS: "systemStress",
    };

    this.performancePatterns = {
      [this.patterns.STABLE]: { maxRate: 1.1 },
      [this.patterns.OSCILLATING]: { maxRate: 1.05 },
      [this.patterns.LAGGING]: { maxRate: 1.2 },
      [this.patterns.SYSTEM_STRESS]: { maxRate: 1.05 },
    };

    this.maxTimeGap = 1000;
    this.synchronizationThreshold = 0.005;
    this.maxIntegralError = 0.5;
    this.fastSyncThreshold = 0.75;
    this.maxFastSyncRate = 2;

    this._initCoefficients();
    this._resetRuntimeState();
  }

  _initCoefficients(profile = COEFFICIENT_PROFILES.stable) {
    this.adaptiveCoefficients = {
      kP: {
        value: profile.kP,
        minValue: 0.2,
        maxValue: 0.8,
      },
      kI: {
        value: profile.kI,
        minValue: 0.01,
        maxValue: 0.15,
      },
      kD: {
        value: profile.kD,
        minValue: 0.08,
        maxValue: 0.25,
      },
    };
  }

  _resetRuntimeState() {
    this.currentPattern = this.patterns.STABLE;
    this.systemLag = 0;
    this.overshoots = 0;
    this.avgResponseTime = 0;
    this.integral = 0;
    this.lastTimeDifference = 0;
    this.lastUpdateTime = 0;
    this.lastWallTime = null;
    this.lastAppliedRate = 1;
    this.lastErrorSign = 0;
    this._rateChangeTime = 0;
    this._errorRing = new Float64Array(10);
    this._errorRingIdx = 0;
    this._errorRingSize = 0;
    this._errorSum = 0;
    this._errorSqSum = 0;
  }

  _nudgeCoefficients(pattern) {
    const profile = COEFFICIENT_PROFILES[pattern] || COEFFICIENT_PROFILES.stable;
    const step = 0.08;
    for (const key of ["kP", "kI", "kD"]) {
      const coeff = this.adaptiveCoefficients[key];
      const target = profile[key];
      coeff.value += (target - coeff.value) * step;
      coeff.value =
        coeff.value < coeff.minValue
          ? coeff.minValue
          : coeff.value > coeff.maxValue
            ? coeff.maxValue
            : coeff.value;
    }
  }

  _applyPlaybackRate(rate) {
    if (!Number.isFinite(rate)) {
      return;
    }
    if (Math.abs(rate - this.lastAppliedRate) < 0.002) {
      return;
    }
    this.video.playbackRate = rate;
    this.lastAppliedRate = rate;
    this._rateChangeTime = performance.now();
  }

  updateSystemMetrics(timeDifference, wallNow) {
    const old = this._errorRing[this._errorRingIdx] || 0;
    this._errorRing[this._errorRingIdx] = timeDifference;
    this._errorRingIdx = (this._errorRingIdx + 1) % 10;
    if (this._errorRingSize < 10) {
      this._errorRingSize++;
    }

    this._errorSum += timeDifference - old;
    this._errorSqSum +=
      timeDifference * timeDifference - old * old;

    const sign =
      timeDifference < -0.003 ? -1 : timeDifference > 0.003 ? 1 : 0;
    if (
      sign !== 0 &&
      this.lastErrorSign !== 0 &&
      sign !== this.lastErrorSign
    ) {
      this.overshoots++;
    }
    if (sign !== 0) {
      this.lastErrorSign = sign;
    }

    if (
      this._rateChangeTime > 0 &&
      Math.abs(timeDifference) < Math.abs(this.lastTimeDifference)
    ) {
      const response = (performance.now() - this._rateChangeTime) / 1000;
      this.avgResponseTime = this.avgResponseTime * 0.8 + response * 0.2;
    }

    if (this.lastWallTime !== null) {
      this.systemLag = wallNow - this.lastWallTime;
    }

    if (this._errorRingSize >= 8) {
      const n = this._errorRingSize;
      const mean = this._errorSum / n;
      const variance = this._errorSqSum / n - mean * mean;
      const prevPattern = this.currentPattern;

      this.currentPattern =
        variance > 0.08 && this.overshoots > 2
          ? this.patterns.OSCILLATING
          : mean > 0.04 || this.avgResponseTime > 0.15
            ? this.patterns.LAGGING
            : this.systemLag > 200 || this.avgResponseTime > 0.25
              ? this.patterns.SYSTEM_STRESS
              : this.patterns.STABLE;

      if (this.currentPattern !== prevPattern) {
        this._nudgeCoefficients(this.currentPattern);
      }
    }
  }

  calculateHistoricalAdjustment(timeDifference, deltaTime) {
    if (
      timeDifference !== timeDifference ||
      deltaTime !== deltaTime ||
      deltaTime <= 0
    ) {
      return 0;
    }

    const dt =
      deltaTime < 0.016 ? 0.016 : deltaTime > 0.5 ? 0.5 : deltaTime;

    this.integral += timeDifference * dt;
    this.integral =
      this.integral < -this.maxIntegralError
        ? -this.maxIntegralError
        : this.integral > this.maxIntegralError
          ? this.maxIntegralError
          : this.integral;

    const derivative = (timeDifference - this.lastTimeDifference) / dt;
    this.lastTimeDifference = timeDifference;

    return (
      this.adaptiveCoefficients.kP.value * timeDifference +
      this.adaptiveCoefficients.kI.value * this.integral +
      this.adaptiveCoefficients.kD.value * derivative
    );
  }

  adjustPlaybackRate(targetTime) {
    const now = performance.now();
    const wallNow = Date.now();
    if (!this.video || this.video.paused || this.video.seeking) {
      return 0;
    }

    const timeDifference = targetTime - this.video.currentTime;
    const timeDifferenceAbs =
      timeDifference < 0 ? -timeDifference : timeDifference;

    if (this.lastWallTime === null) {
      this.lastWallTime = wallNow;
      this.lastUpdateTime = now;
      this.updateSystemMetrics(timeDifference, wallNow);
      return timeDifference;
    }

    const wallTimeDelta = wallNow - this.lastWallTime;
    if (wallTimeDelta > this.maxTimeGap) {
      this.beginPidSeekSuppression();
      this.video.currentTime = targetTime;
      this.lastWallTime = wallNow;
      this.lastUpdateTime = now;
      this.lastAppliedRate = 1;
      this.integral = 0;
      this.lastTimeDifference = 0;
      const seekError = targetTime - this.video.currentTime;
      this.updateSystemMetrics(seekError, wallNow);
      return seekError;
    }

    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;
    this.lastWallTime = wallNow;

    this.updateSystemMetrics(timeDifference, wallNow);

    if (timeDifferenceAbs > this.fastSyncThreshold) {
      const catchUpWindow = deltaTime < 0.08 ? 0.08 : deltaTime;
      let playbackRate;
      if (timeDifference > 0) {
        const calcRate = 1 + timeDifferenceAbs / catchUpWindow;
        playbackRate =
          calcRate > this.maxFastSyncRate ? this.maxFastSyncRate : calcRate;
      } else {
        const calcRate = 1 - timeDifferenceAbs / catchUpWindow;
        const minRate = 1 / this.maxFastSyncRate;
        playbackRate = calcRate < minRate ? minRate : calcRate;
      }
      this._applyPlaybackRate(playbackRate);
      return timeDifference;
    }

    const finalAdjustment = this.calculateHistoricalAdjustment(
      timeDifference,
      deltaTime,
    );

    const maxRate = this.performancePatterns[this.currentPattern].maxRate;
    const minRate = 2 - maxRate;
    let playbackRate = 1.0 + finalAdjustment;

    playbackRate =
      playbackRate < minRate
        ? minRate
        : playbackRate > maxRate
          ? maxRate
          : playbackRate;

    if (timeDifferenceAbs <= this.synchronizationThreshold) {
      playbackRate = 1.0;
      this.integral = 0;
    }

    this._applyPlaybackRate(playbackRate);
    return timeDifference;
  }

  reset() {
    if (!this.isActiveMediaWindow()) {
      return;
    }
    this._initCoefficients(COEFFICIENT_PROFILES.lagging);
    this._resetRuntimeState();
  }
}

export function getHostnameOrBasename(input) {
  const protocolMatch = input.match(/^(\w+):\/\//);

  if (protocolMatch) {
    const protocolEnd = protocolMatch[0].length;
    const remainingPart = input.slice(protocolEnd);
    const firstSlashIndex = remainingPart.indexOf("/");

    return firstSlashIndex === -1
      ? remainingPart
      : remainingPart.slice(0, firstSlashIndex);
  }

  const lastForwardSlash = input.lastIndexOf("/");
  const lastBackSlash = input.lastIndexOf("\\");
  const lastSeparator = Math.max(lastForwardSlash, lastBackSlash);
  return lastSeparator === -1 ? input : input.slice(lastSeparator + 1);
}

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const TRANSPORT_TIME_DIGITS = Array.from({ length: 10 }, (_, digit) => String(digit));
const transportTimeStateByEl = new WeakMap();

/**
 * Build M:SS display from cached digit strings (minutes text + ":" + two
 * second digits). Minutes use textContent only when the minute value
 * changes; seconds use fixed single-character strings from TRANSPORT_TIME_DIGITS.
 */
export function bindTransportTimeDisplay(displayEl) {
  if (!displayEl) {
    return null;
  }
  const existing = transportTimeStateByEl.get(displayEl);
  if (existing) {
    return existing;
  }

  displayEl.textContent = "";
  const minEl = document.createElement("span");
  minEl.className = "transport-time-min";
  const colon = document.createTextNode(":");
  const secTensEl = document.createElement("span");
  secTensEl.className = "transport-time-sec-digit";
  const secOnesEl = document.createElement("span");
  secOnesEl.className = "transport-time-sec-digit";
  displayEl.appendChild(minEl);
  displayEl.appendChild(colon);
  displayEl.appendChild(secTensEl);
  displayEl.appendChild(secOnesEl);

  const state = {
    minEl,
    secTensEl,
    secOnesEl,
    lastMinute: -1,
    lastSecTens: -1,
    lastSecOnes: -1,
  };
  transportTimeStateByEl.set(displayEl, state);
  paintTransportTimeDisplay(displayEl, 0, state);
  return state;
}

export function paintTransportTimeDisplay(displayEl, seconds, state = null) {
  if (!displayEl) {
    return;
  }
  const st =
    state ?? transportTimeStateByEl.get(displayEl) ?? bindTransportTimeDisplay(displayEl);
  if (!st) {
    return;
  }

  let safeSeconds = seconds;
  if (!Number.isFinite(safeSeconds) || safeSeconds < 0) {
    safeSeconds = 0;
  }

  const totalSec = Math.floor(safeSeconds);
  const minutes = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const tens = Math.floor(sec / 10);
  const ones = sec % 10;

  if (st.lastMinute !== minutes) {
    st.minEl.textContent = String(minutes);
    st.lastMinute = minutes;
  }
  if (st.lastSecTens !== tens) {
    st.secTensEl.textContent = TRANSPORT_TIME_DIGITS[tens];
    st.lastSecTens = tens;
  }
  if (st.lastSecOnes !== ones) {
    st.secOnesEl.textContent = TRANSPORT_TIME_DIGITS[ones];
    st.lastSecOnes = ones;
  }
}
