export class PIDController {
  constructor(video, callbacks = {}) {
    this.video = video;
    this.isActiveMediaWindow = callbacks.isActiveMediaWindow || (() => false);
    this.beginPidSeekSuppression =
      callbacks.beginPidSeekSuppression || (() => {});

    this.adaptiveCoefficients = {
      kP: {
        value: 0.5,
        minValue: 0.2,
        maxValue: 0.8,
        adjustmentRate: 0.005,
      },
      kI: {
        value: 0.05,
        minValue: 0.01,
        maxValue: 0.15,
        adjustmentRate: 0.0025,
      },
      kD: {
        value: 0.15,
        minValue: 0.08,
        maxValue: 0.25,
        adjustmentRate: 0.005,
      },
    };

    this.patterns = {
      STABLE: "stable",
      OSCILLATING: "oscillating",
      LAGGING: "lagging",
      SYSTEM_STRESS: "systemStress",
    };

    this.performancePatterns = {
      [this.patterns.STABLE]: {
        maxRate: 1.1,
        threshold: 0.033,
      },
      [this.patterns.OSCILLATING]: {
        maxRate: 1.05,
        threshold: 0.05,
      },
      [this.patterns.LAGGING]: {
        maxRate: 1.2,
        threshold: 0.066,
      },
      [this.patterns.SYSTEM_STRESS]: {
        maxRate: 1.05,
        threshold: 0.1,
      },
    };

    this.systemLag = 0;
    this.overshoots = 0;
    this.avgResponseTime = 0;
    this.currentPattern = this.patterns.STABLE;

    this.lastWallTime = null;
    this.maxTimeGap = 1000;

    this.synchronizationThreshold = 0.005;
    this.maxIntegralError = 0.5;
    this.fastSyncThreshold = 1;
    this.maxFastSyncRate = 2;

    this.maxHistoryLength = 32;
    this.isFirstAdjustment = true;

    this.timeArray = new Float64Array(this.maxHistoryLength);
    this.diffArray = new Float64Array(this.maxHistoryLength);
    this.responseArray = new Float64Array(this.maxHistoryLength);
    this.historyIndex = 0;
    this.historySize = 0;
    this.MASK = 31;
    this.TREND_MASK = 15;
    this._trendBuffer = new Float64Array(16);
    this._trendPos = 0;

    this._rollingSum = 0;
    this._rollingSquareSum = 0;
    this._rollingTrend = 0;
  }

  updateSystemMetrics(timeDifference, timestamp) {
    const oldDiff = this.diffArray[this.historyIndex] || 0;

    this.timeArray[this.historyIndex] = timestamp;
    this.diffArray[this.historyIndex] = timeDifference;
    this.responseArray[this.historyIndex] =
      this.historySize > 0
        ? timestamp - this.timeArray[(this.historyIndex - 1) & this.MASK]
        : 0;

    this.historyIndex = (this.historyIndex + 1) & this.MASK;
    if (this.historySize < this.maxHistoryLength) this.historySize++;

    if (this.historySize >= 10) {
      const pos = this._trendPos;
      const prevIndex = (pos - 1 + 16) & this.TREND_MASK;
      const prev = this._trendBuffer[prevIndex] || 0;
      const replaced = this._trendBuffer[pos];
      this._trendBuffer[pos] = timeDifference;
      this._trendPos = (pos + 1) & this.TREND_MASK;

      this._rollingSum += timeDifference - oldDiff;
      this._rollingSquareSum +=
        timeDifference * timeDifference - oldDiff * oldDiff;
      this._rollingTrend += timeDifference - prev - (replaced - prev);

      const mean = this._rollingSum / 10;
      const variance = this._rollingSquareSum / 10 - mean * mean;
      const trend = this._rollingTrend / 9;

      this.currentPattern =
        variance > 0.1 && this.overshoots > 3
          ? this.patterns.OSCILLATING
          : trend > 0.05 || this.avgResponseTime > 0.15
            ? this.patterns.LAGGING
            : this.systemLag > 100 || this.avgResponseTime > 0.2
              ? this.patterns.SYSTEM_STRESS
              : this.patterns.STABLE;
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
    this.integral += timeDifference * deltaTime;
    this.integral =
      this.integral < -this.maxIntegralError
        ? -this.maxIntegralError
        : this.integral > this.maxIntegralError
          ? this.maxIntegralError
          : this.integral;

    const derivative = (timeDifference - this.lastTimeDifference) / deltaTime;
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
      return;
    }

    if (this.isFirstAdjustment || this.lastWallTime === null) {
      this.lastWallTime = wallNow;
      this.lastUpdateTime = now;
      this.isFirstAdjustment = false;
      const timeDifference = targetTime - this.video.currentTime;
      this.updateSystemMetrics(timeDifference, wallNow);
      return timeDifference;
    }

    const wallTimeDelta = wallNow - this.lastWallTime;

    if (wallTimeDelta > this.maxTimeGap) {
      this.beginPidSeekSuppression();
      this.video.currentTime = targetTime;
      this.lastWallTime = wallNow;
      this.isFirstAdjustment = false;
      const timeDifference = targetTime - this.video.currentTime;
      this.updateSystemMetrics(timeDifference, wallNow);
      return timeDifference;
    }

    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;
    this.lastWallTime = wallNow;

    const timeDifference = targetTime - this.video.currentTime;
    const timeDifferenceAbs =
      timeDifference < 0 ? -timeDifference : timeDifference;

    this.updateSystemMetrics(timeDifference, wallNow);

    const finalAdjustment = this.calculateHistoricalAdjustment(
      timeDifference,
      deltaTime,
    );

    if (timeDifferenceAbs > this.fastSyncThreshold) {
      let playbackRate;
      if (timeDifference > 0) {
        const calcRate = 1 + timeDifferenceAbs / deltaTime;
        playbackRate =
          calcRate > this.maxFastSyncRate ? this.maxFastSyncRate : calcRate;
      } else {
        const calcRate = 1 - timeDifferenceAbs / deltaTime;
        const minRate = 1 / this.maxFastSyncRate;
        playbackRate = calcRate < minRate ? minRate : calcRate;
      }
      this.video.playbackRate = playbackRate;
      return timeDifference;
    }

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

    if (playbackRate >= 0 || playbackRate <= 0) {
      this.video.playbackRate = playbackRate;
    }

    return timeDifference;
  }

  reset() {
    if (!this.isActiveMediaWindow()) {
      return;
    }
    this.lastError = 0;
    this.integral = 0;
    this.lastTimeDifference = 0;
    this.lastUpdateTime = performance.now();
    this.isFirstAdjustment = true;
    this.lastWallTime = null;

    this.historyIndex = 0;
    this.historySize = 0;

    this.systemLag = 0;
    this.overshoots = 0;
    this.avgResponseTime = 0;
    this.currentPattern = this.patterns.STABLE;

    this.adaptiveCoefficients = {
      kP: {
        value: 0.6,
        minValue: 0.3,
        maxValue: 0.9,
        adjustmentRate: 0.01,
      },
      kI: {
        value: 0.08,
        minValue: 0.02,
        maxValue: 0.2,
        adjustmentRate: 0.005,
      },
      kD: {
        value: 0.12,
        minValue: 0.05,
        maxValue: 0.2,
        adjustmentRate: 0.01,
      },
    };
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
