let permissionsData = [];
let ROUTES = ['homepage', 'staff_upload', 'student_upload', 'student_timetable', 'staff_timetable', 'admin_menu'];
const ROUTE_LABELS = {
  homepage: 'Homepage',
  staff_upload: 'Staff Upload',
  student_upload: 'Student Upload',
  student_timetable: 'Student Timetable',
  staff_timetable: 'Staff Timetable',
  admin_menu: 'Admin Menu'
};

async function authFetch(url, init) {
  const response = await fetch(url, init);
  if (response.status === 401 || response.status === 403) {
    window.location.href = '/';
    throw new Error('You are not authorized to use this page.');
  }
  return response;
}

// Fetch permissions from backend on page load
window.addEventListener('DOMContentLoaded', () => {
  fetchPermissions();
  
  document.getElementById('saveBtn').addEventListener('click', savePermissions);
  document.getElementById('resetBtn').addEventListener('click', resetPermissions);
});

function fetchPermissions() {
  authFetch('/api/permissions/all')
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        ROUTES = data.routes || ROUTES;
        permissionsData = data.roles;
        renderPermissionsTable(data.roles);
      } else {
        alert('Failed to load permissions: ' + data.error);
      }
    })
    .catch(err => {
      console.error('Error fetching permissions:', err);
      alert('Failed to load permissions');
    });
}

function renderPermissionsTable(roles = []) {
  const headRow = document.getElementById('permissionsHeadRow');
  const body = document.getElementById('permissionsBody');
  if (headRow) {
    headRow.innerHTML = `<th>Role</th>${ROUTES.map(route => `<th>${ROUTE_LABELS[route] || formatRoleName(route)}</th>`).join('')}`;
  }
  if (!roles.length) {
    body.innerHTML = `<tr><td colspan="${ROUTES.length + 1}">No roles found.</td></tr>`;
    return;
  }
  
  body.innerHTML = roles.map(role => {
    let html = `<tr><td>${formatRoleName(role.role_name)}</td>`;
    ROUTES.forEach(route => {
      const isChecked = role[route] ? 'checked' : '';
      const disabled = route === 'homepage' ? 'disabled' : '';
      html += `<td><input type="checkbox" class="route-checkbox" data-role="${role.role_name}" data-route="${route}" ${isChecked} ${disabled} /></td>`;
    });
    html += '</tr>';
    return html;
  }).join('');
  
  // Add event listeners to checkboxes
  document.querySelectorAll('.route-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', trackChanges);
  });
}

function formatRoleName(roleName) {
  return roleName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function trackChanges() {
  // Mark that changes have been made (for UI feedback if needed)
  console.log('Permission change detected');
}

function savePermissions() {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  const updates = [];
  
  // Build update objects for each role
  const roles = new Set();
  document.querySelectorAll('.route-checkbox').forEach(checkbox => {
    roles.add(checkbox.dataset.role);
  });

  let completed = 0;
  let errors = 0;

  roles.forEach(roleName => {
    const permissions = {};
    ROUTES.forEach(route => {
      const checkbox = document.querySelector(`.route-checkbox[data-role="${roleName}"][data-route="${route}"]`);
      permissions[route] = checkbox ? checkbox.checked : false;
    });

    authFetch(`/api/permissions/${roleName}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(permissions)
    })
      .then(res => res.json())
      .then(data => {
        completed++;
        if (!data.success) {
          errors++;
          console.error(`Failed to update ${roleName}:`, data.error);
        }
        
        if (completed === roles.size) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
          
          if (errors === 0) {
            showSuccessMessage();
          } else {
            alert(`Saved with ${errors} error(s). Check console for details.`);
          }
        }
      })
      .catch(err => {
        completed++;
        errors++;
        console.error(`Error updating ${roleName}:`, err);
        
        if (completed === roles.size) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
          alert(`Failed to save permissions: ${err.message}`);
        }
      });
  });
}

function resetPermissions() {
  if (!confirm('Are you sure you want to reset all permissions to defaults? This cannot be undone.')) {
    return;
  }

  const resetBtn = document.getElementById('resetBtn');
  resetBtn.disabled = true;
  resetBtn.textContent = 'Resetting...';

  authFetch('/api/permissions/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => res.json())
    .then(data => {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Reset to Defaults';
      
      if (data.success) {
        fetchPermissions();
        showSuccessMessage('Permissions reset to defaults successfully!');
      } else {
        alert('Failed to reset permissions: ' + data.error);
      }
    })
    .catch(err => {
      resetBtn.disabled = false;
      resetBtn.textContent = 'Reset to Defaults';
      console.error('Error resetting permissions:', err);
      alert('Failed to reset permissions');
    });
}

function showSuccessMessage(message = 'Permissions updated successfully!') {
  const msgEl = document.getElementById('successMessage');
  msgEl.textContent = message;
  msgEl.classList.add('show');
  
  setTimeout(() => {
    msgEl.classList.remove('show');
  }, 3000);
}
