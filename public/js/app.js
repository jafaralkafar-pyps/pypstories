
    // Tailwind script
    function initTailwind() {
      document.documentElement.style.setProperty('--accent', '#3b82f6');
    }

    // State
    let currentUser = null;
    let currentComicId = null;
    let currentPages = [];
    let currentReaderPage = null;
    let allComics = [];
    let previousView = 'home'; // for restoring after reader or editor
    let catalogMode = 'home'; // 'home' (hero) or 'browse' (no hero)

    function hideMainViews() {
      ['view-catalog', 'view-my-comics', 'view-admin-reviews', 'view-account'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
    }

    function isCatalogVisible() {
      const catalog = document.getElementById('view-catalog');
      return catalog && !catalog.classList.contains('hidden');
    }

    function rememberCurrentView() {
      if (isCatalogVisible()) {
        previousView = catalogMode;
      } else if (!document.getElementById('view-my-comics')?.classList.contains('hidden')) {
        previousView = 'my-comics';
      } else if (!document.getElementById('view-admin-reviews')?.classList.contains('hidden')) {
        previousView = 'admin-reviews';
      } else if (!document.getElementById('view-account')?.classList.contains('hidden')) {
        previousView = 'account';
      } else if (!document.getElementById('create-modal')?.classList.contains('hidden')) {
        previousView = 'edit';
      }
    }

    function restorePreviousView() {
      if (previousView === 'edit' && editingComicId) {
        document.getElementById('reader-modal').classList.add('hidden');
        document.getElementById('create-modal').classList.remove('hidden');
        document.getElementById('create-form').classList.add('hidden');
        document.getElementById('editor-section').classList.remove('hidden');
        document.getElementById('navbar').classList.remove('hidden');
        return;
      }
      if (previousView === 'my-comics') {
        showMyComics();
      } else if (previousView === 'admin-reviews') {
        showAdminReviews();
      } else if (previousView === 'account') {
        showAccount();
      } else if (previousView === 'browse') {
        showBrowse();
      } else {
        showHome();
      }
    }

    async function closeStructureBuilder(options = {}) {
      const el = document.getElementById('structure-builder-page');
      if (!el) return;
      if (options.save !== false && typeof window.__saveStoryStructure === 'function') {
        try { await window.__saveStoryStructure(); } catch (e) { console.error(e); }
      }
      window.__saveStoryStructure = null;
      el.remove();
    }

    function showCatalog(mode) {
      // Fire-and-forget save+close so navbar works from Structure page
      closeStructureBuilder({ save: true });
      document.getElementById('reader-modal').classList.add('hidden');
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('navbar').classList.remove('hidden');
      hideMainViews();
      document.getElementById('view-catalog').classList.remove('hidden');

      catalogMode = mode;
      const hero = document.getElementById('home-hero');
      const browseHeading = document.getElementById('browse-heading');
      if (mode === 'home') {
        hero.classList.remove('hidden');
        browseHeading.classList.add('hidden');
      } else {
        hero.classList.add('hidden');
        browseHeading.classList.remove('hidden');
      }
      loadComics();
    }

    function debounceSearch() {
      clearTimeout(window.searchTimeout);
      window.searchTimeout = setTimeout(() => loadComics(), 220);
    }

    // Navbar + Auth UI
    async function updateAuthUI() {
      const container = document.getElementById('auth-section');
      const myBtn = document.getElementById('my-comics-btn');

      try {
        const res = await fetch('/api/me');
        const data = await res.json();
        currentUser = data.user;

        if (currentUser) {
          const displayName = currentUser.username || (currentUser.email ? currentUser.email.split('@')[0] : 'User');
          const emailOrName = currentUser.username || currentUser.email || 'User';
          const initial = (emailOrName)[0].toUpperCase();
          const verifiedBadge = currentUser.email_verified ? '' : ' <span class="text-[10px] text-amber-400">(unverified)</span>';
          
          const bal = ((currentUser.credit_balance_cents || 0) / 100).toFixed(2);
          container.innerHTML = `
            <div class="flex items-center gap-2 flex-wrap justify-end">
              <button onclick="showCreditsModal()" class="text-xs px-2 py-1.5 hover:bg-slate-800 rounded-xl border border-slate-700" title="Credits">$${bal}</button>
              <div onclick="showAccountModal()" class="cursor-pointer flex items-center gap-2 bg-slate-900 hover:bg-slate-800 px-3 py-1 rounded-2xl text-sm">
                <div class="w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-[10px]">${initial}</div>
                <span class="font-medium">${displayName}${verifiedBadge}</span>
              </div>
              <button onclick="showMyComics()" class="text-xs px-2 py-1.5 hover:bg-slate-800 rounded-xl border border-slate-700">Stories</button>
              <button onclick="showAdminReviews()" class="text-xs px-2 py-1.5 hover:bg-slate-800 rounded-xl border border-slate-700 ${(currentUser.role === 'admin' || currentUser.role === 'editor') ? '' : 'hidden'}">Review Queue</button>
              <button onclick="logout()" class="text-xs px-3 py-1.5 hover:bg-slate-800 rounded-xl border border-slate-700">Log out</button>
            </div>
          `;
          myBtn.classList.remove('hidden');
        } else {
          container.innerHTML = `
            <div class="flex items-center gap-1.5 sm:gap-2">
              <button type="button" onclick="showAuthModal('login')" class="px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-medium border border-slate-600 rounded-2xl hover:bg-slate-900">Log in</button>
              <button type="button" onclick="showAuthModal('register')" class="px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-medium bg-white text-slate-900 rounded-2xl hover:bg-slate-100">Sign up</button>
            </div>`;
          myBtn.classList.add('hidden');
        }
      } catch (e) {
        container.innerHTML = `
          <div class="flex items-center gap-1.5 sm:gap-2">
            <button type="button" onclick="showAuthModal('login')" class="px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-medium border border-slate-600 rounded-2xl hover:bg-slate-900">Log in</button>
            <button type="button" onclick="showAuthModal('register')" class="px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-medium bg-white text-slate-900 rounded-2xl hover:bg-slate-100">Sign up</button>
          </div>`;
      }
    }

    function showAuthModal(tab) {
      document.getElementById('auth-modal').classList.remove('hidden');
      clearAuthForms();
      switchAuthTab(tab === 'register' ? 'register' : 'login');
    }

    function clearAuthForms() {
      const inputs = [
        'login-email', 'login-password',
        'reg-email', 'reg-username', 'reg-password', 'reg-password2',
        'forgot-email',
        'reset-password', 'reset-password2'
      ];
      inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      const errorEls = ['login-error', 'reg-error', 'forgot-error', 'reset-error'];
      errorEls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = '';
          el.classList.add('hidden');
        }
      });

      const successEl = document.getElementById('forgot-success');
      if (successEl) {
        successEl.textContent = '';
        successEl.classList.add('hidden');
      }

      const resendStatus = document.getElementById('login-resend-status');
      if (resendStatus) {
        resendStatus.textContent = '';
        resendStatus.classList.add('hidden');
        resendStatus.classList.remove('text-red-400');
        resendStatus.classList.add('text-emerald-400');
      }
    }

    function closeAuthModal() {
      document.getElementById('auth-modal').classList.add('hidden');
      clearAuthForms();
    }

    function switchAuthTab(tab) {
      // Hide all auth forms
      document.getElementById('login-form').classList.add('hidden');
      document.getElementById('register-form').classList.add('hidden');
      document.getElementById('forgot-password-form').classList.add('hidden');
      document.getElementById('reset-password-form').classList.add('hidden');

      const tabLogin = document.getElementById('tab-login');
      const tabReg = document.getElementById('tab-register');

      if (tab === 'login') {
        document.getElementById('login-form').classList.remove('hidden');
        tabLogin.classList.add('border-b-2', 'border-blue-500');
        tabLogin.classList.remove('text-slate-400');
        tabReg.classList.remove('border-b-2', 'border-blue-500');
        tabReg.classList.add('text-slate-400');
      } else if (tab === 'register') {
        document.getElementById('register-form').classList.remove('hidden');
        tabReg.classList.add('border-b-2', 'border-blue-500');
        tabReg.classList.remove('text-slate-400');
        tabLogin.classList.remove('border-b-2', 'border-blue-500');
        tabLogin.classList.add('text-slate-400');
      }
    }

    function showForgotPassword() {
      document.getElementById('login-form').classList.add('hidden');
      document.getElementById('register-form').classList.add('hidden');
      document.getElementById('forgot-password-form').classList.remove('hidden');
    }

    async function login() {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const rememberMe = document.getElementById('login-remember') ? document.getElementById('login-remember').checked : true;
      const errorEl = document.getElementById('login-error');
      errorEl.classList.add('hidden');
      
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email, password, rememberMe })
      });
      const data = await res.json();
      
      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.classList.remove('hidden');
        if (data.requiresVerification) {
          errorEl.textContent += ' Use “Resend verification email” below. Also check your spam/junk folder.';
        }
        return;
      }
      closeAuthModal();
      await updateAuthUI();
      showHome();
    }

    async function register() {
      const email = document.getElementById('reg-email').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const pw = document.getElementById('reg-password').value;
      const pw2 = document.getElementById('reg-password2').value;
      const errorEl = document.getElementById('reg-error');
      errorEl.classList.add('hidden');

      if (!email || !pw) {
        errorEl.textContent = 'Email and password are required';
        errorEl.classList.remove('hidden');
        return;
      }
      if (pw !== pw2) {
        errorEl.textContent = "Passwords don't match";
        errorEl.classList.remove('hidden');
        return;
      }
      if (pw.length < 8) {
        errorEl.textContent = "Password must be at least 8 characters";
        errorEl.classList.remove('hidden');
        return;
      }
      
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email, username, password: pw })
      });
      const data = await res.json();
      
      if (data.error) {
        // Account already exists (often unverified from an earlier attempt)
        if (res.status === 409) {
          errorEl.textContent = data.error + ' Check spam/junk, or switch to Log in and use Resend verification email.';
        } else {
          errorEl.textContent = data.error;
        }
        errorEl.classList.remove('hidden');
        return;
      }

      // Stay in auth modal: switch to login with email filled + clear next steps
      switchAuthTab('login');
      const loginEmail = document.getElementById('login-email');
      if (loginEmail) loginEmail.value = email;
      const statusEl = document.getElementById('login-resend-status');
      if (statusEl) {
        statusEl.textContent = `Account created. Check ${email} for a verification link (including spam/junk). You can also click Resend verification email.`;
        statusEl.classList.remove('hidden', 'text-red-400');
        statusEl.classList.add('text-emerald-400');
      }
    }

    async function resendVerification(email) {
      const res = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        return { ok: false, message: data.error || 'Failed to send verification email.' };
      }
      return { ok: true, message: data.message || 'Verification email sent if the account exists and is unverified. Check your inbox and spam/junk folder.' };
    }

    async function resendFromLogin() {
      const email = document.getElementById('login-email').value.trim();
      const statusEl = document.getElementById('login-resend-status');
      const errorEl = document.getElementById('login-error');
      if (errorEl) errorEl.classList.add('hidden');

      if (!email) {
        if (statusEl) {
          statusEl.textContent = 'Enter your email address above first.';
          statusEl.classList.remove('hidden', 'text-emerald-400');
          statusEl.classList.add('text-red-400');
        } else {
          alert('Please enter your email first.');
        }
        return;
      }

      const btn = document.getElementById('login-resend-btn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
      }

      try {
        const result = await resendVerification(email);
        if (statusEl) {
          statusEl.textContent = result.message;
          statusEl.classList.remove('hidden');
          if (result.ok) {
            statusEl.classList.remove('text-red-400');
            statusEl.classList.add('text-emerald-400');
          } else {
            statusEl.classList.remove('text-emerald-400');
            statusEl.classList.add('text-red-400');
          }
        } else {
          alert(result.message);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Resend verification email';
        }
      }
    }

    async function sendForgotPassword() {
      const email = document.getElementById('forgot-email').value.trim();
      const errorEl = document.getElementById('forgot-error');
      const successEl = document.getElementById('forgot-success');
      errorEl.classList.add('hidden');
      successEl.classList.add('hidden');

      if (!email) {
        errorEl.textContent = 'Please enter your email.';
        errorEl.classList.remove('hidden');
        return;
      }

      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.classList.remove('hidden');
      } else {
        successEl.textContent = data.message || 'Check your email for the reset link (including spam/junk).';
        successEl.classList.remove('hidden');
      }
    }

    async function submitPasswordReset() {
      const token = new URLSearchParams(window.location.search).get('token');
      const pw = document.getElementById('reset-password').value;
      const pw2 = document.getElementById('reset-password2').value;
      const errorEl = document.getElementById('reset-error');
      errorEl.classList.add('hidden');

      if (!pw || pw !== pw2) {
        errorEl.textContent = "Passwords don't match or are missing";
        errorEl.classList.remove('hidden');
        return;
      }
      if (pw.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters';
        errorEl.classList.remove('hidden');
        return;
      }

      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ token, password: pw })
      });
      const data = await res.json();

      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.classList.remove('hidden');
      } else {
        alert(data.message || 'Password reset successful!');
        // Clean URL and go to login
        window.history.replaceState({}, document.title, window.location.pathname);
        document.getElementById('reset-password-form').classList.add('hidden');
        switchAuthTab('login');
      }
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      currentUser = null;
      await updateAuthUI();
      showHome();
    }

    async function showAccount() {
      if (!currentUser) return showAuthModal();

      await closeStructureBuilder({ save: true });
      document.getElementById('reader-modal').classList.add('hidden');
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('navbar').classList.remove('hidden');
      hideMainViews();
      document.getElementById('view-account').classList.remove('hidden');

      document.getElementById('account-email').textContent = currentUser.email || '';
      const unEl = document.getElementById('account-username');
      if (unEl) unEl.textContent = currentUser.username ? `@${currentUser.username}` : '';
      const credEl = document.getElementById('account-credits-balance');
      if (credEl) credEl.textContent = ((currentUser.credit_balance_cents || 0) / 100).toFixed(2);

      ['current-password', 'new-password', 'confirm-new-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const err = document.getElementById('change-password-error');
      const succ = document.getElementById('change-password-success');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      if (succ) { succ.classList.add('hidden'); succ.textContent = ''; }

      // Stripe Connect
      const connectBox = document.getElementById('account-stripe-connect');
      if (connectBox) {
        if (!currentUser.stripe_account_id) {
          connectBox.classList.remove('hidden');
          const btn = document.getElementById('account-connect-stripe-btn');
          if (btn) {
            btn.onclick = async () => {
              const r = await fetch('/api/stripe/connect', { method: 'POST' });
              const d = await r.json();
              if (d.url) window.location.href = d.url;
              else alert(d.error || 'Could not start Stripe Connect');
            };
          }
        } else {
          connectBox.classList.add('hidden');
        }
      }

      // Creator earnings
      try {
        const earnRes = await fetch('/api/creator/earnings');
        if (earnRes.ok) {
          const earn = await earnRes.json();
          const s = earn.summary || {};
          document.getElementById('account-earn-pending').textContent = `$${((s.pending || 0) / 100).toFixed(2)}`;
          document.getElementById('account-earn-available').textContent = `$${((s.available || 0) / 100).toFixed(2)}`;
          document.getElementById('account-earn-paid').textContent = `$${((s.paid || 0) / 100).toFixed(2)}`;

          const payoutBtn = document.getElementById('account-payout-btn');
          if (payoutBtn) {
            if (s.can_payout) {
              payoutBtn.disabled = false;
              payoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            } else {
              payoutBtn.disabled = true;
              payoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
            }
            payoutBtn.onclick = async () => {
              if (!confirm('Request payout of available earnings to your Stripe account?')) return;
              const r = await fetch('/api/creator/payout', { method: 'POST' });
              const d = await r.json();
              if (!r.ok) return alert(d.error || 'Payout failed');
              alert(`Payout sent: $${(d.amount_cents / 100).toFixed(2)}`);
              showAccount();
            };
          }

          const recentEl = document.getElementById('account-earnings-recent');
          if (recentEl) {
            const recent = earn.recent || [];
            if (!recent.length) {
              recentEl.innerHTML = '<div class="text-slate-500">No earnings yet.</div>';
            } else {
              recentEl.innerHTML = '<div class="text-slate-500 mb-1">Recent</div>' + recent.slice(0, 10).map(row => {
                const amt = ((row.creator_cents || 0) / 100).toFixed(2);
                const when = (row.created_at || '').slice(0, 10);
                return `<div class="flex justify-between gap-2 border-t border-slate-800 pt-1.5">
                  <span>${row.source || 'sale'} · ${row.status}</span>
                  <span>$${amt} <span class="text-slate-600">${when}</span></span>
                </div>`;
              }).join('');
            }
          }
        }
      } catch (e) {}
    }

    // Back-compat name used by navbar onclick
    function showAccountModal() {
      showAccount();
    }

    async function changePassword() {
      const current = document.getElementById('current-password').value;
      const newPass = document.getElementById('new-password').value;
      const confirm = document.getElementById('confirm-new-password').value;

      const errEl = document.getElementById('change-password-error');
      const succEl = document.getElementById('change-password-success');
      errEl.classList.add('hidden');
      succEl.classList.add('hidden');

      if (!current || !newPass || !confirm) {
        errEl.textContent = 'Please fill out all fields';
        errEl.classList.remove('hidden');
        return;
      }
      if (newPass.length < 8) {
        errEl.textContent = 'New password must be at least 8 characters';
        errEl.classList.remove('hidden');
        return;
      }
      if (newPass !== confirm) {
        errEl.textContent = 'New passwords do not match';
        errEl.classList.remove('hidden');
        return;
      }

      try {
        const res = await fetch('/api/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword: current, newPassword: newPass })
        });
        const data = await res.json();

        if (!res.ok || data.error) {
          errEl.textContent = data.error || 'Failed to change password';
          errEl.classList.remove('hidden');
          return;
        }

        succEl.textContent = data.message || 'Password changed successfully!';
        succEl.classList.remove('hidden');

        ['current-password', 'new-password', 'confirm-new-password'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
      } catch (e) {
        errEl.textContent = 'Failed to connect to server';
        errEl.classList.remove('hidden');
      }
    }

    // === BROWSE COMICS ===
    async function loadGenres() {
      const sel = document.getElementById('genre-filter');
      sel.innerHTML = '<option value="All">All genres</option>';
      try {
        const res = await fetch('/api/genres');
        const genres = await res.json();
        if (Array.isArray(genres)) {
          genres.forEach(g => {
            if (g !== 'All') {
              const opt = document.createElement('option');
              opt.value = g;
              opt.textContent = g;
              sel.appendChild(opt);
            }
          });
        }
      } catch(e) {}
    }

    async function loadComics() {
      const q = document.getElementById('search-input').value;
      const genre = document.getElementById('genre-filter').value;
      const sort = document.getElementById('sort-filter').value;

      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (genre && genre !== 'All') params.append('genre', genre);
      if (sort) params.append('sort', sort);

      const res = await fetch('/api/comics?' + params.toString());
      allComics = await res.json();

      renderComicsGrid(allComics, document.getElementById('comics-grid'), true);
    }

    function renderComicsGrid(comics, container, showEmpty = true) {
      container.innerHTML = '';
      const emptyEl = document.getElementById('browse-empty');
      
      if (!comics.length) {
        if (showEmpty && emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');

      comics.forEach(comic => {
        const card = document.createElement('div');
        card.className = `comic-card bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden cursor-pointer flex flex-col`;
        
        const imgHtml = comic.cover_image 
          ? `<img src="${comic.cover_image}" class="w-full h-full object-contain bg-slate-950" alt="">` 
          : `<div class="h-full w-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-5xl opacity-40">ðŸ“–</div>`;

        card.innerHTML = `
          <div class="relative bg-slate-950" style="height:7rem;">
            ${imgHtml}
            <div class="absolute top-3 right-3 text-[10px] px-2 py-0.5 bg-black/60 rounded-full">${comic.genre}</div>
          </div>
          <div class="p-4 flex-1 flex flex-col">
            <div class="font-semibold text-lg leading-tight line-clamp-2">${comic.title}</div>
            <div class="text-xs text-slate-400 mt-1">by ${comic.author}</div>
            
            <div class="flex-1"></div>
            
            <div class="flex justify-between items-center text-xs pt-3 border-t border-slate-800 mt-2 text-slate-400">
              <div>${comic.page_count || 0} pages</div>
              <div>${comic.price || (comic.price_cents ? '$' + (comic.price_cents/100).toFixed(2) : 'Free')}</div>
            </div>
          </div>
        `;
        
        card.dataset.comicId = comic.id;
        // onclick removed in favor of delegation on #comics-grid to avoid any closure issues
        container.appendChild(card);
      });
    }

    // === MY COMICS ===
    async function showMyComics() {
      if (!currentUser) {
        showAuthModal();
        return;
      }
      
      await closeStructureBuilder({ save: true });
      // Close any full-page views (reader/editor) so navbar nav works
      document.getElementById('reader-modal').classList.add('hidden');
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('navbar').classList.remove('hidden');
      hideMainViews();
      document.getElementById('view-my-comics').classList.remove('hidden');

      // Stripe Connect prompt stays light on My Stories; full earnings live on Account
      const existingWarnings = document.getElementById('view-my-comics').querySelectorAll('.connect-stripe-warning');
      existingWarnings.forEach(el => el.remove());

      if (!currentUser.stripe_account_id) {
        const connectDiv = document.createElement('div');
        connectDiv.className = 'mb-6 p-4 bg-amber-900/30 border border-amber-600 rounded-2xl text-sm connect-stripe-warning';
        connectDiv.innerHTML = `
          To sell your stories, connect Stripe for payouts (also under Account).
          <button class="ml-2 px-3 py-1 bg-white text-slate-900 rounded-xl text-xs font-medium">Connect Stripe</button>
          <button type="button" class="ml-2 px-3 py-1 border border-slate-600 rounded-xl text-xs">Open Account</button>
        `;
        const btns = connectDiv.querySelectorAll('button');
        btns[0].onclick = async () => {
          const r = await fetch('/api/stripe/connect', { method: 'POST' });
          const d = await r.json();
          if (d.url) window.location.href = d.url;
        };
        btns[1].onclick = () => showAccount();
        document.getElementById('view-my-comics').prepend(connectDiv);
      }

      const res = await fetch('/api/comics?sort=new&my=1');
      const all = await res.json();
      const mine = all.filter(c => c.author === currentUser.username);

      const grid = document.getElementById('my-comics-grid');
      const empty = document.getElementById('my-comics-empty');
      grid.innerHTML = '';

      if (!mine.length) {
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');

      mine.forEach(comic => {
        const div = document.createElement('div');
        div.className = 'comic-card bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 cursor-pointer';
        const status = comic.status || 'draft';
        const statusText = status.charAt(0).toUpperCase() + status.slice(1);
        div.innerHTML = `
          <div class="font-semibold text-xl">${comic.title}</div>
          <div class="text-sm text-slate-400 mt-0.5">${comic.genre} • ${comic.page_count || 0} pages ${comic.price ? '• $' + comic.price : '• Free'}</div>
          <div class="mt-1 text-xs ${status === 'published' ? 'text-green-400' : status === 'approved' ? 'text-blue-400' : 'text-amber-400'}">Status: ${statusText}</div>
          <div class="mt-4 text-xs flex gap-3 text-slate-400">
            <span>${comic.view_count || 0} views</span>
          </div>
          <div class="mt-5 flex gap-2 text-sm">
            <button class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-2xl text-xs sm:text-sm" data-action="edit">Edit</button>
            <button class="flex-1 py-2 border border-slate-700 hover:bg-slate-800 rounded-2xl text-xs sm:text-sm" data-action="read">Read</button>
            ${ (status === 'draft' || status === 'changes_requested') ? `
              <button class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-2xl text-xs sm:text-sm text-white" data-action="submit">Submit for Review</button>
            ` : ''}
            ${ status === 'approved' ? `
              <button class="flex-1 py-2 bg-green-600 hover:bg-green-500 rounded-2xl text-xs sm:text-sm text-white" data-action="publish">Publish</button>
            ` : ''}
          </div>
        `;
        div.dataset.comicId = comic.id;
        grid.appendChild(div);
      });
    }

    async function showAdminReviews() {
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'editor')) {
        alert('Admin access required');
        return;
      }

      await closeStructureBuilder({ save: true });
      // Close other views
      document.getElementById('reader-modal').classList.add('hidden');
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('navbar').classList.remove('hidden');
      hideMainViews();
      document.getElementById('view-admin-reviews').classList.remove('hidden');

      const res = await fetch('/api/admin/pending-stories');
      const stories = await res.json();

      const grid = document.getElementById('admin-reviews-grid');
      const empty = document.getElementById('admin-reviews-empty');
      grid.innerHTML = '';

      if (!stories.length) {
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');

      stories.forEach(story => {
        const div = document.createElement('div');
        div.className = 'comic-card bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5';
        const isClaimedByMe = story.claimed_by && story.claimed_by === currentUser.username;
        const statusLabel = story.status === 'submitted' ? 'Submitted' : 'In Review';
        div.innerHTML = `
          <div class="font-semibold text-xl">${story.title}</div>
          <div class="text-sm text-slate-400 mt-0.5">by ${story.author} • ${story.page_count || 0} pages</div>
          <div class="mt-2 text-xs text-slate-400">Status: ${statusLabel} ${story.claimed_by ? '• Claimed by ' + story.claimed_by : ''}</div>
          <div class="mt-4 flex gap-2 text-sm">
            ${!story.claimed_by ? `
              <button class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-2xl text-xs sm:text-sm text-white" data-action="claim">Claim for Review</button>
            ` : ''}
            ${isClaimedByMe ? `
              <button class="flex-1 py-2 bg-green-600 hover:bg-green-500 rounded-2xl text-xs sm:text-sm text-white" data-action="approve">Approve</button>
              <button class="flex-1 py-2 bg-amber-600 hover:bg-amber-500 rounded-2xl text-xs sm:text-sm text-white" data-action="changes">Request Changes</button>
            ` : ''}
            <button class="flex-1 py-2 border border-slate-700 hover:bg-slate-800 rounded-2xl text-xs sm:text-sm" data-action="view">View</button>
          </div>
        `;
        div.dataset.comicId = story.id;
        div.dataset.status = story.status;
        div.dataset.claimedBy = story.claimed_by || '';
        grid.appendChild(div);
      });

      // Attach listeners
      grid.querySelectorAll('button[data-action]').forEach(btn => {
        btn.onclick = async (e) => {
          const card = btn.closest('.comic-card');
          const id = card.dataset.comicId;
          const action = btn.dataset.action;
          if (action === 'claim') {
            await fetch(`/api/admin/pending/${id}/claim`, { method: 'POST' });
            showAdminReviews();
          } else if (action === 'approve') {
            const notes = prompt('Any notes for the creator? (optional)') || '';
            await fetch('/api/admin/review', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comicId: id, decision: 'approve', notes })
            });
            alert('Approved. Creator notified.');
            showAdminReviews();
          } else if (action === 'changes') {
            const notes = prompt('Enter notes for changes needed:') || '';
            if (!notes) return;
            await fetch('/api/admin/review', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ comicId: id, decision: 'changes_requested', notes })
            });
            alert('Changes requested. Creator notified.');
            showAdminReviews();
          } else if (action === 'view') {
            openReader(id);
          }
        };
      });
    }

    function showHome() {
      showCatalog('home');
    }

    function showBrowse() {
      showCatalog('browse');
    }

    // === CREATE / EDIT ===
    let editingComicId = null;
    // Where to return when leaving the editor (not overwritten by preview reader)
    let viewBeforeEditor = 'my-comics';

    async function showCreateComic() {
      if (!currentUser) {
        showAuthModal();
        return;
      }
      if (!currentUser.email_verified) {
        alert('Please verify your email address before creating stories.\nCheck your inbox and spam/junk folder, or use Resend verification email on the Log in screen.');
        return;
      }
      editingComicId = null;

      // Save previous for restore on Done
      rememberCurrentView();
      viewBeforeEditor = previousView === 'edit' ? 'my-comics' : previousView;

      // Full-page edit/create view below navbar (navbar always visible)
      hideMainViews();
      document.getElementById('reader-modal').classList.add('hidden');

      document.getElementById('create-modal-title').textContent = 'Create New Comic';
      document.getElementById('create-form').classList.remove('hidden');
      document.getElementById('editor-section').classList.add('hidden');
      
      document.getElementById('comic-title').value = '';
      document.getElementById('comic-desc').value = '';
      document.getElementById('comic-genre').value = 'Fantasy';
      document.getElementById('comic-price').value = '0';
      
      // Clear page add fields if any
      const titleInput = document.getElementById('page-title');
      if (titleInput) titleInput.value = '';
      
      document.getElementById('create-modal').classList.remove('hidden');
    }

    async function createComic() {
      const title = document.getElementById('comic-title').value.trim();
      const description = document.getElementById('comic-desc').value.trim();
      const genre = document.getElementById('comic-genre').value;
      const price = parseFloat(document.getElementById('comic-price').value) || 0;

      if (!title) return alert('Please give your comic a title');
      if (price > 0 && price < 5.99) return alert('Full story / bundle minimum is $5.99 (or $0 free). Use chapters for smaller prices.');

      try {
        const res = await fetch('/api/comics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, genre, price })
        });
        const comic = await res.json();

        if (!res.ok || comic.error) {
          return alert(comic.error || 'Failed to create comic. Is the server running?');
        }

        // Switch to editor
        editingComicId = comic.id;
        document.getElementById('create-form').classList.add('hidden');
        document.getElementById('editor-section').classList.remove('hidden');
        document.getElementById('create-modal-title').textContent = 'Edit Comic';

        await loadEditor(comic.id);
      } catch (err) {
        console.error(err);
        alert('Failed to reach the server. Make sure you ran "npm start" and are viewing the site at http://localhost:3000 (not the file directly).');
      }
    }

    async function editComic(comicId) {
      editingComicId = Number(comicId);

      // Save previous for restore on Done
      rememberCurrentView();
      viewBeforeEditor = previousView === 'edit' ? 'my-comics' : previousView;

      // Full-page edit/create view below navbar (navbar always visible)
      hideMainViews();
      document.getElementById('reader-modal').classList.add('hidden');

      document.getElementById('create-modal-title').textContent = 'Edit Comic';
      document.getElementById('create-form').classList.add('hidden');
      document.getElementById('editor-section').classList.remove('hidden');
      document.getElementById('create-modal').classList.remove('hidden');
      
      await loadEditor(comicId);
    }

    async function saveComicPrice() {
      if (!editingComicId) return;
      const priceInput = document.getElementById('editor-comic-price');
      if (!priceInput) return;

      let val = priceInput.value.trim().replace(/^\$/, '');
      // Check standard dollar format: integer or up to 2 decimal places (e.g. 10, 10.5, 10.50)
      if (!/^\d+(\.\d{1,2})?$/.test(val)) {
        return alert('Please enter a valid dollar amount (e.g. 10 or 10.50)');
      }

      const price = parseFloat(val) || 0;
      if (price > 0 && price < 5.99) return alert('Full story / bundle minimum is $5.99 (or $0 free).');

      try {
        const res = await fetch(`/api/comics/${editingComicId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price })
        });
        const updated = await res.json();
        if (!res.ok || updated.error) {
          return alert(updated.error || 'Failed to update price');
        }
        // refresh editor display
        document.getElementById('editor-comic-title').textContent = updated.title + (updated.price ? ` ($${updated.price})` : '');
        priceInput.value = updated.price ? parseFloat(updated.price).toFixed(2) : '0.00';
        // reload for full consistency
        await loadEditor(editingComicId);
      } catch (err) {
        console.error(err);
        alert('Failed to update price');
      }
    }

    function updateEditorCoverPreview(coverUrl) {
      const img = document.getElementById('editor-cover-img');
      const ph = document.getElementById('editor-cover-placeholder');
      if (!img || !ph) return;
      if (coverUrl) {
        img.src = coverUrl;
        img.classList.remove('hidden');
        img.style.objectFit = 'contain';
        ph.classList.add('hidden');
      } else {
        img.removeAttribute('src');
        img.classList.add('hidden');
        ph.classList.remove('hidden');
      }
    }

    function wireEditorCoverUpload(comicId) {
      const fileInput = document.getElementById('editor-cover-input');
      const coverBtn = document.getElementById('editor-cover-btn');
      const status = document.getElementById('editor-cover-status');
      if (!fileInput || !coverBtn) return;

      coverBtn.onclick = () => fileInput.click();

      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        fileInput.value = '';
        if (!file || !comicId) return;

        // Local preview at fixed thumbnail size
        const localUrl = URL.createObjectURL(file);
        updateEditorCoverPreview(localUrl);
        if (status) status.textContent = 'Uploading…';
        coverBtn.disabled = true;
        coverBtn.textContent = 'Uploading…';

        try {
          const form = new FormData();
          form.append('cover', file);
          const res = await fetch(`/api/comics/${comicId}/cover`, {
            method: 'POST',
            body: form
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            if (status) status.textContent = data.error || 'Upload failed';
            coverBtn.disabled = false;
            coverBtn.textContent = 'Add Cover';
            return;
          }
          updateEditorCoverPreview(data.cover_image);
          if (status) status.textContent = 'Cover saved — full image shown on Browse (3:2 works best).';
          coverBtn.textContent = 'Change Cover';
          coverBtn.disabled = false;
        } catch (e) {
          console.error(e);
          if (status) status.textContent = 'Upload failed';
          coverBtn.disabled = false;
          coverBtn.textContent = 'Add Cover';
        }
      };
    }

    async function loadEditor(comicId) {
      const res = await fetch(`/api/comics/${comicId}`);
      const comic = await res.json();
      
      document.getElementById('editor-comic-title').textContent = comic.title + (comic.price ? ` ($${comic.price})` : '');
      document.getElementById('editor-comic-genre').textContent = comic.genre;
      updateEditorCoverPreview(comic.cover_image || null);
      wireEditorCoverUpload(comicId);
      const status = document.getElementById('editor-cover-status');
      const coverBtn = document.getElementById('editor-cover-btn');
      if (comic.cover_image) {
        if (status) status.textContent = 'Cover saved — full image shown on Browse (3:2 works best).';
        if (coverBtn) coverBtn.textContent = 'Change Cover';
      } else {
        if (status) status.textContent = 'Click Add Cover. Recommended: 3:2 landscape (e.g. 1200×800).';
        if (coverBtn) coverBtn.textContent = 'Add Cover';
      }

      const priceInput = document.getElementById('editor-comic-price');
      if (priceInput) {
        priceInput.value = comic.price ? parseFloat(comic.price).toFixed(2) : '0.00';
        // Format on blur for standard dollar format (e.g. accept "10" as "10.00")
        priceInput.onblur = () => {
          let val = priceInput.value.trim().replace(/^\$/, '');
          if (/^\d+(\.\d{1,2})?$/.test(val)) {
            priceInput.value = parseFloat(val).toFixed(2);
          } else if (val === '') {
            priceInput.value = '0.00';
          }
        };
        // Pressing Enter in the price field saves (acts like clicking Save)
        priceInput.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveComicPrice();
          }
        };
      }

      const pagesRes = await fetch(`/api/comics/${comicId}/pages`);
      const { pages } = await pagesRes.json();
      currentPages = pages || [];

      renderPagesList(pages);
      await loadEditorChapters(comicId);
    }

    async function loadEditorChapters(comicId) {
      const list = document.getElementById('editor-chapters-list');
      if (!list) return;
      try {
        const res = await fetch(`/api/comics/${comicId}/chapters`);
        const chapters = await res.json();
        if (!chapters.length) {
          list.innerHTML = '<div class="text-slate-500">No chapters yet. Add chapters to sell for credits (e.g. $0.99).</div>';
          return;
        }
        list.innerHTML = chapters.map(ch => `
          <div class="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5" data-chapter-id="${ch.id}">
            <span class="flex-1 min-w-[8rem] font-medium">${ch.title}</span>
            <span class="text-slate-400">$${(ch.price_cents / 100).toFixed(2)}</span>
            <button type="button" class="px-2 py-0.5 border border-slate-700 rounded-lg hover:bg-slate-800" data-ch-edit="${ch.id}">Edit</button>
            <button type="button" class="px-2 py-0.5 border border-red-900/50 text-red-300 rounded-lg hover:bg-red-950/40" data-ch-del="${ch.id}">Delete</button>
          </div>
        `).join('');
        list.querySelectorAll('[data-ch-edit]').forEach(btn => {
          btn.onclick = async () => {
            const id = btn.getAttribute('data-ch-edit');
            const ch = chapters.find(c => String(c.id) === String(id));
            if (!ch) return;
            const title = prompt('Chapter title', ch.title);
            if (title === null) return;
            const priceStr = prompt('Price in USD (e.g. 0.99 or 0 for free)', (ch.price_cents / 100).toFixed(2));
            if (priceStr === null) return;
            const r = await fetch(`/api/chapters/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: title.trim(), price: parseFloat(priceStr) || 0 }),
            });
            const d = await r.json();
            if (!r.ok) return alert(d.error || 'Failed to update chapter');
            await loadEditorChapters(comicId);
          };
        });
        list.querySelectorAll('[data-ch-del]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm('Delete this chapter?')) return;
            const id = btn.getAttribute('data-ch-del');
            const r = await fetch(`/api/chapters/${id}`, { method: 'DELETE' });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) return alert(d.error || 'Failed to delete');
            await loadEditorChapters(comicId);
          };
        });
      } catch (e) {
        list.innerHTML = '<div class="text-red-400">Could not load chapters</div>';
      }
    }

    async function addEditorChapter() {
      if (!editingComicId) return;
      const title = prompt('Chapter title');
      if (!title || !title.trim()) return;
      const priceStr = prompt('Price in USD (e.g. 0.99)', '0.99');
      if (priceStr === null) return;
      const price = parseFloat(priceStr) || 0;
      const r = await fetch(`/api/comics/${editingComicId}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), price }),
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || 'Failed to add chapter');
      await loadEditorChapters(editingComicId);
    }

    function renderPagesList(pages) {
      const container = document.getElementById('pages-list');
      container.innerHTML = '';

      if (!pages || !pages.length) {
        container.innerHTML = `<div class="text-sm text-slate-400 border border-slate-800 rounded-2xl p-4">No pages yet. Click "+ Add Page" above to upload the first page of your story.</div>`;
        return;
      }

      pages.forEach((page, index) => {
        const div = document.createElement('div');
        div.className = `bg-slate-950 border ${page.is_start ? 'border-emerald-700' : 'border-slate-800'} rounded-2xl p-2 sm:p-3 text-sm flex gap-2 sm:gap-3 items-start`;
        
        const thumb = page.image_path 
          ? `<img src="${page.image_path}" style="width:48px;height:48px;min-width:48px;" class="object-cover rounded-xl flex-shrink-0">`
          : `<div style="width:48px;height:48px;min-width:48px;" class="bg-slate-900 rounded-xl flex items-center justify-center text-lg flex-shrink-0">ðŸ“„</div>`;

        const choiceCount = page.choices ? page.choices.length : 0;

        div.innerHTML = `
          <div>${thumb}</div>
          <div class="flex-1 min-w-0 overflow-hidden">
            <div class="flex items-center gap-2">
              <span class="font-medium">${page.title || 'Untitled Page'}</span>
              ${page.is_start ? '<span class="text-[10px] px-1.5 py-px bg-emerald-900 text-emerald-400 rounded">START</span>' : ''}
            </div>
            <div class="text-xs text-slate-400 line-clamp-2 mt-0.5">${page.text_content || '(no text)'}</div>
            <div class="text-[10px] mt-1 text-blue-400">${choiceCount} choice${choiceCount === 1 ? '' : 's'}</div>
            ${page.choices && page.choices.length > 0 ? `
              <div class="flex gap-1 mt-2">
                ${page.choices.slice(0,3).map(ch => 
                  ch.image ? `<img src="${ch.image}" class="w-8 h-8 object-cover rounded border border-slate-700">` : ''
                ).join('')}
              </div>` : ''}
          </div>
          <div class="flex flex-col gap-1 text-[10px] flex-shrink-0" style="min-width: 58px;">
            <button class="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-xs" onclick="addChoiceToPage(${page.id}, event)">+ Choice</button>
            <button class="px-2 py-0.5 bg-blue-800 hover:bg-blue-700 rounded text-xs" onclick="editPage(${page.id}, event)">Edit</button>
            <button class="px-2 py-0.5 text-red-400 hover:bg-slate-800 rounded text-xs" onclick="deletePage(${page.id}, event)">Delete</button>
          </div>
        `;
        container.appendChild(div);
      });
    }

    async function addNewPage() {
      if (!editingComicId) return;

      // Create popup widget with MULTI file support for mass uploads
      const widget = document.createElement('div');
      widget.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]';
      widget.innerHTML = `
        <div class="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-lg w-full mx-4" onclick="event.stopImmediatePropagation()">
          <h3 class="text-xl font-semibold mb-2">Add Pages</h3>
          <div class="text-xs text-slate-400 mb-4">Supports single or multiple images. Max 25MB per image, ~25 images per batch. If upload fails, try fewer/smaller files.</div>
          
          <!-- Drag & Drop Zone (multi) -->
          <div id="drop-zone" class="border-2 border-dashed border-blue-500 rounded-2xl p-8 text-center mb-3 cursor-pointer hover:bg-slate-800 transition">
            <div class="text-4xl mb-2">📁</div>
            <div class="font-medium">Drag & drop images here</div>
            <div class="text-sm text-slate-400">or click to browse (multiple files OK)</div>
            <input type="file" id="page-file-input" accept="image/*" multiple class="hidden">
          </div>

          <!-- Selected files preview list (for multi) -->
          <div id="selected-list" class="hidden mb-3 max-h-36 overflow-auto border border-slate-800 rounded-xl p-2 text-xs space-y-1 bg-slate-950"></div>

          <!-- Title controls -->
          <div class="mb-3">
            <label class="text-xs text-slate-400">Title prefix (optional)</label>
            <input id="page-title-prefix" type="text" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2 text-sm mt-1" placeholder="e.g. Chapter 1 - ">
            <div class="flex items-center gap-2 mt-1.5">
              <input type="checkbox" id="use-filenames" class="accent-blue-600" checked>
              <label for="use-filenames" class="text-xs text-slate-400">Use filenames as titles (great for bulk)</label>
            </div>
          </div>

          <!-- Single-file extras (hidden when multi) -->
          <div id="single-extras">
            <div class="mb-3">
              <label class="text-xs text-slate-400">Page text / caption (optional)</label>
              <textarea id="page-text" rows="2" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2 text-sm mt-1" placeholder="Describe this page..."></textarea>
            </div>
            <div class="flex items-center gap-2 mb-4">
              <input type="checkbox" id="make-start" class="accent-blue-600">
              <label for="make-start" class="text-sm">Make this the starting page</label>
            </div>
          </div>

          <div class="flex gap-3">
            <button id="cancel-page" class="flex-1 py-2 border border-slate-700 rounded-2xl text-sm">Cancel</button>
            <button id="upload-page" class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-2xl text-sm font-medium">Add Page(s)</button>
          </div>
          <div class="text-[10px] text-center text-slate-500 mt-2">Tip: For large stories, upload in batches of ~10-20 images.</div>
        </div>
      `;

      document.body.appendChild(widget);
      widget.style.zIndex = '99999';

      const dropZone = widget.querySelector('#drop-zone');
      const fileInput = widget.querySelector('#page-file-input');
      const selectedList = widget.querySelector('#selected-list');
      const prefixInput = widget.querySelector('#page-title-prefix');
      const useFilenamesCb = widget.querySelector('#use-filenames');
      const singleExtras = widget.querySelector('#single-extras');
      const textArea = widget.querySelector('#page-text');
      const makeStart = widget.querySelector('#make-start');
      const cancelBtn = widget.querySelector('#cancel-page');
      const uploadBtn = widget.querySelector('#upload-page');

      let selectedFiles = [];

      function updateSelectedUI() {
        if (selectedFiles.length === 0) {
          selectedList.classList.add('hidden');
          selectedList.innerHTML = '';
          singleExtras.style.display = '';
          dropZone.innerHTML = `
            <div class="text-4xl mb-2">📁</div>
            <div class="font-medium">Drag & drop images here</div>
            <div class="text-sm text-slate-400">or click to browse (multiple files OK)</div>
          `;
          return;
        }

        // Multi mode UI
        singleExtras.style.display = selectedFiles.length > 1 ? 'none' : '';
        if (useFilenamesCb && useFilenamesCb.parentElement) {
          useFilenamesCb.parentElement.style.display = selectedFiles.length > 1 ? 'none' : '';
        }
        selectedList.classList.remove('hidden');
        selectedList.innerHTML = '';

        const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center px-1 pb-1 text-[10px] text-slate-400 border-b border-slate-800 mb-1';
        header.innerHTML = `<span>${selectedFiles.length} image(s) selected • ${(totalSize / 1024 / 1024).toFixed(1)} MB total</span>`;
        const clearAll = document.createElement('button');
        clearAll.textContent = 'Clear all';
        clearAll.className = 'text-blue-400 hover:underline';
        clearAll.onclick = () => { selectedFiles = []; updateSelectedUI(); };
        header.appendChild(clearAll);
        selectedList.appendChild(header);

        selectedFiles.forEach((file, idx) => {
          const row = document.createElement('div');
          row.className = 'flex items-center gap-2 px-1 py-0.5 hover:bg-slate-900 rounded';
          const sizeMB = (file.size / 1024 / 1024).toFixed(1);
          const name = file.name.length > 28 ? file.name.slice(0,25) + '…' : file.name;

          // Small thumbnail preview
          const thumb = document.createElement('img');
          thumb.className = 'w-8 h-8 object-cover rounded border border-slate-700 flex-shrink-0';
          const url = URL.createObjectURL(file);
          thumb.src = url;
          // cleanup later not critical in widget lifetime

          const left = document.createElement('div');
          left.className = 'flex-1 flex items-center gap-2 min-w-0';
          left.appendChild(thumb);
          const nm = document.createElement('span');
          nm.className = 'truncate';
          nm.textContent = name;
          left.appendChild(nm);
          const sz = document.createElement('span');
          sz.className = 'text-[10px] text-slate-500 flex-shrink-0';
          sz.textContent = sizeMB + 'MB';
          left.appendChild(sz);
          row.appendChild(left);

          const rm = document.createElement('button');
          rm.className = 'text-red-400 hover:text-red-300 text-xs px-1';
          rm.textContent = '✕';
          rm.onclick = () => {
            selectedFiles.splice(idx, 1);
            URL.revokeObjectURL(url);
            updateSelectedUI();
          };
          row.appendChild(rm);
          selectedList.appendChild(row);
        });
      }

      function addFiles(newFiles) {
        const valid = [];
        const maxBytes = 25 * 1024 * 1024;
        for (const f of newFiles) {
          // Some browsers leave type empty for certain files — still allow by extension
          const looksImage = (f.type && f.type.startsWith('image/')) ||
            /\.(jpe?g|png|gif|webp)$/i.test(f.name || '');
          if (!looksImage) {
            alert(`Skipped non-image: ${f.name}`);
            continue;
          }
          if (f.size > maxBytes) {
            alert(`Skipped (over 25MB): ${f.name}`);
            continue;
          }
          valid.push(f);
        }
        if (selectedFiles.length + valid.length > 25) {
          alert('Max 25 images per batch. Some files were skipped.');
          valid.splice(25 - selectedFiles.length);
        }
        selectedFiles = selectedFiles.concat(valid);
        // If first selection, auto suggest prefix from common parts or leave
        if (selectedFiles.length === 1 && !prefixInput.value) {
          const base = selectedFiles[0].name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' ');
          prefixInput.value = base;
        }
        updateSelectedUI();
      }

      // Click to browse (multi)
      dropZone.onclick = () => fileInput.click();

      fileInput.onchange = (e) => {
        if (e.target.files && e.target.files.length) {
          addFiles(Array.from(e.target.files));
          fileInput.value = ''; // reset so same files can be re-selected if needed
        }
      };

      // Drag and drop multi
      dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('bg-slate-800', 'border-blue-400');
      };
      dropZone.ondragleave = () => {
        dropZone.classList.remove('bg-slate-800', 'border-blue-400');
      };
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('bg-slate-800', 'border-blue-400');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          addFiles(Array.from(e.dataTransfer.files));
        }
      };

      cancelBtn.onclick = () => {
        selectedFiles.forEach(f => { /* urls auto GC */ });
        widget.remove();
      };

      uploadBtn.onclick = async () => {
        if (selectedFiles.length === 0) {
          alert('Please select or drop at least one image');
          return;
        }
        if (!editingComicId) {
          alert('No story selected. Close this and open the editor again.');
          return;
        }

        const prefix = (prefixInput.value || '').trim();
        const useFilenames = useFilenamesCb.checked;

        uploadBtn.textContent = `Uploading ${selectedFiles.length}...`;
        uploadBtn.disabled = true;

        async function parseJsonSafe(res) {
          const text = await res.text();
          if (!text) return {};
          try { return JSON.parse(text); } catch (_) {
            return { error: text.slice(0, 200) || `HTTP ${res.status}` };
          }
        }

        try {
          // Single file: rich endpoint (title, caption, start page)
          if (selectedFiles.length === 1) {
            const title = widget.querySelector('#page-title-prefix').value.trim() ||
                          (useFilenames ? selectedFiles[0].name.replace(/\.[^/.]+$/, '') : `Page ${Date.now()}`);
            const singleForm = new FormData();
            singleForm.append('image', selectedFiles[0]);
            singleForm.append('title', title || selectedFiles[0].name.replace(/\.[^/.]+$/, ''));
            singleForm.append('text_content', (textArea && textArea.value || '').trim());
            singleForm.append('is_start', (makeStart && makeStart.checked) ? '1' : '0');

            const res = await fetch(`/api/comics/${editingComicId}/pages`, {
              method: 'POST',
              body: singleForm,
              credentials: 'same-origin'
            });
            const page = await parseJsonSafe(res);
            if (!res.ok || page.error) {
              alert(page.error || `Upload failed (HTTP ${res.status}).`);
              uploadBtn.textContent = 'Add Page(s)';
              uploadBtn.disabled = false;
              return;
            }
            widget.remove();
            try {
              await loadEditor(editingComicId);
            } catch (reloadErr) {
              console.error(reloadErr);
              alert('Image uploaded, but the editor failed to refresh. Close and reopen the story.');
            }
            return;
          }

          // Bulk path
          const form = new FormData();
          selectedFiles.forEach(f => form.append('images', f));
          if (prefix) form.append('title_prefix', prefix);

          const res = await fetch(`/api/comics/${editingComicId}/pages/bulk`, {
            method: 'POST',
            body: form,
            credentials: 'same-origin'
          });
          const data = await parseJsonSafe(res);

          if (!res.ok || data.error) {
            alert(data.error || `Upload failed (HTTP ${res.status}).`);
            uploadBtn.textContent = 'Add Page(s)';
            uploadBtn.disabled = false;
            return;
          }
          widget.remove();
          try {
            await loadEditor(editingComicId);
          } catch (reloadErr) {
            console.error(reloadErr);
            alert('Images uploaded, but the editor failed to refresh. Close and reopen the story.');
          }
        } catch (e) {
          console.error('Upload error:', e);
          alert('Upload failed: ' + (e && e.message ? e.message : 'network or browser error') +
            '. Check that you are logged in and try again.');
          uploadBtn.textContent = 'Add Page(s)';
          uploadBtn.disabled = false;
        }
      };

      // Initial state
      updateSelectedUI();
    }

    async function addChoiceToPage(pageId, ev) {
      ev.stopImmediatePropagation();

      // Get current pages for target selection
      const pagesRes = await fetch(`/api/comics/${editingComicId}/pages`);
      const { pages } = await pagesRes.json();

      const otherPages = pages.filter(p => p.id !== pageId);
      if (!otherPages.length) {
        const createNew = confirm('No other pages yet. Create a new page as the destination for this choice?');
        if (createNew) {
          await addNewPage(); // user can add page first
        }
        return;
      }

      // Create widget for image-based choice (no text box)
      const widget = document.createElement('div');
      widget.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]';
      let optionsHtml = otherPages.map(p => 
        `<option value="${p.id}">${p.text_content ? p.text_content.substring(0,50) : 'Page ' + p.id}</option>`
      ).join('');

      widget.innerHTML = `
        <div class="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full mx-4" onclick="event.stopImmediatePropagation()">
          <h3 class="text-xl font-semibold mb-4">Add Image Choice</h3>
          
          <div class="mb-4">
            <label class="text-xs text-slate-400 block mb-1">Destination Page</label>
            <select id="choice-target" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2 text-sm">
              ${optionsHtml}
            </select>
          </div>

          <!-- Drag & Drop for Choice Image -->
          <div id="choice-drop-zone" class="border-2 border-dashed border-amber-500 rounded-2xl p-8 text-center mb-4 cursor-pointer hover:bg-slate-800 transition">
            <div class="text-3xl mb-2">🖼️</div>
            <div class="font-medium">Drag & drop choice image here</div>
            <div class="text-sm text-slate-400">or click to browse</div>
            <input type="file" id="choice-file-input" accept="image/*" class="hidden">
          </div>

          <div class="flex gap-3">
            <button id="cancel-choice" class="flex-1 py-2 border border-slate-700 rounded-2xl text-sm">Cancel</button>
            <button id="add-choice-btn" class="flex-1 py-2 bg-amber-600 hover:bg-amber-500 rounded-2xl text-sm font-medium">Add Choice</button>
          </div>
          <div class="text-[10px] text-center text-slate-400 mt-2">Choices are now visual images (text optional in future).</div>
        </div>
      `;

      document.body.appendChild(widget);
      widget.style.zIndex = '99999';  // Ensure always on top of editor modals

      const dropZone = widget.querySelector('#choice-drop-zone');
      const fileInput = widget.querySelector('#choice-file-input');
      const targetSelect = widget.querySelector('#choice-target');
      const cancelBtn = widget.querySelector('#cancel-choice');
      const addBtn = widget.querySelector('#add-choice-btn');

      let selectedFile = null;

      // Click browse
      dropZone.onclick = () => fileInput.click();

      fileInput.onchange = (e) => {
        if (e.target.files[0]) {
          selectedFile = e.target.files[0];
          dropZone.innerHTML = `<div class="text-emerald-400">✓ ${selectedFile.name}</div><div class="text-xs text-slate-400 mt-1">Click to change</div>`;
        }
      };

      // Drag & drop
      dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('bg-slate-800', 'border-amber-400'); };
      dropZone.ondragleave = () => dropZone.classList.remove('bg-slate-800', 'border-amber-400');
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('bg-slate-800', 'border-amber-400');
        if (e.dataTransfer.files[0]) {
          selectedFile = e.dataTransfer.files[0];
          if (!selectedFile.type.startsWith('image/')) {
            alert('Drop an image file for the choice');
            return;
          }
          dropZone.innerHTML = `<div class="text-emerald-400">✓ ${selectedFile.name}</div><div class="text-xs text-slate-400 mt-1">Click to change</div>`;
        }
      };

      cancelBtn.onclick = () => widget.remove();

      addBtn.onclick = async () => {
        if (!selectedFile) {
          alert('Please select or drop an image for this choice');
          return;
        }
        const targetId = parseInt(targetSelect.value);
        if (!targetId) return alert('Select a destination page');

        const form = new FormData();
        form.append('image', selectedFile);
        form.append('to_page_id', targetId);
        // choice_text left empty since we're using images

        addBtn.textContent = 'Adding...';
        addBtn.disabled = true;

        try {
          const res = await fetch(`/api/pages/${pageId}/choices`, {
            method: 'POST',
            body: form
          });
          const result = await res.json();
          
          widget.remove();
          
          if (result.error) {
            alert(result.error);
          } else {
            await loadEditor(editingComicId);
          }
        } catch (e) {
          alert('Failed to add choice');
          widget.remove();
        }
      };
    }

    async function addChoice(fromPageId, choiceText, toPageId) {
      const res = await fetch(`/api/pages/${fromPageId}/choices`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ choice_text: choiceText, to_page_id: toPageId })
      });
      const result = await res.json();
      if (result.error) alert(result.error);
      else await loadEditor(editingComicId);
    }

    async function deletePage(pageId, ev) {
      ev.stopImmediatePropagation();
      if (!confirm('Delete this page and all its choices?')) return;
      
      await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
      await loadEditor(editingComicId);
    }

    async function editPage(pageId, ev) {
      ev.stopImmediatePropagation();

      // Find the page data (from current list)
      let page = currentPages.find(p => p.id === pageId);
      if (!page) {
        // fallback fetch
        const res = await fetch(`/api/comics/${editingComicId}/pages`);
        const data = await res.json();
        page = data.pages.find(p => p.id === pageId);
      }
      if (!page) return alert('Page not found');

      // Create edit widget similar to add
      const widget = document.createElement('div');
      widget.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]';
      widget.innerHTML = `
        <div class="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full mx-4" onclick="event.stopImmediatePropagation()">
          <h3 class="text-xl font-semibold mb-4">Edit Page</h3>

          <div class="mb-3">
            <label class="text-xs text-slate-400">Page Title / Name</label>
            <input id="edit-page-title" type="text" value="${(page.title || '').replace(/"/g, '&quot;')}" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2 text-sm mt-1">
          </div>

          <div class="mb-4">
            <label class="text-xs text-slate-400">Current Image</label>
            <div class="mb-2">
              ${page.image_path ? `<img src="${page.image_path}" class="max-h-24 rounded-xl border border-slate-600">` : '<span class="text-slate-400 text-xs">No image</span>'}
            </div>
            <label class="text-xs text-slate-400">Replace image (optional - drag & drop or click)</label>
            <div id="edit-drop-zone" class="border-2 border-dashed border-blue-500 rounded-2xl p-6 text-center mb-2 cursor-pointer hover:bg-slate-800 text-sm">
              <div>Drop new image here or click</div>
              <input type="file" id="edit-page-file" accept="image/*" class="hidden">
            </div>
          </div>

          <div class="mb-4">
            <label class="text-xs text-slate-400">Page text / caption</label>
            <textarea id="edit-page-text" rows="4" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2 text-sm mt-1">${(page.text_content || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
          </div>

          <div class="flex gap-3">
            <button id="cancel-edit" class="flex-1 py-2 border border-slate-700 rounded-2xl text-sm">Cancel</button>
            <button id="save-edit" class="flex-1 py-2 bg-blue-600 hover:bg-blue-500 rounded-2xl text-sm font-medium">Save Changes</button>
          </div>
        </div>
      `;

      document.body.appendChild(widget);
      widget.style.zIndex = '99999';

      const dropZone = widget.querySelector('#edit-drop-zone');
      const fileInput = widget.querySelector('#edit-page-file');
      const titleInput = widget.querySelector('#edit-page-title');
      const textInput = widget.querySelector('#edit-page-text');
      const cancelBtn = widget.querySelector('#cancel-edit');
      const saveBtn = widget.querySelector('#save-edit');

      let newFile = null;

      dropZone.onclick = () => fileInput.click();
      fileInput.onchange = (e) => {
        if (e.target.files[0]) {
          newFile = e.target.files[0];
          dropZone.innerHTML = `<div class="text-emerald-400">✓ New image selected: ${newFile.name}</div>`;
        }
      };

      // Basic drag drop for edit too
      dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('bg-slate-800'); };
      dropZone.ondragleave = () => dropZone.classList.remove('bg-slate-800');
      dropZone.ondrop = (e) => {
        e.preventDefault(); dropZone.classList.remove('bg-slate-800');
        if (e.dataTransfer.files[0]) {
          newFile = e.dataTransfer.files[0];
          dropZone.innerHTML = `<div class="text-emerald-400">✓ New image selected: ${newFile.name}</div>`;
        }
      };

      cancelBtn.onclick = () => widget.remove();

      saveBtn.onclick = async () => {
        const form = new FormData();
        form.append('title', titleInput.value.trim());
        form.append('text_content', textInput.value.trim());
        if (newFile) {
          form.append('image', newFile);
        }

        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;

        try {
          const res = await fetch(`/api/pages/${pageId}`, {
            method: 'POST',
            body: form
          });
          const updated = await res.json();

          widget.remove();

          if (updated.error) {
            alert(updated.error);
          } else {
            await loadEditor(editingComicId);
          }
        } catch (e) {
          alert('Failed to save changes');
          widget.remove();
        }
      };
    }

    async function closeCreateModal() {
      await closeStructureBuilder({ save: true });
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('reader-modal').classList.add('hidden');

      // Return to where the editor was opened from (not "edit", which would re-open itself)
      previousView = viewBeforeEditor && viewBeforeEditor !== 'edit'
        ? viewBeforeEditor
        : 'my-comics';
      restorePreviousView();
    }

    function openStoryBuilder() {
      if (!editingComicId || !currentPages || currentPages.length === 0) {
        return alert('Add some pages first using + Add Page.');
      }

      // Full page (not a small modal) — hide story editor while building structure
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('navbar').classList.remove('hidden');

      const existing = document.getElementById('structure-builder-page');
      if (existing) existing.remove();

      const widget = document.createElement('div');
      widget.id = 'structure-builder-page';
      widget.className = 'fixed top-14 sm:top-16 left-0 right-0 bottom-0 z-40 bg-slate-950 flex flex-col';
      widget.innerHTML = `
        <div class="max-w-6xl mx-auto w-full h-full px-4 sm:px-6 py-4 sm:py-6 flex flex-col min-h-0">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 flex-shrink-0">
            <div>
              <h2 class="text-2xl sm:text-3xl font-semibold tracking-tighter">Story Structure</h2>
              <p class="text-slate-400 text-sm">Link choices between pages. Changes save when you switch pages.</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span id="structure-save-status" class="text-xs text-slate-500">Ready</span>
              <button id="save-structure" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-sm font-medium">Save</button>
              <button id="close-builder" class="px-4 py-2 border border-slate-700 hover:bg-slate-900 rounded-2xl text-sm">Back to editor</button>
            </div>
          </div>

          <div class="mb-4 flex-shrink-0">
            <label class="block text-sm font-medium mb-1">Initial / Starting Page</label>
            <div class="flex flex-col sm:flex-row gap-2">
              <select id="initial-page" class="bg-slate-900 border border-slate-700 rounded-2xl px-3 py-2 flex-1 text-sm">
                ${currentPages.map((p, i) => `<option value="${p.id}" ${p.is_start ? 'selected' : ''}>${p.title || 'Untitled'} (Page ${i+1})</option>`).join('')}
              </select>
              <button id="set-initial" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-2xl text-sm">Set as Start</button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 flex-1 min-h-0">
            <div class="flex flex-col min-h-0 bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-4">
              <div class="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 flex-shrink-0">
                <label class="text-sm font-medium whitespace-nowrap">Edit choices for:</label>
                <select id="focus-page" class="bg-slate-950 border border-slate-700 rounded-xl px-2 py-1.5 text-sm flex-1"></select>
              </div>

              <div id="focus-page-preview" class="mb-3 p-2 bg-slate-800 rounded-xl flex gap-2 items-center text-xs flex-shrink-0"></div>

              <div class="text-sm font-medium mb-2 flex-shrink-0">Choice slots (up to 3)</div>
              <div id="choice-slots" class="space-y-3 overflow-auto flex-1 min-h-0 pr-1"></div>
            </div>

            <div class="flex flex-col min-h-0 bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-4">
              <div class="text-sm font-medium mb-2 flex-shrink-0">All pages (drag into a slot)</div>
              <div id="pages-palette" class="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 bg-slate-950 border border-slate-700 rounded-2xl overflow-auto flex-1 min-h-0"></div>
            </div>
          </div>

          <div class="text-[10px] text-slate-500 mt-3 flex-shrink-0">Drag pages into the 3 choice slots. Switching the focused page auto-saves that page’s choices.</div>
        </div>
      `;

      document.body.appendChild(widget);

      const initialSelect = widget.querySelector('#initial-page');
      const setInitialBtn = widget.querySelector('#set-initial');
      const focusSelect = widget.querySelector('#focus-page');
      const focusPreview = widget.querySelector('#focus-page-preview');
      const slotsContainer = widget.querySelector('#choice-slots');
      const palette = widget.querySelector('#pages-palette');
      const saveBtn = widget.querySelector('#save-structure');
      const closeBtn = widget.querySelector('#close-builder');
      const statusEl = widget.querySelector('#structure-save-status');

      let focusedPageId = Number(currentPages.find(p => p.is_start)?.id || currentPages[0].id);
      let slots = [null, null, null];
      // Live references to label inputs (index 0..2) — more reliable than querySelector after re-renders
      let labelInputs = [null, null, null];
      let saving = false;
      let saveQueued = false;
      let labelSaveTimer = null;
      // pageId -> [label0, label1, label2]
      const labelDrafts = {};

      function setStatus(msg, kind) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = 'text-xs ' + (
          kind === 'ok' ? 'text-emerald-400' :
          kind === 'err' ? 'text-red-400' :
          kind === 'busy' ? 'text-amber-400' : 'text-slate-500'
        );
      }

      function draftsFor(pageId) {
        const id = String(pageId);
        if (!labelDrafts[id]) labelDrafts[id] = ['', '', ''];
        return labelDrafts[id];
      }

      function readLabel(i) {
        if (labelInputs[i]) return labelInputs[i].value;
        const d = draftsFor(focusedPageId)[i];
        if (d != null && d !== '') return d;
        if (slots[i] && slots[i].text) return slots[i].text;
        return '';
      }

      function writeLabel(i, value) {
        const v = value == null ? '' : String(value);
        draftsFor(focusedPageId)[i] = v;
        if (slots[i]) slots[i].text = v;
        if (labelInputs[i] && labelInputs[i].value !== v) {
          labelInputs[i].value = v;
        }
      }

      function captureAllLabels() {
        for (let i = 0; i < 3; i++) {
          if (labelInputs[i]) {
            writeLabel(i, labelInputs[i].value);
          }
        }
      }

      function getChosenPayload() {
        captureAllLabels();
        const payload = [];
        const labelsOnly = [];
        for (let i = 0; i < 3; i++) {
          const s = slots[i];
          // Prefer live input value; do not trim until send so spaces while typing aren't fought
          const raw = labelInputs[i]
            ? labelInputs[i].value
            : (draftsFor(focusedPageId)[i] || (s && s.text) || '');
          // Trim only ends for storage; keep internal spaces
          const text = String(raw).replace(/^\s+|\s+$/g, '');
          labelsOnly[i] = text;
          if (s) s.text = text;
          draftsFor(focusedPageId)[i] = text;

          if (!s || !s.to_page_id) continue;
          payload.push({
            to_page_id: Number(s.to_page_id),
            choice_image: s.choice_image || null,
            text,
            choice_text: text,
            label: text
          });
        }
        return { choices: payload, labels: labelsOnly };
      }

      async function refreshPagesFromServer() {
        const pagesRes = await fetch(`/api/comics/${editingComicId}/pages`);
        const data = await pagesRes.json();
        currentPages = data.pages || [];
        currentPages.forEach((p) => {
          if (!p.choices || !p.choices.length) return;
          const d = draftsFor(p.id);
          p.choices.slice(0, 3).forEach((ch, i) => {
            const t = (ch.text || ch.choice_text || '').trim();
            if (t) d[i] = t; // server is source of truth after a successful save
          });
        });
      }

      async function saveCurrentStructure(silent = true) {
        if (!focusedPageId) return false;

        if (saving) {
          saveQueued = true;
          return true;
        }

        saving = true;
        setStatus('Saving…', 'busy');
        let ok = true;
        try {
          do {
            saveQueued = false;
            const pageIdToSave = focusedPageId;
            const { choices: chosen, labels: labelsOnly } = getChosenPayload();
            console.log('[structure] saving page', pageIdToSave);
            console.log('[structure] texts being sent:', chosen.map(c => c.text));
            console.log('[structure] labels array:', labelsOnly);
            console.log('[structure] input values:', labelInputs.map(el => (el ? el.value : null)));

            const r = await fetch(`/api/pages/${pageIdToSave}/set-choices`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({ choices: chosen, labels: labelsOnly })
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
              setStatus(body.error || `Save failed (${r.status})`, 'err');
              if (!silent) alert(body.error || `Failed to save (${r.status})`);
              ok = false;
              break;
            }

            // Second pass: update labels by slot order (handles any field-name mismatch)
            const labelPayload = [];
            for (let i = 0; i < 3; i++) {
              if (slots[i] && slots[i].to_page_id) {
                labelPayload.push(labelsOnly[i] || readLabel(i).trim());
              }
            }
            try {
              const r2 = await fetch(`/api/pages/${pageIdToSave}/choice-labels`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ labels: labelPayload })
              });
              const body2 = await r2.json().catch(() => ({}));
              console.log('[structure] choice-labels result', body2);
            } catch (e2) {
              console.warn('choice-labels secondary save failed', e2);
            }

            // Prefer server echo of saved labels when present
            const savedChoices = Array.isArray(body.choices) ? body.choices : chosen;
            console.log('[structure] server returned texts:', savedChoices.map(c => c.text));
            const page = currentPages.find(pp => Number(pp.id) === Number(pageIdToSave));
            if (page) {
              page.choices = savedChoices.map(c => ({
                to_page_id: c.to_page_id,
                image: c.image || c.choice_image || null,
                text: c.text || '',
                choice_text: c.text || ''
              }));
            }
            const d = draftsFor(pageIdToSave);
            // Update memory only — do NOT overwrite a focused/live input (that wiped spaces mid-type)
            for (let i = 0; i < 3; i++) {
              if (!slots[i]) {
                d[i] = labelsOnly[i] || '';
                continue;
              }
              const match = savedChoices.find(c => Number(c.to_page_id) === Number(slots[i].to_page_id));
              const savedText = match ? (match.text || '') : '';
              const live = labelInputs[i] ? labelInputs[i].value : null;
              const focused = labelInputs[i] && document.activeElement === labelInputs[i];

              if (focused && live != null) {
                d[i] = live;
                slots[i].text = live;
                if (live.trim() !== savedText) saveQueued = true;
              } else if (live != null && live.trim() !== savedText && live !== (labelsOnly[i] || '')) {
                d[i] = live;
                slots[i].text = live;
                saveQueued = true;
              } else {
                d[i] = savedText || labelsOnly[i] || '';
                slots[i].text = d[i];
              }
            }
            ok = true;
          } while (saveQueued);

          if (ok) setStatus('Saved', 'ok');
        } catch (e) {
          console.error('saveCurrentStructure', e);
          setStatus('Save failed', 'err');
          if (!silent) alert('Failed to save structure');
          ok = false;
        } finally {
          saving = false;
        }

        if (ok && saveQueued) {
          saveQueued = false;
          return saveCurrentStructure(silent);
        }
        return ok;
      }

      function scheduleLabelSave() {
        clearTimeout(labelSaveTimer);
        setStatus('Unsaved changes…', 'busy');
        // Longer debounce so typing (including spaces) isn't interrupted by save writeback
        labelSaveTimer = setTimeout(() => {
          // Don't autosave while the user is mid-keystroke in a label field
          if (labelInputs.some(el => el && document.activeElement === el)) {
            scheduleLabelSave();
            return;
          }
          saveCurrentStructure(true);
        }, 600);
      }

      function populateFocusSelect() {
        focusSelect.innerHTML = currentPages.map((p, i) =>
          `<option value="${p.id}">${p.title || 'Untitled'} (Page ${i + 1})</option>`
        ).join('');
        focusSelect.value = focusedPageId;
      }

      function updateFocusPreview() {
        const p = currentPages.find(pp => Number(pp.id) === Number(focusedPageId));
        if (!p) return;
        focusPreview.innerHTML = `
          <img src="${p.image_path || ''}" class="w-8 h-8 object-cover rounded border border-slate-600 flex-shrink-0" onerror="this.style.display='none'">
          <div class="min-w-0">
            <div class="font-medium text-xs">Page ${currentPages.indexOf(p) + 1}</div>
            <div class="text-slate-400 text-[10px] truncate">${(p.text_content || '').substring(0, 40)}</div>
          </div>
        `;
      }

      function renderSlots() {
        // Capture any in-progress typing before wiping the DOM
        captureAllLabels();
        labelInputs = [null, null, null];
        slotsContainer.innerHTML = '';
        const drafts = draftsFor(focusedPageId);

        for (let i = 0; i < 3; i++) {
          const slot = document.createElement('div');
          slot.className = 'border-2 border-dashed border-purple-500 rounded-2xl p-3 min-h-[70px] bg-slate-950';
          slot.dataset.slot = String(i);

          const linked = slots[i];
          if (linked) {
            const linkedPage = currentPages.find(pp => Number(pp.id) === Number(linked.to_page_id));
            // Prefer draft (what user typed), then slot, then empty
            const label = (drafts[i] != null && drafts[i] !== '')
              ? drafts[i]
              : (linked.text || '');

            const head = document.createElement('div');
            head.className = 'flex items-center gap-2 mb-2';
            head.innerHTML = `
              ${linkedPage && linkedPage.image_path
                ? `<img src="${linkedPage.image_path}" class="w-6 h-6 object-cover rounded border border-slate-600 flex-shrink-0">`
                : '<div class="w-6 h-6 bg-slate-700 rounded flex-shrink-0"></div>'}
              <div class="flex-1 text-[10px] min-w-0">
                <div>Choice ${i + 1} → Page ${linkedPage ? currentPages.indexOf(linkedPage) + 1 : '?'}</div>
                <div class="text-emerald-400 truncate">${linkedPage ? (linkedPage.text_content || linkedPage.title || 'Untitled') : ''}</div>
              </div>
            `;
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'text-red-400 text-xs px-1';
            clearBtn.textContent = '✕';
            clearBtn.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              captureAllLabels();
              slots[i] = null;
              draftsFor(focusedPageId)[i] = '';
              labelInputs[i] = null;
              renderSlots();
              await saveCurrentStructure(true);
            };
            head.appendChild(clearBtn);
            slot.appendChild(head);

            const lab = document.createElement('label');
            lab.className = 'block text-[10px] text-slate-400 mb-0.5';
            lab.textContent = 'Choice label (shown in reader)';
            slot.appendChild(lab);

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.maxLength = 200;
            labelInput.placeholder = 'e.g. Reach out to pet him';
            labelInput.className = 'w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs outline-none focus:border-purple-500';
            labelInput.value = label; // set via property, not HTML attribute
            labelInput.dataset.choiceLabel = String(i);
            labelInputs[i] = labelInput;
            linked.text = label;
            drafts[i] = label;

            labelInput.addEventListener('input', () => {
              writeLabel(i, labelInput.value);
              scheduleLabelSave();
            });
            labelInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(labelSaveTimer);
                writeLabel(i, labelInput.value.trim());
                saveCurrentStructure(true);
                labelInput.blur();
              }
            });
            labelInput.addEventListener('blur', () => {
              clearTimeout(labelSaveTimer);
              writeLabel(i, labelInput.value.trim());
              saveCurrentStructure(true);
            });

            slot.appendChild(labelInput);
          } else {
            slot.innerHTML = `<div class="text-center text-xs text-slate-400 py-2">Drop page here for Choice ${i + 1}</div>`;
          }

          slot.ondragover = e => { e.preventDefault(); slot.classList.add('bg-purple-900/20'); };
          slot.ondragleave = () => slot.classList.remove('bg-purple-900/20');
          slot.ondrop = async (e) => {
            e.preventDefault();
            slot.classList.remove('bg-purple-900/20');
            const droppedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (droppedId && droppedId != focusedPageId) {
              captureAllLabels();
              const droppedPage = currentPages.find(pp => Number(pp.id) === droppedId);
              const prevText = readLabel(i);
              slots[i] = {
                to_page_id: droppedId,
                choice_image: droppedPage ? droppedPage.image_path : null,
                text: prevText
              };
              writeLabel(i, prevText);
              renderSlots();
              await saveCurrentStructure(true);
            }
          };

          slotsContainer.appendChild(slot);
        }
      }

      function populatePalette() {
        palette.innerHTML = '';
        currentPages.forEach(p => {
          if (Number(p.id) === Number(focusedPageId)) return;
          const card = document.createElement('div');
          card.className = 'bg-slate-800 border border-slate-700 rounded-xl p-1 text-xs cursor-grab flex gap-1 items-center';
          card.draggable = true;
          card.dataset.pageId = p.id;
          card.innerHTML = `
            ${p.image_path ? `<img src="${p.image_path}" class="w-6 h-6 object-cover rounded flex-shrink-0">` : '<div class="w-6 h-6 bg-slate-700 rounded flex-shrink-0"></div>'}
            <div class="truncate flex-1 text-[10px]">${(p.text_content || 'Page ' + (currentPages.indexOf(p) + 1)).substring(0, 18)}</div>
          `;
          card.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', p.id);
          };
          palette.appendChild(card);
        });
      }

      function loadChoicesForFocus() {
        const p = currentPages.find(pp => Number(pp.id) === Number(focusedPageId));
        const drafts = draftsFor(focusedPageId);
        slots = [null, null, null];
        labelInputs = [null, null, null];
        if (p && p.choices) {
          p.choices.slice(0, 3).forEach((ch, i) => {
            const fromServer = (ch.text || ch.choice_text || '').trim();
            // Prefer draft if user typed something this session; else server
            const text = (drafts[i] && String(drafts[i]).trim() !== '')
              ? String(drafts[i])
              : fromServer;
            drafts[i] = text;
            slots[i] = {
              to_page_id: ch.to_page_id,
              choice_image: ch.image || null,
              text
            };
          });
        }
        renderSlots();
      }

      populateFocusSelect();
      focusSelect.value = focusedPageId;
      updateFocusPreview();
      loadChoicesForFocus();
      populatePalette();

      // Auto-save previous page's choices+labels, then load the next page's data
      focusSelect.onchange = async () => {
        const nextId = parseInt(focusSelect.value, 10);
        if (nextId === Number(focusedPageId)) return;

        clearTimeout(labelSaveTimer);
        captureAllLabels();
        const ok = await saveCurrentStructure(true);
        if (!ok) {
          focusSelect.value = focusedPageId;
          return;
        }

        focusedPageId = nextId;
        slots = [null, null, null];
        labelInputs = [null, null, null];
        slotsContainer.innerHTML = '';
        updateFocusPreview();
        try {
          await refreshPagesFromServer();
          populateFocusSelect();
          focusSelect.value = focusedPageId;
        } catch (e) {}
        loadChoicesForFocus();
        populatePalette();
        setStatus('Editing page — autosave on', 'ok');
      };

      setInitialBtn.onclick = async () => {
        const startId = initialSelect.value;
        if (!startId) return;
        const r = await fetch(`/api/pages/${startId}/set-start`, { method: 'POST' });
        if (r.ok) {
          await refreshPagesFromServer();
          initialSelect.innerHTML = currentPages.map((p, i) =>
            `<option value="${p.id}" ${Number(p.id) === Number(startId) ? 'selected' : ''}>${p.title || 'Untitled'} (Page ${i + 1})</option>`
          ).join('');
          setStatus('Start page set', 'ok');
        }
      };

      saveBtn.onclick = async () => {
        clearTimeout(labelSaveTimer);
        captureAllLabels();
        console.log('[structure] labelInputs values', labelInputs.map(el => el ? el.value : null));
        console.log('[structure] drafts', JSON.parse(JSON.stringify(draftsFor(focusedPageId))));
        const ok = await saveCurrentStructure(false);
        if (ok) {
          await refreshPagesFromServer();
          const p = currentPages.find(pp => Number(pp.id) === Number(focusedPageId));
          const labels = (p && p.choices) ? p.choices.map(c => c.text || c.choice_text || '') : [];
          console.log('[structure] verified labels after save:', labels);
          setStatus(labels.some(Boolean) ? 'Saved (labels OK)' : 'Saved — labels empty!', labels.some(Boolean) ? 'ok' : 'err');
          if (!labels.some(Boolean)) {
            alert('Labels did not save. Open the browser console (F12) and check the [structure] logs, or try typing a label and pressing Enter.');
          }
        }
      };

      const doClose = async () => {
        clearTimeout(labelSaveTimer);
        captureAllLabels();
        await saveCurrentStructure(true);
        window.__saveStoryStructure = null;
        widget.remove();
        document.getElementById('create-modal').classList.remove('hidden');
        await loadEditor(editingComicId);
      };
      closeBtn.onclick = doClose;

      // Allow preview / navbar code to flush structure saves (including labels)
      window.__saveStoryStructure = async () => {
        clearTimeout(labelSaveTimer);
        captureAllLabels();
        return saveCurrentStructure(true);
      };

      // Seed drafts from whatever is already on the server
      refreshPagesFromServer().then(() => {
        loadChoicesForFocus();
        populatePalette();
      }).catch(() => {});
    }

    async function previewComic() {
      const comicId = editingComicId;
      if (!comicId) {
        alert('Save or open a story first.');
        return;
      }
      // Flush any open structure-builder labels before reading
      if (typeof window.__saveStoryStructure === 'function') {
        try {
          const saved = await window.__saveStoryStructure();
          if (saved === false) {
            alert('Could not save choice labels. Check that you are logged in, then try Save again.');
            return;
          }
        } catch (e) {
          console.error(e);
        }
      }
      // Hide editor so the reader (same z-index layer) is visible; closeReader restores editor
      document.getElementById('create-modal').classList.add('hidden');
      previousView = 'edit';
      await openReader(comicId, { fromEditor: true });
    }

    // === READER ===
    let readerComic = null;
    let readerAllPages = [];
    let hasPurchasedComic = false;
    let choicesMade = 0;
    const FREE_CHOICES = 1;
    let pageHistory = [];

    // === COMIC INFO MODAL (title + description shown first on browse) ===
    async function showComicInfo(comicId) {
      comicId = Number(comicId);
      const res = await fetch(`/api/comics/${comicId}`);
      const comic = await res.json();

      // Populate basic info
      document.getElementById('info-title').textContent = comic.title || 'Untitled';
      document.getElementById('info-author').innerHTML = `by <span class="text-slate-400">${comic.author || 'Unknown'}</span>`;

      const isOwner = currentUser && comic.author === currentUser.username;

      // Genre, pages, price badges
      const genreEl = document.getElementById('info-genre');
      genreEl.textContent = comic.genre || 'Other';

      const pagesEl = document.getElementById('info-pages');
      const pageCount = comic.pageCount || comic.page_count || 0;
      pagesEl.textContent = `${pageCount} page${pageCount === 1 ? '' : 's'}`;

      const priceEl = document.getElementById('info-price');
      const price = comic.price || (comic.price_cents ? (comic.price_cents / 100).toFixed(2) : null);
      if (price && !isOwner) {
        priceEl.textContent = `$${price}`;
      } else if (isOwner) {
        priceEl.textContent = 'Yours';
      } else {
        priceEl.textContent = 'Free (limited ads)';
      }

      // Description - enforce short (≤ 240 words)
      let desc = (comic.description || 'No description has been provided for this story.').trim();
      const words = desc.split(/\s+/).filter(Boolean);
      if (words.length > 240) {
        desc = words.slice(0, 240).join(' ') + '…';
      }
      document.getElementById('info-description').textContent = desc;

      // Determine ownership for button states
      let hasPurchased = false;
      if (currentUser) {
        try {
          const purchRes = await fetch(`/api/comics/${comicId}/purchased`);
          const purchData = await purchRes.json();
          hasPurchased = !!purchData.purchased;
        } catch (e) {}
      }

      if (currentUser && comic.author === currentUser.username) {
        hasPurchased = true;
      }
      // Reviewer who claimed for review bypasses paywall (consistent with openReader + server)
      if (currentUser && comic.reviewed_by && Number(currentUser.id) === Number(comic.reviewed_by)) {
        hasPurchased = true;
      }

      const sampleBtn = document.getElementById('info-read-sample-btn');
      const purchaseBtn = document.getElementById('info-purchase-btn');
      const tip = document.getElementById('info-sample-tip');
      const creditBalEl = document.getElementById('info-credit-balance');
      if (creditBalEl) {
        if (currentUser) {
          creditBalEl.classList.remove('hidden');
          creditBalEl.innerHTML = `Your credits: $${((currentUser.credit_balance_cents || 0) / 100).toFixed(2)} · <button type="button" class="underline text-blue-400" onclick="closeComicInfo(); showCreditsModal()">Add credits</button>`;
        } else {
          creditBalEl.classList.add('hidden');
        }
      }

      // Chapters list
      const chWrap = document.getElementById('info-chapters-wrap');
      const chList = document.getElementById('info-chapters-list');
      try {
        const chRes = await fetch(`/api/comics/${comicId}/chapters`);
        const chapters = await chRes.json();
        if (chapters.length && chWrap && chList) {
          chWrap.classList.remove('hidden');
          chList.innerHTML = chapters.map(ch => {
            const priceLabel = ch.price_cents ? `$${(ch.price_cents / 100).toFixed(2)}` : 'Free';
            const status = ch.unlocked ? 'Unlocked' : priceLabel;
            const btn = (!ch.unlocked && ch.price_cents)
              ? `<button type="button" class="text-xs px-2 py-1 bg-emerald-700 hover:bg-emerald-600 rounded-lg" data-unlock-ch="${ch.id}">Unlock</button>`
              : `<span class="text-xs text-slate-500">${status}</span>`;
            return `<div class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-sm">
              <span>${ch.title}</span>
              ${btn}
            </div>`;
          }).join('');
          chList.querySelectorAll('[data-unlock-ch]').forEach(btn => {
            btn.onclick = async () => {
              if (!currentUser) { closeComicInfo(); showAuthModal(); return; }
              const id = btn.getAttribute('data-unlock-ch');
              const r = await fetch(`/api/chapters/${id}/unlock`, { method: 'POST' });
              const d = await r.json();
              if (!r.ok) {
                if ((d.error || '').includes('Insufficient')) {
                  if (confirm('Not enough credits. Buy credits now?')) {
                    closeComicInfo();
                    showCreditsModal();
                  }
                } else {
                  alert(d.error || 'Unlock failed');
                }
                return;
              }
              await updateAuthUI();
              await showComicInfo(comicId);
            };
          });
        } else if (chWrap) {
          chWrap.classList.add('hidden');
          if (chList) chList.innerHTML = '';
        }
      } catch (e) {
        if (chWrap) chWrap.classList.add('hidden');
      }

      if (isOwner) {
        // Creator - full access, no ads
        sampleBtn.style.display = 'none';
        if (tip) tip.style.display = 'none';
        purchaseBtn.textContent = 'Read Full Story';
        purchaseBtn.onclick = () => {
          closeComicInfo();
          openReader(comicId);
        };
      } else if (!price) {
        // Free story (non-owner) - full access with limited platform ads
        sampleBtn.style.display = '';
        sampleBtn.textContent = 'Read Sample (first choice free)';
        sampleBtn.onclick = () => {
          closeComicInfo();
          openReader(comicId);
        };
        purchaseBtn.textContent = 'Read Full Story';
        purchaseBtn.onclick = () => {
          closeComicInfo();
          openReader(comicId);
        };
        if (tip) tip.style.display = '';
      } else if (hasPurchased) {
        sampleBtn.style.display = 'none';
        if (tip) tip.style.display = 'none';
        purchaseBtn.textContent = 'Read Full Story';
        purchaseBtn.onclick = () => {
          closeComicInfo();
          openReader(comicId);
        };
      } else {
        // Paid, not yet purchased
        sampleBtn.style.display = '';
        sampleBtn.textContent = 'Read Sample (first choice free)';
        sampleBtn.onclick = () => {
          closeComicInfo();
          openReader(comicId);
        };
        if (tip) tip.style.display = '';
        purchaseBtn.textContent = `Unlock full story $${price}`;
        purchaseBtn.onclick = async () => {
          if (!currentUser) {
            closeComicInfo();
            showAuthModal();
            return;
          }
          closeComicInfo();
          await purchaseComic(comicId);
        };
      }

      document.getElementById('comic-info-modal').classList.remove('hidden');
    }

    function closeComicInfo() {
      document.getElementById('comic-info-modal').classList.add('hidden');
    }

    async function openReader(comicId, options = {}) {
      comicId = Number(comicId);

      if (options.fromEditor) {
        // Preview from editor: return to editor on close, don't clobber viewBeforeEditor
        previousView = 'edit';
        document.getElementById('create-modal').classList.add('hidden');
      } else {
        // Normal browse/read: remember current main view (never store "edit" as home for Done)
        rememberCurrentView();
        if (previousView === 'edit') {
          previousView = viewBeforeEditor || 'my-comics';
        }
        document.getElementById('create-modal').classList.add('hidden');
      }

      // Full-page reader view below navbar (navbar always visible)
      hideMainViews();
      document.getElementById('navbar').classList.remove('hidden');

      const res = await fetch(`/api/comics/${comicId}`);
      readerComic = await res.json();

      // fetch full pages
      const pagesRes = await fetch(`/api/comics/${comicId}/pages`);
      const data = await pagesRes.json();
      readerAllPages = data.pages || [];

      // Check if purchased (only if logged in)
      hasPurchasedComic = false;
      choicesMade = 0;
      pageHistory = [];
      if (currentUser) {
        try {
          const purchRes = await fetch(`/api/comics/${comicId}/purchased`);
          const purchData = await purchRes.json();
          hasPurchasedComic = purchData.purchased;

          // Fetch persistent sample choice count for non-purchased paid comics
          if (!hasPurchasedComic && readerComic && readerComic.price) {
            const progRes = await fetch(`/api/comics/${comicId}/sample-progress`);
            const prog = await progRes.json();
            choicesMade = prog.choicesUsed || 0;
          }
        } catch (e) {}
      }

      // Creators do not pay to read their own comics (client-side fallback)
      if (currentUser && readerComic.author === currentUser.username) {
        hasPurchasedComic = true;
      }
      // Reviewer who claimed the story for review also gets full access (bypass paywall)
      if (currentUser && readerComic.reviewed_by && Number(currentUser.id) === Number(readerComic.reviewed_by)) {
        hasPurchasedComic = true;
      }

      const isOwner = currentUser && readerComic.author === currentUser.username;
      const displayPrice = readerComic.price && !isOwner ? readerComic.price : null;
      document.getElementById('reader-comic-title').textContent = readerComic.title + (displayPrice ? ` ($${displayPrice})` : '');
      document.getElementById('reader-author').innerHTML = `by <span class="text-slate-400">${readerComic.author}</span>`;

      document.getElementById('reader-modal').classList.remove('hidden');

      // Find start
      let start = readerAllPages.find(p => p.is_start);
      if (!start) start = readerAllPages[0];
      
      if (start) {
        currentReaderPage = start;
        renderReaderPage(start);
      } else {
        document.getElementById('reader-text').innerHTML = '<em>This comic has no pages yet.</em>';
        document.getElementById('reader-choices').innerHTML = '';
        const scrollContainer = document.getElementById('reader-scroll');
        if (scrollContainer) scrollContainer.scrollTop = 0;
      }
    }

    function renderReaderPage(page) {
      currentReaderPage = page;

      const isFirstPage = !!page.is_start;

      // Limited ads ONLY on free stories for non-owners (platform keeps all ad revenue)
      const adContainer = document.getElementById('reader-ad');
      if (adContainer) {
        const isFreeStory = !readerComic || !readerComic.price;
        const isOwner = currentUser && readerComic && readerComic.author === currentUser.username;
        if (isFreeStory && !isOwner && isFirstPage) {
          // Show only on the very first page of free stories to keep it limited
          adContainer.classList.remove('hidden');
          if (!adContainer.querySelector('.adsbygoogle')) {
            adContainer.innerHTML = `
              <div class="text-[10px] text-slate-500 mb-1">Sponsored (limited ads on free stories)</div>
              <ins class="adsbygoogle"
                   style="display:block; min-height:90px; background:#1e2937; border-radius:8px;"
                   data-ad-client="ca-pub-YOUR_PUBLISHER_ID_HERE"
                   data-ad-slot="YOUR_AD_SLOT_HERE"
                   data-ad-format="auto"
                   data-full-width-responsive="true"></ins>
            `;
            try {
              (adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
              console.log('[Ads] AdSense not loaded yet - replace placeholders and enable script in <head>');
            }
          }
        } else {
          adContainer.classList.add('hidden');
        }
      }

      // Reset scroll to top on every page change (choices, back, restart, etc.)
      const scrollContainer = document.getElementById('reader-scroll');
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
      
      const img = document.getElementById('reader-image');
      const placeholder = document.getElementById('reader-image-placeholder');
      
      if (page.image_path) {
        img.src = page.image_path;
        img.style.display = 'block';
        img.style.height = 'auto';
        img.style.maxHeight = 'none';
        placeholder.style.display = 'none';

        // Re-reset after image loads (in case it affects layout height)
        img.onload = () => {
          if (scrollContainer) scrollContainer.scrollTop = 0;
        };
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
      }

      document.getElementById('reader-text').textContent = page.text_content || '';

      // Progress
      const idx = readerAllPages.findIndex(p => p.id === page.id);
      document.getElementById('reader-progress').textContent = `${idx + 1} / ${readerAllPages.length}`;

      // Side "Go Back" button next to choices (height matches the choices stack dynamically)
      const backBtn = document.getElementById('reader-back-btn');
      if (backBtn) {
        if (pageHistory.length > 0) {
          backBtn.classList.remove('hidden');
          backBtn.onclick = () => {
            if (pageHistory.length > 0) {
              const prev = pageHistory.pop();
              renderReaderPage(prev);
            }
          };
        } else {
          backBtn.classList.add('hidden');
          backBtn.onclick = null;
        }
      }

      // Choices
      const choicesContainer = document.getElementById('reader-choices');
      choicesContainer.innerHTML = '';

      if (!page.choices || !page.choices.length) {
        const end = document.createElement('div');
        end.className = 'text-center py-2 text-emerald-400 text-sm';
        end.textContent = '— The End —';
        choicesContainer.appendChild(end);
        return;
      }

      const isSampleLimited = !hasPurchasedComic && choicesMade >= FREE_CHOICES && readerComic.price && !isFirstPage;

      if (isSampleLimited) {
        const paywall = document.createElement('div');
        paywall.className = 'p-4 bg-slate-800 border border-amber-600 rounded-2xl text-center';
        paywall.innerHTML = `
          <div class="font-medium mb-1">Sample Ended</div>
          <div class="text-sm text-slate-400 mb-3">The first choice is free. Buy to continue the full story.</div>
          <button class="px-6 py-2 bg-white text-slate-900 rounded-2xl text-sm font-medium">Buy for $${readerComic.price || '??'}</button>
        `;
        const buyBtn = paywall.querySelector('button');
        buyBtn.onclick = () => purchaseComic(readerComic.id);
        choicesContainer.appendChild(paywall);
        return;
      }

      page.choices.forEach(choice => {
        const btn = document.createElement('button');
        // Compact choice row — never expand destination page art to full reader width
        btn.className = 'choice-btn w-full max-h-16 flex items-center gap-3 px-2 sm:px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl text-sm text-left overflow-hidden flex-shrink-0';
        
        const target = readerAllPages.find(p => p.id === choice.to_page_id);
        const imgSrc = choice.image || (target && target.image_path ? target.image_path : null);
        // Only show text the creator actually entered — never invent "Continue" / "Choice"
        const label = (choice.text || choice.choice_text || '').trim();
        const safeLabel = label
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

        if (imgSrc && label) {
          btn.innerHTML = `
            <img src="${imgSrc}" class="h-12 w-16 sm:h-14 sm:w-20 object-cover rounded-xl border border-slate-600 flex-shrink-0" alt="" style="width:5rem;height:3.5rem;object-fit:cover;">
            <span class="flex-1 text-sm leading-snug pr-1 line-clamp-2">${safeLabel}</span>
          `;
        } else if (imgSrc) {
          // Thumbnail only — fixed size, not full-bleed
          btn.classList.add('justify-start');
          btn.innerHTML = `
            <img src="${imgSrc}" class="h-12 w-20 sm:h-14 sm:w-24 object-cover rounded-xl border border-slate-600 flex-shrink-0" alt="" style="width:6rem;height:3.5rem;object-fit:cover;">
          `;
        } else if (label) {
          btn.classList.add('px-5', 'py-3');
          btn.textContent = label;
        } else {
          // No image and no label — still clickable, no placeholder caption
          btn.classList.add('px-5', 'py-3', 'justify-center', 'text-slate-500');
          btn.innerHTML = '<span class="text-lg leading-none">→</span>';
          btn.setAttribute('aria-label', 'Continue');
        }
        
        btn.onclick = async () => {
          pageHistory.push(currentReaderPage);

          // For logged-in users on paid comics, record sample choice server-side
          // (sample is now just the first page's choices) so the limit persists across refreshes
          if (currentUser && !hasPurchasedComic && readerComic && readerComic.price) {
            try {
              const incRes = await fetch(`/api/comics/${readerComic.id}/sample-choice`, { method: 'POST' });
              const incData = await incRes.json();
              if (typeof incData.choicesUsed === 'number') {
                choicesMade = incData.choicesUsed;
              } else {
                choicesMade++;
              }
            } catch (e) {
              choicesMade++;
            }
          } else {
            choicesMade++;
          }

          const target = readerAllPages.find(p => p.id === choice.to_page_id);
          if (target) {
            renderReaderPage(target);
          } else {
            const r = await fetch(`/api/pages/${choice.to_page_id}`);
            const fresh = await r.json();
            const existingIdx = readerAllPages.findIndex(p => p.id === fresh.id);
            if (existingIdx >= 0) readerAllPages[existingIdx] = fresh;
            else readerAllPages.push(fresh);
            renderReaderPage(fresh);
          }
        };
        choicesContainer.appendChild(btn);
      });
    }

    async function purchaseComic(comicId) {
      try {
        // Prefer credits for full story when balance is enough
        const bal = currentUser?.credit_balance_cents || 0;
        const metaRes = await fetch(`/api/comics/${comicId}`);
        const comic = await metaRes.json();
        const priceCents = comic.price_cents || (comic.price ? Math.round(parseFloat(comic.price) * 100) : 0);

        if (priceCents > 0 && bal >= priceCents) {
          const useCredits = confirm(`Unlock full story for $${(priceCents / 100).toFixed(2)} using credits?\n\nYour balance: $${(bal / 100).toFixed(2)}\n\nOK = credits · Cancel = pay with card`);
          if (useCredits) {
            const r = await fetch(`/api/comics/${comicId}/purchase-credits`, { method: 'POST' });
            const d = await r.json();
            if (!r.ok) {
              if ((d.error || '').includes('Insufficient')) {
                if (confirm('Not enough credits. Buy credits?')) showCreditsModal();
              } else {
                alert(d.error || 'Purchase failed');
              }
              return;
            }
            alert('Story unlocked with credits!');
            await updateAuthUI();
            hasPurchasedComic = true;
            openReader(comicId);
            return;
          }
        } else if (priceCents > 0 && bal < priceCents) {
          const buyCredits = confirm(`Full story is $${(priceCents / 100).toFixed(2)}. Your credits: $${(bal / 100).toFixed(2)}.\n\nBuy credits first? (Cancel = pay with card if available)`);
          if (buyCredits) {
            showCreditsModal();
            return;
          }
        }

        const res = await fetch(`/api/comics/${comicId}/purchase`, { method: 'POST' });
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else if (data.success) {
          hasPurchasedComic = true;
          openReader(comicId);
        } else if (data.error) {
          alert(data.error);
        }
      } catch (e) {
        alert('Could not start purchase.');
      }
    }

    async function showCreditsModal() {
      if (!currentUser) {
        showAuthModal();
        return;
      }
      const modal = document.getElementById('credits-modal');
      modal.classList.remove('hidden');
      try {
        const [balRes, pkgRes] = await Promise.all([
          fetch('/api/credits/balance'),
          fetch('/api/credits/packages'),
        ]);
        const bal = await balRes.json();
        const pkgs = await pkgRes.json();
        document.getElementById('credits-balance-display').textContent = bal.balance_dollars || '0.00';
        const box = document.getElementById('credits-packages');
        box.innerHTML = (pkgs.packages || []).map(p => `
          <button type="button" class="w-full text-left px-4 py-3 bg-slate-950 border border-slate-700 hover:border-blue-600 rounded-2xl text-sm flex justify-between items-center gap-2" data-pkg="${p.cents}">
            <span>${p.label_detail || p.label}</span>
            <span class="text-blue-400 font-medium">Buy</span>
          </button>
        `).join('');
        box.querySelectorAll('[data-pkg]').forEach(btn => {
          btn.onclick = async () => {
            const cents = parseInt(btn.getAttribute('data-pkg'), 10);
            btn.disabled = true;
            try {
              const r = await fetch('/api/credits/topup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_cents: cents }),
              });
              const d = await r.json();
              if (d.url) {
                window.location.href = d.url;
              } else {
                alert(d.error || 'Could not start top-up');
                btn.disabled = false;
              }
            } catch (e) {
              alert('Could not start top-up');
              btn.disabled = false;
            }
          };
        });
      } catch (e) {
        alert('Could not load credits');
      }
    }

    function closeCreditsModal() {
      document.getElementById('credits-modal').classList.add('hidden');
    }

    function restartStory() {
      if (!readerComic) return;
      // Do not reset choicesMade here — the sample count is persistent per user/comic
      // (fetched on openReader and updated via /sample-choice). Restart just restarts the story view.
      pageHistory = [];
      let start = readerAllPages.find(p => p.is_start);
      if (!start) start = readerAllPages[0];
      if (start) renderReaderPage(start);
    }

    function closeReader() {
      document.getElementById('reader-modal').classList.add('hidden');
      pageHistory = [];
      restorePreviousView();
    }

    // Init
    async function init() {
      initTailwind();
      
      const urlParams = new URLSearchParams(window.location.search);
      
      // Handle email verification token
      const verifyToken = urlParams.get('token');
      if (verifyToken) {
        try {
          const res = await fetch('/api/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: verifyToken })
          });
          const data = await res.json();
          
          if (data.success) {
            alert('Email verified successfully! You are now logged in.');
            window.history.replaceState({}, document.title, window.location.pathname);
            await updateAuthUI();
          } else {
            alert(data.error || 'Verification failed. The link may have expired.');
          }
        } catch (e) {
          alert('Verification failed. Please try again or request a new link.');
        }
      }

      // Handle password reset token from URL (separate from verify)
      if (urlParams.get('token') && window.location.pathname.includes('/reset-password')) {
        document.getElementById('auth-modal').classList.remove('hidden');
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('forgot-password-form').classList.add('hidden');
        document.getElementById('reset-password-form').classList.remove('hidden');
      }

      try {
        await updateAuthUI();
      } catch (e) { console.error('updateAuthUI failed', e); }
      document.getElementById('navbar').classList.remove('hidden');
      try {
        await loadGenres();
      } catch (e) { console.error('loadGenres failed', e); }

      // Credit top-up success (works without webhook via session_id)
      if (urlParams.get('credits') === 'success') {
        const sessionId = urlParams.get('session_id');
        if (sessionId && currentUser) {
          try {
            const r = await fetch('/api/credits/topup-complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId }),
            });
            const d = await r.json();
            if (r.ok) {
              alert(`Credits added! Balance: $${((d.balance || 0) / 100).toFixed(2)}`);
              await updateAuthUI();
            } else {
              alert(d.error || 'Could not confirm credit top-up. If you were charged, contact support.');
            }
          } catch (e) {
            alert('Could not confirm credit top-up.');
          }
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (urlParams.get('credits') === 'cancel') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Handle successful full-story purchase redirect
      const purchasedComic = urlParams.get('purchased');
      if (purchasedComic && currentUser) {
        fetch(`/api/comics/${purchasedComic}/purchase-complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: urlParams.get('payment_intent') })
        }).then(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          hasPurchasedComic = true;
          alert('Thank you! You can now read the full story.');
          if (currentReaderPage) renderReaderPage(currentReaderPage);
        });
      }

      // Event delegation for browse comic cards (safer than per-card closures)
      const browseGrid = document.getElementById('comics-grid');
      if (browseGrid) {
        browseGrid.addEventListener('click', (e) => {
          const card = e.target.closest('.comic-card');
          if (card && card.dataset.comicId) {
            showComicInfo(parseInt(card.dataset.comicId, 10));
          }
        });
      }

      // Event delegation for My Stories cards (prevents inline onclick / closure mixups)
      const myGrid = document.getElementById('my-comics-grid');
      if (myGrid) {
        myGrid.addEventListener('click', (e) => {
          const card = e.target.closest('.comic-card');
          if (!card || !card.dataset.comicId) return;
          const id = parseInt(card.dataset.comicId, 10);
          const actionBtn = e.target.closest('button[data-action]');
          if (actionBtn) {
            e.stopImmediatePropagation();
            if (actionBtn.dataset.action === 'edit') {
              editComic(id);
            } else if (actionBtn.dataset.action === 'read') {
              openReader(id);
            } else if (actionBtn.dataset.action === 'submit') {
              fetch(`/api/comics/${id}/submit`, { method: 'POST' }).then(() => {
                alert('Submitted for review.');
                showMyComics();
              });
            } else if (actionBtn.dataset.action === 'publish') {
              fetch(`/api/comics/${id}/publish`, { method: 'POST' })
                .then(async (r) => {
                  const data = await r.json().catch(() => ({}));
                  if (!r.ok) {
                    alert(data.error || 'Could not publish story.');
                    return;
                  }
                  alert('Story published! It is now live on Browse.');
                  showMyComics();
                })
                .catch(() => alert('Could not publish story.'));
            }
          } else {
            // click on card body -> edit
            editComic(id);
          }
        });
      }

      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement.tagName === 'BODY') {
          e.preventDefault();
          showBrowse();
          const search = document.getElementById('search-input');
          if (search) {
            search.focus();
            search.select();
          }
        }
        if (e.key.toLowerCase() === '?' && document.getElementById('reader-modal').classList.contains('hidden') === false) {
          // quick restart in reader
          restartStory();
        }
      });

      // Show landing page by default
      showHome();
      
      console.log('%c[Pick Your Path Stories] Ready at PYPStories.com — data stored locally on E: drive.', 'color:#64748b');
    }

    // Expose handlers used by inline onclick attributes
    window.previewComic = previewComic;
    window.closeCreateModal = closeCreateModal;
    window.openStoryBuilder = openStoryBuilder;
    window.showCreateComic = showCreateComic;
    window.editComic = editComic;
    window.showAuthModal = showAuthModal;
    window.closeAuthModal = closeAuthModal;
    window.switchAuthTab = switchAuthTab;
    window.login = login;
    window.register = register;
    window.logout = logout;
    window.showForgotPassword = showForgotPassword;
    window.resendFromLogin = resendFromLogin;
    window.resendVerification = resendVerification;
    window.showHome = showHome;
    window.showBrowse = showBrowse;
    window.showMyComics = showMyComics;
    window.showCreditsModal = showCreditsModal;
    window.closeCreditsModal = closeCreditsModal;
    window.showAccountModal = showAccountModal;
    window.showAdminReviews = showAdminReviews;

    // Boot
    window.onload = init;
  
