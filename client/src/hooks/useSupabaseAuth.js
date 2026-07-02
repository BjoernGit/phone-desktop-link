import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../utils/supabaseClient";

export function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let isActive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isActive) return;
        setSession(data?.session ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (!isActive) return;
        setError(err?.message || "auth-session-error");
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      isActive = false;
      data?.subscription?.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      const fallbackError = new Error("supabase-not-configured");
      setError(fallbackError.message);
      return { data: null, error: fallbackError };
    }
    setError("");
    const { data, error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (signInError) {
      setError(signInError.message);
    }
    return { data, error: signInError };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return { error: null };
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
    }
    return { error: signOutError };
  }, []);

  return {
    supabase,
    session,
    user: session?.user ?? null,
    loading,
    error,
    isConfigured: isSupabaseConfigured(),
    signInWithGoogle,
    signOut,
  };
}
