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
    const data = await apiFetch('/admin/stats');
    document.getElementById('stat-jobs').textContent = data.totals.jobs;
    document.getElementById('stat-users').textContent = data.totals.users;
    document.getElementById('stat-matches').textContent = data.totals.matchRequests;
    document.getElementById('stat-jobs-24h').textContent = data.last24Hours.jobs;
    document.getElementById('stat-users-24h').textContent = data.last24Hours.users;
    document.getElementById('stat-recs').textContent = data.totals.recommendations || 0;
    document.getElementById('stat-notifications').textContent = data.totals.notifications || 0;
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
              <div style="font-size:11px;color:#666;margin-top:2px;">${escapeHtml(userCaption)}</div>
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
        const userCaption = user?.domainCapsule ? truncate(user.domainCapsule.split('Keywords')[0], 50) : '-';

        html += `
          <tr class="${scoreClass}">
            <td>${finalPct}%</td>
            <td style="color:#666;">${threshPct}%</td>
            <td>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code style="font-size:11px;">${escapeHtml(truncate(r.userId, 18))}</code>
                ${r.userCountry ? `<span style="font-size:11px;">${escapeHtml(r.userCountry)}</span>` : ''}
              </div>
              <div style="font-size:11px;color:#666;margin-top:2px;">${escapeHtml(userCaption)}</div>
            </td>
            <td><span class="badge badge-${r.expertiseTier || 'entry'}">${r.expertiseTier || 'entry'}</span></td>
            <td><span class="badge badge-${r.filterReason?.includes('below') ? 'warning' : 'error'}">${escapeHtml(r.filterReason || '-')}</span></td>
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
  if (tabName === 'jobs') loadJobs();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'matches') loadMatches();
  else if (tabName === 'recommendations') loadRecommendations();
  else if (tabName === 'notifications') loadNotifications();
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
