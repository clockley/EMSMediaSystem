// Copyright 2018 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

"use strict";

(() => {
	// Pre-create reusable error object
	const enosysError = (() => {
		const err = new Error("not implemented");
		err.code = "ENOSYS";
		return err;
	})();

	// Create encoder/decoder once globally
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// Constants
	const NAN_HEAD = 0x7FF80000;
	const WASM_MIN_DATA_ADDR = 12288; // 4096 + 8192
	const ALIGN_MASK = ~7; // For 8-byte alignment

	// Fast global scope access
	const { Reflect, Date, performance, console, crypto, setTimeout, clearTimeout, isNaN, parseInt, String } = globalThis;

	// Lazy initialization for fs and process
	if (!globalThis.fs) {
		let outputBuf = "";
		const enosys = () => enosysError;

		globalThis.fs = {
			constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1 },
			writeSync(fd, buf) {
				outputBuf += decoder.decode(buf);
				const nl = outputBuf.lastIndexOf("\n");
				if (nl !== -1) {
					console.log(outputBuf.substring(0, nl));
					outputBuf = outputBuf.substring(nl + 1);
				}
				return buf.length;
			},
			write(fd, buf, offset, length, position, callback) {
				if (offset !== 0 || length !== buf.length || position !== null) {
					callback(enosys());
					return;
				}
				callback(null, this.writeSync(fd, buf));
			},
			// Batch assign no-op functions
			...Object.fromEntries([
				'chmod', 'chown', 'close', 'fchmod', 'fchown', 'fstat', 'ftruncate',
				'lchown', 'link', 'lstat', 'mkdir', 'open', 'read', 'readdir', 'readlink',
				'rename', 'rmdir', 'stat', 'symlink', 'truncate', 'unlink', 'utimes'
			].map(fn => [fn, (a, b, c, callback) => callback(enosys())])),
			fsync(fd, callback) { callback(null); }
		};
	}

	if (!globalThis.process) {
		globalThis.process = {
			getuid: () => -1,
			getgid: () => -1,
			geteuid: () => -1,
			getegid: () => -1,
			getgroups() { throw enosysError; },
			pid: -1,
			ppid: -1,
			umask() { throw enosysError; },
			cwd() { throw enosysError; },
			chdir() { throw enosysError; }
		};
	}

	// Pre-calculate time origin
	const timeOrigin = Date.now() - performance.now();

	// Optimized helper functions outside class to avoid method lookup overhead
	const setInt64 = (mem, addr, v) => {
		mem.setUint32(addr, v, true);
		mem.setUint32(addr + 4, Math.floor(v * 2.3283064365386963e-10), true); // 1/4294967296
	};

	const getInt64 = (mem, addr) => {
		return mem.getUint32(addr, true) + mem.getInt32(addr + 4, true) * 4294967296;
	};

	const loadValue = (mem, values, addr) => {
		const f = mem.getFloat64(addr, true);
		return f === 0 ? undefined : (!isNaN(f) ? f : values[mem.getUint32(addr, true)]);
	};

	const storeValue = (mem, values, goRefCounts, ids, idPool, addr, v) => {
		const vType = typeof v;
		if (vType === "number" && v !== 0) {
			if (isNaN(v)) {
				mem.setUint32(addr + 4, NAN_HEAD, true);
				mem.setUint32(addr, 0, true);
			} else {
				mem.setFloat64(addr, v, true);
			}
			return;
		}

		if (v === undefined) {
			mem.setFloat64(addr, 0, true);
			return;
		}

		let id = ids.get(v);
		if (id === undefined) {
			id = idPool.pop() || values.length;
			values[id] = v;
			goRefCounts[id] = 0;
			ids.set(v, id);
		}
		goRefCounts[id]++;

		let typeFlag = 0;
		if (vType === "object" && v !== null) typeFlag = 1;
		else if (vType === "string") typeFlag = 2;
		else if (vType === "symbol") typeFlag = 3;
		else if (vType === "function") typeFlag = 4;

		mem.setUint32(addr + 4, NAN_HEAD | typeFlag, true);
		mem.setUint32(addr, id, true);
	};

	const loadSlice = (mem, instExports, addr) => {
		const array = getInt64(mem, addr);
		const len = getInt64(mem, addr + 8);
		return new Uint8Array(instExports.mem.buffer, array, len);
	};

	const loadSliceOfValues = (mem, values, addr) => {
		const array = getInt64(mem, addr);
		const len = getInt64(mem, addr + 8);
		const result = new Array(len);
		for (let i = 0; i < len; i++) {
			result[i] = loadValue(mem, values, array + (i << 3));
		}
		return result;
	};

	const loadString = (mem, instExports, addr) => {
		const saddr = getInt64(mem, addr);
		const len = getInt64(mem, addr + 8);
		return decoder.decode(new DataView(instExports.mem.buffer, saddr, len));
	};

	globalThis.Go = class {
		constructor() {
			this.argv = ["js"];
			this.env = {};
			this.exit = (code) => {
				if (code !== 0) console.warn("exit code:", code);
			};
			this._exitPromise = new Promise(resolve => this._resolveExitPromise = resolve);
			this._pendingEvent = null;
			this._scheduledTimeouts = new Map();
			this._nextCallbackTimeoutID = 1;

			// Pre-create import object with minimal closures
			this.importObject = {
				_gotest: { add: (a, b) => a + b },
				gojs: this._createGoJSImports()
			};
		}

		_createGoJSImports() {
			return {
				"runtime.wasmExit": (sp) => {
					sp >>>= 0;
					const code = this.mem.getInt32(sp + 8, true);
					this.exited = true;
					this._cleanup();
					this.exit(code);
				},

				"runtime.wasmWrite": (sp) => {
					sp >>>= 0;
					const fd = getInt64(this.mem, sp + 8);
					const p = getInt64(this.mem, sp + 16);
					const n = this.mem.getInt32(sp + 24, true);
					globalThis.fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n));
				},

				"runtime.resetMemoryDataView": (sp) => {
					this.mem = new DataView(this._inst.exports.mem.buffer);
				},

				"runtime.nanotime1": (sp) => {
					sp >>>= 0;
					setInt64(this.mem, sp + 8, (timeOrigin + performance.now()) * 1000000);
				},

				"runtime.walltime": (sp) => {
					sp >>>= 0;
					const msec = Date.now();
					setInt64(this.mem, sp + 8, msec / 1000);
					this.mem.setInt32(sp + 16, (msec % 1000) * 1000000, true);
				},

				"runtime.scheduleTimeoutEvent": (sp) => {
					sp >>>= 0;
					const id = this._nextCallbackTimeoutID++;
					const delay = getInt64(this.mem, sp + 8);
					this._scheduledTimeouts.set(id, setTimeout(() => {
						this._resume();
						while (this._scheduledTimeouts.has(id)) {
							console.warn("scheduleTimeoutEvent: missed timeout event");
							this._resume();
						}
					}, delay));
					this.mem.setInt32(sp + 16, id, true);
				},

				"runtime.clearTimeoutEvent": (sp) => {
					sp >>>= 0;
					const id = this.mem.getInt32(sp + 8, true);
					clearTimeout(this._scheduledTimeouts.get(id));
					this._scheduledTimeouts.delete(id);
				},

				"runtime.getRandomData": (sp) => {
					sp >>>= 0;
					crypto.getRandomValues(loadSlice(this.mem, this._inst.exports, sp + 8));
				},

				"syscall/js.finalizeRef": (sp) => {
					sp >>>= 0;
					const id = this.mem.getUint32(sp + 8, true);
					if (--this._goRefCounts[id] === 0) {
						const v = this._values[id];
						this._values[id] = null;
						this._ids.delete(v);
						this._idPool.push(id);
					}
				},

				"syscall/js.stringVal": (sp) => {
					sp >>>= 0;
					storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 24,
						loadString(this.mem, this._inst.exports, sp + 8));
				},

				"syscall/js.valueGet": (sp) => {
					sp >>>= 0;
					const result = Reflect.get(loadValue(this.mem, this._values, sp + 8),
						loadString(this.mem, this._inst.exports, sp + 16));
					sp = this._inst.exports.getsp() >>> 0;
					storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 32, result);
				},

				"syscall/js.valueSet": (sp) => {
					sp >>>= 0;
					Reflect.set(loadValue(this.mem, this._values, sp + 8),
						loadString(this.mem, this._inst.exports, sp + 16),
						loadValue(this.mem, this._values, sp + 32));
				},

				"syscall/js.valueDelete": (sp) => {
					sp >>>= 0;
					Reflect.deleteProperty(loadValue(this.mem, this._values, sp + 8),
						loadString(this.mem, this._inst.exports, sp + 16));
				},

				"syscall/js.valueIndex": (sp) => {
					sp >>>= 0;
					storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 24,
						Reflect.get(loadValue(this.mem, this._values, sp + 8), getInt64(this.mem, sp + 16)));
				},

				"syscall/js.valueSetIndex": (sp) => {
					sp >>>= 0;
					Reflect.set(loadValue(this.mem, this._values, sp + 8),
						getInt64(this.mem, sp + 16),
						loadValue(this.mem, this._values, sp + 24));
				},

				"syscall/js.valueCall": (sp) => {
					sp >>>= 0;
					try {
						const v = loadValue(this.mem, this._values, sp + 8);
						const m = Reflect.get(v, loadString(this.mem, this._inst.exports, sp + 16));
						const args = loadSliceOfValues(this.mem, this._values, sp + 32);
						const result = Reflect.apply(m, v, args);
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 56, result);
						this.mem.setUint8(sp + 64, 1);
					} catch (err) {
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 56, err);
						this.mem.setUint8(sp + 64, 0);
					}
				},

				"syscall/js.valueInvoke": (sp) => {
					sp >>>= 0;
					try {
						const v = loadValue(this.mem, this._values, sp + 8);
						const args = loadSliceOfValues(this.mem, this._values, sp + 16);
						const result = Reflect.apply(v, undefined, args);
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 40, result);
						this.mem.setUint8(sp + 48, 1);
					} catch (err) {
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 40, err);
						this.mem.setUint8(sp + 48, 0);
					}
				},

				"syscall/js.valueNew": (sp) => {
					sp >>>= 0;
					try {
						const v = loadValue(this.mem, this._values, sp + 8);
						const args = loadSliceOfValues(this.mem, this._values, sp + 16);
						const result = Reflect.construct(v, args);
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 40, result);
						this.mem.setUint8(sp + 48, 1);
					} catch (err) {
						sp = this._inst.exports.getsp() >>> 0;
						storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 40, err);
						this.mem.setUint8(sp + 48, 0);
					}
				},

				"syscall/js.valueLength": (sp) => {
					sp >>>= 0;
					setInt64(this.mem, sp + 16, parseInt(loadValue(this.mem, this._values, sp + 8).length));
				},

				"syscall/js.valuePrepareString": (sp) => {
					sp >>>= 0;
					const str = encoder.encode(String(loadValue(this.mem, this._values, sp + 8)));
					storeValue(this.mem, this._values, this._goRefCounts, this._ids, this._idPool, sp + 16, str);
					setInt64(this.mem, sp + 24, str.length);
				},

				"syscall/js.valueLoadString": (sp) => {
					sp >>>= 0;
					loadSlice(this.mem, this._inst.exports, sp + 16).set(loadValue(this.mem, this._values, sp + 8));
				},

				"syscall/js.valueInstanceOf": (sp) => {
					sp >>>= 0;
					this.mem.setUint8(sp + 24,
						loadValue(this.mem, this._values, sp + 8) instanceof loadValue(this.mem, this._values, sp + 16) ? 1 : 0);
				},

				"syscall/js.copyBytesToGo": (sp) => {
					sp >>>= 0;
					const dst = loadSlice(this.mem, this._inst.exports, sp + 8);
					const src = loadValue(this.mem, this._values, sp + 32);
					if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
						this.mem.setUint8(sp + 48, 0);
						return;
					}
					const toCopy = src.subarray(0, dst.length);
					dst.set(toCopy);
					setInt64(this.mem, sp + 40, toCopy.length);
					this.mem.setUint8(sp + 48, 1);
				},

				"syscall/js.copyBytesToJS": (sp) => {
					sp >>>= 0;
					const dst = loadValue(this.mem, this._values, sp + 8);
					const src = loadSlice(this.mem, this._inst.exports, sp + 16);
					if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
						this.mem.setUint8(sp + 48, 0);
						return;
					}
					const toCopy = src.subarray(0, dst.length);
					dst.set(toCopy);
					setInt64(this.mem, sp + 40, toCopy.length);
					this.mem.setUint8(sp + 48, 1);
				},

				"debug": console.log
			};
		}

		async run(instance) {
			if (!(instance instanceof WebAssembly.Instance)) {
				throw new Error("Go.run: WebAssembly.Instance expected");
			}

			this._inst = instance;
			this.mem = new DataView(instance.exports.mem.buffer);

			// Initialize with pre-sized arrays for better performance
			this._values = [NaN, 0, null, true, false, globalThis, this];
			this._goRefCounts = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
			this._ids = new Map([[0, 1], [null, 2], [true, 3], [false, 4], [globalThis, 5], [this, 6]]);
			this._idPool = [];
			this.exited = false;

			// Fast command line setup
			let offset = 4096;
			const argvPtrs = [];

			// Optimized string pointer creation
			for (const arg of this.argv) {
				const ptr = offset;
				const bytes = encoder.encode(arg + "\0");
				new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
				offset = (offset + bytes.length + 7) & ALIGN_MASK;
				argvPtrs.push(ptr);
			}
			argvPtrs.push(0);

			// Environment variables
			const envKeys = Object.keys(this.env);
			if (envKeys.length > 0) {
				envKeys.sort();
				for (const key of envKeys) {
					const ptr = offset;
					const bytes = encoder.encode(`${key}=${this.env[key]}\0`);
					new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
					offset = (offset + bytes.length + 7) & ALIGN_MASK;
					argvPtrs.push(ptr);
				}
			}
			argvPtrs.push(0);

			const argv = offset;
			for (let i = 0; i < argvPtrs.length; i++) {
				const ptrOffset = offset + (i << 3);
				this.mem.setUint32(ptrOffset, argvPtrs[i], true);
				this.mem.setUint32(ptrOffset + 4, 0, true);
			}
			offset += argvPtrs.length << 3;

			if (offset >= WASM_MIN_DATA_ADDR) {
				throw new Error("total length of command line and environment variables exceeds limit");
			}

			instance.exports.run(this.argv.length, argv);
			if (this.exited) this._resolveExitPromise();
			await this._exitPromise;
		}

		_cleanup() {
			delete this._inst;
			delete this._values;
			delete this._goRefCounts;
			delete this._ids;
			delete this._idPool;
		}

		_resume() {
			if (this.exited) {
				throw new Error("Go program has already exited");
			}
			this._inst.exports.resume();
			if (this.exited) this._resolveExitPromise();
		}

		_makeFuncWrapper(id) {
			const go = this;
			return function () {
				const event = { id, this: this, args: arguments };
				go._pendingEvent = event;
				go._resume();
				return event.result;
			};
		}
	};
})();