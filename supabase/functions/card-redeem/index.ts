import { createRedeemHandler } from '../_shared/card-service.mjs';
import { createSupabaseStore } from '../_shared/supabase-store.mjs';
const store = createSupabaseStore(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
Deno.serve(createRedeemHandler({ store }));
