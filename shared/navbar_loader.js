(function loadNav() {
  const host = document.getElementById('navbar-include');
  if (!host) return;

  const links = [
    { href: '/staff_upload.html', label: 'Staff Upload' },
    { href: '/student_upload.html', label: 'Student Timetable' },
    { href: '/timetable_upload.html', label: 'Staff Timetable' }
  ];

  host.innerHTML = `
    <nav class="top-nav" aria-label="Main navigation">
      <div class="top-nav-inner">
        ${links.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')}
      </div>
    </nav>
  `;
})();
