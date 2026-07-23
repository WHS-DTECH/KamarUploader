function formatDatePart(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function safeText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateStatCard(prefix, item) {
  const currentEl = document.getElementById(`${prefix}Current`);
  const metaEl = document.getElementById(`${prefix}Meta`);
  if (!currentEl || !metaEl) return;

  const counts = (item && item.counts) || {};
  const latest = (item && item.latest_upload) || {};
  currentEl.textContent = String(Number(counts.current || 0));

  const uploadYear = latest.upload_year != null ? latest.upload_year : '-';
  const uploadTerm = latest.upload_term || '-';
  const uploadDate = formatDatePart(latest.upload_date);
  metaEl.textContent = `Total: ${Number(counts.total || 0)} | Last upload: ${uploadYear} ${uploadTerm} (${uploadDate})`;
}

async function loadDashboardStats() {
  try {
    const res = await fetch('/api/feed/summary/current-counts');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load summary.');

    updateStatCard('staff', data.staff);
    updateStatCard('student', data.students);
    updateStatCard('timetable', data.timetable);

    const generatedAtEl = document.getElementById('dashboardUpdated');
    if (generatedAtEl) {
      generatedAtEl.textContent = new Date(data.generated_at).toLocaleTimeString();
    }
  } catch (err) {
    ['staffMeta', 'studentMeta', 'timetableMeta'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = `Error: ${err.message || err}`;
    });
  }
}

function persistSessionUser(user) {
  localStorage.setItem('kamarAuthUser', JSON.stringify(user || null));
  if (user && user.role === 'staff') {
    sessionStorage.setItem('currentStaffUser', JSON.stringify({ email_school: user.email }));
  } else {
    sessionStorage.removeItem('currentStaffUser');
  }
  sessionStorage.setItem('navbar_user_role', String((user && user.role) || 'guest'));
  window.dispatchEvent(new Event('kamar-auth-changed'));
}

function renderUserPanel(user, hintMessage) {
  const panel = document.getElementById('currentUserPanel');
  const hint = document.getElementById('authHint');
  const signOutBtn = document.getElementById('signOutBtn');
  const googleTarget = document.getElementById('googleSignInTarget');

  if (!panel || !hint || !signOutBtn || !googleTarget) return;

  if (user && user.email) {
    panel.innerHTML = `
      <div class="current-user-row"><strong>${safeText(user.name || user.email)}</strong></div>
      <div class="current-user-row">${safeText(user.email)}</div>
      <div class="current-user-row">Role: ${safeText(String(user.role || 'guest').toUpperCase())}</div>
      <div class="current-user-row">Staff record: ${user.in_staff_upload ? 'Yes' : 'No'}</div>
      <div class="current-user-row">Student record: ${user.in_student_upload ? 'Yes' : 'No'}</div>
    `;
    hint.textContent = hintMessage || 'Signed in with Google.';
    signOutBtn.style.display = 'inline-flex';
    googleTarget.style.display = 'none';
    return;
  }

  panel.textContent = 'Not signed in.';
  hint.textContent = hintMessage || 'Use your school Google account to continue.';
  signOutBtn.style.display = 'none';
  googleTarget.style.display = 'block';
}

async function bootstrapExistingSession() {
  try {
    const res = await fetch('/api/auth/session');
    if (!res.ok) {
      localStorage.removeItem('kamarAuthUser');
      renderUserPanel(null);
      return;
    }

    const payload = await res.json();
    if (!payload.success || !payload.user) {
      localStorage.removeItem('kamarAuthUser');
      renderUserPanel(null);
      return;
    }

    persistSessionUser(payload.user);
    renderUserPanel(payload.user);
  } catch (_err) {
    renderUserPanel(null, 'Could not confirm session.');
  }
}

async function handleGoogleCredentialResponse(response) {
  const token = String(response && response.credential ? response.credential : '').trim();
  if (!token) {
    renderUserPanel(null, 'Google sign-in did not return a token.');
    return;
  }

  try {
    const res = await fetch('/api/auth/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: token })
    });
    const payload = await res.json();

    if (!res.ok || !payload.success || !payload.user) {
      throw new Error(payload.error || 'Google login failed.');
    }

    persistSessionUser(payload.user);
    renderUserPanel(payload.user, 'Google sign-in complete.');
  } catch (err) {
    localStorage.removeItem('kamarAuthUser');
    renderUserPanel(null, err.message || 'Google sign-in failed.');
  }
}

async function initGoogleSignIn() {
  const target = document.getElementById('googleSignInTarget');
  if (!target) return;

  try {
    const cfgRes = await fetch('/api/auth/google/config');
    const cfg = await cfgRes.json();

    if (!cfgRes.ok || !cfg.enabled || !cfg.client_id) {
      renderUserPanel(null, 'Google Login is not configured on the server yet.');
      return;
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      renderUserPanel(null, 'Google Identity script failed to load.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: cfg.client_id,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });

    window.google.accounts.id.renderButton(target, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 280
    });

    window.google.accounts.id.prompt();
  } catch (_err) {
    renderUserPanel(null, 'Could not initialize Google Login.');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadDashboardStats();
  await bootstrapExistingSession();
  await initGoogleSignIn();

  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (_err) {
        // Ignore network errors.
      }

      localStorage.removeItem('kamarAuthUser');
      sessionStorage.removeItem('currentStaffUser');
      sessionStorage.removeItem('navbar_user_role');
      window.dispatchEvent(new Event('kamar-auth-changed'));
      renderUserPanel(null, 'Signed out.');
      await initGoogleSignIn();
    });
  }
});
