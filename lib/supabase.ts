import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://xtewfpzsyjeaqgkdttij.supabase.co";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_c9Bvz2ebh2Jcejk_7sIQWQ_avpFiSFb";

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
