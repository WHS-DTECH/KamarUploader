function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let auditRows = [];

function showAuditStatus(message, isError) {
  const el = document.getElementById('auditStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `audit-status ${isError ? 'err' : 'ok'}`;
  el.style.display = message ? 'block' : 'none';
}

async function authFetch(url, init) {
  const response = await fetch(url, init);
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/';
    throw new Error('You are not authorized to use this page.');
  }
  return response;
}

function setSummary(summary) {
  const safe = summary || {};
  document.getElementById('summaryTotal').textContent = String(Number(safe.total || 0));
  document.getElementById('summaryLive').textContent = String(Number(safe.live || 0));
  document.getElementById('summaryInProgress').textContent = String(Number(safe.in_progress || 0));
  document.getElementById('summaryNotStarted').textContent = String(Number(safe.not_started || 0));
}

function statusLabel(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'live') return 'Live';
  if (key === 'in_progress') return 'In Progress';
  return 'Not Started';
}

function statusClass(status) {
  const key = String(status || '').trim().toLowerCase();
  if (key === 'live') return 'status-live';
  if (key === 'in_progress') return 'status-in-progress';
  return 'status-not-started';
}

function renderAuditTable() {
  const body = document.getElementById('auditTableBody');
  if (!body) return;

  if (!auditRows.length) {
    body.innerHTML = '<tr><td colspan="6">No subject sites tracked yet.</td></tr>';
    return;
  }

  body.innerHTML = auditRows.map((row) => {
    const sections = [
      row.homepage_ready ? 'Homepage' : '',
      row.standards_ready ? 'Standards' : '',
      row.resources_ready ? 'Resources' : ''
    ].filter(Boolean).join(', ');

    return `
      <tr>
        <td>
          <div><strong>${escapeHtml(row.subject_name || '')}</strong></div>
          <div style="color:#556; margin-top:0.25rem;">${escapeHtml(row.teacher_name || '')}</div>
        </td>
        <td><span class="status-pill ${statusClass(row.site_status)}">${escapeHtml(statusLabel(row.site_status))}</span></td>
        <td>${escapeHtml(sections || 'None marked')}</td>
        <td>${row.site_url ? `<a class="audit-link" href="${escapeHtml(row.site_url)}" target="_blank" rel="noopener noreferrer">Open site</a>` : '<span style="color:#667;">No URL yet</span>'}</td>
        <td>${escapeHtml(row.notes || '')}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="row-btn edit" data-id="${Number(row.id || 0)}">Edit</button>
            <button type="button" class="row-btn delete" data-id="${Number(row.id || 0)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  Array.from(document.querySelectorAll('.row-btn.edit')).forEach((button) => {
    button.addEventListener('click', () => populateForm(Number(button.dataset.id || 0)));
  });
  Array.from(document.querySelectorAll('.row-btn.delete')).forEach((button) => {
    button.addEventListener('click', () => deleteRow(Number(button.dataset.id || 0)));
  });
}

async function loadAudit() {
  const res = await authFetch('/api/site-audit');
  const payload = await res.json();
  if (!payload.success) throw new Error(payload.error || 'Failed to load audit.');
  auditRows = Array.isArray(payload.rows) ? payload.rows : [];
  setSummary(payload.summary || {});
  renderAuditTable();
}

function resetForm() {
  document.getElementById('auditRowId').value = '';
  document.getElementById('subjectName').value = '';
  document.getElementById('teacherName').value = '';
  document.getElementById('siteUrl').value = '';
  document.getElementById('siteStatus').value = 'not_started';
  document.getElementById('homepageReady').checked = false;
  document.getElementById('standardsReady').checked = false;
  document.getElementById('resourcesReady').checked = false;
  document.getElementById('siteNotes').value = '';
  document.getElementById('auditFormTitle').textContent = 'Add Subject Site';
}

function populateForm(id) {
  const row = auditRows.find((item) => Number(item.id || 0) === Number(id || 0));
  if (!row) return;

  document.getElementById('auditRowId').value = String(row.id || '');
  document.getElementById('subjectName').value = String(row.subject_name || '');
  document.getElementById('teacherName').value = String(row.teacher_name || '');
  document.getElementById('siteUrl').value = String(row.site_url || '');
  document.getElementById('siteStatus').value = String(row.site_status || 'not_started');
  document.getElementById('homepageReady').checked = Boolean(row.homepage_ready);
  document.getElementById('standardsReady').checked = Boolean(row.standards_ready);
  document.getElementById('resourcesReady').checked = Boolean(row.resources_ready);
  document.getElementById('siteNotes').value = String(row.notes || '');
  document.getElementById('auditFormTitle').textContent = 'Edit Subject Site';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function collectPayload() {
  return {
    subject_name: String(document.getElementById('subjectName').value || '').trim(),
    teacher_name: String(document.getElementById('teacherName').value || '').trim(),
    site_url: String(document.getElementById('siteUrl').value || '').trim(),
    site_status: String(document.getElementById('siteStatus').value || 'not_started').trim(),
    homepage_ready: document.getElementById('homepageReady').checked,
    standards_ready: document.getElementById('standardsReady').checked,
    resources_ready: document.getElementById('resourcesReady').checked,
    notes: String(document.getElementById('siteNotes').value || '').trim()
  };
}

async function saveRow() {
  const rowId = Number(document.getElementById('auditRowId').value || 0);
  const payload = collectPayload();

  if (!payload.subject_name) {
    showAuditStatus('Subject name is required.', true);
    return;
  }

  const button = document.getElementById('saveAuditBtn');
  button.disabled = true;
  button.textContent = rowId > 0 ? 'Saving...' : 'Adding...';

  try {
    const res = await authFetch(rowId > 0 ? `/api/site-audit/${rowId}` : '/api/site-audit', {
      method: rowId > 0 ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to save audit row.');

    showAuditStatus(rowId > 0 ? 'Audit row updated.' : 'Audit row added.', false);
    resetForm();
    await loadAudit();
  } catch (err) {
    showAuditStatus(err.message || 'Failed to save audit row.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Save Subject Site';
  }
}

async function deleteRow(id) {
  if (!Number.isInteger(id) || id <= 0) return;
  if (!confirm('Delete this subject site audit row?')) return;

  try {
    const res = await authFetch(`/api/site-audit/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to delete audit row.');

    showAuditStatus('Audit row deleted.', false);
    if (Number(document.getElementById('auditRowId').value || 0) === id) resetForm();
    await loadAudit();
  } catch (err) {
    showAuditStatus(err.message || 'Failed to delete audit row.', true);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('saveAuditBtn').addEventListener('click', saveRow);
  document.getElementById('resetAuditBtn').addEventListener('click', () => {
    resetForm();
    showAuditStatus('', false);
  });

  try {
    await loadAudit();
  } catch (err) {
    showAuditStatus(err.message || 'Failed to load subject site audit.', true);
  }
});
