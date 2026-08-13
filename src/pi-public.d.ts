import type { CallId, Campaign, Hash, Json, Tool } from "./index";

declare const modelBrand: unique symbol;
declare const registryBrand: unique symbol;

export type PiCredential =
  | {
      readonly type: "api_key";
      readonly key?: string;
      readonly env?: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "oauth";
      readonly refresh: string;
      readonly access: string;
      readonly expires: number;
      readonly [key: string]: unknown;
    };

export interface PiAuthOperationOptions {
  readonly signal?: AbortSignal;
}

export interface PiCredentialInfo {
  readonly providerId: string;
  readonly type: PiCredential["type"];
}

export interface PiCredentialStore {
  read(
    providerId: string,
    options?: PiAuthOperationOptions,
  ): Promise<PiCredential | undefined>;
  list(options?: PiAuthOperationOptions): Promise<readonly PiCredentialInfo[]>;
  modify(
    providerId: string,
    update: (
      current: PiCredential | undefined,
    ) => Promise<PiCredential | undefined>,
    options?: PiAuthOperationOptions,
  ): Promise<PiCredential | undefined>;
  delete(providerId: string, options?: PiAuthOperationOptions): Promise<void>;
}

export declare class InMemoryCredentialStore implements PiCredentialStore {
  read(
    providerId: string,
    options?: PiAuthOperationOptions,
  ): Promise<PiCredential | undefined>;
  list(options?: PiAuthOperationOptions): Promise<readonly PiCredentialInfo[]>;
  modify(
    providerId: string,
    update: (
      current: PiCredential | undefined,
    ) => Promise<PiCredential | undefined>,
    options?: PiAuthOperationOptions,
  ): Promise<PiCredential | undefined>;
  delete(providerId: string, options?: PiAuthOperationOptions): Promise<void>;
}

export interface PiModel {
  readonly [modelBrand]: true;
  readonly provider: string;
  readonly id: string;
  readonly api: string;
  readonly name: string;
}

export interface PiRegistry {
  readonly [registryBrand]: true;
  getModel(provider: string, modelId: string): PiModel | undefined;
}

export interface PiRunOptions {
  readonly models: PiRegistry;
  readonly model: PiModel;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly candidate?: Hash;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

export type PiResult = {
  readonly call: CallId;
  readonly transcript: readonly Json[];
  readonly text: string;
} & (
  | { readonly state: "succeeded" }
  | {
      readonly state: "failed" | "cancelled";
      readonly error: string;
    }
);

export declare function builtinPi(options?: {
  readonly credentials?: PiCredentialStore;
}): PiRegistry;

export declare function runPi(
  campaign: Campaign,
  options: PiRunOptions,
): Promise<PiResult>;
