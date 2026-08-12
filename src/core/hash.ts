import { createHash } from "node:crypto";

import type { Hash } from "./types";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function hashBytes(bytes: Uint8Array): Hash {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function isHash(value: unknown): value is Hash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

export function assertHash(
  value: unknown,
  label = "hash",
): asserts value is Hash {
  if (!isHash(value)) {
    throw new TypeError(`${label} must match sha256:<64 lowercase hex digits>`);
  }
}

export function hashMatches(hash: Hash, bytes: Uint8Array): boolean {
  return hashBytes(bytes) === hash;
}
