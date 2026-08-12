import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { dlopen, FFIType, read } from "bun:ffi";

import { Refusal } from "./errors";

const isDarwin = process.platform === "darwin";

if (!isDarwin && process.platform !== "linux") {
  throw new Error(`writer locks are unsupported on ${process.platform}`);
}

const flockSignature = {
  args: [FFIType.i32, FFIType.i32],
  returns: FFIType.i32,
} as const;
const errnoSignature = {
  args: [],
  returns: FFIType.ptr,
} as const;
const native = isDarwin
  ? (() => {
      const library = dlopen("/usr/lib/libSystem.B.dylib", {
        flock: flockSignature,
        __error: errnoSignature,
      });
      return {
        library,
        flock: library.symbols.flock,
        errnoLocation: library.symbols.__error,
      };
    })()
  : (() => {
      const library = dlopen("libc.so.6", {
        flock: flockSignature,
        __errno_location: errnoSignature,
      });
      return {
        library,
        flock: library.symbols.flock,
        errnoLocation: library.symbols.__errno_location,
      };
    })();

const LOCK_EX = 2;
const LOCK_NB = 4;
const O_CLOEXEC = isDarwin ? 0x01000000 : 0x00080000;

class WriterLockedError extends Refusal {
  readonly databasePath: string;

  constructor(databasePath: string) {
    super("WRITER_LOCKED", `campaign already has a writer: ${databasePath}`, {
      operation: "open-campaign",
    });
    this.databasePath = databasePath;
  }
}

interface WriterLock {
  close(): void;
}

function canonicalDatabasePath(databasePath: string): string {
  if (databasePath.includes("\0")) {
    throw new TypeError("database path contains NUL");
  }

  const absolutePath = resolve(databasePath);

  try {
    const status = lstatSync(absolutePath);
    if (status.isSymbolicLink()) {
      throw new Refusal(
        "INVALID_ARGUMENT",
        `database path cannot be a symbolic link: ${absolutePath}`,
        { operation: "open-campaign" },
      );
    }
    if (!status.isFile()) {
      throw new Refusal(
        "INVALID_ARGUMENT",
        `database path is not a regular file: ${absolutePath}`,
        { operation: "open-campaign" },
      );
    }
    if (status.nlink !== 1) {
      throw new Refusal(
        "INVALID_ARGUMENT",
        `database path has ${status.nlink} hard links; Elenx requires exactly one: ${absolutePath}`,
        { operation: "open-campaign" },
      );
    }
    return realpathSync(absolutePath);
  } catch (error) {
    if (!isErrorWithCode(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return join(realpathSync(dirname(absolutePath)), basename(absolutePath));
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

function lastErrno(): number {
  const pointer = native.errnoLocation();

  if (pointer === null) {
    throw new Error("libc returned a null errno pointer");
  }

  return read.i32(pointer, 0);
}

export function acquireWriterLock(databasePath: string): WriterLock {
  const canonicalPath = canonicalDatabasePath(databasePath);
  const lockPath = `${canonicalPath}.writer-lock`;
  const fd = openSync(
    lockPath,
    fsConstants.O_CREAT |
      fsConstants.O_RDWR |
      fsConstants.O_NOFOLLOW |
      O_CLOEXEC,
    0o600,
  );

  const lockStatus = fstatSync(fd);
  if (!lockStatus.isFile()) {
    closeSync(fd);
    throw new Refusal(
      "INVALID_ARGUMENT",
      `writer lock path is not a regular file: ${lockPath}`,
      { operation: "open-campaign" },
    );
  }

  if (native.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    const errno = lastErrno();
    closeSync(fd);

    if (errno === osConstants.errno.EAGAIN) {
      throw new WriterLockedError(canonicalPath);
    }

    throw new Error(`flock(${lockPath}) failed with errno ${errno}`);
  }

  let closed = false;

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      closeSync(fd);
    },
  };
}
