function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRole(roleName) {
  const text = String(roleName || '').trim().toLowerCase();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function showStatus(message, isError) {
  const box = document.getElementById('roleStatusMsg');
  if (!box) return;
  box.textContent = message;
  box.className = `status-box ${isError ? 'status-err' : 'status-ok'}`;
  box.style.display = 'block';
}

async function authFetch(url, init) {
  const response = await fetch(url, init);
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/';
    throw new Error('You are not authorized to use this page.');
  }
  return response;
}

async function loadOptions() {
  const res = await authFetch('/api/user_roles/options');
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error || 'Failed to load options.');

  const userSelect = document.getElementById('userEmailSelect');
  const roleSelect = document.getElementById('roleSelect');

  userSelect.innerHTML = '<option value="">-- Select a user --</option>';
  (payload.users || []).forEach((user) => {
    const option = document.createElement('option');
    option.value = String(user.value || '').trim().toLowerCase();
    option.textContent = String(user.label || user.value || '').trim();
    userSelect.appendChild(option);
  });

  roleSelect.innerHTML = '<option value="">-- Select a role --</option>';
  (payload.roles || []).forEach((role) => {
    const roleName = String(role.role_name || '').trim().toLowerCase();
    const option = document.createElement('option');
    option.value = roleName;
    option.textContent = formatRole(roleName);
    roleSelect.appendChild(option);
  });
}

async function loadUserRoles() {
  const res = await authFetch('/api/user_roles/all');
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error || 'Failed to load assignments.');

  const body = document.getElementById('userRolesBody');
  const rows = Array.isArray(payload.users) ? payload.users : [];

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#566;">No assigned roles yet.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((row) => {
    const chips = (row.roles || []).map((role) => `<span class="role-chip">${escapeHtml(formatRole(role))}</span>`).join(' ');
    return `
      <tr>
        <td>${escapeHtml(row.user_label || row.user_identifier || '')}</td>
        <td>${chips || '<span style="color:#667;">-</span>'}</td>
        <td>
          <button class="danger-btn" type="button" data-email="${escapeHtml(row.user_identifier || '')}">Remove Roles</button>
        </td>
      </tr>
    `;
  }).join('');

  Array.from(document.querySelectorAll('.danger-btn')).forEach((button) => {
    button.addEventListener('click', () => removeRoles(button.dataset.email || ''));
  });
}

async function loadUserProfile(email) {
  const profileEl = document.getElementById('userProfileContent');
  if (!email) {
    profileEl.textContent = 'Select a staff user to view profile details.';
    return;
  }

  try {
    const res = await authFetch('/api/staff_upload/all');
    const payload = await res.json();
    const row = (payload.staff || []).find((item) => String(item.email_school || '').trim().toLowerCase() === String(email || '').trim().toLowerCase());

    if (!row) {
      profileEl.innerHTML = `<div><b>Email:</b> ${escapeHtml(email)}</div><div style="margin-top:0.45rem;color:#677;">Not found in current Staff Upload list.</div>`;
      return;
    }

    const fullName = [row.first_name, row.last_name].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
    profileEl.innerHTML = `
      <div><b>Name:</b> ${escapeHtml(fullName || 'Unknown')}</div>
      <div><b>Email:</b> ${escapeHtml(row.email_school || '')}</div>
      <div><b>Staff Code:</b> ${escapeHtml(row.code || 'N/A')}</div>
      <div><b>Title:</b> ${escapeHtml(row.title || 'N/A')}</div>
      <div><b>Status:</b> ${escapeHtml(row.status || 'N/A')}</div>
    `;
  } catch (err) {
    profileEl.innerHTML = `<span style="color:#a11;">${escapeHtml(err.message || 'Failed to load profile.')}</span>`;
  }
}

async function addRole() {
  const addBtn = document.getElementById('addRoleBtn');
  const emailInput = document.getElementById('userEmailInput');
  const roleSelect = document.getElementById('roleSelect');
  const email = String((emailInput && emailInput.value) || '').trim().toLowerCase();
  const roleName = String((roleSelect && roleSelect.value) || '').trim().toLowerCase();

  if (!email) {
    showStatus('Select or enter a staff email first.', true);
    return;
  }
  if (!roleName) {
    showStatus('Select a role to add.', true);
    return;
  }

  addBtn.disabled = true;
  addBtn.textContent = 'Adding...';

  try {
    const res = await authFetch('/api/user_roles/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_type: 'staff', user_identifier: email, role_name: roleName })
    });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed to add role.');

    showStatus(payload.message || 'Role assigned.', false);
    await loadUserRoles();
  } catch (err) {
    showStatus(err.message || 'Failed to add role.', true);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = 'Add Role';
  }
}

async function removeRoles(email) {
  const userEmail = String(email || '').trim().toLowerCase();
  if (!userEmail) return;
  if (!confirm(`Remove all assigned roles for ${userEmail}?`)) return;

  try {
    const res = await authFetch(`/api/user_roles/staff/${encodeURIComponent(userEmail)}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'Failed to remove roles.');

    showStatus(payload.message || 'Roles removed.', false);
    await loadUserRoles();
  } catch (err) {
    showStatus(err.message || 'Failed to remove roles.', true);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const userSelect = document.getElementById('userEmailSelect');
  const emailInput = document.getElementById('userEmailInput');
  const addBtn = document.getElementById('addRoleBtn');

  userSelect.addEventListener('change', () => {
    const value = String(userSelect.value || '').trim().toLowerCase();
    emailInput.value = value;
    loadUserProfile(value);
  });

  addBtn.addEventListener('click', addRole);

  try {
    await loadOptions();
    await loadUserRoles();
  } catch (err) {
    showStatus(err.message || 'Failed to initialize role management.', true);
  }
});
