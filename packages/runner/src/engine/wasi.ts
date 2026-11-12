/**
 * A minimal WASI preview1 runtime for programs compiled by clang to wasm32-wasi: stdin from a
 * string, stdout/stderr to callbacks, a clock and random numbers. No files, no network, no fork.
 */

const ESUCCESS = 0;
const EBADF = 8;
const ENOSYS = 52;
const ESPIPE = 70;
const FILETYPE_CHARACTER_DEVICE = 2;
const RIGHTS_FD_READ = 2n;
const RIGHTS_FD_WRITE = 64n;

export class ProcExit extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

export interface WasiOptions {
  stdin: string;
  stdout: (bytes: Uint8Array) => void;
  stderr: (bytes: Uint8Array) => void;
  args?: string[];
}

export class Wasi {
  memory: WebAssembly.Memory | null = null;
  private stdin: Uint8Array;
  private stdinPos = 0;

  constructor(private readonly opts: WasiOptions) {
    this.stdin = new TextEncoder().encode(opts.stdin);
  }

  private view() {
    return new DataView((this.memory as WebAssembly.Memory).buffer);
  }

  private bytes() {
    return new Uint8Array((this.memory as WebAssembly.Memory).buffer);
  }

  private iovs(ptr: number, len: number): { buf: number; len: number }[] {
    const v = this.view();
    return Array.from({ length: len }, (_, i) => ({
      buf: v.getUint32(ptr + i * 8, true),
      len: v.getUint32(ptr + i * 8 + 4, true),
    }));
  }

  private stringsSizes(list: string[], countPtr: number, sizePtr: number) {
    const v = this.view();
    v.setUint32(countPtr, list.length, true);
    v.setUint32(
      sizePtr,
      list.reduce((n, s) => n + new TextEncoder().encode(s).length + 1, 0),
      true,
    );
    return ESUCCESS;
  }

  private stringsGet(list: string[], ptrs: number, buf: number) {
    const v = this.view();
    const b = this.bytes();
    let at = buf;
    list.forEach((s, i) => {
      v.setUint32(ptrs + i * 4, at, true);
      const enc = new TextEncoder().encode(s);
      b.set(enc, at);
      b[at + enc.length] = 0;
      at += enc.length + 1;
    });
    return ESUCCESS;
  }

  imports(): Record<string, WebAssembly.ImportValue> {
    const args = this.opts.args ?? ['main'];
    const impl: Record<string, (...a: never[]) => number | void> = {
      args_sizes_get: (c: number, s: number) => this.stringsSizes(args, c, s),
      args_get: (p: number, b: number) => this.stringsGet(args, p, b),
      environ_sizes_get: (c: number, s: number) => this.stringsSizes([], c, s),
      environ_get: (p: number, b: number) => this.stringsGet([], p, b),
      fd_write: (fd: number, iovs: number, len: number, written: number) => {
        if (fd !== 1 && fd !== 2) return EBADF;
        let n = 0;
        const b = this.bytes();
        for (const io of this.iovs(iovs, len)) {
          const chunk = b.slice(io.buf, io.buf + io.len);
          (fd === 1 ? this.opts.stdout : this.opts.stderr)(chunk);
          n += io.len;
        }
        this.view().setUint32(written, n, true);
        return ESUCCESS;
      },
      fd_read: (fd: number, iovs: number, len: number, read: number) => {
        if (fd !== 0) return EBADF;
        let n = 0;
        const b = this.bytes();
        for (const io of this.iovs(iovs, len)) {
          const take = Math.min(io.len, this.stdin.length - this.stdinPos);
          b.set(this.stdin.subarray(this.stdinPos, this.stdinPos + take), io.buf);
          this.stdinPos += take;
          n += take;
          if (take < io.len) break;
        }
        this.view().setUint32(read, n, true);
        return ESUCCESS;
      },
      fd_fdstat_get: (fd: number, ptr: number) => {
        if (fd > 2) return EBADF;
        // A character device without seek rights: libc treats it as a terminal, so stdout is
        // line buffered exactly like in a real shell.
        const v = this.view();
        v.setUint8(ptr, FILETYPE_CHARACTER_DEVICE);
        v.setUint16(ptr + 2, 0, true);
        v.setBigUint64(ptr + 8, fd === 0 ? RIGHTS_FD_READ : RIGHTS_FD_WRITE, true);
        v.setBigUint64(ptr + 16, 0n, true);
        return ESUCCESS;
      },
      fd_fdstat_set_flags: () => ESUCCESS,
      fd_seek: () => ESPIPE,
      fd_close: () => ESUCCESS,
      fd_sync: () => ESUCCESS,
      fd_prestat_get: () => EBADF,
      fd_prestat_dir_name: () => EBADF,
      path_open: () => ENOSYS,
      proc_exit: (code: number) => {
        throw new ProcExit(code);
      },
      sched_yield: () => ESUCCESS,
      clock_res_get: (_id: number, ptr: number) => {
        this.view().setBigUint64(ptr, 1000n, true);
        return ESUCCESS;
      },
      clock_time_get: (id: number, _precision: bigint, ptr: number) => {
        const ms = id === 0 ? Date.now() : performance.now();
        this.view().setBigUint64(ptr, BigInt(Math.round(ms * 1e6)), true);
        return ESUCCESS;
      },
      random_get: (buf: number, len: number) => {
        crypto.getRandomValues(this.bytes().subarray(buf, buf + len));
        return ESUCCESS;
      },
      poll_oneoff: () => ENOSYS,
    };
    return new Proxy(impl as Record<string, WebAssembly.ImportValue>, {
      get: (target, name: string) => target[name] ?? (() => ENOSYS),
    });
  }
}

/**
 * Instantiates and runs a WASI command module. Returns the exit code; a trap (out-of-bounds memory,
 * stack overflow, the trace step limit…) is rethrown for the caller to report.
 */
export async function runWasi(
  wasm: Uint8Array,
  wasi: Wasi,
  extra: Record<string, Record<string, WebAssembly.ImportValue>> = {},
): Promise<number> {
  const module = await WebAssembly.compile(wasm as BufferSource);
  // Every import the module asks for must exist: give it the WASI functions plus `extra`.
  const imports: WebAssembly.Imports = { wasi_snapshot_preview1: wasi.imports(), ...extra };
  const instance = await WebAssembly.instantiate(module, imports);
  wasi.memory = instance.exports.memory as WebAssembly.Memory;
  try {
    (instance.exports._start as () => void)();
    return 0;
  } catch (e) {
    if (e instanceof ProcExit) return e.code;
    throw e;
  }
}
