import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T12:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const one = (x) => (Array.isArray(x) ? x[0] : x) || null;
const status = (due) => {
  if (!due) return ["wa", "Sin fecha"];
  const d = Math.round((new Date(due) - new Date(today())) / 864e5);
  return d < 0 ? ["er", "Vencido"] : d <= 7 ? ["wa", "Próximo a vencer"] : ["ok", "Pagado"];
};

const S = { profile: null, billing: null, athletes: [], groups: [], showNew: false, invite: null, msg: "", ready: false,
            recovery: location.hash.includes("type=recovery") };

/* ---------- Sesión ---------- */
sb.auth.onAuthStateChange((event) => {
  // setTimeout evita llamar a Supabase dentro del propio callback (recomendado por la librería)
  setTimeout(async () => {
    if (event === "PASSWORD_RECOVERY") { S.recovery = true; S.ready = true; return render(); }
    if (event === "SIGNED_OUT") { S.profile = null; S.ready = true; return render(); }
    await load();
  }, 0);
});

async function load() {
  if (S.recovery) { S.ready = true; return render(); }
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { S.profile = null; S.ready = true; return render(); }
  const { data: p } = await sb.from("profiles").select("id, role, first_name, coach_id").eq("id", user.id).maybeSingle();
  if (!p) { await sb.auth.signOut(); S.msg = fail("Tu cuenta aún no está configurada. Avísale a tu coach."); return; }
  S.profile = p;
  if (p.role === "coach") await loadCoach(); else await loadAthlete();
  S.ready = true; render();
}
async function loadCoach() {
  const [a, g] = await Promise.all([
    sb.from("athletes").select("id, level, modality, status, profiles(first_name, last_name, phone), billing(due_date, monthly_price)").order("joined_at", { ascending: false }),
    sb.from("groups").select("id, name").order("name"),
  ]);
  S.athletes = (a.data ?? []).filter((x) => x.status !== "retirado");
  S.groups = g.data ?? [];
}
async function loadAthlete() {
  const { data } = await sb.from("billing").select("due_date, monthly_price").maybeSingle();
  S.billing = data;
}

/* ---------- Vistas ---------- */
const fail = (t) => `<div class="card" style="color:var(--er)">${esc(t)}</div>`;
const ok = (t) => `<div class="card">✅ ${t}</div>`;

function render() {
  const app = $("#app");
  $("#out").style.display = S.profile && !S.recovery ? "" : "none";
  document.body.classList.toggle("lg", !S.profile || S.recovery);
  if (SUPABASE_URL.includes("TU-PROYECTO")) { app.innerHTML = `<div class="card"><h2>Falta configurar</h2><p class="mu">Abre config.js y pega la URL y la anon key de tu proyecto Supabase.</p></div>`; return; }
  if (!S.ready) { app.innerHTML = `<p class="mu" style="text-align:center;margin-top:40vh">Cargando…</p>`; return; }
  if (S.recovery) { app.innerHTML = recoveryView(); return; }
  if (!S.profile) { app.innerHTML = S.msg + loginView(); S.msg = ""; return; }
  app.innerHTML = S.msg + (S.profile.role === "coach" ? coachView() : athleteView());
  S.msg = "";
}

const bigLogo = `<div style="text-align:center"><span class="logo" style="font-size:clamp(44px,15vw,96px)"><span>TEAM</span><b>FAJA</b></span><div class="sub">CROSSFIT &amp; GIMNASIA</div></div>`;

function loginView() {
  return `<div class="login">${bigLogo}<div class="card"><input id="le" type="email" placeholder="Correo" autocomplete="username"><input id="lp" type="password" placeholder="Contraseña" style="margin-top:8px" autocomplete="current-password"><div class="err" id="lerr"></div><button class="p wide" data-act="login" style="margin:0">Iniciar sesión</button><div class="mu" style="margin-top:12px;text-align:center">¿Olvidaste tu contraseña? Pídele un nuevo enlace a tu coach.</div></div></div>`;
}
function recoveryView() {
  return `<div class="login">${bigLogo}<div class="card"><h2>Crea tu contraseña</h2><input id="p1" type="password" placeholder="Nueva contraseña (mín. 6)" autocomplete="new-password"><input id="p2" type="password" placeholder="Repite la contraseña" style="margin-top:8px" autocomplete="new-password"><div class="err" id="perr"></div><button class="p wide" data-act="setpw" style="margin:0">Guardar y entrar</button></div></div>`;
}
function athleteView() {
  const b = S.billing, [c, l] = status(b?.due_date);
  return `<h2>Hola, ${esc(S.profile.first_name)} 💪</h2><div class="card"><h3>Mensualidad</h3><span class="tag ${c}">${l}</span> ${b ? `<span class="mu">vence ${esc(b.due_date)}</span>` : ""}</div><div class="card mu">Tu programación diaria aparecerá aquí muy pronto.</div>`;
}
function coachView() {
  return `<h2>Atletas</h2>${S.invite ? inviteCard() : ""}<button class="p wide" data-act="togglenew">${S.showNew ? "Cerrar formulario" : "＋ Nuevo atleta"}</button>${S.showNew ? newForm() : ""}${S.athletes.map(athRow).join("") || `<div class="card mu">Aún no tienes atletas. Crea el primero con el botón de arriba.</div>`}<div class="card mu">Próximas fases: programación, resultados, RM, pagos y bloqueo por mensualidad.</div>`;
}
function athRow(a) {
  const p = one(a.profiles) || {}, b = one(a.billing), [c, l] = status(b?.due_date);
  return `<div class="card"><div class="row"><b>${esc(p.first_name)} ${esc(p.last_name || "")}</b><span class="tag ${c}">${l}</span></div><div class="mu">${esc(a.level || "—")} · ${esc(a.modality)}${b ? ` · vence ${esc(b.due_date)}` : ""}</div><button class="s" data-act="resend" data-id="${a.id}">Enlace de acceso por WhatsApp</button></div>`;
}
function newForm() {
  const f = (id, ph, t = "text", x = "") => `<input id="${id}" type="${t}" placeholder="${ph}" ${x}>`;
  return `<div class="card"><h3>Nuevo atleta</h3>
<div class="fl">${f("an", "Nombre completo")}${f("at", "WhatsApp (ej. 3001234567)", "tel")}</div>
<div class="fl">${f("ae", "Correo", "email")}${f("ae2", "Repite el correo", "email")}</div>
<div class="fl"><select id="ag"><option value="">Sin grupo</option>${S.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select><select id="am"><option value="presencial">Presencial</option><option value="remoto">Remoto</option></select><select id="alv"><option>Principiante</option><option>Intermedio</option><option>RX</option></select></div>
<div class="fl">${f("apr", "Mensualidad ($)", "number", 'inputmode="numeric" min="1" value="150000"')}<div><div class="mu">Primer vencimiento</div><input id="ad" type="date" value="${addDays(today(), 30)}"></div></div>
${f("aj", "Objetivo (opcional)")}<div class="err" id="ferr"></div><button class="p wide" id="bcreate" data-act="create" style="margin:0">Crear atleta y generar enlace</button></div>`;
}
function waUrl(i) {
  const msg = `Hola ${i.name} 💪 Soy ${S.profile.first_name} de TeamFaja. Entra a este enlace para crear tu contraseña y ver tu programación: ${i.link}`;
  let d = String(i.phone || "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("3")) d = "57" + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(msg)}`;
}
function inviteCard() {
  const i = S.invite;
  return `<div class="card"><h3>Enlace listo para ${esc(i.name)}</h3><p class="mu">Envíaselo por WhatsApp. Con él crea su contraseña y entra. Si vence, genera uno nuevo desde su tarjeta.</p><a class="btn p wide" target="_blank" rel="noopener" href="${esc(waUrl(i))}">Abrir WhatsApp</a><button class="s" data-act="copy">Copiar enlace</button> <button class="s" data-act="closeinv">Cerrar</button></div>`;
}

/* ---------- Acciones ---------- */
const say = (id, t) => { const e = $("#" + id); if (e) e.textContent = t; };
async function fnError(error) { try { return (await error.context.json()).error || error.message; } catch { return error.message; } }

const act = {
  async login() {
    const email = $("#le").value.trim().toLowerCase(), password = $("#lp").value;
    if (!email || !password) return say("lerr", "Escribe tu correo y contraseña.");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) say("lerr", "Correo o contraseña incorrectos.");
  },
  async logout() { await sb.auth.signOut(); },
  async setpw() {
    const p = $("#p1").value, q = $("#p2").value;
    if (p.length < 6) return say("perr", "Mínimo 6 caracteres.");
    if (p !== q) return say("perr", "Las contraseñas no coinciden.");
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return say("perr", "No se pudo guardar: " + error.message + " (si el enlace venció, pídele uno nuevo a tu coach).");
    S.recovery = false; history.replaceState(null, "", location.pathname); await load();
  },
  togglenew() { S.showNew = !S.showNew; render(); },
  closeinv() { S.invite = null; render(); },
  copy() { navigator.clipboard?.writeText(S.invite.link).then(() => alert("Enlace copiado")); },
  async create() {
    const v = (id) => $("#" + id).value.trim(), email = v("ae").toLowerCase(), price = Number(v("apr"));
    if (!v("an")) return say("ferr", "Escribe el nombre.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return say("ferr", "Correo no válido.");
    if (email !== v("ae2").toLowerCase()) return say("ferr", "Los dos correos no coinciden. Revisa que esté bien escrito.");
    if (!(price > 0)) return say("ferr", "Escribe la mensualidad.");
    const btn = $("#bcreate"); btn.disabled = true; btn.textContent = "Creando…";
    const { data, error } = await sb.functions.invoke("invite-athlete", { body: {
      first_name: v("an"), email, phone: v("at") || null, group_id: v("ag") || null, modality: v("am"), level: v("alv"),
      monthly_price: price, due_date: v("ad"), goal: v("aj") || null } });
    if (error || !data?.link) { btn.disabled = false; btn.textContent = "Crear atleta y generar enlace"; return say("ferr", error ? await fnError(error) : "No se obtuvo el enlace."); }
    S.invite = { name: v("an"), phone: v("at"), link: data.link }; S.showNew = false; await loadCoach(); render(); scrollTo(0, 0);
  },
  async resend(id) {
    const a = S.athletes.find((x) => x.id === id), p = one(a.profiles) || {};
    const { data, error } = await sb.functions.invoke("invite-athlete", { body: { action: "reset_link", athlete_id: id } });
    if (error || !data?.link) { S.msg = fail(error ? await fnError(error) : "No se obtuvo el enlace."); return render(); }
    S.invite = { name: p.first_name, phone: p.phone, link: data.link }; render(); scrollTo(0, 0);
  },
};
document.addEventListener("click", (e) => { const t = e.target.closest("[data-act]"); if (t && act[t.dataset.act]) act[t.dataset.act](t.dataset.id); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "lp") act.login(); });
render();
