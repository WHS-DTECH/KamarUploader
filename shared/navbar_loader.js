(function loadNav() {
  const host = document.getElementById('navbar-include');
  if (!host) return;

  const links = [
    { href: '/', label: 'Home' },
    { href: '/staff_upload.html', label: 'Staff Upload' },
    { href: '/student_details_upload.html', label: 'Student Upload' },
    { href: '/student_upload.html', label: 'Student Timetable' },
    { href: '/timetable_upload.html', label: 'Staff Timetable' }
  ];

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getAuthUser() {
    try {
      const raw = localStorage.getItem('kamarAuthUser');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  function applyNav() {
    const user = getAuthUser();
    const signedIn = Boolean(user && user.email);
    const userText = signedIn
      ? `${user.name || user.email} (${String(user.role || 'guest').toUpperCase()})`
      : 'Not signed in';

    host.innerHTML = `
      <nav class="top-nav" aria-label="Main navigation">
        <div class="top-nav-inner">
          <div class="top-nav-links">
            ${links.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')}
          </div>
          <div class="top-nav-user">
            <span class="top-nav-user-chip">${escapeHtml(userText)}</span>
            ${signedIn
              ? '<button id="topNavSignOutBtn" type="button" class="top-nav-signout">Sign out</button>'
              : '<a href="/" class="top-nav-signin-link">Sign in</a>'}
          </div>
        </div>
      </nav>
    `;

    const signOutBtn = document.getElementById('topNavSignOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch (_err) {
          // Ignore network errors during sign out.
        }

        localStorage.removeItem('kamarAuthUser');
        sessionStorage.removeItem('currentStaffUser');
        sessionStorage.removeItem('navbar_user_role');
        window.dispatchEvent(new Event('kamar-auth-changed'));
        window.location.href = '/';
      });
    }
  }

  applyNav();
  window.addEventListener('kamar-auth-changed', applyNav);
})();
