import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/memo";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

/**
 * URLとPublishable keyが未設定の開発・ローカル利用でもアプリ本体が壊れないよう、
 * クライアントは設定済みの時だけ生成する。
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
