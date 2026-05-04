"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth/store";

export function AuthBootstrap() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.userId);
  const email = useAuthStore((s) => s.email);
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    if (!token || !userId || !email) {
      return;
    }

    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || data.error) {
          return;
        }
        setAuth(data.userId || userId, token, data.email || email, Boolean(data.isAdmin));
      })
      .catch(() => {});
  }, [token, userId, email, setAuth]);

  return null;
}
