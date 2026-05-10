/*
Copyright (C) 2025 Christian Lockley

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

// Tiny startup profiler for the main process.
// Activated only when the EMS_PROFILE env var is set to "1".
// Used to measure how much of cold-start could plausibly be saved by a
// custom V8 startup snapshot. The "uptime at first JS" mark below is the
// upper bound of that potential saving (everything before user JS ran is
// Electron / Node / V8 init, which a snapshot can shrink).

const enabled = process.env.EMS_PROFILE === "1";

// Captured as the very first thing this module does.
const moduleEvalStartHrtime = process.hrtime.bigint();
const moduleEvalStartUptimeMs = process.uptime() * 1000;

const marks = [];

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function fmtMs(ms) {
  return ms.toFixed(2).padStart(8) + " ms";
}

export function mark(name) {
  if (!enabled) return;
  const elapsedMs = Number(process.hrtime.bigint() - moduleEvalStartHrtime) / 1e6;
  const uptimeMs = process.uptime() * 1000;
  marks.push({ name, elapsedMs, uptimeMs });
  console.log(
    `[profile] ${pad(name, 40)} +${fmtMs(elapsedMs)}  (uptime ${fmtMs(uptimeMs)})`,
  );
}

export function report() {
  if (!enabled) return;
  console.log("");
  console.log("[profile] -------- startup summary --------");
  console.log(
    `[profile] process uptime when profiler loaded:        ${fmtMs(moduleEvalStartUptimeMs)}`,
  );
  console.log(
    `[profile]   ^ this is the time spent in Electron/Node/V8 init`,
  );
  console.log(
    `[profile]     before any application JS ran. A custom V8`,
  );
  console.log(
    `[profile]     startup snapshot can only shave time off this.`,
  );
  console.log("[profile]");
  console.log("[profile] phase timings (relative to first JS line):");
  for (const m of marks) {
    console.log(`[profile]   ${pad(m.name, 40)} +${fmtMs(m.elapsedMs)}`);
  }
  if (marks.length >= 2) {
    console.log("[profile]");
    console.log("[profile] phase deltas:");
    for (let i = 1; i < marks.length; i++) {
      const dt = marks[i].elapsedMs - marks[i - 1].elapsedMs;
      console.log(
        `[profile]   ${pad(marks[i - 1].name + " -> " + marks[i].name, 60)} ${fmtMs(dt)}`,
      );
    }
  }
  console.log("[profile] ---------------------------------");
}

export const profileEnabled = enabled;

if (enabled) {
  console.log(
    `[profile] dev-profiler active. Process uptime at first JS = ${fmtMs(moduleEvalStartUptimeMs)}`,
  );
}
