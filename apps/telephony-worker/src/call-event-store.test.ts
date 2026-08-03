import { describe, expect, it } from "vitest";
import { callStatus, durationSeconds } from "./call-event-store";

describe("normalização dos eventos de chamada", () => {
  it("converte a duração do Asterisk para segundos", () => {
    expect(durationSeconds("1501")).toBe(2);
    expect(durationSeconds("0")).toBe(0);
    expect(durationSeconds(undefined)).toBeNull();
  });

  it("traduz os estados do Dial para o histórico", () => {
    expect(callStatus("ANSWER")).toBe("completed");
    expect(callStatus("BUSY")).toBe("busy");
    expect(callStatus("NOANSWER")).toBe("no_answer");
    expect(callStatus("TIMEOUT")).toBe("no_answer");
    expect(callStatus("CONTINUE", 12)).toBe("completed");
    expect(callStatus(undefined)).toBe("failed");
  });
});
