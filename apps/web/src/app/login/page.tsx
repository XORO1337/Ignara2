"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppButton, AppContainer, AppInput, GlassCard } from "../../components/ui";
import { API_URL, apiRequest } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";

type LoginResponse = {
  user: {
    sub: string;
    email: string;
    role: "admin" | "manager" | "employee";
    orgId: string;
    isDevAllowlisted?: boolean;
  };
};

export default function LoginPage() {
  const [email, setEmail] = useState("manager@ignara.local");
  const [password, setPassword] = useState("manager123");
  const [error, setError] = useState<string | null>(null);
  const setUser = useAuthStore((state) => state.setUser);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(response.user);
      router.push("/dashboard");
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes("Cannot reach API")) {
        setError(
          `Cannot reach API at ${API_URL}. Start backend with: pnpm --filter @ignara/api dev. If you are using Codespaces, make sure port 3001 is forwarded and then reload the page.`,
        );
        return;
      }

      setError("Login failed. Check seeded credentials.");
    }
  }

  return (
    <AppContainer className="flex min-h-[70vh] max-w-xl items-center justify-center">
      <GlassCard className="w-full">
        <form onSubmit={onSubmit}>
          <p className="font-data text-xs uppercase tracking-[0.24em] text-text-dim">Secure Access</p>
          <h1 className="mt-1 text-3xl font-semibold">Sign In to Ignara</h1>
          <p className="mt-1 text-sm text-text-dim">Use manager, admin, or employee credentials from seeded data.</p>

          <label className="mt-6 block text-sm text-text-dim">Email</label>
          <AppInput className="mt-1" value={email} onChange={(event) => setEmail(event.target.value)} />

          <label className="mt-4 block text-sm text-text-dim">Password</label>
          <AppInput type="password" className="mt-1" value={password} onChange={(event) => setPassword(event.target.value)} />

          {error ? <p className="mt-3 rounded-xl border border-error/35 bg-error/10 px-3 py-2 text-sm text-error">{error}</p> : null}

          <AppButton type="submit" className="mt-6 w-full">
            Sign In
          </AppButton>
        </form>
      </GlassCard>
    </AppContainer>
  );
}
