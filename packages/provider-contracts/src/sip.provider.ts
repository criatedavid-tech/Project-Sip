import type { E164, ValidationResult } from "./common";

export type PhoneNumberKind = "mobile" | "landline" | "national" | "unknown";

export interface PhoneNumber {
  number: E164;
  kind: PhoneNumberKind;
  country: string;
  capabilities: {
    inbound: boolean;
    outbound: boolean;
    sms: boolean;
  };
}

export interface MakeCallRequest {
  from: E164;
  to: E164;
  /** Correlaciona o comando com os eventos que chegarão depois, de forma assíncrona. */
  correlationId: string;
  callerIdName?: string;
  timeoutSeconds?: number;
  variables?: Record<string, string>;
}

export interface CallResult {
  externalCallId: string;
  correlationId: string;
  acceptedAt: Date;
}

export const SIP_PROVIDER = Symbol("SipProvider");

export interface SipProvider {
  validateConfiguration(): Promise<ValidationResult>;
  getNumbers(): Promise<PhoneNumber[]>;
  makeCall(request: MakeCallRequest): Promise<CallResult>;
  hangupCall(externalCallId: string): Promise<void>;
}
