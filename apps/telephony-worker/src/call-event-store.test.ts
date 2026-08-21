import { describe, expect, it } from "vitest";
import {
  callStatus,
  durationSeconds,
  eventTimestamp,
  recordingStatus,
} from "./call-event-store";

describe("normalização dos eventos de chamada", () => {
  it("converte a duração do Asterisk para segundos", () => {
    expect(durationSeconds("1501")).toBe(2);
    expect(durationSeconds("0")).toBe(0);
    expect(durationSeconds(undefined)).toBeNull();
  });

  it("preserva os instantes reais enviados pelo PABX", () => {
    expect(eventTimestamp("1787331600000")?.toISOString()).toBe(
      "2026-08-21T17:00:00.000Z",
    );
    expect(eventTimestamp("inválido")).toBeNull();
  });

  it("traduz os estados do Dial para o histórico", () => {
    expect(callStatus("ANSWER")).toBe("completed");
    expect(callStatus("BUSY")).toBe("busy");
    expect(callStatus("NOANSWER")).toBe("no_answer");
    expect(callStatus("TIMEOUT")).toBe("no_answer");
    expect(callStatus("CONTINUE", 12)).toBe("completed");
    expect(callStatus(undefined)).toBe("failed");
  });

  it("does not report unanswered calls as recording failures", () => {
    expect(recordingStatus("cancelled", false)).toBe("not_recorded");
    expect(recordingStatus("no_answer", false)).toBe("not_recorded");
    expect(recordingStatus("completed", false)).toBe("failed");
    expect(recordingStatus("completed", true)).toBe("available");
  });
});
