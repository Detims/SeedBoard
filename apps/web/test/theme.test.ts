import { describe, expect, it, vi } from "vitest";
import { resolveTheme, saveTheme, themeStorageKey } from "../src/theme.js";

describe("theme preference", () => {
  it("uses the system preference when no saved choice exists", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("preserves an explicit saved choice over the current system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("ignores invalid saved values and falls back to the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("invalid", false)).toBe("light");
  });

  it("persists an explicit selection in the browser preference store", () => {
    const setItem = vi.fn();

    saveTheme("dark", { setItem });

    expect(setItem).toHaveBeenCalledWith(themeStorageKey, "dark");
  });

  it("keeps theme changes usable when browser storage is unavailable", () => {
    const setItem = vi.fn(() => {
      throw new Error("Storage is blocked.");
    });

    expect(() => saveTheme("light", { setItem })).not.toThrow();
  });
});
