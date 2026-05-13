// ─────────────────────────────────────────────────────────────
//  Auth helpers — load after supabase-client.js and utils.js
// ─────────────────────────────────────────────────────────────

// ── Role checks ──────────────────────────────────────────────
// Role hierarchy: member < ap < admin < super_admin
const ADMIN_ROLES = ['admin', 'super_admin'];

function isSuperAdmin(m) { return m?.role === 'super_admin'; }
function isAdmin(m)      { return ADMIN_ROLES.includes(m?.role); }  // true for both admin + super_admin
function isAP(m)         { return m?.role === 'ap'; }
function isAdminOrAP(m)  { return ADMIN_ROLES.includes(m?.role) || m?.role === 'ap'; }

// ── Auth guards ──────────────────────────────────────────────

// requireAuth — hides page body until session confirmed.
// Prevents any flash of protected content for unauthenticated users.
async function requireAuth() {
  document.body.style.visibility = 'hidden';

  const { data: { session } } = await _supabase.auth.getSession();
  if (session) {
    document.body.style.visibility = 'visible';
    return session;
  }

  // Session may still be loading (JWT refresh in flight) — wait up to 5s
  return new Promise(resolve => {
    let done = false;
    const { data: { subscription } } = _supabase.auth.onAuthStateChange((event, sess) => {
      if (done) return;
      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
      done = true;
      subscription.unsubscribe();
      if (!sess) { window.location.href = '/login.html'; resolve(null); return; }
      document.body.style.visibility = 'visible';
      resolve(sess);
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      subscription.unsubscribe();
      window.location.href = '/login.html';
    }, 5000);
  });
}

// requireAdmin — admin pages only; redirects others to dashboard
// Accepts both 'admin' and 'super_admin' roles
async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;
  const { data: m } = await _supabase
    .from('members').select('role').eq('id', session.user.id).single();
  if (!ADMIN_ROLES.includes(m?.role)) { window.location.href = '/dashboard.html'; return null; }
  return session;
}

// requireAdminOrAP — admin + A&P pages; redirects members to dashboard
async function requireAdminOrAP() {
  const session = await requireAuth();
  if (!session) return null;
  const { data: m } = await _supabase
    .from('members').select('role').eq('id', session.user.id).single();
  if (!['admin', 'super_admin', 'ap'].includes(m?.role)) {
    window.location.href = '/dashboard.html'; return null;
  }
  return session;
}

// ── Member data ──────────────────────────────────────────────
async function getCurrentMember() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) return null;
  const { data } = await _supabase
    .from('members').select('*').eq('id', session.user.id).single();
  return data;
}

async function signOut() {
  await _supabase.auth.signOut();
  window.location.href = '/index.html';
}

// ── Nav user widget ──────────────────────────────────────────
// Renders name + role badge + sign-out into #navUser element.
// Call after getCurrentMember() resolves.
function renderNavUser(member) {
  const el = document.getElementById('navUser');
  if (!el || !member) return;

  const roleStyle = {
    super_admin: 'background:linear-gradient(135deg,#E8A030,#c47d10)',
    admin:       'background:linear-gradient(135deg,#667eea,#764ba2)',
    ap:          'background:linear-gradient(135deg,#e67e22,#d35400)',
    member:      'background:rgba(255,255,255,0.12)'
  };
  const roleLabel = { super_admin: 'Super Admin', admin: 'Admin', ap: 'A&P', member: 'Member' };

  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;white-space:nowrap';

  const nm = document.createElement('span');
  nm.className = 'nav-user-name';
  nm.textContent = member.name || member.email;

  const badge = document.createElement('span');
  badge.className = 'nav-role-badge';
  badge.style.cssText = `${roleStyle[member.role] || roleStyle.member};color:#fff;font-size:0.68em;font-weight:700;padding:2px 8px;border-radius:10px;letter-spacing:0.5px;text-transform:uppercase;font-family:'Montserrat',sans-serif`;
  badge.textContent = roleLabel[member.role] || 'Member';

  const btn = document.createElement('button');
  btn.className = 'nav-signout-btn';
  btn.textContent = 'Sign out';
  btn.onclick = signOut;

  wrap.append(nm, badge, btn);
  el.appendChild(wrap);
}

// ── Nav toggle (mobile hamburger) ────────────────────────────
function toggleNav() {
  document.getElementById('navLinks')?.classList.toggle('nav-open');
}
