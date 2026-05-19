import {
  getCurrentUser,
  loginAccount,
  logoutAccount,
  onUserChange,
  registerAccount,
} from './userData.js';

export function mountAuthUi() {
  const slot = document.getElementById('authSlot');
  const modal = document.getElementById('authModal');
  if (!slot || !modal) return;

  onUserChange(user => {
    const label = user?.displayName || user?.email || 'Account';
    slot.innerHTML = user
      ? `<span class="hidden sm:inline text-xs text-muted truncate max-w-36">${escapeHtml(label)}</span>
         <button id="logoutBtn" class="nav-btn">Logout</button>`
      : `<button id="openLoginBtn" class="nav-btn">Login</button>
         <button id="openSignupBtn" class="nav-btn nav-btn-primary">Create Account</button>`;

    document.getElementById('logoutBtn')?.addEventListener('click', () => logoutAccount().catch(showAuthError));
    document.getElementById('openLoginBtn')?.addEventListener('click', () => openAuthModal('login'));
    document.getElementById('openSignupBtn')?.addEventListener('click', () => openAuthModal('signup'));
  });

  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.dataset.closeAuth !== undefined) closeAuthModal();
  });

  document.getElementById('authForm')?.addEventListener('submit', submitAuthForm);
  document.getElementById('authModeToggle')?.addEventListener('click', () => {
    openAuthModal(document.body.dataset.authMode === 'signup' ? 'login' : 'signup');
  });
}

export function requireAccountMessage() {
  if (getCurrentUser()) return '';
  return ' Sign in to sync across devices.';
}

function openAuthModal(mode) {
  document.body.dataset.authMode = mode;
  document.getElementById('authTitle').textContent = mode === 'signup' ? 'Create Account' : 'Login';
  document.getElementById('authSubmit').textContent = mode === 'signup' ? 'Create Account' : 'Login';
  document.getElementById('authModeToggle').textContent = mode === 'signup' ? 'Use existing account' : 'Create new account';
  document.getElementById('nameField').classList.toggle('hidden', mode !== 'signup');
  document.getElementById('authError').textContent = '';
  document.getElementById('authModal').classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('authModal')?.classList.add('hidden');
}

async function submitAuthForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = document.body.dataset.authMode || 'login';
  const email = form.email.value.trim();
  const password = form.password.value;
  const name = form.displayName.value.trim();

  try {
    if (mode === 'signup') await registerAccount(email, password, name);
    else await loginAccount(email, password);
    form.reset();
    closeAuthModal();
  } catch (error) {
    showAuthError(error);
  }
}

function showAuthError(error) {
  const el = document.getElementById('authError');
  if (el) el.textContent = error.message || 'Authentication failed.';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
