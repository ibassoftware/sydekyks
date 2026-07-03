import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button, Card, Input, Label, PageShell } from "../components/ui";
import axios from "axios";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      if (user.role === "super_admin") navigate("/admin");
      else navigate("/hq");
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError("Invalid email or password.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell>
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <Link to="/" className="mb-8 flex items-center gap-2 text-lg font-bold tracking-wide text-gold-300">
          <span className="text-2xl">⚡</span> SYDEKYKS
        </Link>
        <Card className="w-full max-w-sm p-8">
          <h1 className="text-xl font-semibold text-[#f5eee0]">Welcome back</h1>
          <p className="mt-1 text-sm text-[#b9ad98]">Sign in to your HQ.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </PageShell>
  );
}
