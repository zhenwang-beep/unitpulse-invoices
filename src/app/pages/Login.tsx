import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../utils/supabaseClient";
import Logo from "../../imports/Logo-4-122";
import logoPng from "../../assets/logo.svg";

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ✅ If already logged in, go straight to app
  useEffect(() => {
    if (!loading && user) {
      console.log(
        "User authenticated, redirecting to app:",
        user.email,
      );
      navigate("/", { replace: true });
    }
  }, [user, loading, navigate]);

  // ✅ Show spinner while Supabase checks auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithGoogle(); // ✅ uses AuthContext, not supabase directly
    } catch (err) {
      setError(
        "Failed to sign in with Google. Please try again.",
      );
      console.error("Sign in error:", err);
      setIsLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: "dev@local.test",
        password: "devlocal123",
      });
      if (error) throw error;
    } catch (err: any) {
      setError("Dev login failed: " + err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16">
              <img
                src={logoPng}
                alt="UnitPulse"
                className="w-full h-full object-contain"
              />
            </div>
          </div>

          {/* Title */}
          <h1
            className="text-4xl mb-2"
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 700,
            }}
          >
            Welcome to UnitPulse
          </h1>
          <p
            className="text-[#666666] text-lg"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Professional invoice generator for your business
          </p>
        </div>

        {/* Sign In Card */}
        <div className="bg-white border border-[#E0E0E0] rounded-xl p-8 shadow-sm">
          <h2
            className="text-xl mb-6 text-center"
            style={{
              fontFamily: "Manrope, sans-serif",
              fontWeight: 600,
            }}
          >
            Sign in to continue
          </h2>

          {error && (
            <div
              className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {error}
            </div>
          )}

          {/* Google Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full bg-white border-2 border-[#E0E0E0] text-[#1F1F1F] py-3 px-6 rounded-lg transition-all duration-200 hover:border-[#22C55E] hover:bg-[#F0FDF4] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 cursor-pointer"
            style={{
              fontFamily: "Inter, sans-serif",
              fontWeight: 500,
            }}
          >
            {isLoading ? (
              <span>Signing in...</span>
            ) : (
              <>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19.8055 10.2292C19.8055 9.55174 19.7501 8.86842 19.6323 8.19785H10.2002V12.0492H15.6014C15.3773 13.2911 14.6571 14.3898 13.6026 15.0875V17.5866H16.8251C18.7175 15.8449 19.8055 13.2728 19.8055 10.2292Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M10.2002 20.0006C12.9517 20.0006 15.2727 19.1048 16.8296 17.5872L13.6071 15.088C12.7021 15.698 11.5404 16.0433 10.2047 16.0433C7.54624 16.0433 5.28788 14.2834 4.48979 11.9169H1.16309V14.4927C2.75193 17.8356 6.30913 20.0006 10.2002 20.0006Z"
                    fill="#34A853"
                  />
                  <path
                    d="M4.4853 11.917C4.04607 10.6751 4.04607 9.32999 4.4853 8.08804V5.51221H1.16316C-0.387721 8.59035 -0.387721 12.4147 1.16316 15.493L4.4853 11.917Z"
                    fill="#FBBC04"
                  />
                  <path
                    d="M10.2002 3.95805C11.6148 3.936 13.0005 4.47247 14.036 5.45722L16.8935 2.60218C15.1858 0.990732 12.9334 0.0949324 10.2002 0.122149C6.30913 0.122149 2.75193 2.28712 1.16309 5.63002L4.48523 8.20585C5.27878 5.83481 7.5417 3.95805 10.2002 3.95805Z"
                    fill="#EA4335"
                  />
                </svg>
                <span>Sign in with Google</span>
              </>
            )}
          </button>

          {import.meta.env.DEV && (
            <>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 h-px bg-[#E0E0E0]" />
                <span className="text-xs text-[#999] font-mono">DEV ONLY</span>
                <div className="flex-1 h-px bg-[#E0E0E0]" />
              </div>
              <button
                onClick={handleDevLogin}
                disabled={isLoading}
                className="mt-4 w-full bg-[#1a1a1a] text-white py-3 px-6 rounded-lg transition-all duration-200 hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer font-mono text-sm"
              >
                <span>⚡</span>
                <span>Dev Login (skip Google)</span>
              </button>
            </>
          )}

          <div className="mt-6 text-center">
            <p
              className="text-sm text-[#666666]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              By signing in, you agree to our Terms of Service
              and Privacy Policy
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div
          className="mt-6 p-4 bg-[#F0FDF4] border border-[#22C55E] rounded-lg"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          <p className="text-sm text-[#166534]">
            <strong className="font-semibold">
              Setup Required:
            </strong>{" "}
            Please ensure Google OAuth is configured in your
            Supabase dashboard. Follow the instructions at{" "}
            <a
              href="https://supabase.com/docs/guides/auth/social-login/auth-google"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#22C55E]"
            >
              supabase.com/docs/guides/auth/social-login/auth-google
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}