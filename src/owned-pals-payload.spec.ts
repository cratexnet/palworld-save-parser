import { describe, expect, it } from "vitest";
import { isCompactOwnedPalsPayload } from "./owned-pals-payload";

describe("palworld owned pals compact payload", () => {
  it("accepts only compact payload rows used by the browser session", () => {
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: [
          {
            i: "pal-1",
            s: "BOSS_IceHorse",
            g: "F",
            p: ["Legend", "ElementBoost_Ice_2_PAL"],
            l: "palbox:628",
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects incompatible versions and malformed compact rows", () => {
    expect(isCompactOwnedPalsPayload({ v: 2, pals: [] })).toBe(false);
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: [{ i: "", s: "FlyingManta", g: "Unknown" }],
      }),
    ).toBe(false);
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: [{ i: "pal-1", s: "FlyingManta", p: ["Legend", 42] }],
      }),
    ).toBe(false);
  });

  it("rejects payloads that exceed the cross-thread output budget", () => {
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: [{ i: "pal-1", s: "x".repeat(257) }],
      }),
    ).toBe(false);
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: [
          {
            i: "pal-1",
            s: "Anubis",
            p: Array.from({ length: 17 }, (_, index) => `Passive_${index}`),
          },
        ],
      }),
    ).toBe(false);
    expect(
      isCompactOwnedPalsPayload({
        v: 1,
        pals: Array.from({ length: 25_001 }, (_, index) => ({
          i: `pal-${index + 1}`,
          s: "Anubis",
        })),
      }),
    ).toBe(false);
  });
});
