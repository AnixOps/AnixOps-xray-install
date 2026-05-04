import { create } from "zustand";

interface AuthState {
  userId: string | null;
  token: string | null;
  email: string | null;
  isAdmin: boolean;
  setAuth: (userId: string, token: string, email: string, isAdmin?: boolean) => void;
  setAdmin: (isAdmin: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  token: null,
  email: null,
  isAdmin: false,
  setAuth: (userId, token, email, isAdmin = false) => {
    localStorage.setItem("anixops_user", JSON.stringify({ userId, token, email, isAdmin }));
    set({ userId, token, email, isAdmin });
  },
  setAdmin: (isAdmin) =>
    set((state) => {
      if (state.userId && state.token && state.email) {
        localStorage.setItem("anixops_user", JSON.stringify({
          userId: state.userId,
          token: state.token,
          email: state.email,
          isAdmin,
        }));
      }
      return { isAdmin };
    }),
  logout: () => {
    localStorage.removeItem("anixops_user");
    set({ userId: null, token: null, email: null, isAdmin: false });
  },
}));

// Load from localStorage on init
if (typeof window !== "undefined") {
  const saved = localStorage.getItem("anixops_user");
  if (saved) {
    try {
      const { userId, token, email, isAdmin } = JSON.parse(saved);
      useAuthStore.setState({ userId, token, email, isAdmin: Boolean(isAdmin) });
    } catch {}
  }
}
