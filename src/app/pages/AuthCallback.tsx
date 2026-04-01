import React, { useEffect } from "react";
import { useNavigate } from "react-router";
import { supabase } from "../utils/supabaseClient";

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Handle PKCE code exchange — Supabase detects ?code= in the URL,
    // exchanges it for a session, then fires SIGNED_IN.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate("/", { replace: true });
      }
    });

    // If a session already exists (e.g. page reload), go straight to app.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/", { replace: true });
      }
    });

    // Fallback: if no session after 10 seconds, send back to login.
    const timeout = setTimeout(() => {
      navigate("/login", { replace: true });
    }, 10000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
