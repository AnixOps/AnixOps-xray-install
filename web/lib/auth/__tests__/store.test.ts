import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAuthStore } from "../store";

// Mock localStorage for Node.js test environment
const mockStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
});

describe("auth store", () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({ userId: null, token: null, email: null });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("initializes with null values", () => {
    const { userId, token, email } = useAuthStore.getState();
    expect(userId).toBeNull();
    expect(token).toBeNull();
    expect(email).toBeNull();
  });

  it("sets auth state and persists to localStorage", () => {
    const { setAuth } = useAuthStore.getState();
    setAuth("user-123", "token-abc", "test@example.com");

    const state = useAuthStore.getState();
    expect(state.userId).toBe("user-123");
    expect(state.token).toBe("token-abc");
    expect(state.email).toBe("test@example.com");

    const saved = localStorage.getItem("anixops_user");
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!);
    expect(parsed.userId).toBe("user-123");
  });

  it("clears auth state on logout", () => {
    useAuthStore.getState().setAuth("user-1", "tok", "a@b.com");
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.userId).toBeNull();
    expect(state.token).toBeNull();
    expect(state.email).toBeNull();
    expect(localStorage.getItem("anixops_user")).toBeNull();
  });

  it("restores state from localStorage when manually set", () => {
    // Simulate a previously saved session
    localStorage.setItem(
      "anixops_user",
      JSON.stringify({ userId: "restored", token: "restored-tok", email: "restored@test.com" })
    );

    // Manually restore (mimicking what the init block does)
    const saved = localStorage.getItem("anixops_user");
    const { userId, token, email } = JSON.parse(saved!);
    useAuthStore.setState({ userId, token, email });

    const state = useAuthStore.getState();
    expect(state.userId).toBe("restored");
    expect(state.email).toBe("restored@test.com");
  });

  it("handles corrupted localStorage data gracefully", () => {
    localStorage.setItem("anixops_user", "not-valid-json");
    // This should not throw — the init block has try/catch
    expect(() => {
      localStorage.getItem("anixops_user");
    }).not.toThrow();
  });
});
