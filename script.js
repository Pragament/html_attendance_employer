// Global bcrypt reference mapping for BcryptJS loaded via UMD CDN
const bcrypt = window.bcrypt || (window.dcodeIO && window.dcodeIO.bcrypt);

// ============================================================
//  STATE
// ============================================================
const STATE = {
    supabase: null,
    config: null, // { url, key }
    session: null, // supabase auth session
    organizations: [],
    employees: [],
    roles: [], // for autocomplete
    employeeMemberships: [],
    accessMode: 'employer', // employer | employee
    currentMembership: null,
    currentOrgId: null, // which org we're viewing
    isEditingOrg: false,
    isEditingEmp: false,
};

const ATTENDANCE_VIEW = {
    selectedDate: getLocalDateString(new Date()),
    statusFilter: 'all',
    search: '',
    sortBy: 'alerts',
    records: [],
};

// ============================================================
//  DOM REFS
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const pages = {
    settings: $('#pageSettings'),
    login: $('#pageLogin'),
    dashboard: $('#pageDashboard'),
    orgDetail: $('#pageOrgDetail'),
};

const topbar = $('#topbar');
const userEmail = $('#userEmail');
const btnLogout = $('#btnLogout');

// settings
const settingsForm = $('#settingsForm');
const supabaseUrl = $('#supabaseUrl');
const supabaseKey = $('#supabaseKey');
const configStatus = $('#configStatus');
const btnSaveConfig = $('#btnSaveConfig');

// login
const btnGoogleLogin = $('#btnGoogleLogin');
const loginStatus = $('#loginStatus');

// orgs
const orgList = $('#orgList');
const btnAddOrg = $('#btnAddOrg');

// org modal
const modalOrg = $('#modalOrg');
const orgForm = $('#orgForm');
const orgFormId = $('#orgFormId');
const orgFormCode = $('#orgFormCode');
const orgFormName = $('#orgFormName');
const modalOrgTitle = $('#modalOrgTitle');
const modalOrgSub = $('#modalOrgSub');
const modalOrgCancel = $('#modalOrgCancel');
const modalOrgSave = $('#modalOrgSave');

// employees
const employeeList = $('#employeeList');
const btnAddEmployee = $('#btnAddEmployee');
const btnBackToOrgs = $('#btnBackToOrgs');
const orgDetailTitle = $('#orgDetailTitle');
const orgDetailSub = $('#orgDetailSub');

// tabs & attendance
const tabEmployees = $('#tabEmployees');
const tabAttendance = $('#tabAttendance');
const employeeSection = $('#employeeSection');
const attendanceSection = $('#attendanceSection');
const attendanceList = $('#attendanceList');

// emp modal
const modalEmp = $('#modalEmp');
const empForm = $('#empForm');
const empFormId = $('#empFormId');
const empFormEmployeeId = $('#empFormEmployeeId');
const empFormName = $('#empFormName');
const empFormRole = $('#empFormRole');
const empFormEmail = $('#empFormEmail');
const empFormSystemRole = $('#empFormSystemRole');
const empFormPassword = $('#empFormPassword');
const empFormPin = $('#empFormPin');
const roleDatalist = $('#roleDatalist');
const modalEmpTitle = $('#modalEmpTitle');
const modalEmpSub = $('#modalEmpSub');
const modalEmpCancel = $('#modalEmpCancel');
const modalEmpSave = $('#modalEmpSave');

// fetch config selectors
const connectionPin = $('#connectionPin');

const toastContainer = $('#toastContainer');

// ============================================================
//  TOAST
// ============================================================
function showToast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    el.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        el.style.transition = '0.25s ease';
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

// ============================================================
//  CONFIG
// ============================================================
function loadConfig() {
    try {
        const raw = localStorage.getItem('empManager_config');
        if (raw) {
            const cfg = JSON.parse(raw);
            if (cfg.url && cfg.key) {
                STATE.config = cfg;
                supabaseUrl.value = cfg.url;
                supabaseKey.value = cfg.key;
                return cfg;
            }
        }
    } catch (_) { /* ignore */ }
    return null;
}

function saveConfig(url, key) {
    const cfg = { url: url.trim(), key: key.trim() };
    localStorage.setItem('empManager_config', JSON.stringify(cfg));
    STATE.config = cfg;
    return cfg;
}

// ============================================================
//  SUPABASE CLIENT
// ============================================================
function initSupabase() {
    const cfg = STATE.config;
    if (!cfg || !cfg.url || !cfg.key) return null;
    try {
        const client = window.supabase.createClient(cfg.url, cfg.key, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true, // Prevent concurrent/duplicate auto-exchanges of PKCE code on creation
                storage: window.localStorage,
                storageKey: 'empManager_sb_auth',
            }
        });
        STATE.supabase = client;
        return client;
    } catch (e) {
        console.error('Supabase init error:', e);
        return null;
    }
}

// ============================================================
//  AUTH
// ============================================================
async function getSession() {
    if (!STATE.supabase) return null;
    try {
        const { data, error } = await STATE.supabase.auth.getSession();
        if (error) {
            console.error('getSession error:', error);
            return null;
        }
        return data.session;
    } catch (err) {
        console.error('getSession unexpected error:', err);
        return null;
    }
}

async function signInWithGoogle() {
    if (!STATE.supabase) {
        showToast('Supabase not configured.', 'error');
        return;
    }
    loginStatus.textContent = 'Redirecting to Google...';
    let redirectUrl = window.location.origin + window.location.pathname;
    if (redirectUrl.endsWith('index.html')) {
        redirectUrl = redirectUrl.slice(0, -10); // remove 'index.html' suffix to match whitelist
    }
    const { error } = await STATE.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: redirectUrl,
        },
    });
    if (error) {
        loginStatus.textContent = 'Error: ' + error.message;
        showToast('Google sign-in error: ' + error.message, 'error');
    }
}

async function signOut() {
    if (!STATE.supabase) return;
    await STATE.supabase.auth.signOut();
    STATE.session = null;
    STATE.employeeMemberships = [];
    STATE.accessMode = 'employer';
    STATE.currentMembership = null;
    STATE.currentOrgId = null;
    renderApp();
}

// ============================================================
//  RLS-COMPATIBLE QUERIES (with employer_id / org scope)
// ============================================================
function getEmployerId() {
    return STATE.session?.user?.id || null;
}

function getSignedInEmail() {
    return (STATE.session?.user?.email || '').trim().toLowerCase();
}

function normalizeSystemRole(role) {
    const normalized = (role || 'viewer').trim().toLowerCase();
    return ['viewer', 'editor', 'admin'].includes(normalized) ? normalized : 'viewer';
}

function isEmployerMode() {
    return STATE.accessMode === 'employer';
}

function getMembershipForOrg(orgId) {
    if (isEmployerMode()) return null;
    return STATE.employeeMemberships.find(member => member.organization_id === orgId) || null;
}

function getCurrentSystemRole() {
    if (isEmployerMode()) return 'admin';
    return normalizeSystemRole(STATE.currentMembership?.system_role);
}

function canManageOrganizations() {
    return isEmployerMode();
}

function canManageEmployees() {
    if (isEmployerMode()) return true;
    return ['editor', 'admin'].includes(getCurrentSystemRole());
}

function canManageSystemRoles() {
    return isEmployerMode() || getCurrentSystemRole() === 'admin';
}

function canDeleteEmployees() {
    return canManageSystemRoles();
}

function canEditEmployee(employee) {
    if (!canManageEmployees()) return false;
    if (canManageSystemRoles()) return true;
    return normalizeSystemRole(employee?.system_role) === 'viewer';
}

function canViewEmployees() {
    return canManageEmployees();
}

function canViewAttendance() {
    if (isEmployerMode()) return true;
    return ['viewer', 'admin'].includes(getCurrentSystemRole());
}

function getDefaultTab() {
    if (canViewEmployees()) return 'employees';
    if (canViewAttendance()) return 'attendance';
    return null;
}

function hasAnyOrgAccess() {
    return canViewEmployees() || canViewAttendance();
}

function isMissingEmployeeAccessColumns(error) {
    const message = (error?.message || '').toLowerCase();
    return message.includes('employees.email') || message.includes('employees.system_role');
}

// ---- ORGANIZATIONS ----
async function fetchOrganizations() {
    const uid = getEmployerId();
    if (!uid || !STATE.supabase) return [];
    STATE.employeeMemberships = [];
    STATE.accessMode = 'employer';

    const { data: ownedOrgs, error } = await STATE.supabase
        .from('organizations')
        .select('*')
        .eq('employer_id', uid)
        .order('created_at', { ascending: true });
    if (error) {
        console.error('fetchOrganizations error:', error);
        showToast('Error loading organizations: ' + error.message, 'error');
    }
    if (ownedOrgs && ownedOrgs.length > 0) {
        return ownedOrgs;
    }

    const email = getSignedInEmail();
    if (!email) return [];

    const { data: memberships, error: membershipError } = await STATE.supabase
        .from('employees')
        .select('id, organization_id, employee_id, name, role, email, system_role')
        .ilike('email', email);
    if (membershipError) {
        console.error('fetch employee memberships error:', membershipError);
        if (isMissingEmployeeAccessColumns(membershipError)) {
            showToast('Employee email login needs the database migration. Add employees.email and employees.system_role in Supabase.', 'error');
        } else {
            showToast('Error loading employee access: ' + membershipError.message, 'error');
        }
        return [];
    }

    STATE.employeeMemberships = (memberships || []).map(member => ({
        ...member,
        system_role: normalizeSystemRole(member.system_role),
    }));
    if (STATE.employeeMemberships.length === 0) {
        return [];
    }

    STATE.accessMode = 'employee';
    const orgIds = [...new Set(STATE.employeeMemberships.map(member => member.organization_id).filter(Boolean))];
    if (orgIds.length === 0) return [];

    const { data: employeeOrgs, error: orgError } = await STATE.supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds)
        .order('created_at', { ascending: true });
    if (orgError) {
        console.error('fetch employee organizations error:', orgError);
        showToast('Error loading employee organizations: ' + orgError.message, 'error');
        return [];
    }
    return employeeOrgs || [];
}

async function createOrganization(orgCode, orgName) {
    const uid = getEmployerId();
    if (!uid || !STATE.supabase) throw new Error('Not authenticated');
    const { data, error } = await STATE.supabase
        .from('organizations')
        .insert({ org_code: orgCode, org_name: orgName, employer_id: uid })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function updateOrganization(id, orgCode, orgName) {
    if (!STATE.supabase) throw new Error('No client');
    const { data, error } = await STATE.supabase
        .from('organizations')
        .update({ org_code: orgCode, org_name: orgName, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function deleteOrganization(id) {
    if (!STATE.supabase) throw new Error('No client');
    const { error } = await STATE.supabase
        .from('organizations')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// ---- EMPLOYEES ----
async function fetchEmployees(orgId) {
    if (!STATE.supabase) return [];
    const { data, error } = await STATE.supabase
        .from('employees')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
    if (error) {
        console.error('fetchEmployees error:', error);
        showToast('Error loading employees: ' + error.message, 'error');
        return [];
    }
    return data || [];
}

async function fetchRoles(orgId) {
    if (!STATE.supabase) return [];
    const { data, error } = await STATE.supabase
        .from('roles')
        .select('role_name')
        .eq('organization_id', orgId)
        .order('role_name', { ascending: true });
    if (error) {
        console.error('fetchRoles error:', error);
        return [];
    }
    return data.map(r => r.role_name);
}

async function ensureRole(orgId, roleName) {
    if (!roleName || !roleName.trim()) return;
    const trimmed = roleName.trim();
    if (!trimmed) return;
    // check if exists
    const { data, error } = await STATE.supabase
        .from('roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('role_name', trimmed)
        .maybeSingle();
    if (error) {
        console.error('ensureRole check error:', error);
        return;
    }
    if (data) return; // already exists
    // insert
    const { error: insErr } = await STATE.supabase
        .from('roles')
        .insert({ organization_id: orgId, role_name: trimmed });
    if (insErr) {
        console.error('ensureRole insert error:', insErr);
    }
}

async function createEmployee(orgId, employeeId, name, role, email, systemRole, password, pin) {
    if (!STATE.supabase) throw new Error('No client');
    const salt = bcrypt.genSaltSync(10);
    const pwdHash = bcrypt.hashSync(password, salt);
    const pinHash = bcrypt.hashSync(pin, salt);
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const { data, error } = await STATE.supabase
        .from('employees')
        .insert({
            organization_id: orgId,
            employee_id: employeeId.trim(),
            name: name.trim(),
            role: role ? role.trim() : null,
            email: normalizedEmail || null,
            system_role: normalizeSystemRole(systemRole),
            password_hash: pwdHash,
            pin_hash: pinHash,
        })
        .select()
        .single();
    if (error) throw error;
    // ensure role in roles table
    if (role && role.trim()) {
        await ensureRole(orgId, role.trim());
    }
    return data;
}

async function updateEmployee(id, orgId, employeeId, name, role, email, systemRole, password, pin) {
    if (!STATE.supabase) throw new Error('No client');
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const payload = {
        employee_id: employeeId.trim(),
        name: name.trim(),
        role: role ? role.trim() : null,
        email: normalizedEmail || null,
        system_role: normalizeSystemRole(systemRole),
        updated_at: new Date().toISOString(),
    };
    // only hash & update password/pin if provided
    if (password && password.length > 0) {
        const salt = bcrypt.genSaltSync(10);
        payload.password_hash = bcrypt.hashSync(password, salt);
    }
    if (pin && pin.length === 4) {
        const salt = bcrypt.genSaltSync(10);
        payload.pin_hash = bcrypt.hashSync(pin, salt);
    }
    const { data, error } = await STATE.supabase
        .from('employees')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    if (role && role.trim()) {
        await ensureRole(orgId, role.trim());
    }
    return data;
}

async function deleteEmployee(id) {
    if (!STATE.supabase) throw new Error('No client');
    const { error } = await STATE.supabase
        .from('employees')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

// ============================================================
//  RENDER
// ============================================================
function showPage(pageId) {
    Object.values(pages).forEach(p => p.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
}

async function renderApp() {
    const cfg = loadConfig();
    if (!cfg) {
        topbar.style.display = 'none';
        showPage('pageSettings');
        return;
    }
    // init supabase if not already
    if (!STATE.supabase) {
        initSupabase();
    }
    // check session
    try {
        const session = await getSession();
        STATE.session = session;
        if (session) {
            topbar.style.display = 'flex';
            userEmail.textContent = session.user?.email || 'User';
            await renderDashboard();
        } else {
            topbar.style.display = 'none';
            showPage('pageLogin');
            loginStatus.textContent = '';
        }
    } catch (err) {
        console.error('Session retrieval failed:', err);
        topbar.style.display = 'none';
        showPage('pageLogin');
    }
}

// ---- RENDER DASHBOARD ----
async function renderDashboard() {
    STATE.currentOrgId = null;
    STATE.currentMembership = null;
    showPage('pageDashboard');
    const orgs = await fetchOrganizations();
    STATE.organizations = orgs;
    btnAddOrg.style.display = canManageOrganizations() ? 'inline-flex' : 'none';
    renderOrgList(orgs);
}

function renderOrgList(orgs) {
    if (!orgs || orgs.length === 0) {
        const emptyText = isEmployerMode()
            ? 'No organizations yet. Create your first one!'
            : 'No employee access found for this Google account.';
        orgList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-building"></i>
                <p>${emptyText}</p>
            </div>
        `;
        return;
    }
    let html = '<div class="org-grid">';
    orgs.forEach(org => {
        const membership = getMembershipForOrg(org.id);
        const systemRoleHtml = membership
            ? `<div class="org-access-role">System role: ${escHtml(normalizeSystemRole(membership.system_role))}</div>`
            : '';
        const orgActionsHtml = canManageOrganizations()
            ? `
                <div class="org-actions">
                    <button class="btn-edit-org" data-id="${org.id}" data-code="${org.org_code}" data-name="${escHtml(org.org_name)}">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-del-org" data-id="${org.id}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            `
            : '';
        html += `
            <div class="org-card" data-org-id="${org.id}">
                <div class="org-code">${org.org_code}</div>
                <div class="org-name">${escHtml(org.org_name)}</div>
                ${systemRoleHtml}
                ${orgActionsHtml}
            </div>
        `;
    });
    html += '</div>';
    orgList.innerHTML = html;

    // click on card -> view employees
    orgList.querySelectorAll('.org-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // ignore if click on action button
            if (e.target.closest('.org-actions')) return;
            const id = card.dataset.orgId;
            if (id) viewOrganization(id);
        });
    });

    // edit buttons
    orgList.querySelectorAll('.btn-edit-org').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const code = btn.dataset.code;
            const name = btn.dataset.name;
            openOrgModal(id, code, name);
        });
    });

    // delete buttons
    orgList.querySelectorAll('.btn-del-org').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('Delete this organization and all its employees?')) return;
            try {
                await deleteOrganization(id);
                showToast('Organization deleted.');
                renderDashboard();
            } catch (err) {
                showToast('Delete failed: ' + err.message, 'error');
            }
        });
    });
}

// ---- TABS SWITCHING ----
function switchTab(tab) {
    if (tab === 'employees') {
        if (!canViewEmployees()) {
            showToast('Your role does not allow employee management.', 'error');
            if (canViewAttendance()) switchTab('attendance');
            return;
        }
        tabEmployees.classList.add('active');
        tabAttendance.classList.remove('active');
        employeeSection.style.display = 'block';
        attendanceSection.style.display = 'none';
        btnAddEmployee.style.display = canManageEmployees() ? 'inline-flex' : 'none';
    } else if (tab === 'attendance') {
        if (!canViewAttendance()) {
            showToast('Your role does not allow attendance access.', 'error');
            if (canViewEmployees()) switchTab('employees');
            return;
        }
        tabEmployees.classList.remove('active');
        tabAttendance.classList.add('active');
        employeeSection.style.display = 'none';
        attendanceSection.style.display = 'block';
        btnAddEmployee.style.display = 'none';
        if (STATE.currentOrgId) {
            loadAndRenderAttendance(STATE.currentOrgId);
        }
    }
}

// ---- ATTENDANCE LOGS ----
async function fetchAttendance(orgId) {
    if (!STATE.supabase) return [];
    const { data, error } = await STATE.supabase
        .from('attendance')
        .select('*')
        .eq('organization_id', orgId)
        .order('date', { ascending: false });
    if (error) {
        console.error('fetchAttendance error:', error);
        showToast('Error loading attendance: ' + error.message, 'error');
        return [];
    }
    return data || [];
}

async function loadAndRenderAttendance(orgId) {
    attendanceList.innerHTML = `
        <div class="attendance-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <p>Loading attendance records...</p>
        </div>
    `;
    const records = await fetchAttendance(orgId);
    ATTENDANCE_VIEW.records = records;
    renderAttendanceList(STATE.employees, records);
}

function getAttendanceStatus(rec) {
    if (!rec.punch_in_time) return 'Absent';
    if (!rec.punch_out_time) return 'Punched In';
    const reason = rec.punch_out_reason ? rec.punch_out_reason.trim() : '';
    if (reason) {
        if (reason.toLowerCase() === 'half day') return 'Half Day';
        return `Present (${reason})`;
    }
    return 'Present';
}

function getAttendanceBucket(status) {
    if (status === 'Present') return 'present';
    if (status === 'Punched In') return 'punched-in';
    if (status === 'Half Day') return 'half-day';
    if (status.startsWith('Present (')) return 'present';
    return 'absent';
}

function getStatusBadgeClass(status) {
    if (status === 'Present' || status.startsWith('Present (')) return 'badge-success';
    if (status === 'Punched In') return 'badge-info';
    if (status === 'Half Day') return 'badge-warning';
    return 'badge-secondary';
}

function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + days);
    return getLocalDateString(date);
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return 'Selected day';
    const date = new Date(`${dateStr}T00:00:00`);
    return date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatTimeValue(value) {
    return value ? escHtml(value) : '—';
}

function getPrimaryRecordForDay(records) {
    if (!records.length) return null;
    return records.find(rec => rec.punch_in_time || rec.punch_out_time) || records[0];
}

function getEmployeeAttendanceRows(employees, records, selectedDate) {
    return employees.map(emp => {
        const allRecords = records.filter(r => r.employee_id === emp.id);
        const dayRecords = allRecords.filter(r => r.date === selectedDate);
        const record = getPrimaryRecordForDay(dayRecords);
        const status = record ? getAttendanceStatus(record) : 'Absent';
        const bucket = getAttendanceBucket(status);
        const recentRecords = allRecords
            .filter(r => r.date && r.date <= selectedDate)
            .slice()
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 14);
        const recentMisses = recentRecords.filter(r => !r.punch_in_time).length;
        const recentHalfDays = recentRecords.filter(r => getAttendanceStatus(r) === 'Half Day').length;
        const openPunches = allRecords.filter(r => r.punch_in_time && !r.punch_out_time).length;
        const latestDate = allRecords[0] && allRecords[0].date ? allRecords[0].date : '';
        const alertScore = (bucket === 'absent' ? 5 : 0) + recentMisses + recentHalfDays + openPunches;

        return {
            emp,
            allRecords,
            dayRecords,
            record,
            status,
            bucket,
            recentMisses,
            recentHalfDays,
            openPunches,
            latestDate,
            alertScore,
        };
    });
}

function getFilteredAttendanceRows(rows) {
    const query = ATTENDANCE_VIEW.search.trim().toLowerCase();
    return rows.filter(row => {
        const matchesStatus = ATTENDANCE_VIEW.statusFilter === 'all' || row.bucket === ATTENDANCE_VIEW.statusFilter;
        const searchable = [
            row.emp.name,
            row.emp.employee_id,
            row.emp.role,
            row.status,
        ].filter(Boolean).join(' ').toLowerCase();
        return matchesStatus && (!query || searchable.includes(query));
    }).sort((a, b) => {
        if (ATTENDANCE_VIEW.sortBy === 'name') return String(a.emp.name).localeCompare(String(b.emp.name));
        if (ATTENDANCE_VIEW.sortBy === 'status') return String(a.status).localeCompare(String(b.status));
        if (ATTENDANCE_VIEW.sortBy === 'latest') return String(b.latestDate).localeCompare(String(a.latestDate));
        return b.alertScore - a.alertScore || String(a.emp.name).localeCompare(String(b.emp.name));
    });
}

function getAttendanceSummary(rows) {
    const total = rows.length;
    const present = rows.filter(row => row.bucket === 'present').length;
    const punchedIn = rows.filter(row => row.bucket === 'punched-in').length;
    const halfDay = rows.filter(row => row.bucket === 'half-day').length;
    const absent = rows.filter(row => row.bucket === 'absent').length;
    const alerts = rows.filter(row => row.alertScore > 1 || row.bucket === 'absent').length;
    const presentRate = total ? Math.round(((present + punchedIn + halfDay) / total) * 100) : 0;

    return { total, present, punchedIn, halfDay, absent, alerts, presentRate };
}

function renderSummaryCard(label, value, detail, icon, tone = '') {
    return `
        <div class="attendance-stat ${tone}">
            <div class="attendance-stat-icon"><i class="fas ${icon}"></i></div>
            <div>
                <span class="attendance-stat-label">${escHtml(label)}</span>
                <strong>${escHtml(String(value))}</strong>
                <span class="attendance-stat-detail">${escHtml(detail)}</span>
            </div>
        </div>
    `;
}

function renderPatternChips(row) {
    const chips = [];
    if (row.bucket === 'absent') chips.push(['Absent selected day', 'fa-user-times', 'danger']);
    if (row.openPunches > 0) chips.push([`${row.openPunches} open punch`, 'fa-clock', 'info']);
    if (row.recentMisses > 0) chips.push([`${row.recentMisses} recent missing day(s)`, 'fa-calendar-times', 'warning']);
    if (row.recentHalfDays > 0) chips.push([`${row.recentHalfDays} half day(s)`, 'fa-adjust', 'warning']);
    if (!chips.length) chips.push(['No recent alerts', 'fa-check-circle', 'success']);

    return chips.map(([label, icon, tone]) => `
        <span class="attendance-chip ${tone}">
            <i class="fas ${icon}"></i> ${escHtml(label)}
        </span>
    `).join('');
}

function renderRecordDetail(rec) {
    if (!rec) return '<span class="muted">No punch record for the selected day.</span>';

    const inImg = rec.punch_in_image_url ?
        `<a href="${escHtml(rec.punch_in_image_url)}" target="_blank" title="View Full Punch-In Image"><img class="attendance-photo" src="${escHtml(rec.punch_in_image_url)}" alt="Punch In" /></a>` : '';
    const outImg = rec.punch_out_image_url ?
        `<a href="${escHtml(rec.punch_out_image_url)}" target="_blank" title="View Full Punch-Out Image"><img class="attendance-photo" src="${escHtml(rec.punch_out_image_url)}" alt="Punch Out" /></a>` : '';

    let reasonHtml = '—';
    if (rec.punch_out_reason) {
        reasonHtml = `<span class="reason-badge">${escHtml(rec.punch_out_reason)}</span>`;
        if (rec.punch_out_reason_detail) {
            reasonHtml += `<span class="reason-detail">${escHtml(rec.punch_out_reason_detail)}</span>`;
        }
    }

    return `
        <div class="attendance-day-grid">
            <div>
                <span>Punch In</span>
                <strong>${formatTimeValue(rec.punch_in_time)} ${inImg}</strong>
            </div>
            <div>
                <span>Punch Out</span>
                <strong>${formatTimeValue(rec.punch_out_time)} ${outImg}</strong>
            </div>
            <div>
                <span>Reason / Detail</span>
                <strong>${reasonHtml}</strong>
            </div>
        </div>
    `;
}

function getRecentRecordRows(row) {
    const rows = row.allRecords
        .filter(rec => rec.date && rec.date <= ATTENDANCE_VIEW.selectedDate)
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 5);

    if (!rows.length) {
        return `
            <tr>
                <td colspan="5">No recent history available.</td>
            </tr>
        `;
    }

    return rows.map(rec => {
        const status = getAttendanceStatus(rec);
        return `
            <tr>
                <td><strong>${escHtml(rec.date || '—')}</strong></td>
                <td>${formatTimeValue(rec.punch_in_time)}</td>
                <td>${formatTimeValue(rec.punch_out_time)}</td>
                <td><span class="badge ${getStatusBadgeClass(status)}">${escHtml(status)}</span></td>
                <td>${rec.punch_out_reason ? escHtml(rec.punch_out_reason) : '—'}</td>
            </tr>
        `;
    }).join('');
}

function renderAttendanceList(employees, records) {
    if (!employees || employees.length === 0) {
        attendanceList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-slash"></i>
                <p>No employees in this organization yet.</p>
            </div>
        `;
        return;
    }

    const today = getLocalDateString(new Date());
    const yesterday = addDays(today, -1);
    const rows = getEmployeeAttendanceRows(employees, records, ATTENDANCE_VIEW.selectedDate);
    const filteredRows = getFilteredAttendanceRows(rows);
    const summary = getAttendanceSummary(rows);
    const activeDateLabel = ATTENDANCE_VIEW.selectedDate === today ? 'Today' :
        ATTENDANCE_VIEW.selectedDate === yesterday ? 'Yesterday' : formatDisplayDate(ATTENDANCE_VIEW.selectedDate);

    const cardsHtml = filteredRows.map(row => `
        <div class="attendance-card ${row.bucket}">
           <div class="attendance-card-header">
               <div class="emp-info">
                   <span class="emp-name">${escHtml(row.emp.name)}</span>
                   <span class="emp-id">${escHtml(row.emp.employee_id)}</span>
                   ${row.emp.role ? `<span class="badge badge-role attendance-role">${escHtml(row.emp.role)}</span>` : ''}
               </div>
               <div class="attendance-record-count">
                   <span class="badge ${getStatusBadgeClass(row.status)}">${escHtml(row.status)}</span>
               </div>
           </div>
           ${renderRecordDetail(row.record)}
           <div class="attendance-pattern-row">${renderPatternChips(row)}</div>
           <details class="attendance-history">
                <summary>Recent history (${row.allRecords.length} total record(s))</summary>
                <div class="table-wrap">
                    <table class="attendance-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Punch In</th>
                                <th>Punch Out</th>
                                <th>Status</th>
                                <th>Reason</th>
                            </tr>
                        </thead>
                        <tbody>${getRecentRecordRows(row)}</tbody>
                    </table>
                </div>
           </details>
        </div>
    `).join('');

    attendanceList.innerHTML = `
        <div class="attendance-dashboard">
            <div class="attendance-toolbar">
                <div>
                    <span class="attendance-eyebrow">Attendance Snapshot</span>
                    <h3>${escHtml(activeDateLabel)}</h3>
                    <p>${escHtml(formatDisplayDate(ATTENDANCE_VIEW.selectedDate))}</p>
                </div>
                <div class="attendance-date-tools">
                    <button class="btn-secondary btn-sm attendance-date-step" data-step="-1" title="Previous day">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="btn-secondary btn-sm attendance-today">
                        <i class="fas fa-calendar-day"></i> Today
                    </button>
                    <button class="btn-secondary btn-sm attendance-yesterday">
                        <i class="fas fa-history"></i> Yesterday
                    </button>
                    <input class="form-control attendance-date-input" type="date" value="${escHtml(ATTENDANCE_VIEW.selectedDate)}" />
                    <button class="btn-secondary btn-sm attendance-date-step" data-step="1" title="Next day">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <button class="btn-secondary btn-sm attendance-refresh">
                        <i class="fas fa-rotate"></i> Refresh
                    </button>
                </div>
            </div>

            <div class="attendance-stats">
                ${renderSummaryCard('Coverage', `${summary.presentRate}%`, `${summary.present + summary.punchedIn + summary.halfDay}/${summary.total} active`, 'fa-chart-pie', 'success')}
                ${renderSummaryCard('Present', summary.present, 'Completed punch in/out', 'fa-user-check', 'success')}
                ${renderSummaryCard('Punched In', summary.punchedIn, 'Missing punch out', 'fa-clock', 'info')}
                ${renderSummaryCard('Half Day', summary.halfDay, 'Marked half day', 'fa-adjust', 'warning')}
                ${renderSummaryCard('Absent', summary.absent, 'No selected-day punch', 'fa-user-times', 'danger')}
                ${renderSummaryCard('Alerts', summary.alerts, 'Needs quick review', 'fa-exclamation-triangle', 'warning')}
            </div>

            <div class="attendance-filterbar">
                <div class="attendance-search">
                    <i class="fas fa-search"></i>
                    <input class="form-control attendance-search-input" type="search" placeholder="Search employee, ID, role, status" value="${escHtml(ATTENDANCE_VIEW.search)}" />
                </div>
                <select class="form-control attendance-status-filter" aria-label="Filter by attendance status">
                    <option value="all"${ATTENDANCE_VIEW.statusFilter === 'all' ? ' selected' : ''}>All statuses</option>
                    <option value="present"${ATTENDANCE_VIEW.statusFilter === 'present' ? ' selected' : ''}>Present</option>
                    <option value="punched-in"${ATTENDANCE_VIEW.statusFilter === 'punched-in' ? ' selected' : ''}>Punched in</option>
                    <option value="half-day"${ATTENDANCE_VIEW.statusFilter === 'half-day' ? ' selected' : ''}>Half day</option>
                    <option value="absent"${ATTENDANCE_VIEW.statusFilter === 'absent' ? ' selected' : ''}>Absent</option>
                </select>
                <select class="form-control attendance-sort" aria-label="Sort attendance rows">
                    <option value="alerts"${ATTENDANCE_VIEW.sortBy === 'alerts' ? ' selected' : ''}>Sort: alerts first</option>
                    <option value="name"${ATTENDANCE_VIEW.sortBy === 'name' ? ' selected' : ''}>Sort: name</option>
                    <option value="status"${ATTENDANCE_VIEW.sortBy === 'status' ? ' selected' : ''}>Sort: status</option>
                    <option value="latest"${ATTENDANCE_VIEW.sortBy === 'latest' ? ' selected' : ''}>Sort: latest activity</option>
                </select>
                <button class="btn-secondary btn-sm attendance-export">
                    <i class="fas fa-file-csv"></i> Export CSV
                </button>
            </div>

            <div class="attendance-results-meta">
                Showing ${filteredRows.length} of ${rows.length} employee(s)
            </div>

            <div class="attendance-cards">
                ${cardsHtml || `
                    <div class="empty-state">
                        <i class="fas fa-filter"></i>
                        <p>No employees match the selected filters.</p>
                    </div>
                `}
            </div>
        </div>
    `;

    bindAttendanceDashboardControls();
}

function rerenderAttendanceDashboard(focusSearch = false) {
    renderAttendanceList(STATE.employees, ATTENDANCE_VIEW.records);
    if (focusSearch) {
        const searchInput = attendanceList.querySelector('.attendance-search-input');
        if (searchInput) {
            searchInput.focus();
            const end = searchInput.value.length;
            searchInput.setSelectionRange(end, end);
        }
    }
}

function bindAttendanceDashboardControls() {
    attendanceList.querySelectorAll('.attendance-date-step').forEach(btn => {
        btn.addEventListener('click', () => {
            ATTENDANCE_VIEW.selectedDate = addDays(ATTENDANCE_VIEW.selectedDate, Number(btn.dataset.step || 0));
            rerenderAttendanceDashboard();
        });
    });

    const todayBtn = attendanceList.querySelector('.attendance-today');
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            ATTENDANCE_VIEW.selectedDate = getLocalDateString(new Date());
            rerenderAttendanceDashboard();
        });
    }

    const yesterdayBtn = attendanceList.querySelector('.attendance-yesterday');
    if (yesterdayBtn) {
        yesterdayBtn.addEventListener('click', () => {
            ATTENDANCE_VIEW.selectedDate = addDays(getLocalDateString(new Date()), -1);
            rerenderAttendanceDashboard();
        });
    }

    const dateInput = attendanceList.querySelector('.attendance-date-input');
    if (dateInput) {
        dateInput.addEventListener('change', () => {
            if (!dateInput.value) return;
            ATTENDANCE_VIEW.selectedDate = dateInput.value;
            rerenderAttendanceDashboard();
        });
    }

    const searchInput = attendanceList.querySelector('.attendance-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            ATTENDANCE_VIEW.search = searchInput.value;
            rerenderAttendanceDashboard(true);
        });
    }

    const statusFilter = attendanceList.querySelector('.attendance-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            ATTENDANCE_VIEW.statusFilter = statusFilter.value;
            rerenderAttendanceDashboard();
        });
    }

    const sortSelect = attendanceList.querySelector('.attendance-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            ATTENDANCE_VIEW.sortBy = sortSelect.value;
            rerenderAttendanceDashboard();
        });
    }

    const refreshBtn = attendanceList.querySelector('.attendance-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (STATE.currentOrgId) loadAndRenderAttendance(STATE.currentOrgId);
        });
    }

    const exportBtn = attendanceList.querySelector('.attendance-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportAttendanceCsv);
    }
}

function csvEscape(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function exportAttendanceCsv() {
    const rows = getFilteredAttendanceRows(
        getEmployeeAttendanceRows(STATE.employees, ATTENDANCE_VIEW.records, ATTENDANCE_VIEW.selectedDate)
    );
    const header = [
        'Date',
        'Employee Name',
        'Employee ID',
        'Role',
        'Status',
        'Punch In',
        'Punch Out',
        'Reason',
        'Recent Missing Days',
        'Recent Half Days',
        'Open Punches',
    ];
    const lines = rows.map(row => {
        const rec = row.record || {};
        return [
            ATTENDANCE_VIEW.selectedDate,
            row.emp.name,
            row.emp.employee_id,
            row.emp.role || '',
            row.status,
            rec.punch_in_time || '',
            rec.punch_out_time || '',
            rec.punch_out_reason || '',
            row.recentMisses,
            row.recentHalfDays,
            row.openPunches,
        ].map(csvEscape).join(',');
    });
    const blob = new Blob([[header.map(csvEscape).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-${ATTENDANCE_VIEW.selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// ---- VIEW ORGANIZATION (employees) ----
async function viewOrganization(orgId) {
    STATE.currentOrgId = orgId;
    STATE.currentMembership = getMembershipForOrg(orgId);
    const org = STATE.organizations.find(o => o.id === orgId);
    if (!org) {
        showToast('Organization not found.', 'error');
        return;
    }
    if (!hasAnyOrgAccess()) {
        showToast('You do not have access to this organization.', 'error');
        return;
    }
    orgDetailTitle.innerHTML =
        `<i class="fas fa-users section-title-icon"></i>${escHtml(org.org_name)}`;
    const modeText = isEmployerMode()
        ? 'Manage employees and attendance'
        : `${getCurrentSystemRole()} access`;
    orgDetailSub.textContent = `Code: ${org.org_code} · ${modeText}`;

    tabEmployees.style.display = canViewEmployees() ? 'inline-flex' : 'none';
    tabAttendance.style.display = canViewAttendance() ? 'inline-flex' : 'none';

    // fetch employees
    const emps = await fetchEmployees(orgId);
    STATE.employees = emps;
    // fetch roles for autocomplete
    const roles = canManageEmployees() ? await fetchRoles(orgId) : [];
    STATE.roles = roles;
    updateRoleDatalist(roles);

    renderEmployeeList(emps);
    showPage('pageOrgDetail');
    const defaultTab = getDefaultTab();
    if (defaultTab) {
        switchTab(defaultTab);
    }
}

function renderEmployeeList(emps) {
    if (!emps || emps.length === 0) {
        employeeList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-slash"></i>
                <p>No employees in this organization yet.</p>
            </div>
        `;
        return;
    }
    let html = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Employee ID</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Email</th>
                        <th>System Role</th>
                        ${canManageEmployees() ? '<th class="actions-cell">Actions</th>' : ''}
                    </tr>
                </thead>
                <tbody>
    `;
    emps.forEach(emp => {
        const systemRole = normalizeSystemRole(emp.system_role);
        const rowActions = `
            ${canEditEmployee(emp) ? `
                <button class="btn-edit-emp" data-id="${emp.id}" data-empid="${escHtml(emp.employee_id)}" data-name="${escHtml(emp.name)}" data-role="${escHtml(emp.role||'')}" data-email="${escHtml(emp.email||'')}" data-system-role="${escHtml(systemRole)}">
                    <i class="fas fa-edit"></i> Edit
                </button>
            ` : ''}
            ${canDeleteEmployees() ? `
                <button class="btn-del-emp" data-id="${emp.id}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            ` : ''}
        `;
        const actionsHtml = canManageEmployees()
            ? `
                <td class="actions-cell">
                    <div class="employee-actions employee-actions-end">
                        ${rowActions || '<span class="text-muted text-sm">Locked</span>'}
                    </div>
                </td>
            `
            : '';
        html += `
            <tr>
                <td><span class="emp-id">${escHtml(emp.employee_id)}</span></td>
                <td><strong>${escHtml(emp.name)}</strong></td>
                <td>${emp.role ? `<span class="badge badge-role">${escHtml(emp.role)}</span>` : '<span class="badge">—</span>'}</td>
                <td>${emp.email ? escHtml(emp.email) : '<span class="badge">—</span>'}</td>
                <td><span class="badge badge-system-role">${escHtml(systemRole)}</span></td>
                ${actionsHtml}
            </tr>
        `;
    });
    html += '</tbody></table></div>';
    employeeList.innerHTML = html;

    // edit
    employeeList.querySelectorAll('.btn-edit-emp').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const employee = STATE.employees.find(emp => emp.id === id);
            if (!canEditEmployee(employee)) {
                showToast('Your role does not allow editing this employee.', 'error');
                return;
            }
            const empId = btn.dataset.empid;
            const name = btn.dataset.name;
            const role = btn.dataset.role;
            const email = btn.dataset.email;
            const systemRole = btn.dataset.systemRole;
            openEmpModal(id, empId, name, role, email, systemRole);
        });
    });

    // delete
    employeeList.querySelectorAll('.btn-del-emp').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!canDeleteEmployees()) {
                showToast('Only admins can delete employees.', 'error');
                return;
            }
            const id = btn.dataset.id;
            if (!confirm('Delete this employee?')) return;
            try {
                await deleteEmployee(id);
                showToast('Employee deleted.');
                viewOrganization(STATE.currentOrgId);
            } catch (err) {
                showToast('Delete failed: ' + err.message, 'error');
            }
        });
    });
}

function updateRoleDatalist(roles) {
    roleDatalist.innerHTML = '';
    roles.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        roleDatalist.appendChild(opt);
    });
}

// ============================================================
//  ORG MODAL
// ============================================================
function openOrgModal(id = null, code = '', name = '') {
    STATE.isEditingOrg = !!id;
    if (id) {
        orgFormId.value = id;
        orgFormCode.value = code;
        orgFormName.value = name;
        modalOrgTitle.textContent = 'Edit Organization';
        modalOrgSub.textContent = 'Update the organization details.';
        modalOrgSave.innerHTML = '<i class="fas fa-save"></i> Update';
    } else {
        orgFormId.value = '';
        orgFormCode.value = '';
        orgFormName.value = '';
        modalOrgTitle.textContent = 'New Organization';
        modalOrgSub.textContent = 'Enter a 4‑digit code and a name.';
        modalOrgSave.innerHTML = '<i class="fas fa-plus"></i> Create';
    }
    modalOrg.classList.add('open');
    orgFormCode.focus();
}

function closeOrgModal() {
    modalOrg.classList.remove('open');
}

// ============================================================
//  EMP MODAL
// ============================================================
function openEmpModal(id = null, employeeId = '', name = '', role = '', email = '', systemRole = 'viewer') {
    STATE.isEditingEmp = !!id;
    const labelPassword = empFormPassword.previousElementSibling;
    const labelPin = empFormPin.previousElementSibling;

    if (id) {
        empFormId.value = id;
        empFormEmployeeId.value = employeeId;
        empFormName.value = name;
        empFormRole.value = role;
        empFormEmail.value = email;
        empFormSystemRole.value = normalizeSystemRole(systemRole);
        empFormPassword.value = '';
        empFormPin.value = '';

        empFormPassword.required = false;
        empFormPin.required = false;
        empFormSystemRole.disabled = !canManageSystemRoles();
        empFormPassword.placeholder = 'Leave blank to keep current password';
        empFormPin.placeholder = 'Leave blank to keep current PIN';
        
        if (labelPassword) labelPassword.innerHTML = 'Password';
        if (labelPin) labelPin.innerHTML = '4‑Digit PIN';

        modalEmpTitle.textContent = 'Edit Employee';
        modalEmpSub.textContent = 'Update employee details. Leave password/PIN blank to keep unchanged.';
        modalEmpSave.innerHTML = '<i class="fas fa-save"></i> Update';
    } else {
        empFormId.value = '';
        empFormEmployeeId.value = '';
        empFormName.value = '';
        empFormRole.value = '';
        empFormEmail.value = '';
        empFormSystemRole.value = 'viewer';
        empFormPassword.value = '';
        empFormPin.value = '';

        empFormPassword.required = true;
        empFormPin.required = true;
        empFormSystemRole.disabled = !canManageSystemRoles();
        empFormPassword.placeholder = 'At least 6 characters';
        empFormPin.placeholder = 'e.g. 1234';

        if (labelPassword) labelPassword.innerHTML = 'Password <span class="required">*</span>';
        if (labelPin) labelPin.innerHTML = '4‑Digit PIN <span class="required">*</span>';

        modalEmpTitle.textContent = 'New Employee';
        modalEmpSub.textContent = 'Enter the employee\'s details.';
        modalEmpSave.innerHTML = '<i class="fas fa-user-plus"></i> Create';
    }
    // refresh roles in datalist
    const roles = STATE.roles || [];
    updateRoleDatalist(roles);
    modalEmp.classList.add('open');
    empFormEmployeeId.focus();
}

function closeEmpModal() {
    modalEmp.classList.remove('open');
}

// ============================================================
//  DATABASE CONFIGURATION FETCH LOGIC
// ============================================================

// Fetch Supabase configuration using live backend API
async function fetchSupabaseConfig(uuid, pin) {
    // Strip any spaces, zero-width characters, or special characters that might be pasted along
    const cleanPin = pin.trim().replace(/[^0-9]/g, '');
    const cleanUuid = uuid.trim().replace(/[^a-zA-Z0-9-]/g, '');
    
    if (!cleanPin) {
        throw new Error('PIN is required.');
    }
    
    // Set loading state on the Connect Database button
    btnSaveConfig.disabled = true;
    const originalHtml = btnSaveConfig.innerHTML;
    btnSaveConfig.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...';
    
    try {
        const apiUrl = 'https://expressjs-api-intranet-nameserver.onrender.com/api/config/get';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: cleanUuid,
                pin: cleanPin
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || `Failed to fetch configuration: ${response.status}`);
        }
        
        if (!data.success || !data.config) {
            throw new Error('Could not retrieve a valid configuration.');
        }
        
        const configData = {
            url: data.config.project_url || data.config.url,
            key: data.config.anon_key || data.config.anonKey || data.config.key
        };
        
        if (!configData.url || !configData.key) {
            throw new Error('Retrieved configuration is missing URL or Anon Key.');
        }
        
        // Automatically configure Supabase and update state
        saveConfig(configData.url, configData.key);
        showToast('Supabase configuration updated successfully!', 'success');
        
        // Re-initialize Supabase client
        initSupabase();
        
        // Refresh app view to transition to the Login screen
        renderApp();
    } catch (err) {
        console.error('[Error] fetchSupabaseConfig failed:', err);
        showToast(err.message, 'error');
    } finally {
        // Restore button state
        btnSaveConfig.disabled = false;
        btnSaveConfig.innerHTML = originalHtml;
    }
}

// Window escape key handler
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeOrgModal();
        closeEmpModal();
    }
});

// ============================================================
//  EVENT BINDINGS
// ============================================================

// -- Settings PIN configuration fetch --
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = connectionPin.value;
    const uuid = 'hXzVNksb5V90qJUOQeGU'; // Hardcoded UUID
    
    if (!pin.trim()) {
        showToast('PIN is required.', 'error');
        return;
    }
    
    try {
        await fetchSupabaseConfig(uuid, pin);
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// -- Login --
btnGoogleLogin.addEventListener('click', signInWithGoogle);

// -- Logout --
btnLogout.addEventListener('click', signOut);

// -- Add Org --
btnAddOrg.addEventListener('click', () => {
    if (!canManageOrganizations()) {
        showToast('Only the organization owner can manage organizations.', 'error');
        return;
    }
    openOrgModal();
});

// -- Org Modal --
modalOrgCancel.addEventListener('click', closeOrgModal);
modalOrg.addEventListener('click', (e) => {
    if (e.target === modalOrg) closeOrgModal();
});

orgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canManageOrganizations()) {
        showToast('Only the organization owner can manage organizations.', 'error');
        return;
    }
    const id = orgFormId.value;
    const code = orgFormCode.value.trim();
    const name = orgFormName.value.trim();
    if (!/^[0-9]{4}$/.test(code)) {
        showToast('Organization code must be exactly 4 digits.', 'error');
        return;
    }
    if (!name) {
        showToast('Organization name is required.', 'error');
        return;
    }
    try {
        if (id) {
            await updateOrganization(id, code, name);
            showToast('Organization updated.');
        } else {
            await createOrganization(code, name);
            showToast('Organization created.');
        }
        closeOrgModal();
        renderDashboard();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
});

// -- Back to Orgs --
btnBackToOrgs.addEventListener('click', renderDashboard);

// -- Tabs Navigation --
tabEmployees.addEventListener('click', () => switchTab('employees'));
tabAttendance.addEventListener('click', () => switchTab('attendance'));

// -- Add Employee --
btnAddEmployee.addEventListener('click', () => {
    if (!STATE.currentOrgId) {
        showToast('No organization selected.', 'error');
        return;
    }
    if (!canManageEmployees()) {
        showToast('Your role does not allow employee management.', 'error');
        return;
    }
    openEmpModal();
});

// -- Emp Modal --
modalEmpCancel.addEventListener('click', closeEmpModal);
modalEmp.addEventListener('click', (e) => {
    if (e.target === modalEmp) closeEmpModal();
});

empForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = empFormId.value;
    const employeeId = empFormEmployeeId.value.trim();
    const name = empFormName.value.trim();
    const role = empFormRole.value.trim();
    const email = empFormEmail.value.trim();
    const requestedSystemRole = empFormSystemRole.value;
    const systemRole = canManageSystemRoles()
        ? requestedSystemRole
        : (id ? requestedSystemRole : 'viewer');
    const password = empFormPassword.value;
    const pin = empFormPin.value.trim();

    if (!employeeId) {
        showToast('Employee ID is required.', 'error');
        return;
    }
    if (!name) {
        showToast('Name is required.', 'error');
        return;
    }
    if (email && !empFormEmail.checkValidity()) {
        showToast('Enter a valid email address.', 'error');
        return;
    }
    if (!['viewer', 'editor', 'admin'].includes(systemRole)) {
        showToast('Choose a valid system role.', 'error');
        return;
    }
    // For Create mode: password is required
    if (!id && !password) {
        showToast('Password is required.', 'error');
        return;
    }
    // If password is provided (in either mode), validate length
    if (password && password.length < 6) {
        showToast('Password must be at least 6 characters.', 'error');
        return;
    }
    // For Create mode: PIN is required
    if (!id && !pin) {
        showToast('PIN is required.', 'error');
        return;
    }
    // If PIN is provided (in either mode), validate format (exactly 4 digits)
    if (pin && !/^[0-9]{4}$/.test(pin)) {
        showToast('PIN must be exactly 4 digits.', 'error');
        return;
    }

    const orgId = STATE.currentOrgId;
    if (!orgId) {
        showToast('No organization selected.', 'error');
        return;
    }
    if (!canManageEmployees()) {
        showToast('Your role does not allow employee management.', 'error');
        return;
    }

    try {
        if (id) {
            await updateEmployee(id, orgId, employeeId, name, role, email, systemRole, password, pin);
            showToast('Employee updated.');
        } else {
            await createEmployee(orgId, employeeId, name, role, email, systemRole, password, pin);
            showToast('Employee created.');
        }
        closeEmpModal();
        viewOrganization(orgId);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
});

// ============================================================
//  UTILITY
// ============================================================
function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
//  HANDLE AUTH CALLBACK (OAuth redirect)
// ============================================================
async function handleAuthCallback() {
    const cfg = loadConfig();
    if (!cfg) return;
    if (!STATE.supabase) initSupabase();
    if (!STATE.supabase) return;

    const hasHash = window.location.hash && window.location.hash.includes('access_token');
    const hasQuery = window.location.search && (window.location.search.includes('code=') || window.location.search.includes('error='));

    if (hasHash || hasQuery) {
        // If there's an OAuth error parameter in the URL redirect, log it, clean URL, and abort
        if (window.location.search && window.location.search.includes('error=')) {
            console.error('OAuth redirect returned error:', window.location.search);
            let newUrl = window.location.pathname;
            window.history.replaceState(null, '', newUrl);
            return;
        }

        const { data, error } = await STATE.supabase.auth.getSession();
        if (error) {
            console.error('Auth callback error:', error);
            return;
        }
        if (data.session) {
            STATE.session = data.session;
            // clean URL from OAuth hash/query parameters
            let newUrl = window.location.pathname;
            if (window.location.search) {
                const params = new URLSearchParams(window.location.search);
                params.delete('code');
                params.delete('state');
                params.delete('error');
                params.delete('error_description');
                params.delete('error_code');
                const queryStr = params.toString();
                if (queryStr) {
                    newUrl += '?' + queryStr;
                }
            }
            window.history.replaceState(null, '', newUrl);
        }
    }
}

// ============================================================
//  INIT
// ============================================================
async function init() {
    const cfg = loadConfig();
    if (cfg) {
        initSupabase();
        // check if we have a session from OAuth redirect
        await handleAuthCallback();
    } else {
        showPage('pageSettings');
        topbar.style.display = 'none';
    }

    // Delegate routing and dashboard rendering entirely to renderApp
    await renderApp();
}

// Run
init().catch(console.error);

// Expose for debugging
console.log('🚀 EmpManager loaded.');
console.log('State:', STATE);
