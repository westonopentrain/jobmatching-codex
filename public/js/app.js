/**
 * Job Matching Admin Dashboard
 */

// State
let apiKey = localStorage.getItem('apiKey') || '';
let currentMatchContext = null; // Stores { matchRequest, jobInfo, results, currentIndex }
let currentRecContext = null; // Stores { matchRequest, userInfo, results, currentIndex }
let currentNotifyContext = null; // Stores { notifyRequest, jobInfo, results, currentIndex }

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

  // Keyboard navigation for candidate/job detail view
  document.addEventListener('keydown', (e) => {
    if (currentMatchContext) {
      if (e.key === 'ArrowLeft') {
        navigateCandidate(-1);
      } else if (e.key === 'ArrowRight') {
        navigateCandidate(1);
      } else if (e.key === 'Escape') {
        backToMatchList();
      }
    } else if (currentRecContext) {
      if (e.key === 'ArrowLeft') {
        navigateRecJob(-1);
      } else if (e.key === 'ArrowRight') {
        navigateRecJob(1);
      } else if (e.key === 'Escape') {
        backToRecList();
      }
    } else if (currentNotifyContext) {
      if (e.key === 'ArrowLeft') {
        navigateNotifyUser(-1);
      } else if (e.key === 'ArrowRight') {
        navigateNotifyUser(1);
      } else if (e.key === 'Escape') {
        backToNotifyList();
      }
    }
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

  document.getElementById('rec-search-btn').addEventListener('click', () => {
    const userId = document.getElementById('rec-search').value.trim();
    loadRecommendations(userId);
  });
  document.getElementById('rec-clear-btn').addEventListener('click', () => {
    document.getElementById('rec-search').value = '';
    loadRecommendations();
  });

  document.getElementById('notify-search-btn').addEventListener('click', () => {
    const jobId = document.getElementById('notify-search').value.trim();
    loadNotifications(jobId);
  });
  document.getElementById('notify-clear-btn').addEventListener('click', () => {
    document.getElementById('notify-search').value = '';
    loadNotifications();
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
  loadOverview();
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

async function apiDelete(endpoint) {
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (response.status === 401) {
    handleLogout();
    throw new Error('Unauthorized');
  }
  return response.json();
}

async function deleteJob(jobId) {
  if (!confirm(`Are you sure you want to delete job ${jobId}?\n\nThis will remove:\n- Job vectors from Pinecone\n- All audit records for this job`)) {
    return;
  }

  try {
    await apiDelete(`/v1/jobs/${encodeURIComponent(jobId)}`);
    alert('Job deleted successfully');
    closeModal();
    loadJobs();
    loadStats();
  } catch (err) {
    alert('Failed to delete job: ' + err.message);
    console.error('Failed to delete job:', err);
  }
}

async function deleteUser(userId) {
  if (!confirm(`Are you sure you want to delete user ${userId}?\n\nThis will remove:\n- User vectors from Pinecone\n- All audit records for this user`)) {
    return;
  }

  try {
    await apiDelete(`/v1/users/${encodeURIComponent(userId)}`);
    alert('User deleted successfully');
    closeModal();
    loadUsers();
    loadStats();
  } catch (err) {
    alert('Failed to delete user: ' + err.message);
    console.error('Failed to delete user:', err);
  }
}

async function deleteMatch(matchId) {
  if (!confirm(`Are you sure you want to delete this match?\n\nThis will remove the match request and all scored results from the audit trail.`)) {
    return;
  }

  try {
    await apiDelete(`/admin/matches/${matchId}`);
    alert('Match deleted successfully');
    closeModal();
    loadMatches();
    loadStats();
  } catch (err) {
    alert('Failed to delete match: ' + err.message);
    console.error('Failed to delete match:', err);
  }
}

async function loadStats() {
  try {
    const [data, qualData] = await Promise.all([
      apiFetch('/admin/stats'),
      apiFetch('/admin/qualifications/summary').catch(() => null),
    ]);
    document.getElementById('stat-jobs').textContent = data.totals.jobs;
    document.getElementById('stat-users').textContent = data.totals.users;
    document.getElementById('stat-jobs-24h').textContent = data.last24Hours.jobs;
    document.getElementById('stat-users-24h').textContent = data.last24Hours.users;
    document.getElementById('stat-notifications').textContent = data.totals.notifications || 0;
    document.getElementById('stat-failures').textContent = data.totals.upsertFailures || 0;

    // Update failures stat styling based on count
    const failuresValue = data.totals.upsertFailures || 0;
    const failuresStat = document.querySelector('.stat-failures');
    if (failuresStat) {
      if (failuresValue > 0) {
        failuresStat.classList.add('stat-warning');
      } else {
        failuresStat.classList.remove('stat-warning');
      }
    }

    // Qualification summary stats
    if (qualData) {
      document.getElementById('stat-pending').textContent = qualData.pendingNotifications || 0;
      document.getElementById('stat-active-jobs').textContent = qualData.activeJobs || 0;
    }
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
        <td><span class="badge badge-${user.expertiseTier || 'entry'}">${user.expertiseTier || 'entry'}</span></td>
        <td>${escapeHtml(user.country || '-')}</td>
        <td>${escapeHtml(truncate(user.domainCapsule || '-', 60))}</td>
        <td><span class="badge badge-${user.evidenceDetected ? 'success' : 'warning'}">${user.evidenceDetected ? 'Yes' : 'No'}</span></td>
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
      const jobDisplay = match.jobTitle || truncate(match.jobId, 20);
      tr.innerHTML = `
        <td>
          <div style="font-weight:500;">${escapeHtml(jobDisplay)}</div>
          <div style="font-size:11px;color:#666;"><code>${escapeHtml(truncate(match.jobId, 24))}</code></div>
        </td>
        <td>${match.candidateCount || '-'}</td>
        <td>${match.resultsReturned || 0}</td>
        <td><span class="badge badge-${match.weightsSource === 'auto' ? 'success' : 'generic'}">${match.weightsSource || 'manual'}</span> D:${match.wDomain?.toFixed(2) || '-'} T:${match.wTask?.toFixed(2) || '-'}</td>
        <td>${match.thresholdUsed?.toFixed(2) || 'none'}</td>
        <td>${formatDate(match.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showMatchDetail(match.id));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading matches';
    console.error('Failed to load matches:', err);
  }
}

async function loadRecommendations(userId = '') {
  const loading = document.getElementById('recs-loading');
  const tbody = document.querySelector('#recs-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const endpoint = userId ? `/admin/recommendations?userId=${encodeURIComponent(userId)}` : '/admin/recommendations?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No recommendations found</td></tr>';
      return;
    }

    data.records.forEach(rec => {
      const tr = document.createElement('tr');
      const userDisplay = rec.userInfo?.domainCapsule ? truncate(rec.userInfo.domainCapsule.split('Keywords')[0], 40) : truncate(rec.userId, 20);
      tr.innerHTML = `
        <td>
          <div style="font-weight:500;">${escapeHtml(userDisplay)}</div>
          <div style="font-size:11px;color:#666;"><code>${escapeHtml(truncate(rec.userId, 24))}</code></div>
        </td>
        <td><span class="badge badge-${rec.userExpertiseTier || 'entry'}">${rec.userExpertiseTier || 'entry'}</span></td>
        <td>${rec.jobCount || '-'}</td>
        <td>${rec.countGteThreshold || 0}</td>
        <td>${rec.suggestedThreshold ? (rec.suggestedThreshold * 100).toFixed(0) + '%' : '-'} <small>(${rec.suggestedThresholdMethod || ''})</small></td>
        <td>${formatDate(rec.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showRecommendationDetail(rec.id));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading recommendations';
    console.error('Failed to load recommendations:', err);
  }
}

async function deleteRecommendation(recId) {
  if (!confirm(`Are you sure you want to delete this recommendation?\n\nThis will remove the recommendation request and all scored jobs from the audit trail.`)) {
    return;
  }

  try {
    await apiDelete(`/admin/recommendations/${recId}`);
    alert('Recommendation deleted successfully');
    closeModal();
    loadRecommendations();
    loadStats();
  } catch (err) {
    alert('Failed to delete recommendation: ' + err.message);
    console.error('Failed to delete recommendation:', err);
  }
}

async function loadNotifications(jobId = '') {
  const loading = document.getElementById('notifications-loading');
  const tbody = document.querySelector('#notifications-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const endpoint = jobId ? `/admin/notifications?jobId=${encodeURIComponent(jobId)}` : '/admin/notifications?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#666;">No notifications found</td></tr>';
      return;
    }

    data.records.forEach(notify => {
      const tr = document.createElement('tr');
      const jobDisplay = notify.title || truncate(notify.jobId, 20);
      const filters = [];
      if (notify.countriesFilter?.length) filters.push(`${notify.countriesFilter.length} countries`);
      if (notify.languagesFilter?.length) filters.push(`${notify.languagesFilter.length} languages`);
      const filterDisplay = filters.length > 0 ? filters.join(', ') : 'None';

      // Determine status
      let statusBadge = '';
      if (notify.notifyCount > 0) {
        statusBadge = '<span class="badge badge-success">OK</span>';
      } else if (notify.totalCandidates === 0) {
        statusBadge = '<span class="badge badge-warning">No candidates</span>';
      } else {
        statusBadge = '<span class="badge badge-error">0 notified</span>';
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight:500;">${escapeHtml(jobDisplay)}</div>
          <div style="font-size:11px;color:#666;"><code>${escapeHtml(truncate(notify.jobId, 24))}</code></div>
        </td>
        <td>${notify.totalCandidates}</td>
        <td><strong>${notify.notifyCount}</strong></td>
        <td>${notify.totalAboveThreshold}</td>
        <td><small>${escapeHtml(filterDisplay)}</small></td>
        <td>${formatDate(notify.createdAt)}</td>
        <td>${statusBadge}</td>
      `;
      tr.addEventListener('click', () => showNotificationDetail(notify.id));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading notifications';
    console.error('Failed to load notifications:', err);
  }
}

async function deleteNotification(notifyId) {
  if (!confirm(`Are you sure you want to delete this notification?\n\nThis will remove the notification request and all user results from the audit trail.`)) {
    return;
  }

  try {
    await apiDelete(`/admin/notifications/${notifyId}`);
    alert('Notification deleted successfully');
    closeModal();
    loadNotifications();
    loadStats();
  } catch (err) {
    alert('Failed to delete notification: ' + err.message);
    console.error('Failed to delete notification:', err);
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
        <button class="btn-delete" onclick="deleteJob('${escapeHtml(jobId)}')">Delete Job</button>
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
        <h3>Subject Matter Requirements</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Strictness</span>
            <span class="value"><span class="badge badge-${latest.subjectMatterStrictness === 'strict' ? 'error' : (latest.subjectMatterStrictness === 'lenient' ? 'success' : 'warning')}">${latest.subjectMatterStrictness || 'moderate'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Threshold</span>
            <span class="value">${latest.subjectMatterStrictness === 'strict' ? '80%' : (latest.subjectMatterStrictness === 'lenient' ? '60%' : '70%')}</span>
          </div>
        </div>
        <div style="margin-top:12px;">
          <strong>Required Codes:</strong>
          <div class="keywords" style="margin-top:4px;">
            ${(latest.subjectMatterCodes && latest.subjectMatterCodes.length > 0)
              ? latest.subjectMatterCodes.map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
              : '<span style="color:#666;">None specified</span>'}
          </div>
        </div>
        ${(latest.acceptableSubjectCodes && latest.acceptableSubjectCodes.length > 0) ? `
          <div style="margin-top:12px;">
            <strong>Also Acceptable:</strong>
            <div class="keywords" style="margin-top:4px;">
              ${latest.acceptableSubjectCodes.map(c => `<span class="keyword" style="background:#e3f2fd;color:#1565c0;">${escapeHtml(c)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
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
        <button class="btn-delete" onclick="deleteUser('${escapeHtml(userId)}')">Delete User</button>
      </div>

      <div class="detail-section">
        <h3>Classification</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Expertise Tier</span>
            <span class="value"><span class="badge badge-${latest.expertiseTier || 'entry'}">${latest.expertiseTier || 'entry'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Confidence</span>
            <span class="value">${latest.classificationConfidence ? (latest.classificationConfidence * 100).toFixed(0) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Years Experience</span>
            <span class="value">${latest.yearsExperience ?? '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${latest.elapsedMs ? latest.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Credentials</h3>
        <div class="keywords">
          ${(latest.credentials && latest.credentials.length > 0)
            ? latest.credentials.map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
            : '<span style="color:#666;">None specified</span>'}
        </div>
      </div>

      <div class="detail-section">
        <h3>Subject Matter Expertise</h3>
        <div class="keywords">
          ${(latest.subjectMatterCodes && latest.subjectMatterCodes.length > 0)
            ? latest.subjectMatterCodes.map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
            : '<span style="color:#666;">None specified</span>'}
        </div>
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
            <span class="label">Labeling Experience</span>
            <span class="value"><span class="badge badge-${latest.evidenceDetected ? 'success' : 'warning'}">${latest.evidenceDetected ? 'Yes' : 'No'}</span></span>
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

    // Raw input from Bubble
    if (latest.rawInput) {
      const raw = latest.rawInput;
      html += `
        <div class="detail-section">
          <h3>Raw Input from Bubble</h3>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="label">User ID</span>
              <span class="value"><code>${escapeHtml(raw.user_id || '-')}</code></span>
            </div>
            <div class="detail-item">
              <span class="label">Country</span>
              <span class="value">${escapeHtml(raw.country || '-')}</span>
            </div>
            <div class="detail-item">
              <span class="label">Languages</span>
              <span class="value">${Array.isArray(raw.languages) ? raw.languages.join(', ') : (raw.languages || '-')}</span>
            </div>
          </div>
          ${raw.resume_text ? `
            <div style="margin-top:12px;">
              <strong>Resume Text:</strong>
              <div class="capsule-text" style="margin-top:4px;max-height:200px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(raw.resume_text)}</div>
            </div>
          ` : ''}
          ${raw.work_experience && raw.work_experience.length > 0 ? `
            <div style="margin-top:12px;">
              <strong>Work Experience:</strong>
              <ul style="margin:4px 0 0 20px;">
                ${raw.work_experience.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${raw.education && raw.education.length > 0 ? `
            <div style="margin-top:12px;">
              <strong>Education:</strong>
              <ul style="margin:4px 0 0 20px;">
                ${raw.education.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${raw.labeling_experience && raw.labeling_experience.length > 0 ? `
            <div style="margin-top:12px;">
              <strong>Labeling Experience:</strong>
              <ul style="margin:4px 0 0 20px;">
                ${raw.labeling_experience.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }

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

// Match Detail View
async function showMatchDetail(matchId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/matches/${matchId}`);

    if (data.error) {
      modalBody.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
      return;
    }

    const m = data.matchRequest;
    const job = data.jobInfo;

    let html = `
      <div class="detail-header">
        <h2>${job?.title ? escapeHtml(job.title) : 'Match Scoring Results'}</h2>
        <div class="meta">
          Job ID: <code>${escapeHtml(m.jobId)}</code> |
          Scored: ${formatDate(m.createdAt)}
        </div>
        <button class="btn-delete" onclick="deleteMatch(${m.id})">Delete Match</button>
      </div>

      <div class="detail-section">
        <h3>Scoring Configuration</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Job Classification</span>
            <span class="value"><span class="badge badge-${job?.jobClass || 'generic'}">${job?.jobClass || '-'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Weights Source</span>
            <span class="value"><span class="badge badge-${m.weightsSource === 'auto' ? 'success' : 'generic'}">${m.weightsSource || 'manual'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Domain Weight</span>
            <span class="value">${m.wDomain ? (m.wDomain * 100).toFixed(0) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Task Weight</span>
            <span class="value">${m.wTask ? (m.wTask * 100).toFixed(0) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Candidates Scored</span>
            <span class="value">${m.candidateCount || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Results Returned</span>
            <span class="value">${m.resultsReturned || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Threshold</span>
            <span class="value">${m.thresholdUsed?.toFixed(2) || 'none'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${m.elapsedMs ? m.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>
    `;

    // Job capsules for reference
    if (job) {
      html += `
        <div class="detail-section collapsible">
          <h3 onclick="this.parentElement.classList.toggle('collapsed')">Job Capsules (click to expand)</h3>
          <div class="collapsible-content">
            <div style="margin-bottom: 12px;">
              <strong>Domain:</strong>
              <div class="capsule-text" style="margin-top:4px;">${escapeHtml(job.domainCapsule || '-')}</div>
            </div>
            <div>
              <strong>Task:</strong>
              <div class="capsule-text" style="margin-top:4px;">${escapeHtml(job.taskCapsule || '-')}</div>
            </div>
          </div>
        </div>
      `;
    }

    // All scored users
    html += `
      <div class="detail-section">
        <h3>All Scored Users (${m.results?.length || 0} candidates)</h3>
        <table class="detail-table score-table">
          <thead>
            <tr>
              <th style="width:40px">Rank</th>
              <th style="width:80px">Final</th>
              <th style="width:70px">Domain</th>
              <th style="width:70px">Task</th>
              <th>User Info</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (m.results && m.results.length > 0) {
      m.results.forEach((r, idx) => {
        const user = r.userInfo;
        const finalPct = r.finalScore ? (r.finalScore * 100).toFixed(1) : '-';
        const domainPct = r.sDomain ? (r.sDomain * 100).toFixed(1) : '-';
        const taskPct = r.sTask ? (r.sTask * 100).toFixed(1) : '-';

        // Color code by score
        let scoreClass = '';
        if (r.finalScore >= 0.7) scoreClass = 'score-high';
        else if (r.finalScore >= 0.5) scoreClass = 'score-medium';
        else if (r.finalScore >= 0.3) scoreClass = 'score-low';
        else scoreClass = 'score-poor';

        const userCaption = user?.domainCapsule ? truncate(user.domainCapsule.split('Keywords')[0], 80) : '-';
        const credentials = user?.credentials?.length ? user.credentials.join(', ') : '';
        const expertise = user?.expertiseTier || 'entry';

        html += `
          <tr class="clickable-row ${scoreClass}" data-candidate-index="${idx}">
            <td><strong>#${r.rank || idx + 1}</strong></td>
            <td><strong>${finalPct}%</strong></td>
            <td>${domainPct}%</td>
            <td>${taskPct}%</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code style="font-size:11px;">${escapeHtml(truncate(r.userId, 18))}</code>
                <span class="badge badge-${expertise}" style="font-size:10px;">${expertise}</span>
                ${credentials ? `<span style="font-size:11px;color:#666;">${escapeHtml(truncate(credentials, 30))}</span>` : ''}
              </div>
              <div style="font-size:11px;color:#666;margin-top:2px;">${escapeHtml(userCaption)}</div>
            </td>
          </tr>
        `;
      });
    } else {
      html += '<tr><td colspan="5" style="text-align:center;color:#666;">No results</td></tr>';
    }

    html += '</tbody></table></div>';

    modalBody.innerHTML = html;

    // Store context for candidate navigation
    currentMatchContext = {
      matchRequest: m,
      jobInfo: job,
      results: m.results || [],
      currentIndex: -1
    };

    // Add click handlers for candidate rows
    modalBody.querySelectorAll('[data-candidate-index]').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.candidateIndex, 10);
        showCandidateDetail(idx);
      });
    });
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading match details</p>';
    console.error('Failed to load match detail:', err);
  }
}

// Recommendation Detail View (user→jobs)
async function showRecommendationDetail(recId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/recommendations/${recId}`);

    if (data.error) {
      modalBody.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
      return;
    }

    const m = data.matchRequest;
    const user = data.userInfo;

    let html = `
      <div class="detail-header">
        <h2>Job Recommendations for User</h2>
        <div class="meta">
          User ID: <code>${escapeHtml(m.userId)}</code> |
          Scored: ${formatDate(m.createdAt)}
        </div>
        <button class="btn-delete" onclick="deleteRecommendation(${m.id})">Delete</button>
      </div>

      <div class="detail-section">
        <h3>User Profile</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Expertise Tier</span>
            <span class="value"><span class="badge badge-${m.userExpertiseTier || 'entry'}">${m.userExpertiseTier || 'entry'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Country</span>
            <span class="value">${escapeHtml(user?.country || '-')}</span>
          </div>
          <div class="detail-item">
            <span class="label">Languages</span>
            <span class="value">${user?.languages?.join(', ') || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Credentials</span>
            <span class="value">${user?.credentials?.length ? user.credentials.join(', ') : 'None'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Scoring Configuration</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Weights Source</span>
            <span class="value"><span class="badge badge-${m.weightsSource === 'auto' ? 'success' : 'generic'}">${m.weightsSource || 'auto'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Jobs Scored</span>
            <span class="value">${m.jobCount || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Results Returned</span>
            <span class="value">${m.resultsReturned || '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Above Threshold</span>
            <span class="value">${m.countGteThreshold || 0}</span>
          </div>
          <div class="detail-item">
            <span class="label">Suggested Threshold</span>
            <span class="value">${m.suggestedThreshold ? (m.suggestedThreshold * 100).toFixed(0) + '%' : '-'} (${m.suggestedThresholdMethod || '-'})</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${m.elapsedMs ? m.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>
    `;

    // User capsules
    if (user) {
      html += `
        <div class="detail-section collapsible">
          <h3 onclick="this.parentElement.classList.toggle('collapsed')">User Capsules (click to expand)</h3>
          <div class="collapsible-content">
            <div style="margin-bottom: 12px;">
              <strong>Domain:</strong>
              <div class="capsule-text" style="margin-top:4px;">${escapeHtml(user.domainCapsule || '-')}</div>
            </div>
            <div>
              <strong>Task:</strong>
              <div class="capsule-text" style="margin-top:4px;">${escapeHtml(user.taskCapsule || '-')}</div>
            </div>
          </div>
        </div>
      `;
    }

    // Scored jobs table with per-job thresholds
    // Each job has its own threshold based on user tier and job class:
    // - Specialists: 45% for generic jobs, 50% for specialized
    // - Entry/Intermediate: 35% for generic, 50% for specialized
    html += `
      <div class="detail-section">
        <h3>All Scored Jobs (${m.results?.length || 0} jobs)</h3>
        <table class="detail-table score-table">
          <thead>
            <tr>
              <th style="width:40px">Rank</th>
              <th style="width:80px">Final</th>
              <th style="width:60px">Thresh</th>
              <th style="width:70px">Domain</th>
              <th style="width:70px">Task</th>
              <th>Job Info</th>
              <th style="width:80px">Status</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (m.results && m.results.length > 0) {
      m.results.forEach((r, idx) => {
        const job = r.jobInfo;
        const finalPct = r.finalScore ? (r.finalScore * 100).toFixed(1) : '-';
        const domainPct = r.sDomain ? (r.sDomain * 100).toFixed(1) : '-';
        const taskPct = r.sTask ? (r.sTask * 100).toFixed(1) : '-';
        // Use per-job threshold from API if available, otherwise fall back to global
        const jobThreshold = r.jobThreshold ?? m.suggestedThreshold ?? 0.35;
        const thresholdPct = (jobThreshold * 100).toFixed(0);
        // Use aboveThreshold from API if available, otherwise calculate
        const aboveThreshold = r.aboveThreshold ?? (r.finalScore >= jobThreshold);

        // Color code by score
        let scoreClass = '';
        if (r.finalScore >= 0.7) scoreClass = 'score-high';
        else if (r.finalScore >= 0.5) scoreClass = 'score-medium';
        else if (r.finalScore >= 0.3) scoreClass = 'score-low';
        else scoreClass = 'score-poor';

        const jobTitle = job?.title || truncate(r.jobId, 30);
        const weights = r.wDomain && r.wTask ? `D:${(r.wDomain * 100).toFixed(0)}% T:${(r.wTask * 100).toFixed(0)}%` : '';

        html += `
          <tr class="clickable-row ${scoreClass}" data-job-index="${idx}">
            <td><strong>#${r.rank || idx + 1}</strong></td>
            <td><strong>${finalPct}%</strong></td>
            <td style="color:#666;">${thresholdPct}%</td>
            <td>${domainPct}%</td>
            <td>${taskPct}%</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-weight:500;">${escapeHtml(truncate(jobTitle, 40))}</span>
                <span class="badge badge-${r.jobClass || 'generic'}" style="font-size:10px;">${r.jobClass || 'generic'}</span>
                ${weights ? `<span style="font-size:10px;color:#666;">${weights}</span>` : ''}
              </div>
              <div style="font-size:11px;color:#666;margin-top:2px;"><code>${escapeHtml(truncate(r.jobId, 24))}</code></div>
            </td>
            <td>
              <span class="badge badge-${aboveThreshold ? 'success' : 'warning'}">${aboveThreshold ? 'Match' : 'Below'}</span>
            </td>
          </tr>
        `;
      });
    } else {
      html += '<tr><td colspan="7" style="text-align:center;color:#666;">No results</td></tr>';
    }

    html += '</tbody></table></div>';

    modalBody.innerHTML = html;

    // Store context for job navigation
    currentRecContext = {
      matchRequest: m,
      userInfo: user,
      results: m.results || [],
      currentIndex: -1
    };

    // Add click handlers for job rows
    modalBody.querySelectorAll('[data-job-index]').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.jobIndex, 10);
        showJobFromRecDetail(idx);
      });
    });
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading recommendation details</p>';
    console.error('Failed to load recommendation detail:', err);
  }
}

// Job Detail from Recommendation View (with navigation)
async function showJobFromRecDetail(index) {
  if (!currentRecContext || !currentRecContext.results[index]) return;

  currentRecContext.currentIndex = index;
  const result = currentRecContext.results[index];
  const user = currentRecContext.userInfo;
  const total = currentRecContext.results.length;
  const suggestedThreshold = currentRecContext.matchRequest.suggestedThreshold || 0;

  const job = result.jobInfo;
  const finalPct = result.finalScore ? (result.finalScore * 100).toFixed(1) : '-';
  const domainPct = result.sDomain ? (result.sDomain * 100).toFixed(1) : '-';
  const taskPct = result.sTask ? (result.sTask * 100).toFixed(1) : '-';
  const aboveThreshold = result.finalScore >= suggestedThreshold;

  let html = `
    <div class="candidate-nav">
      <button class="nav-btn" onclick="navigateRecJob(-1)" ${index === 0 ? 'disabled' : ''}>← Previous</button>
      <span class="nav-info">
        <strong>Job ${index + 1} of ${total}</strong>
        for user ${escapeHtml(truncate(currentRecContext.matchRequest.userId, 16))}
      </span>
      <button class="nav-btn" onclick="navigateRecJob(1)" ${index >= total - 1 ? 'disabled' : ''}>Next →</button>
    </div>
    <div class="candidate-nav-hint">Use ← → arrow keys to navigate, Esc to go back</div>

    <div class="detail-section scores-section">
      <div class="score-boxes">
        <div class="score-box ${getScoreClass(result.finalScore)}">
          <div class="score-label">Final Score</div>
          <div class="score-value">${finalPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Domain</div>
          <div class="score-value">${domainPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Task</div>
          <div class="score-value">${taskPct}%</div>
        </div>
        <div class="score-box ${aboveThreshold ? 'score-high' : 'score-poor'}">
          <div class="score-label">Status</div>
          <div class="score-value">${aboveThreshold ? 'Match' : 'Below'}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Why This Score?</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="label">Job Class</span>
          <span class="value"><span class="badge badge-${result.jobClass || 'generic'}">${result.jobClass || 'generic'}</span></span>
        </div>
        <div class="detail-item">
          <span class="label">Weights Used</span>
          <span class="value">D:${result.wDomain ? (result.wDomain * 100).toFixed(0) : '-'}% / T:${result.wTask ? (result.wTask * 100).toFixed(0) : '-'}%</span>
        </div>
        <div class="detail-item">
          <span class="label">Suggested Threshold</span>
          <span class="value">${(suggestedThreshold * 100).toFixed(0)}%</span>
        </div>
        <div class="detail-item">
          <span class="label">Score vs Threshold</span>
          <span class="value">${finalPct}% ${result.finalScore >= suggestedThreshold ? '>=' : '<'} ${(suggestedThreshold * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Job Info</h3>
      <div class="detail-grid">
        <div class="detail-item" style="grid-column: 1 / -1;">
          <span class="label">Title</span>
          <span class="value" style="font-weight:500;">${escapeHtml(job?.title || 'Unknown')}</span>
        </div>
        <div class="detail-item" style="grid-column: 1 / -1;">
          <span class="label">Job ID</span>
          <span class="value"><code>${escapeHtml(result.jobId)}</code></span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Capsule Comparison</h3>
      <div class="capsule-comparison">
        <div class="capsule-item">
          <div class="capsule-label">User Domain Capsule</div>
          <div class="capsule-text">${escapeHtml(user?.domainCapsule || '-')}</div>
        </div>
        <div class="capsule-item">
          <div class="capsule-label">Job Domain Capsule</div>
          <div class="capsule-text">${escapeHtml(job?.domainCapsule || '-')}</div>
        </div>
      </div>
      <div class="capsule-comparison" style="margin-top:16px;">
        <div class="capsule-item">
          <div class="capsule-label">User Task Capsule</div>
          <div class="capsule-text">${escapeHtml(user?.taskCapsule || '-')}</div>
        </div>
        <div class="capsule-item">
          <div class="capsule-label">Job Task Capsule</div>
          <div class="capsule-text">${escapeHtml(job?.taskCapsule || '-')}</div>
        </div>
      </div>
    </div>
  `;

  // Back button
  html += `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
      <button class="nav-btn" onclick="backToRecList()">← Back to Recommendation Results</button>
    </div>
  `;

  modalBody.innerHTML = html;
}

function navigateRecJob(direction) {
  if (!currentRecContext) return;
  const newIndex = currentRecContext.currentIndex + direction;
  if (newIndex >= 0 && newIndex < currentRecContext.results.length) {
    showJobFromRecDetail(newIndex);
  }
}

function backToRecList() {
  if (!currentRecContext) {
    closeModal();
    return;
  }
  const recId = currentRecContext.matchRequest.id;
  currentRecContext = null;
  showRecommendationDetail(recId);
}

// Notification Detail View
async function showNotificationDetail(notifyId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/notifications/${notifyId}`);

    if (data.error) {
      modalBody.innerHTML = `<p class="error">${escapeHtml(data.error)}</p>`;
      return;
    }

    const n = data.notifyRequest;
    const job = data.jobInfo;

    // Separate notified and filtered users
    const notifiedUsers = n.results.filter(r => r.notified);
    const filteredUsers = n.results.filter(r => !r.notified);

    let html = `
      <div class="detail-header">
        <h2>${job?.title ? escapeHtml(job.title) : 'Job Notification Results'}</h2>
        <div class="meta">
          Job ID: <code>${escapeHtml(n.jobId)}</code> |
          Sent: ${formatDate(n.createdAt)}
        </div>
        <button class="btn-delete" onclick="deleteNotification(${n.id})">Delete</button>
      </div>

      <div class="detail-section">
        <h3>Summary</h3>
        <div class="score-boxes">
          <div class="score-box ${n.notifyCount > 0 ? 'score-high' : 'score-poor'}">
            <div class="score-label">Notified</div>
            <div class="score-value">${n.notifyCount}</div>
          </div>
          <div class="score-box">
            <div class="score-label">Above Threshold</div>
            <div class="score-value">${n.totalAboveThreshold}</div>
          </div>
          <div class="score-box">
            <div class="score-label">Total Candidates</div>
            <div class="score-value">${n.totalCandidates}</div>
          </div>
          <div class="score-box">
            <div class="score-label">Max Cap</div>
            <div class="score-value">${n.maxNotifications}</div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Filters & Thresholds</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Job Class</span>
            <span class="value"><span class="badge badge-${n.jobClass || 'generic'}">${n.jobClass || 'generic'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Countries Filter</span>
            <span class="value">${n.countriesFilter?.length ? n.countriesFilter.join(', ') : 'All'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Languages Filter</span>
            <span class="value">${n.languagesFilter?.length ? n.languagesFilter.join(', ') : 'All'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Threshold (Specialized)</span>
            <span class="value">${(n.thresholdSpecialized * 100).toFixed(0)}%</span>
          </div>
          <div class="detail-item">
            <span class="label">Threshold (Generic)</span>
            <span class="value">${(n.thresholdGeneric * 100).toFixed(0)}%</span>
          </div>
          <div class="detail-item">
            <span class="label">Processing Time</span>
            <span class="value">${n.elapsedMs ? n.elapsedMs + 'ms' : '-'}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Subject Matter Requirements</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Strictness</span>
            <span class="value"><span class="badge badge-${job?.subjectMatterStrictness === 'strict' ? 'error' : (job?.subjectMatterStrictness === 'lenient' ? 'success' : 'warning')}">${job?.subjectMatterStrictness || 'moderate'}</span></span>
          </div>
          <div class="detail-item">
            <span class="label">Threshold</span>
            <span class="value">${job?.subjectMatterStrictness === 'strict' ? '80%' : (job?.subjectMatterStrictness === 'lenient' ? '60%' : '70%')}</span>
          </div>
        </div>
        <div style="margin-top:12px;">
          <strong>Required Codes:</strong>
          <div class="keywords" style="margin-top:4px;">
            ${(job?.subjectMatterCodes && job.subjectMatterCodes.length > 0)
              ? job.subjectMatterCodes.map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
              : '<span style="color:#666;">None required (open to all)</span>'}
          </div>
        </div>
        ${(job?.acceptableSubjectCodes && job.acceptableSubjectCodes.length > 0) ? `
          <div style="margin-top:12px;">
            <strong>Also Acceptable:</strong>
            <div class="keywords" style="margin-top:4px;">
              ${job.acceptableSubjectCodes.map(c => `<span class="keyword" style="background:#e3f2fd;color:#1565c0;">${escapeHtml(c)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="detail-section">
        <h3>Score Distribution</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Min Score</span>
            <span class="value">${n.scoreMin ? (n.scoreMin * 100).toFixed(1) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Max Score</span>
            <span class="value">${n.scoreMax ? (n.scoreMax * 100).toFixed(1) + '%' : '-'}</span>
          </div>
          <div class="detail-item">
            <span class="label">Above Threshold</span>
            <span class="value">${n.totalAboveThreshold} users</span>
          </div>
          <div class="detail-item">
            <span class="label">Below Threshold</span>
            <span class="value">${n.totalCandidates - n.totalAboveThreshold} users</span>
          </div>
        </div>
      </div>
    `;

    // Notified Users Table
    html += `
      <div class="detail-section">
        <h3>Notified Users (${notifiedUsers.length})</h3>
        <table class="detail-table score-table">
          <thead>
            <tr>
              <th style="width:40px">Rank</th>
              <th style="width:70px">Score</th>
              <th style="width:60px">Thresh</th>
              <th>User Info</th>
              <th style="width:80px">Tier</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (notifiedUsers.length > 0) {
      notifiedUsers.forEach((r, idx) => {
        const user = r.userInfo;
        const finalPct = (r.finalScore * 100).toFixed(1);
        const threshPct = (r.thresholdUsed * 100).toFixed(0);
        const scoreClass = getScoreClass(r.finalScore);
        const userCaption = user?.domainCapsule ? truncate(user.domainCapsule.split('Keywords')[0], 60) : '-';
        const userExpertise = r.userSubjectMatterCodes?.length ? r.userSubjectMatterCodes.join(', ') : (user?.subjectMatterCodes?.length ? user.subjectMatterCodes.join(', ') : 'none');

        html += `
          <tr class="clickable-row ${scoreClass}" data-notify-user-index="${idx}">
            <td><strong>#${r.rank || idx + 1}</strong></td>
            <td><strong>${finalPct}%</strong></td>
            <td style="color:#666;">${threshPct}%</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code style="font-size:11px;">${escapeHtml(truncate(r.userId, 18))}</code>
                ${r.userCountry ? `<span style="font-size:11px;">${escapeHtml(r.userCountry)}</span>` : ''}
              </div>
              <div style="font-size:10px;color:#999;margin-top:2px;">Expertise: ${escapeHtml(truncate(userExpertise, 50))}</div>
            </td>
            <td><span class="badge badge-${r.expertiseTier || 'entry'}">${r.expertiseTier || 'entry'}</span></td>
          </tr>
        `;
      });
    } else {
      html += '<tr><td colspan="5" style="text-align:center;color:#666;">No users notified</td></tr>';
    }

    html += '</tbody></table></div>';

    // Filtered Out Users Table
    html += `
      <div class="detail-section">
        <h3>Filtered Out Users (${filteredUsers.length})</h3>
        <table class="detail-table score-table">
          <thead>
            <tr>
              <th style="width:70px">Score</th>
              <th style="width:60px">Thresh</th>
              <th>User Info</th>
              <th style="width:80px">Tier</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (filteredUsers.length > 0) {
      // Show first 50 filtered users
      filteredUsers.slice(0, 50).forEach((r) => {
        const user = r.userInfo;
        const finalPct = (r.finalScore * 100).toFixed(1);
        const threshPct = (r.thresholdUsed * 100).toFixed(0);
        const scoreClass = getScoreClass(r.finalScore);
        const userExpertise = r.userSubjectMatterCodes?.length ? r.userSubjectMatterCodes.join(', ') : (user?.subjectMatterCodes?.length ? user.subjectMatterCodes.join(', ') : 'none');

        // Determine badge color based on filter reason
        let reasonBadgeClass = 'error';
        if (r.filterReason?.includes('below')) {
          reasonBadgeClass = 'warning';
        } else if (r.filterReason?.includes('max_cap')) {
          reasonBadgeClass = 'generic';
        }

        // Format the filter reason for display
        let displayReason = r.filterReason || '-';
        if (r.filterReason?.includes('low_similarity')) {
          displayReason = r.filterReason; // Already includes percentage
        } else if (r.filterReason === 'no_subject_matter_codes') {
          displayReason = 'No expertise codes';
        }

        html += `
          <tr class="${scoreClass}">
            <td>${finalPct}%</td>
            <td style="color:#666;">${threshPct}%</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code style="font-size:11px;">${escapeHtml(truncate(r.userId, 18))}</code>
                ${r.userCountry ? `<span style="font-size:11px;">${escapeHtml(r.userCountry)}</span>` : ''}
              </div>
              <div style="font-size:10px;color:#999;margin-top:2px;">Expertise: ${escapeHtml(truncate(userExpertise, 40))}</div>
            </td>
            <td><span class="badge badge-${r.expertiseTier || 'entry'}">${r.expertiseTier || 'entry'}</span></td>
            <td><span class="badge badge-${reasonBadgeClass}">${escapeHtml(displayReason)}</span></td>
          </tr>
        `;
      });

      if (filteredUsers.length > 50) {
        html += `<tr><td colspan="5" style="text-align:center;color:#666;">... and ${filteredUsers.length - 50} more</td></tr>`;
      }
    } else {
      html += '<tr><td colspan="5" style="text-align:center;color:#666;">No users filtered out</td></tr>';
    }

    html += '</tbody></table></div>';

    modalBody.innerHTML = html;

    // Store context for user navigation
    currentNotifyContext = {
      notifyRequest: n,
      jobInfo: job,
      results: notifiedUsers,
      currentIndex: -1
    };

    // Add click handlers for notified user rows
    modalBody.querySelectorAll('[data-notify-user-index]').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.notifyUserIndex, 10);
        showNotifyUserDetail(idx);
      });
    });
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading notification details</p>';
    console.error('Failed to load notification detail:', err);
  }
}

// Notify User Detail View (with navigation)
async function showNotifyUserDetail(index) {
  if (!currentNotifyContext || !currentNotifyContext.results[index]) return;

  currentNotifyContext.currentIndex = index;
  const result = currentNotifyContext.results[index];
  const job = currentNotifyContext.jobInfo;
  const total = currentNotifyContext.results.length;

  // Fetch full user details
  let userData = null;
  try {
    const data = await apiFetch(`/admin/users/${encodeURIComponent(result.userId)}`);
    userData = data.upserts?.[0] || null;
  } catch (err) {
    console.error('Failed to fetch user details:', err);
  }

  const raw = userData?.rawInput || {};
  const finalPct = (result.finalScore * 100).toFixed(1);
  const domainPct = (result.domainScore * 100).toFixed(1);
  const taskPct = (result.taskScore * 100).toFixed(1);

  let html = `
    <div class="candidate-nav">
      <button class="nav-btn" onclick="navigateNotifyUser(-1)" ${index === 0 ? 'disabled' : ''}>← Previous</button>
      <span class="nav-info">
        <strong>Notified User ${index + 1} of ${total}</strong>
        ${job?.title ? ` for "${escapeHtml(truncate(job.title, 40))}"` : ''}
      </span>
      <button class="nav-btn" onclick="navigateNotifyUser(1)" ${index >= total - 1 ? 'disabled' : ''}>Next →</button>
    </div>
    <div class="candidate-nav-hint">Use ← → arrow keys to navigate, Esc to go back</div>

    <div class="detail-section scores-section">
      <div class="score-boxes">
        <div class="score-box ${getScoreClass(result.finalScore)}">
          <div class="score-label">Final Score</div>
          <div class="score-value">${finalPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Domain</div>
          <div class="score-value">${domainPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Task</div>
          <div class="score-value">${taskPct}%</div>
        </div>
        <div class="score-box rank-box">
          <div class="score-label">Rank</div>
          <div class="score-value">#${result.rank || index + 1}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>User Profile</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="label">User ID</span>
          <span class="value"><code style="font-size:11px;">${escapeHtml(result.userId)}</code></span>
        </div>
        <div class="detail-item">
          <span class="label">Country</span>
          <span class="value">${escapeHtml(result.userCountry || userData?.country || '-')}</span>
        </div>
        <div class="detail-item">
          <span class="label">Languages</span>
          <span class="value">${result.userLanguages?.join(', ') || userData?.languages?.join(', ') || '-'}</span>
        </div>
        <div class="detail-item">
          <span class="label">Expertise Tier</span>
          <span class="value"><span class="badge badge-${result.expertiseTier || 'entry'}">${result.expertiseTier || 'entry'}</span></span>
        </div>
        <div class="detail-item">
          <span class="label">Threshold Used</span>
          <span class="value">${(result.thresholdUsed * 100).toFixed(0)}%</span>
        </div>
        <div class="detail-item">
          <span class="label">Credentials</span>
          <span class="value">${userData?.credentials?.length ? userData.credentials.join(', ') : 'None'}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Subject Matter Expertise</h3>
      <div class="keywords">
        ${(result.userSubjectMatterCodes?.length || userData?.subjectMatterCodes?.length)
          ? (result.userSubjectMatterCodes || userData?.subjectMatterCodes || []).map(c => `<span class="keyword">${escapeHtml(c)}</span>`).join('')
          : '<span style="color:#666;">None specified</span>'}
      </div>
    </div>

    <div class="detail-section">
      <h3>Capsules</h3>
      <div class="capsule-comparison">
        <div class="capsule-item">
          <div class="capsule-label">User Domain</div>
          <div class="capsule-text">${escapeHtml(userData?.domainCapsule || '-')}</div>
        </div>
        <div class="capsule-item">
          <div class="capsule-label">User Task</div>
          <div class="capsule-text">${escapeHtml(userData?.taskCapsule || '-')}</div>
        </div>
      </div>
    </div>
  `;

  // Resume and work history
  html += `
    <div class="detail-section">
      <h3>Resume & Work History</h3>
      ${raw.resume_text ? `
        <div style="margin-bottom:16px;">
          <strong>Resume Text:</strong>
          <div class="capsule-text resume-text" style="margin-top:4px;max-height:300px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(raw.resume_text)}</div>
        </div>
      ` : '<p style="color:#666;">No resume text available</p>'}

      ${raw.work_experience && raw.work_experience.length > 0 ? `
        <div style="margin-bottom:16px;">
          <strong>Work Experience:</strong>
          <ul style="margin:4px 0 0 20px;">
            ${raw.work_experience.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${raw.labeling_experience && raw.labeling_experience.length > 0 ? `
        <div>
          <strong>Labeling Experience:</strong>
          <ul style="margin:4px 0 0 20px;">
            ${raw.labeling_experience.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  // Back button
  html += `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
      <button class="nav-btn" onclick="backToNotifyList()">← Back to Notification Results</button>
    </div>
  `;

  modalBody.innerHTML = html;
}

function navigateNotifyUser(direction) {
  if (!currentNotifyContext) return;
  const newIndex = currentNotifyContext.currentIndex + direction;
  if (newIndex >= 0 && newIndex < currentNotifyContext.results.length) {
    showNotifyUserDetail(newIndex);
  }
}

function backToNotifyList() {
  if (!currentNotifyContext) {
    closeModal();
    return;
  }
  const notifyId = currentNotifyContext.notifyRequest.id;
  currentNotifyContext = null;
  showNotificationDetail(notifyId);
}

// Candidate Detail View (with navigation)
async function showCandidateDetail(index) {
  if (!currentMatchContext || !currentMatchContext.results[index]) return;

  currentMatchContext.currentIndex = index;
  const result = currentMatchContext.results[index];
  const job = currentMatchContext.jobInfo;
  const total = currentMatchContext.results.length;

  // Fetch full user details
  let userData = null;
  try {
    const data = await apiFetch(`/admin/users/${encodeURIComponent(result.userId)}`);
    userData = data.upserts?.[0] || null;
  } catch (err) {
    console.error('Failed to fetch user details:', err);
  }

  const raw = userData?.rawInput || {};
  const finalPct = result.finalScore ? (result.finalScore * 100).toFixed(1) : '-';
  const domainPct = result.sDomain ? (result.sDomain * 100).toFixed(1) : '-';
  const taskPct = result.sTask ? (result.sTask * 100).toFixed(1) : '-';

  let html = `
    <div class="candidate-nav">
      <button class="nav-btn" onclick="navigateCandidate(-1)" ${index === 0 ? 'disabled' : ''}>← Previous</button>
      <span class="nav-info">
        <strong>Candidate ${index + 1} of ${total}</strong>
        ${job?.title ? ` for "${escapeHtml(truncate(job.title, 40))}"` : ''}
      </span>
      <button class="nav-btn" onclick="navigateCandidate(1)" ${index >= total - 1 ? 'disabled' : ''}>Next →</button>
    </div>
    <div class="candidate-nav-hint">Use ← → arrow keys to navigate, Esc to go back</div>

    <div class="detail-section scores-section">
      <div class="score-boxes">
        <div class="score-box ${getScoreClass(result.finalScore)}">
          <div class="score-label">Final Score</div>
          <div class="score-value">${finalPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Domain</div>
          <div class="score-value">${domainPct}%</div>
        </div>
        <div class="score-box">
          <div class="score-label">Task</div>
          <div class="score-value">${taskPct}%</div>
        </div>
        <div class="score-box rank-box">
          <div class="score-label">Rank</div>
          <div class="score-value">#${result.rank || index + 1}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Capsules</h3>
      <div class="capsule-comparison">
        <div class="capsule-item">
          <div class="capsule-label">User Domain</div>
          <div class="capsule-text">${escapeHtml(userData?.domainCapsule || result.userInfo?.domainCapsule || '-')}</div>
        </div>
        <div class="capsule-item">
          <div class="capsule-label">User Task</div>
          <div class="capsule-text">${escapeHtml(userData?.taskCapsule || '-')}</div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Profile</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="label">User ID</span>
          <span class="value"><code style="font-size:11px;">${escapeHtml(result.userId)}</code></span>
        </div>
        <div class="detail-item">
          <span class="label">Country</span>
          <span class="value">${escapeHtml(userData?.country || raw.country || '-')}</span>
        </div>
        <div class="detail-item">
          <span class="label">Languages</span>
          <span class="value">${userData?.languages?.join(', ') || (Array.isArray(raw.languages) ? raw.languages.join(', ') : raw.languages) || '-'}</span>
        </div>
        <div class="detail-item">
          <span class="label">Expertise</span>
          <span class="value"><span class="badge badge-${userData?.expertiseTier || 'entry'}">${userData?.expertiseTier || 'entry'}</span></span>
        </div>
        <div class="detail-item">
          <span class="label">Credentials</span>
          <span class="value">${userData?.credentials?.length ? userData.credentials.join(', ') : 'None'}</span>
        </div>
        <div class="detail-item">
          <span class="label">Years Experience</span>
          <span class="value">${userData?.yearsExperience ?? '-'}</span>
        </div>
      </div>
    </div>
  `;

  // Resume and work history (expanded by default)
  html += `
    <div class="detail-section">
      <h3>Resume & Work History</h3>
      ${raw.resume_text ? `
        <div style="margin-bottom:16px;">
          <strong>Resume Text:</strong>
          <div class="capsule-text resume-text" style="margin-top:4px;max-height:300px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(raw.resume_text)}</div>
        </div>
      ` : '<p style="color:#666;">No resume text available</p>'}

      ${raw.work_experience && raw.work_experience.length > 0 ? `
        <div style="margin-bottom:16px;">
          <strong>Work Experience:</strong>
          <ul style="margin:4px 0 0 20px;">
            ${raw.work_experience.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${raw.education && raw.education.length > 0 ? `
        <div style="margin-bottom:16px;">
          <strong>Education:</strong>
          <ul style="margin:4px 0 0 20px;">
            ${raw.education.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${raw.labeling_experience && raw.labeling_experience.length > 0 ? `
        <div>
          <strong>Labeling Experience:</strong>
          <ul style="margin:4px 0 0 20px;">
            ${raw.labeling_experience.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  // Back button
  html += `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
      <button class="nav-btn" onclick="backToMatchList()">← Back to Match Results</button>
    </div>
  `;

  modalBody.innerHTML = html;
}

function navigateCandidate(direction) {
  if (!currentMatchContext) return;
  const newIndex = currentMatchContext.currentIndex + direction;
  if (newIndex >= 0 && newIndex < currentMatchContext.results.length) {
    showCandidateDetail(newIndex);
  }
}

function backToMatchList() {
  if (!currentMatchContext) {
    closeModal();
    return;
  }
  // Re-render match detail
  const matchId = currentMatchContext.matchRequest.id;
  currentMatchContext = null;
  showMatchDetail(matchId);
}

function getScoreClass(score) {
  if (!score) return '';
  if (score >= 0.7) return 'score-high';
  if (score >= 0.5) return 'score-medium';
  if (score >= 0.3) return 'score-low';
  return 'score-poor';
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
  if (tabName === 'overview') loadOverview();
  else if (tabName === 'jobs') loadJobs();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'pending') loadPendingNotifications();
  else if (tabName === 'failures') loadFailures();
  else if (tabName === 'resume-parsing') loadResumeParseFailures();
  else if (tabName === 'notifications') loadNotifications();
  else if (tabName === 'sync') loadSyncHealth();
  else if (tabName === 'monitoring') loadMonitoring();
  else if (tabName === 'debug') {
    loadMatches();
    loadRecommendations();
  }
}

// Load sync health data
async function loadSyncHealth() {
  const loading = document.getElementById('sync-loading');
  const statsContainer = document.getElementById('sync-health-stats');
  const tbody = document.querySelector('#sync-recent-table tbody');

  loading.classList.remove('hidden');
  statsContainer.innerHTML = '';
  tbody.innerHTML = '';

  try {
    const data = await apiFetch('/admin/sync-health');

    loading.classList.add('hidden');

    // Build stats cards
    const last24h = data.last24h;
    const avgLatency = data.avgLatencyMs;

    let statsHtml = `
      <div class="sync-stat-section">
        <h4>User Upserts (24h)</h4>
        <div class="sync-stat-grid">
          <div class="sync-stat-card">
            <div class="sync-stat-value">${last24h.userUpserts.total || 0}</div>
            <div class="sync-stat-label">Total</div>
          </div>
          <div class="sync-stat-card ${last24h.userUpserts.scheduled_content ? 'source-scheduled' : ''}">
            <div class="sync-stat-value">${last24h.userUpserts.scheduled_content || 0}</div>
            <div class="sync-stat-label">Scheduled</div>
          </div>
          <div class="sync-stat-card ${last24h.userUpserts.manual ? 'source-manual' : ''}">
            <div class="sync-stat-value">${last24h.userUpserts.manual || 0}</div>
            <div class="sync-stat-label">Manual</div>
          </div>
          <div class="sync-stat-card">
            <div class="sync-stat-value">${avgLatency.userUpserts?.scheduled_content || avgLatency.userUpserts?.manual || '-'}ms</div>
            <div class="sync-stat-label">Avg Latency</div>
          </div>
        </div>
      </div>

      <div class="sync-stat-section">
        <h4>Job Upserts (24h)</h4>
        <div class="sync-stat-grid">
          <div class="sync-stat-card">
            <div class="sync-stat-value">${last24h.jobUpserts.total || 0}</div>
            <div class="sync-stat-label">Total</div>
          </div>
          <div class="sync-stat-card ${last24h.jobUpserts.scheduled_content ? 'source-scheduled' : ''}">
            <div class="sync-stat-value">${last24h.jobUpserts.scheduled_content || 0}</div>
            <div class="sync-stat-label">Scheduled</div>
          </div>
          <div class="sync-stat-card ${last24h.jobUpserts.manual ? 'source-manual' : ''}">
            <div class="sync-stat-value">${last24h.jobUpserts.manual || 0}</div>
            <div class="sync-stat-label">Manual</div>
          </div>
          <div class="sync-stat-card">
            <div class="sync-stat-value">${avgLatency.jobUpserts?.scheduled_content || avgLatency.jobUpserts?.manual || '-'}ms</div>
            <div class="sync-stat-label">Avg Latency</div>
          </div>
        </div>
      </div>

      <div class="sync-stat-section">
        <h4>User Metadata Updates (24h)</h4>
        <div class="sync-stat-grid">
          <div class="sync-stat-card">
            <div class="sync-stat-value">${last24h.userMetadataUpdates.total || 0}</div>
            <div class="sync-stat-label">Total</div>
          </div>
          <div class="sync-stat-card ${last24h.userMetadataUpdates.scheduled_metadata ? 'source-scheduled' : ''}">
            <div class="sync-stat-value">${last24h.userMetadataUpdates.scheduled_metadata || 0}</div>
            <div class="sync-stat-label">Scheduled</div>
          </div>
          <div class="sync-stat-card">
            <div class="sync-stat-value">${avgLatency.userMetadataUpdates?.scheduled_metadata || '-'}ms</div>
            <div class="sync-stat-label">Avg Latency</div>
          </div>
        </div>
      </div>

      <div class="sync-stat-section">
        <h4>Job Metadata Updates (24h)</h4>
        <div class="sync-stat-grid">
          <div class="sync-stat-card">
            <div class="sync-stat-value">${last24h.jobMetadataUpdates.total || 0}</div>
            <div class="sync-stat-label">Total</div>
          </div>
          <div class="sync-stat-card ${last24h.jobMetadataUpdates.scheduled_metadata ? 'source-scheduled' : ''}">
            <div class="sync-stat-value">${last24h.jobMetadataUpdates.scheduled_metadata || 0}</div>
            <div class="sync-stat-label">Scheduled</div>
          </div>
          <div class="sync-stat-card">
            <div class="sync-stat-value">${avgLatency.jobMetadataUpdates?.scheduled_metadata || '-'}ms</div>
            <div class="sync-stat-label">Avg Latency</div>
          </div>
        </div>
      </div>
    `;

    statsContainer.innerHTML = statsHtml;

    // Populate recent syncs table
    if (data.recentSyncs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;">No recent syncs found</td></tr>';
      return;
    }

    data.recentSyncs.forEach(sync => {
      const tr = document.createElement('tr');
      const typeDisplay = {
        'user_upsert': 'User Upsert',
        'job_upsert': 'Job Upsert',
        'user_metadata': 'User Metadata',
        'job_metadata': 'Job Metadata'
      }[sync.type] || sync.type;

      const typeClass = {
        'user_upsert': 'badge-entry',
        'job_upsert': 'badge-specialized',
        'user_metadata': 'badge-success',
        'job_metadata': 'badge-warning'
      }[sync.type] || '';

      const sourceClass = {
        'manual': 'badge-generic',
        'scheduled_content': 'badge-success',
        'scheduled_metadata': 'badge-success'
      }[sync.source] || 'badge-warning';

      const sourceDisplay = sync.source || 'unknown';

      tr.innerHTML = `
        <td><span class="badge ${typeClass}">${typeDisplay}</span></td>
        <td><code>${escapeHtml(truncate(sync.id, 20))}</code>${sync.title ? `<br><small>${escapeHtml(truncate(sync.title, 30))}</small>` : ''}</td>
        <td><span class="badge ${sourceClass}">${sourceDisplay}</span></td>
        <td>${sync.elapsedMs ? sync.elapsedMs + 'ms' : '-'}</td>
        <td>${formatDate(sync.createdAt)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading sync health';
    console.error('Failed to load sync health:', err);
  }
}

// Load Overview tab data
async function loadOverview() {
  const loading = document.getElementById('overview-loading');
  const tbody = document.querySelector('#active-jobs-table tbody');

  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const [summary, activeJobs] = await Promise.all([
      apiFetch('/admin/qualifications/summary'),
      apiFetch('/admin/jobs/active'),
    ]);

    loading.classList.add('hidden');

    // Update overview stats
    document.getElementById('overview-active-jobs').textContent = summary.activeJobs || 0;
    document.getElementById('overview-pending').textContent = summary.pendingNotifications || 0;
    document.getElementById('overview-qualified').textContent = summary.totalQualifications || 0;
    document.getElementById('overview-notified-today').textContent = summary.notifiedToday || 0;

    // Populate active jobs table
    if (activeJobs.jobs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;">No active jobs</td></tr>';
      return;
    }

    // Fetch qualification counts for each active job
    const jobsWithCounts = await Promise.all(
      activeJobs.jobs.slice(0, 20).map(async (job) => {
        try {
          const quals = await apiFetch(`/admin/jobs/${encodeURIComponent(job.job_id)}/qualifications?qualifies_only=true&limit=1`);
          const pending = await apiFetch(`/v1/jobs/${encodeURIComponent(job.job_id)}/pending-notifications?limit=1`);
          return {
            ...job,
            qualified: quals.total || 0,
            pending: pending.total || 0,
            notified: (quals.total || 0) - (pending.total || 0),
          };
        } catch {
          return { ...job, qualified: 0, pending: 0, notified: 0 };
        }
      })
    );

    jobsWithCounts.forEach(job => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(job.title || 'Untitled')}</td>
        <td><code>${escapeHtml(truncate(job.job_id, 20))}</code></td>
        <td>${job.qualified}</td>
        <td class="${job.pending > 0 ? 'pending-highlight' : ''}">${job.pending}</td>
        <td>${job.notified}</td>
      `;
      tr.addEventListener('click', () => showJobQualifications(job.job_id));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading overview';
    console.error('Failed to load overview:', err);
  }
}

// Load pending notifications
async function loadPendingNotifications() {
  const loading = document.getElementById('pending-loading');
  const tbody = document.querySelector('#pending-table tbody');

  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    const data = await apiFetch('/admin/pending-notifications?limit=100');

    loading.classList.add('hidden');

    if (data.pending.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No pending notifications</td></tr>';
      return;
    }

    data.pending.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:500;">${escapeHtml(p.job_title || 'Untitled')}</div>
          <div style="font-size:11px;color:#666;"><code>${escapeHtml(truncate(p.job_id, 24))}</code></div>
        </td>
        <td><code>${escapeHtml(truncate(p.user_id, 20))}</code></td>
        <td>${p.final_score ? (p.final_score * 100).toFixed(0) + '%' : '-'}</td>
        <td>${p.threshold_used ? (p.threshold_used * 100).toFixed(0) + '%' : '-'}</td>
        <td>${formatDate(p.evaluated_at)}</td>
        <td>
          <button class="btn-small" onclick="markUserNotified('${escapeHtml(p.job_id)}', '${escapeHtml(p.user_id)}')">Mark Notified</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading pending notifications';
    console.error('Failed to load pending notifications:', err);
  }
}

// Mark a single user as notified
async function markUserNotified(jobId, userId) {
  try {
    await fetch(`/v1/jobs/${encodeURIComponent(jobId)}/mark-notified`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_ids: [userId], notified_via: 'manual_dashboard' }),
    });
    loadPendingNotifications();
    loadStats();
  } catch (err) {
    alert('Failed to mark user as notified');
    console.error('Failed to mark notified:', err);
  }
}

// Show job qualifications modal
async function showJobQualifications(jobId) {
  modalBody.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.remove('hidden');

  try {
    const data = await apiFetch(`/admin/jobs/${encodeURIComponent(jobId)}/qualifications?limit=50`);

    let html = `
      <div class="detail-header">
        <h2>${escapeHtml(data.job?.title || 'Untitled Job')}</h2>
        <div class="meta">
          Job ID: <code>${escapeHtml(jobId)}</code> |
          Status: <span class="badge badge-${data.job?.is_active ? 'success' : 'warning'}">${data.job?.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      <div class="detail-section">
        <h3>Qualification Summary</h3>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="label">Total Qualified</span>
            <span class="value">${data.total}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Qualified Users (Top ${data.qualifications.length})</h3>
        <table class="detail-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Score</th>
              <th>Domain / Task</th>
              <th>Notified</th>
              <th>Filter</th>
            </tr>
          </thead>
          <tbody>
    `;

    data.qualifications.forEach(q => {
      const notifiedStatus = q.notified_at
        ? `<span class="badge badge-success">Yes</span> <small>${formatDate(q.notified_at)}</small>`
        : '<span class="badge badge-warning">Pending</span>';

      html += `
        <tr>
          <td>
            <div><code>${escapeHtml(truncate(q.user_id, 20))}</code></div>
            ${q.user_info ? `<div style="font-size:11px;color:#666;">${escapeHtml(q.user_info.expertise_tier || '')} | ${escapeHtml(q.user_info.country || '')}</div>` : ''}
          </td>
          <td><strong>${q.final_score ? (q.final_score * 100).toFixed(0) + '%' : '-'}</strong></td>
          <td>${q.domain_score ? (q.domain_score * 100).toFixed(0) + '%' : '-'} / ${q.task_score ? (q.task_score * 100).toFixed(0) + '%' : '-'}</td>
          <td>${notifiedStatus}</td>
          <td><small>${escapeHtml(q.filter_reason || '-')}</small></td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';

    modalBody.innerHTML = html;
  } catch (err) {
    modalBody.innerHTML = '<p class="error">Error loading qualifications</p>';
    console.error('Failed to load qualifications:', err);
  }
}

// Modal
function closeModal() {
  modal.classList.add('hidden');
  currentMatchContext = null; // Clear navigation context
  currentRecContext = null; // Clear recommendation navigation context
  currentNotifyContext = null; // Clear notification navigation context
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

// Monitoring state
let monitoringRefreshInterval = null;
let monitoringReNotifyPage = 1;
let monitoringRecJobsPage = 1;

// Load monitoring tab data
async function loadMonitoring() {
  const loading = document.getElementById('monitoring-loading');
  loading.classList.remove('hidden');

  try {
    await Promise.all([
      loadReNotifyEvents(monitoringReNotifyPage),
      loadRecommendedJobsLog(monitoringRecJobsPage),
    ]);
    loading.classList.add('hidden');

    // Set up auto-refresh every 30 seconds
    if (monitoringRefreshInterval) {
      clearInterval(monitoringRefreshInterval);
    }
    monitoringRefreshInterval = setInterval(() => {
      const monitoringTab = document.getElementById('monitoring-tab');
      if (!monitoringTab.classList.contains('hidden')) {
        loadReNotifyEvents(monitoringReNotifyPage);
        loadRecommendedJobsLog(monitoringRecJobsPage);
      }
    }, 30000);
  } catch (err) {
    loading.textContent = 'Error loading monitoring data';
    console.error('Failed to load monitoring data:', err);
  }
}

// Load re-notify events
async function loadReNotifyEvents(page = 1) {
  const tbody = document.querySelector('#re-notify-table tbody');
  const pagination = document.getElementById('re-notify-pagination');

  try {
    const data = await apiFetch(`/admin/re-notify?page=${page}&limit=50`);
    monitoringReNotifyPage = page;

    tbody.innerHTML = '';

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No re-notify events yet</td></tr>';
      pagination.innerHTML = '';
      return;
    }

    data.records.forEach(r => {
      const tr = document.createElement('tr');
      const hasNewlyQualified = r.newly_qualified > 0;
      if (hasNewlyQualified) {
        tr.classList.add('highlight-row');
      }

      const jobDisplay = r.job_title || truncate(r.job_id, 20);

      tr.innerHTML = `
        <td>
          <div style="font-weight:500;">${escapeHtml(jobDisplay)}</div>
          <div style="font-size:11px;color:#666;"><code>${escapeHtml(truncate(r.job_id, 24))}</code></div>
        </td>
        <td>${r.total_qualified}</td>
        <td>${r.previously_notified}</td>
        <td class="${hasNewlyQualified ? 'highlight-value' : ''}">${r.newly_qualified}</td>
        <td>${r.elapsed_ms ? Math.round(r.elapsed_ms) + 'ms' : '-'}</td>
        <td>${formatDate(r.created_at)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Render pagination
    renderPagination(pagination, data.page, data.totalPages, (newPage) => {
      loadReNotifyEvents(newPage);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#c00;">Error loading re-notify events</td></tr>';
    console.error('Failed to load re-notify events:', err);
  }
}

// Load recommended-jobs log
async function loadRecommendedJobsLog(page = 1) {
  const tbody = document.querySelector('#recommended-jobs-table tbody');
  const pagination = document.getElementById('recommended-jobs-pagination');

  try {
    const data = await apiFetch(`/admin/recommended-jobs-log?page=${page}&limit=50`);
    monitoringRecJobsPage = page;

    tbody.innerHTML = '';

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#666;">No recommended-jobs calls yet</td></tr>';
      pagination.innerHTML = '';
      return;
    }

    data.records.forEach(r => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td><code>${escapeHtml(truncate(r.user_id, 20))}</code></td>
        <td><span class="badge badge-${r.expertise_tier || 'entry'}">${r.expertise_tier || 'entry'}</span></td>
        <td>${r.recommended_count}</td>
        <td>${r.skipped_by_country}</td>
        <td>${r.skipped_by_language}</td>
        <td>${r.elapsed_ms ? Math.round(r.elapsed_ms) + 'ms' : '-'}</td>
        <td>${formatDate(r.created_at)}</td>
      `;
      tbody.appendChild(tr);
    });

    // Render pagination
    renderPagination(pagination, data.page, data.totalPages, (newPage) => {
      loadRecommendedJobsLog(newPage);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#c00;">Error loading recommended-jobs log</td></tr>';
    console.error('Failed to load recommended-jobs log:', err);
  }
}

// Render pagination controls
function renderPagination(container, currentPage, totalPages, onPageChange) {
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="pagination-controls">';

  // Previous button
  if (currentPage > 1) {
    html += `<button class="pagination-btn" data-page="${currentPage - 1}">← Prev</button>`;
  }

  // Page info
  html += `<span class="pagination-info">Page ${currentPage} of ${totalPages}</span>`;

  // Next button
  if (currentPage < totalPages) {
    html += `<button class="pagination-btn" data-page="${currentPage + 1}">Next →</button>`;
  }

  html += '</div>';
  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll('.pagination-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page, 10);
      onPageChange(page);
    });
  });
}

// Failures state
let failuresPage = 1;
let failuresEntityType = '';

// Load upsert failures
async function loadFailures(page = 1) {
  const loading = document.getElementById('failures-loading');
  const tbody = document.querySelector('#failures-table tbody');
  const pagination = document.getElementById('failures-pagination');

  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    let endpoint = `/admin/upsert-failures?page=${page}&limit=50`;
    if (failuresEntityType) {
      endpoint += `&entity_type=${failuresEntityType}`;
    }

    const data = await apiFetch(endpoint);
    failuresPage = page;

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#666;">No failures found</td></tr>';
      pagination.innerHTML = '';
      return;
    }

    data.records.forEach(r => {
      const tr = document.createElement('tr');
      const typeClass = r.entity_type === 'user' ? 'badge-entry' : 'badge-specialized';
      const errorCodeClass = r.error_code.includes('PARSE') ? 'badge-warning' : 'badge-generic';

      tr.innerHTML = `
        <td><span class="badge ${typeClass}">${r.entity_type}</span></td>
        <td><code>${escapeHtml(truncate(r.entity_id, 24))}</code></td>
        <td><span class="badge ${errorCodeClass}">${escapeHtml(r.error_code)}</span></td>
        <td title="${escapeHtml(r.error_message)}">${escapeHtml(truncate(r.error_message, 40))}</td>
        <td>${formatDate(r.created_at)}</td>
        <td>
          <button class="btn-small" onclick="showFailureDetail(${r.id})">View</button>
          <button class="btn-small btn-danger" onclick="deleteFailure(${r.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Render pagination
    renderPagination(pagination, data.page, data.totalPages, (newPage) => {
      loadFailures(newPage);
    });
  } catch (err) {
    loading.textContent = 'Error loading failures';
    console.error('Failed to load failures:', err);
  }
}

// Show failure detail in modal
async function showFailureDetail(failureId) {
  try {
    const failure = await apiFetch(`/admin/upsert-failures/${failureId}`);

    let rawInputHtml = '';
    if (failure.raw_input) {
      rawInputHtml = `
        <h4>Raw Input</h4>
        <pre class="code-block">${escapeHtml(JSON.stringify(failure.raw_input, null, 2))}</pre>
      `;
    }

    modalBody.innerHTML = `
      <h2>Upsert Failure Detail</h2>
      <div class="detail-section">
        <h4>Error Information</h4>
        <table class="detail-table">
          <tr><th>ID</th><td>${failure.id}</td></tr>
          <tr><th>Entity Type</th><td><span class="badge ${failure.entity_type === 'user' ? 'badge-entry' : 'badge-specialized'}">${failure.entity_type}</span></td></tr>
          <tr><th>Entity ID</th><td><code>${escapeHtml(failure.entity_id)}</code></td></tr>
          <tr><th>Request ID</th><td><code>${escapeHtml(failure.request_id || '-')}</code></td></tr>
          <tr><th>Error Code</th><td><span class="badge badge-warning">${escapeHtml(failure.error_code)}</span></td></tr>
          <tr><th>Error Message</th><td>${escapeHtml(failure.error_message)}</td></tr>
          <tr><th>Time</th><td>${formatDate(failure.created_at)}</td></tr>
        </table>
      </div>
      ${rawInputHtml}
      <div class="modal-actions">
        <button class="btn-danger" onclick="deleteFailure(${failure.id}); closeModal();">Delete Failure</button>
      </div>
    `;
    openModal();
  } catch (err) {
    console.error('Failed to load failure detail:', err);
    alert('Failed to load failure detail');
  }
}

// Delete a failure record
async function deleteFailure(failureId) {
  if (!confirm('Are you sure you want to delete this failure record?')) {
    return;
  }

  try {
    await apiDelete(`/admin/upsert-failures/${failureId}`);
    loadFailures(failuresPage);
    loadStats();
  } catch (err) {
    alert('Failed to delete failure: ' + err.message);
    console.error('Failed to delete failure:', err);
  }
}

// Initialize failures tab event listeners
document.addEventListener('DOMContentLoaded', () => {
  const typeFilter = document.getElementById('failures-type-filter');
  const refreshBtn = document.getElementById('failures-refresh-btn');

  if (typeFilter) {
    typeFilter.addEventListener('change', () => {
      failuresEntityType = typeFilter.value;
      loadFailures(1);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadFailures(failuresPage);
    });
  }
});

// ============================================
// Resume Parse Failures
// ============================================

async function loadResumeParseFailures(userId = '') {
  const loading = document.getElementById('parse-loading');
  const tbody = document.querySelector('#parse-failures-table tbody');
  loading.classList.remove('hidden');
  tbody.innerHTML = '';

  try {
    // Load stats first
    await loadResumeParseStats();

    const endpoint = userId
      ? `/admin/resume-parse-failures?userId=${encodeURIComponent(userId)}`
      : '/admin/resume-parse-failures?limit=50';
    const data = await apiFetch(endpoint);

    loading.classList.add('hidden');

    if (data.records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#666;">No parse failures found</td></tr>';
      return;
    }

    data.records.forEach(failure => {
      const tr = document.createElement('tr');
      const fileUrlDisplay = failure.fileUrl ? truncate(failure.fileUrl, 40) : '-';
      const errorDisplay = truncate(failure.error, 60);
      tr.innerHTML = `
        <td><code>${escapeHtml(truncate(failure.userId, 20))}</code></td>
        <td><small>${failure.fileUrl ? `<a href="${escapeHtml(failure.fileUrl)}" target="_blank">${escapeHtml(fileUrlDisplay)}</a>` : '-'}</small></td>
        <td><span class="badge badge-error">${escapeHtml(errorDisplay)}</span></td>
        <td>${formatDate(failure.createdAt)}</td>
      `;
      tr.addEventListener('click', () => showParseFailureDetail(failure));
      tbody.appendChild(tr);
    });
  } catch (err) {
    loading.textContent = 'Error loading parse failures';
    console.error('Failed to load parse failures:', err);
  }
}

async function loadResumeParseStats() {
  try {
    const data = await apiFetch('/admin/resume-parse-stats');
    document.getElementById('stat-parse-total').textContent = data.total || 0;
    document.getElementById('stat-parse-24h').textContent = data.last24Hours || 0;
  } catch (err) {
    console.error('Failed to load resume parse stats:', err);
  }
}

function showParseFailureDetail(failure) {
  modalBody.innerHTML = `
    <div class="detail-header">
      <h2>Resume Parse Failure</h2>
      <div class="meta">User ID: <code>${escapeHtml(failure.userId)}</code> | Time: ${formatDate(failure.createdAt)}</div>
    </div>

    <div class="detail-section">
      <h3>Error</h3>
      <div class="capsule-text" style="background:#ffebee;color:#c62828;padding:16px;border-radius:8px;white-space:pre-wrap;">${escapeHtml(failure.error)}</div>
    </div>

    ${failure.fileUrl ? `
      <div class="detail-section">
        <h3>File URL</h3>
        <div class="capsule-text" style="word-break:break-all;"><a href="${escapeHtml(failure.fileUrl)}" target="_blank">${escapeHtml(failure.fileUrl)}</a></div>
      </div>
    ` : ''}
  `;
  modal.classList.remove('hidden');
}

// Initialize resume parse tab event listeners
document.addEventListener('DOMContentLoaded', () => {
  const searchBtn = document.getElementById('parse-search-btn');
  const clearBtn = document.getElementById('parse-clear-btn');
  const searchInput = document.getElementById('parse-search');

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const userId = searchInput.value.trim();
      loadResumeParseFailures(userId);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      loadResumeParseFailures();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const userId = searchInput.value.trim();
        loadResumeParseFailures(userId);
      }
    });
  }
});
