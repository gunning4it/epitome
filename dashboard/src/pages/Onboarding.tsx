import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/hooks/useApi';

export default function Onboarding() {
  const navigate = useNavigate();
  const { data: session, isLoading } = useSession();

  useEffect(() => {
    if (session && !isLoading) {
      navigate('/agents', { replace: true });
    }
  }, [session, isLoading, navigate]);

  const handleGoogleSignIn = () => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000/v1';
    window.location.href = `${apiBase}/auth/login?provider=google`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="size-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.08)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(139,92,246,0.06)_0%,_transparent_50%)]" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-6 text-center">
        <div className="space-y-4">
          <h1 className="text-5xl sm:text-6xl font-light tracking-tight text-white">
            Epitome
          </h1>
          <p className="text-lg text-neutral-400">
            Your AI memory vault
          </p>
        </div>

        <button
          onClick={handleGoogleSignIn}
          className="flex items-center gap-3 px-8 py-3.5 bg-white hover:bg-neutral-100 text-neutral-800 font-medium rounded-full shadow-lg shadow-white/5 transition-colors cursor-pointer"
        >
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <p className="text-sm text-neutral-500">
          By signing up, you agree to our{' '}
          <a
            href="/legal/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-300 underline underline-offset-2 hover:text-white transition-colors"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-300 underline underline-offset-2 hover:text-white transition-colors"
          >
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
