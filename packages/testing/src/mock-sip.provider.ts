import {
  ProviderError,
  type CallResult,
  type MakeCallRequest,
  type PhoneNumber,
  type SipProvider,
  type ValidationResult,
} from "@omni/provider-contracts";

export interface MockSipOptions {
  numbers?: PhoneNumber[];
  /** Simula falha do provedor para exercitar retry/DLQ nos testes. */
  failMakeCall?: { code: string; retryable: boolean };
}

export class MockSipProvider implements SipProvider {
  readonly madeCalls: MakeCallRequest[] = [];
  readonly hangupCalls: string[] = [];
  private counter = 0;

  constructor(private readonly options: MockSipOptions = {}) {}

  async validateConfiguration(): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [], checkedAt: new Date() };
  }

  async getNumbers(): Promise<PhoneNumber[]> {
    return (
      this.options.numbers ?? [
        {
          number: "5511999999999",
          kind: "mobile",
          country: "BR",
          capabilities: { inbound: true, outbound: true, sms: false },
        },
      ]
    );
  }

  async makeCall(request: MakeCallRequest): Promise<CallResult> {
    if (this.options.failMakeCall) {
      throw new ProviderError(
        "mock: falha simulada em makeCall",
        "mock-sip",
        this.options.failMakeCall.code,
        this.options.failMakeCall.retryable,
      );
    }
    this.madeCalls.push(request);
    this.counter += 1;
    return {
      externalCallId: `mock-call-${this.counter}`,
      correlationId: request.correlationId,
      acceptedAt: new Date(),
    };
  }

  async hangupCall(externalCallId: string): Promise<void> {
    this.hangupCalls.push(externalCallId);
  }
}
