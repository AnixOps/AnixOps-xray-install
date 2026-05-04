import { create } from "zustand";

interface AuthState {
  userId: string | null;
  token: string | null;
  email: string | null;
  setAuth: (userId: string, token: string, email: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  token: null,
  email: null,
  setAuth: (userId, token, email) => {
    localStorage.setItem("anixops_user", JSON.stringify({ userId, token, email }));
    set({ userId, token, email });
  },
  logout: () => {
    localStorage.removeItem("anixops_user");
    set({ userId: null, token: null, email: null });
  },
}));

// Load from localStorage on init
if (typeof window !== "undefined") {
  const saved = localStorage.getItem("anixops_user");
  if (saved) {
    try {
      const { userId, token, email } = JSON.parse(saved);
      useAuthStore.setState({ userId, token, email });
    } catch {}
  }
}
