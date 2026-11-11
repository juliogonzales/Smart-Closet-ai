// Envia aviso Web Push para o dono de um look quando alguém curte.
// Chamada pelo banco (trigger notifications_push). Não exige login: a função
// só envia para notificações que existem e ainda não tiveram push.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:juliogonzales@live.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  let body: { notification_id?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const id = body?.notification_id;
  if (!id) return json({ error: "notification_id ausente" }, 400);

  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, actor_id, outfit_id, push_sent_at")
    .eq("id", id)
    .maybeSingle();
  if (!n) return json({ skipped: "notificação não existe" });
  if (n.push_sent_at) return json({ skipped: "push já enviado" });

  // Silenciado: não envia push, mas a curtida continua no sino
  const { data: owner } = await admin.from("profiles").select("notify_muted").eq("id", n.user_id).maybeSingle();
  if (owner?.notify_muted) {
    await admin.from("notifications").update({ push_sent_at: new Date().toISOString() }).eq("id", n.id);
    return json({ skipped: "silenciado" });
  }

  const [{ data: actor }, { data: outfit }, { data: subs }] = await Promise.all([
    admin.from("profiles").select("handle, full_name").eq("id", n.actor_id).maybeSingle(),
    admin.from("outfits").select("title").eq("id", n.outfit_id).maybeSingle(),
    admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", n.user_id),
  ]);

  const who = actor?.handle ? `@${actor.handle}` : (actor?.full_name?.split(" ")[0] || "Alguém");
  const payload = JSON.stringify({
    title: "Nova curtida no seu look",
    body: `${who} curtiu${outfit?.title ? ` «${outfit.title}»` : " seu look"}`,
    url: `#/outfit/${n.outfit_id}`,
    tag: `like-${n.outfit_id}`,
  });

  let sent = 0;
  const gone: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86400 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint); // aparelho removeu a inscrição
    }
  }
  if (gone.length) await admin.from("push_subscriptions").delete().in("endpoint", gone);
  await admin.from("notifications").update({ push_sent_at: new Date().toISOString() }).eq("id", n.id);
  return json({ sent, removed: gone.length });
});
