// Edge Function "notificar" — chamada pelo pg_cron a cada 5 minutos.
// Envia: (1) lembrete X minutos antes de cada visita pendente; (2) resumo diário das visitas do dia.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SUBJECT = "https://github.com/Lucazvfx/crmsergio";
const TZ_PADRAO = "America/Porto_Velho";

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function segredo(nome: string): Promise<string | null> {
  const { data, error } = await sb.rpc("crm_secret", { nome });
  if (error) throw new Error("crm_secret: " + error.message);
  return data ?? null;
}

// Garante que existam chaves VAPID (geradas aqui mesmo na primeira execução)
async function chavesVapid() {
  let pub = await segredo("crm_vapid_public"), priv = await segredo("crm_vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await sb.rpc("crm_guardar_vapid", { pub: k.publicKey, priv: k.privateKey });
    pub = await segredo("crm_vapid_public"); priv = await segredo("crm_vapid_private");
  }
  return { pub: pub!, priv: priv! };
}

function agoraLocal(tz: string) {
  let f: Intl.DateTimeFormat;
  try { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { return agoraLocal(TZ_PADRAO); }
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, min: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) / 60000 };
}
const minutosLocal = (d: string, h: string) => {
  const [y, m, dd] = d.split("-").map(Number); const [hh, mi] = (h || "00:00").split(":").map(Number);
  return Date.UTC(y, m - 1, dd, hh, mi) / 60000;
};
const hhmmMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

Deno.serve(async (req) => {
  const cronSecret = await segredo("crm_cron_secret");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ erro: "proibido" }, 403);
  const body = await req.json().catch(() => ({}));
  const dryRun = !!body?.dryRun;

  const vapid = await chavesVapid();
  webpush.setVapidDetails(SUBJECT, vapid.pub, vapid.priv);

  const { data: subs, error: e1 } = await sb.from("push_subscriptions").select("*");
  if (e1) return json({ erro: e1.message }, 500);
  if (!subs?.length) return json({ inscricoes: 0, enviadas: 0 });

  // Modo teste (só com o segredo do agendador): envia agora para todos os aparelhos inscritos
  if (body?.teste) {
    const r: { aparelho: string; status: number | string }[] = [];
    for (const s of subs) {
      try {
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: "CRM DO SÉRGIO — teste", body: "Notificações funcionando neste aparelho. ✅", tag: "teste-servidor", url: "./?tab=agenda" }),
          { TTL: 600, urgency: "high" },
        );
        r.push({ aparelho: new URL(s.endpoint).host, status: res.statusCode });
      } catch (err) {
        r.push({ aparelho: new URL(s.endpoint).host, status: `${(err as { statusCode?: number }).statusCode ?? ""} ${(err as Error).message}`.trim() });
      }
    }
    return json({ teste: true, resultados: r });
  }

  const users = [...new Set(subs.map((s) => s.user_id))];
  const { data: agenda, error: e2 } = await sb.from("registros").select("user_id,id,dados")
    .eq("tipo", "agenda").eq("deleted", false).in("user_id", users);
  if (e2) return json({ erro: e2.message }, 500);
  const pend = (agenda ?? []).filter((r) => r.dados?.status === "pendente" && r.dados?.data);
  const cliIds = [...new Set(pend.map((r) => r.dados.clienteId).filter(Boolean))];
  const { data: clientes } = cliIds.length
    ? await sb.from("registros").select("user_id,id,dados").eq("tipo", "clientes").eq("deleted", false).in("user_id", users).in("id", cliIds)
    : { data: [] as { user_id: string; id: string; dados: Record<string, string> }[] };
  const cli = (u: string, id: string) => (clientes ?? []).find((c) => c.user_id === u && c.id === id)?.dados ?? {};

  const { data: envios } = await sb.from("push_envios").select("endpoint,chave").in("endpoint", subs.map((s) => s.endpoint));
  const jaFoi = new Set((envios ?? []).map((e) => e.endpoint + "|" + e.chave));

  const planos: { sub: typeof subs[number]; chave: string; titulo: string; corpo: string; tag: string }[] = [];
  for (const s of subs) {
    const agora = agoraLocal(s.tz || TZ_PADRAO);
    const minhas = pend.filter((r) => r.user_id === s.user_id);
    // 1) Lembrete antes da visita
    if (s.lembrete_min > 0) {
      for (const r of minhas) {
        const d = r.dados, falta = minutosLocal(d.data, d.hora) - agora.min;
        if (falta > 0 && falta <= s.lembrete_min) {
          const chave = `lembrete:${r.id}:${d.data}T${d.hora}`;
          if (jaFoi.has(s.endpoint + "|" + chave)) continue;
          const c = cli(r.user_id, d.clienteId);
          planos.push({ sub: s, chave, tag: "visita-" + r.id,
            titulo: `Visita às ${d.hora} — ${c.nome ?? "Cliente"}`,
            corpo: [c.cidade, d.objetivo].filter(Boolean).join(" · ") || `Começa em ${Math.round(falta)} min` });
        }
      }
    }
    // 2) Resumo do dia (só dentro de 3 h após o horário escolhido)
    if (s.resumo_hora) {
      const dif = hhmmMin(agora.hhmm) - hhmmMin(s.resumo_hora);
      const chave = `resumo:${agora.data}`;
      if (dif >= 0 && dif < 180 && !jaFoi.has(s.endpoint + "|" + chave)) {
        const hoje = minhas.filter((r) => r.dados.data === agora.data).sort((a, b) => (a.dados.hora || "").localeCompare(b.dados.hora || ""));
        const atrasadas = minhas.filter((r) => r.dados.data < agora.data).length;
        if (hoje.length || atrasadas) {
          const linhas = hoje.slice(0, 4).map((r) => `${r.dados.hora} ${cli(r.user_id, r.dados.clienteId).nome ?? "Cliente"}`);
          if (hoje.length > 4) linhas.push(`+${hoje.length - 4} outras`);
          if (atrasadas) linhas.push(`${atrasadas} visita(s) atrasada(s)`);
          planos.push({ sub: s, chave, tag: "resumo-" + agora.data,
            titulo: hoje.length ? `Hoje: ${hoje.length} visita${hoje.length > 1 ? "s" : ""} agendada${hoje.length > 1 ? "s" : ""}` : "Visitas atrasadas na agenda",
            corpo: linhas.join("\n") });
        } else {
          planos.push({ sub: s, chave, tag: "", titulo: "", corpo: "" }); // dia sem visitas: só registra para não checar de novo
        }
      }
    }
  }

  if (dryRun) return json({ inscricoes: subs.length, planos: planos.map((p) => ({ chave: p.chave, titulo: p.titulo, corpo: p.corpo })) });

  let enviadas = 0; const erros: string[] = []; const removidas: string[] = [];
  for (const p of planos) {
    if (removidas.includes(p.sub.endpoint.slice(0, 40))) continue; // inscrição já removida nesta rodada
    if (p.titulo) {
      try {
        await webpush.sendNotification(
          { endpoint: p.sub.endpoint, keys: { p256dh: p.sub.p256dh, auth: p.sub.auth } },
          JSON.stringify({ title: p.titulo, body: p.corpo, tag: p.tag, url: "./?tab=agenda" }),
          { TTL: 3600, urgency: "high" },
        );
        enviadas++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { // inscrição expirada/cancelada no aparelho
          await sb.from("push_subscriptions").delete().eq("endpoint", p.sub.endpoint);
          removidas.push(p.sub.endpoint.slice(0, 40));
          continue;
        }
        erros.push(`${code ?? ""} ${(err as Error).message}`.trim());
        continue;
      }
    }
    await sb.from("push_envios").upsert({ endpoint: p.sub.endpoint, chave: p.chave }, { onConflict: "endpoint,chave" });
  }
  // limpeza: registros de envio com mais de 30 dias
  await sb.from("push_envios").delete().lt("enviado_em", new Date(Date.now() - 30 * 864e5).toISOString());
  return json({ inscricoes: subs.length, enviadas, removidas, erros });
});
