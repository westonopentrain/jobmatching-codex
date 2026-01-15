/**
 * Job Matching Admin Dashboard
 */

// State
let apiKey = localStorage.getItem('apiKey') || '';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const apiKeyInput = document.getElementById('api-key-input');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const modal = document.getElementById('detail-modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.querySelector('.modal-close');

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Check if already logged in
  if (apiKey) {
    showDashboard();
  }

  // Event listeners
  loginBtn.addEventListener('click', handleLogin);
  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  logoutBtn.addEventListener('click', handleLogout);
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Search handlers
  document.getElementById('job-search-btn').addEventListener('click', () => {
    const jobId = document.getElementById('job-search').value.trim();
    loadJobs(jobId);
  });
  document.getElementById('job-clear-btn').addEventListener('click', () => {
    document.getElementById('job-search').value = '';
    loadJobs();
  });

  document.getElementById('user-search-btn').addEventListener('click', () => {
    const userId = document.getElementById('user-search').value.trim();
    loadUsers(userId);
  });
  document.getElementById('user-clear-btn').addEventListener('click', () => {
    document.getElementById('user-search').value = '';
    loadUsers();
  });

  document.getElementById('match-search-btn').addEventListener('click', () => {
    const jobId = document.getElementById('match-search').value.trim();
    loadMatches(jobId);
  });
  document.getElementById('match-clear-btn').addEventListener('click', () => {
    document.getElementById('match-search').value = '';
    loadMatches();
  });
}

// Auth
async function handleLogin() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    loginError.textContent = 'Please enter an API key';
    return;
  }

  loginError.textContent = 'Verifying...';
  loginBtn.disabled = true;

  try {
    // Test the API key by fetching stats
    const response = await fetch('/admin/stats', {
      headers: { 'Authorization': `Bearer ${key}` }
    });

    if (response.ok) {
      apiKey = key;
      localStorage.setItem('apiKey', key);
      loginError.textContent = '';
      showDashboard();
    } else if (response.status === 401) {
      loginError.textContent = 'Invalid API key';
    } else {
      loginError.textContent = 'Error connecting to server';
    }
  } catch (err) {
    loginError.textContent = 'Network error. Please try again.';
  } finally {
    loginBtn.disabled = false;
  }
}

function handleLogout() {
  apiKey = '';
  localStorage.removeItem('apiKey');
  apiKeyInput.value = '';
  loginScreen.classList.remove('hidden');
  dashboardScreen.classList.add('hidden');
}

function showDashboard() {
  loginScreen.classList.add('hidden');
  dashboardScreen.classList.remove('hidden');
  loadStats();
  loadJobs();
}

// API Calls
async function apiFetch(endpoint) {
  const response = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (response.status === 401) {
    handleLogout();
    throw new Error('Unauthorized');
  }
  return response.json();
}

async function loadStats() {
  try {
    const data = await apiFetch('/admin/stats');
    document.getElementById('stat-jobs').textContent = data.totals.jobs;
    document.getElementById('stat-users').textContent = data.totals.users;
    document.getElementById('stat-matches').textContent = data.totals.matchRequests;
    document.getElementById('stat-jobs-24h').textContent = data.last24Hours.jobs;
    document.getElementById('stat-users-24h').textContent = data.last24Hours.users;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadJobs(jobId = '') {
  const loading = document.getElementById('jobs-loading');
  const tbody = document.querySelector('#jobs-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const endpoint = jobId ? `/admin/jobs?jobId=${encodeURIComponent(jobId)}` : '/admin/jobs?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No jobs found</td></tr>';
      return;
    }

    data.records.forEach(job => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(job.title || 'Untitled')}</td>
        <td><code>${escapeHtml(truncate(job.jobId, 20))}</code></td>
        <td><span class="badge badge-${job.jobClass || 'generic'}">${job.jobClass || '-'}</span></td>
        <td>${job.classificationConfidence ? (job.classificationConfidence * 100).toFixed(0) + '%' : '-'}</td>
        <td>${job.expertiseTier || '-'}</td>
        <td>${formatDate(job.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showJobDetail(job.jobId));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading jobs';
    console.error('Failed to load jobs:', err);
  }
}

async function loadUsers(userId = '') {
  const loading = document.getElementById('users-loading');
  const tbody = document.querySelector('#users-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const endpoint = userId ? `/admin/users?userId=${encodeURIComponent(userId)}` : '/admin/users?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No users found</td></tr>';
      return;
    }

    data.records.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(truncate(user.userId, 20))}</code></td>
        <td>${escapeHtml(user.country || '-')}</td>
        <td>${user.languages?.join(', ') || '-'}</td>
        <td><span class="badge badge-${user.evidenceDetected ? 'success' : 'warning'}">${user.evidenceDetected ? 'Yes' : 'No'}</span></td>
        <td>${user.resumeChars ? user.resumeChars.toLocaleString() + ' chars' : '-'}</td>
        <td>${formatDate(user.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showUserDetail(user.userId));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading users';
    console.error('Failed to load users:', err);
  }
}

async function loadMatches(jobId = '') {
  const loading = document.getElementById('matches-loading');
  const tbody = document.querySelector('#matches-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const endpoint = jobId ? `/admin/matches?jobId=${encodeURIComponent(jobId)}` : '/admin/matches?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No matches found</td></tr>';
      return;
    }

    data.records.forEach(match => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(truncate(match.jobId, 20))}</code></td>
        <td>${match.candidateCount || '-'}</td>
        <td>${match.resultsReturned || 0}</td>
        <td>D:${match.wDomain?.toFixed(2) || '-'} T:${match.wTask?.toFixed(2) || '-'}</td>
        <td>${match.thresholdUsed?.toFixed(2) || '-'}</td>
        <td>${formatDate(match.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showJobDetail(match.jobId));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading matches';
    console.error('Failed to load matches:', err);
  }
}

// Detail Views
async function showJobDetail(jobId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/jobs/${encodeURIComponent(jobId)}`);
    const latest = data.upserts[0];

    if (!latest) {
      modalBody.innerHTML = '<p>Job not found</p>';
      return;
    }

    let html = `
      <div class="detail-header">
        <h2>${escapeHtml(latest.title || 'Untitled Job')}</h2>
        <div class="meta">Job ID: <code>${escapeHtml(jobId)}</code> | Created: ${formatDate(latest.createdAt)}</div>
      </div>

      <div class="detail-section">
        <h3>Classification</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Class</span>
            <span class="value"><span class="badge badge-${latest.jobClass || 'generic'}">${latest.jobClass || '-'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Confidence</span>
            <span class="value">${latest.classificationConfidence ? (latest.classificationConfidence * 100).toFixed(0) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Expertise Tier</span>
            <span class="value">${latest.expertiseTier || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${latest.elapsedMs ? latest.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Credentials Required</h3>
        <div class="keywords">
          ${(latest.credentials && latest.credentials.length > 0)
            ? latest.credentials.map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
            : '<span style="color:#666;">None specified</span>'}
        </div>
      </div>

      <div class="detail-section">
        <h3>Domain Capsule</h3>
        <div class="capsule-text">${escapeHtml(latest.domainCapsule || 'Not generated')}</div>
      </div>

      <div class="detail-section">
        <h3>Task Capsule</h3>
        <div class="capsule-text">${escapeHtml(latest.taskCapsule || 'Not generated')}</div>
      </div>
    `;

    // Match history
    if (data.matchRequests && data.matchRequests.length > 0) {
      html += `
        <div class="detail-section">
          <h3>Match History (${data.matchRequests.length} requests)</h3>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Candidates</th>
                <th>Results</th>
                <th>Weights (D/T)</th>
                <th>Top Users</th>
              </tr>
            </thead>
            <tbody>
      `;

      data.matchRequests.forEach(m => {
        const topUsers = m.results?.slice(0, 3).map(r =>
          `${truncate(r.userId, 12)}: ${(r.finalScore * 100).toFixed(0)}%`
        ).join(', ') || '-';

        html += `
          <tr>
            <td>${formatDate(m.createdAt)}</td>
            <td>${m.candidateCount || '-'}</td>
            <td>${m.resultsReturned || 0}</td>
            <td>${m.wDomain?.toFixed(2) || '-'} / ${m.wTask?.toFixed(2) || '-'}</td>
            <td><small>${escapeHtml(topUsers)}</small></td>
          </tr>
        `;
      });

      html += '</tbody></table></div>';
    }

    modalBody.innerHTML = html;
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading job details</p>';
    console.error('Failed to load job detail:', err);
  }
}

async function showUserDetail(userId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/users/${encodeURIComponent(userId)}`);
    const latest = data.upserts[0];

    if (!latest) {
      modalBody.innerHTML = '<p>User not found</p>';
      return;
    }

    let html = `
      <div class="detail-header">
        <h2>User Profile</h2>
        <div class="meta">User ID: <code>${escapeHtml(userId)}</code> | Created: ${formatDate(latest.createdAt)}</div>
      </div>

      <div class="detail-section">
        <h3>Profile Info</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Country</span>
            <span class="value">${escapeHtml(latest.country || '-')}</span>
          </div>
          <div class="detail-item">
            <span class="label">Languages</span>
            <span class="value">${latest.languages?.join(', ') || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Resume Length</span>
            <span class="value">${latest.resumeChars ? latest.resumeChars.toLocaleString() + ' chars' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${latest.elapsedMs ? latest.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Experience Flags</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Work Experience</span>
            <span class="value"><span class="badge badge-${latest.hasWorkExperience ? 'success' : 'warning'}">${latest.hasWorkExperience ? 'Yes' : 'No'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Education</span>
            <span class="value"><span class="badge badge-${latest.hasEducation ? 'success' : 'warning'}">${latest.hasEducation ? 'Yes' : 'No'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Labeling Experience</span>
            <span class="value"><span class="badge badge-${latest.hasLabelingExperience ? 'success' : 'warning'}">${latest.hasLabelingExperience ? 'Yes' : 'No'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Evidence Detected</span>
            <span class="value"><span class="badge badge-${latest.evidenceDetected ? 'success' : 'error'}">${latest.evidenceDetected ? 'Yes' : 'No'}</span></span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Domain Capsule</h3>
        <div class="capsule-text">${escapeHtml(latest.domainCapsule || 'Not generated')}</div>
      </div>

      <div class="detail-section">
        <h3>Task Capsule</h3>
        <div class="capsule-text">${escapeHtml(latest.taskCapsule || 'Not generated')}</div>
      </div>
    `;

    // Validation violations
    if (latest.validationViolations && latest.validationViolations.length > 0) {
      html += `
        <div class="detail-section">
          <h3>Validation Violations</h3>
          <div class="keywords">
            ${latest.validationViolations.map(v => `<span class="keyword" style="background:#ffebee;color:#c62828;">${escapeHtml(v)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Match results
    if (data.matchResults && data.matchResults.length > 0) {
      html += `
        <div class="detail-section">
          <h3>Match Results (${data.matchResults.length} jobs)</h3>
          <table class="detail-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Domain Score</th>
                <th>Task Score</th>
                <th>Final Score</th>
                <th>Rank</th>
              </tr>
            </thead>
            <tbody>
      `;

      data.matchResults.forEach(r => {
        html += `
          <tr>
            <td><code>${escapeHtml(truncate(r.matchRequest?.jobId || '-', 16))}</code></td>
            <td>${r.sDomain ? (r.sDomain * 100).toFixed(0) + '%' : '-'}</td>
            <td>${r.sTask ? (r.sTask * 100).toFixed(0) + '%' : '-'}</td>
            <td><strong>${r.finalScore ? (r.finalScore * 100).toFixed(0) + '%' : '-'}</strong></td>
            <td>#${r.rank || '-'}</td>
          </tr>
        `;
      });

      html += '</tbody></table></div>';
    }

    modalBody.innerHTML = html;
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading user details</p>';
    console.error('Failed to load user detail:', err);
  }
}

// Tab switching
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.add('hidden');
  });
  document.getElementById(`${tabName}-tab`).classList.remove('hidden');

  // Load data for the tab
  if (tabName === 'jobs') loadJobs();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'matches') loadMatches();
}

// Modal
function closeModal() {
  modal.classList.add('hidden');
}

// Utilities
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return mins <= 1 ? 'Just now' : `${mins}m ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days}d ago`;
  }

  // Otherwise show date
  return date.toLocaleDateString();
}
