import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export type KakidasUser = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
};

type AuthContextValue = {
  isConfigured: boolean;
  isLoading: boolean;
  user: KakidasUser | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function mapUser(user: User | null): KakidasUser | null {
  if (!user) return null;

  const metadata = user.user_metadata ?? {};
  const displayName =
    typeof metadata.full_name === "string" && metadata.full_name.trim()
      ? metadata.full_name
      : typeof metadata.name === "string" && metadata.name.trim()
        ? metadata.name
        : user.email?.split("@")[0] ?? "ログイン中";

  return {
    id: user.id,
    email: user.email ?? null,
    display_name: displayName,
    avatar_url:
      typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
  };
}

function configuredError() {
  return new Error(
    "Supabaseの接続情報が未設定です。Vercelの環境変数を確認してください。",
  );
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<KakidasUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    const client = supabase;
    let active = true;

    const initialize = async () => {
      const { data, error: sessionError } = await client.auth.getSession();

      if (!active) return;

      if (sessionError) {
        setError(sessionError.message);
      }

      setUser(mapUser(data.session?.user ?? null));
      setIsLoading(false);
    };

    void initialize();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(mapUser(session?.user ?? null));
      setError(null);
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw configuredError();

    setError(null);

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // ViteのSPAでは、戻り先はアプリのルートに固定して扱う。
        // このURLはSupabase AuthのRedirect URLsにも登録が必要。
        redirectTo: window.location.origin,
      },
    });

    if (signInError) {
      setError(signInError.message);
      throw signInError;
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw configuredError();

    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      throw signOutError;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: isSupabaseConfigured,
      isLoading,
      user,
      error,
      signInWithGoogle,
      signOut,
    }),
    [error, isLoading, signInWithGoogle, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthはAuthProviderの内側で使ってください。");
  }

  return context;
}
