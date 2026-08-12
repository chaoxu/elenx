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

import { Defect, Refusal } from "./errors";

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

type CampaignLockOperation = "create-campaign" | "open-campaign";

class WriterLockedError extends Refusal {
  readonly databasePath: string;

  constructor(databasePath: string, operation: CampaignLockOperation) {
    super("WRITER_LOCKED", `campaign already has a writer: ${databasePath}`, {
      operation,
    });
    this.databasePath = databasePath;
  }
}

interface WriterLock {
  close(): void;
}

function invalidPath(
  operation: CampaignLockOperation,
  message: string,
): Refusal {
  return new Refusal("INVALID_ARGUMENT", message, { operation });
}

function pathError(
  operation: CampaignLockOperation,
  subject: string,
  path: string,
  error: unknown,
): never {
  if (error instanceof Refusal || error instanceof Defect) {
    throw error;
  }

  const code = isErrorWithCode(error) ? error.code : undefined;
  if (
    code === undefined ||
    !["EDQUOT", "EIO", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC"].includes(code)
  ) {
    const suffix = code === undefined ? "" : ` (${code})`;
    throw invalidPath(
      operation,
      `${subject} is unsafe or unusable: ${path}${suffix}`,
    );
  }

  throw new Defect("DATABASE", `Failed to inspect ${subject}: ${path}`, {
    operation,
    cause: error,
  });
}

function canonicalDatabasePath(
  databasePath: string,
  operation: CampaignLockOperation,
): string {
  if (databasePath.length === 0) {
    throw invalidPath(operation, "database path must be nonempty");
  }
  if (databasePath.includes("\0")) {
    throw invalidPath(operation, "database path contains NUL");
  }

  const absolutePath = resolve(databasePath);

  try {
    const status = lstatSync(absolutePath);
    if (status.isSymbolicLink()) {
      throw invalidPath(
        operation,
        `database path cannot be a symbolic link: ${absolutePath}`,
      );
    }
    if (!status.isFile()) {
      throw invalidPath(
        operation,
        `database path is not a regular file: ${absolutePath}`,
      );
    }
    if (status.nlink !== 1) {
      throw invalidPath(
        operation,
        `database path has ${status.nlink} hard links; Elenx requires exactly one: ${absolutePath}`,
      );
    }
    try {
      return realpathSync(absolutePath);
    } catch (error) {
      pathError(operation, "database path", absolutePath, error);
    }
  } catch (error) {
    if (!isErrorWithCode(error) || error.code !== "ENOENT") {
      pathError(operation, "database path", absolutePath, error);
    }
  }

  try {
    return join(realpathSync(dirname(absolutePath)), basename(absolutePath));
  } catch (error) {
    pathError(operation, "database parent path", dirname(absolutePath), error);
  }
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

function lastErrno(operation: CampaignLockOperation): number {
  const pointer = native.errnoLocation();

  if (pointer === null) {
    throw new Defect("INVARIANT", "libc returned a null errno pointer", {
      operation,
    });
  }

  return read.i32(pointer, 0);
}

function closeDescriptor(
  fd: number,
  operation: CampaignLockOperation,
  lockPath: string,
): void {
  try {
    closeSync(fd);
  } catch (error) {
    throw new Defect("DATABASE", `Failed to close writer lock: ${lockPath}`, {
      operation,
      cause: error,
    });
  }
}

export function acquireWriterLock(
  databasePath: string,
  operation: CampaignLockOperation,
): WriterLock {
  const canonicalPath = canonicalDatabasePath(databasePath, operation);
  const lockPath = `${canonicalPath}.writer-lock`;
  let fd: number;
  try {
    fd = openSync(
      lockPath,
      fsConstants.O_CREAT |
        fsConstants.O_RDWR |
        fsConstants.O_NOFOLLOW |
        O_CLOEXEC,
      0o600,
    );
  } catch (error) {
    pathError(operation, "writer lock path", lockPath, error);
  }

  let lockStatus: ReturnType<typeof fstatSync>;
  try {
    lockStatus = fstatSync(fd);
  } catch (error) {
    closeDescriptor(fd, operation, lockPath);
    pathError(operation, "writer lock path", lockPath, error);
  }
  if (!lockStatus.isFile() || lockStatus.nlink !== 1) {
    closeDescriptor(fd, operation, lockPath);
    const reason = lockStatus.isFile()
      ? `has ${lockStatus.nlink} hard links; Elenx requires exactly one`
      : "is not a regular file";
    throw invalidPath(operation, `writer lock path ${reason}: ${lockPath}`);
  }

  if (native.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    const errno = lastErrno(operation);
    closeDescriptor(fd, operation, lockPath);

    if (errno === osConstants.errno.EAGAIN) {
      throw new WriterLockedError(canonicalPath, operation);
    }

    throw new Defect(
      "DATABASE",
      `Failed to lock campaign writer: ${lockPath} (errno ${errno})`,
      { operation },
    );
  }

  let closed = false;

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      closeDescriptor(fd, operation, lockPath);
    },
  };
}
