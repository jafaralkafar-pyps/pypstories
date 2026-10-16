/**
 * Login, account, credits, and the story editor. Inserted before app.js
 * runs so the logged-out homepage HTML does not contain those panels.
 */
(function (root) {
  var inserted = false;

  var createModalHtml = `  <!-- CREATE / EDIT COMIC MODAL -->
  <div id="create-modal" 
       class="hidden fixed top-14 sm:top-16 left-0 right-0 bottom-0 bg-black/80 z-40 flex flex-col overflow-hidden">
    <div id="create-modal-panel" onclick="event.stopImmediatePropagation()" class="bg-slate-900 border border-slate-700 w-full h-full p-4 sm:p-6 flex flex-col min-h-0">
      <h3 id="create-modal-title" class="text-2xl font-semibold tracking-tight mb-4">Create New Story</h3>
      
      <div id="create-form" class="pr-0.5 pb-2">
        <!-- Tutorial video + steps for new creators -->
        <div id="creator-tutorial"></div>

        <div class="space-y-4">
          <div>
            <label class="text-xs text-slate-400">Story Title</label>
            <input id="comic-title" type="text" class="w-full mt-1 bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">
          </div>
          <div>
            <label class="text-xs text-slate-400">Description</label>
            <textarea id="comic-desc" rows="3" class="w-full mt-1 bg-slate-950 border border-slate-700 rounded-3xl px-4 py-2.5 text-sm"></textarea>
          </div>
          <div>
            <label class="text-xs text-slate-400">Genre / Type</label>
            <select id="comic-genre" class="w-full mt-1 bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">
              <option>Fantasy</option>
              <option>Sci-Fi</option>
              <option>Horror</option>
              <option>Mystery</option>
              <option>Adventure</option>
              <option>Romance</option>
              <option>Comedy</option>
              <option>Drama</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-slate-400">Full story / bundle price (USD) — 0 free, or ≥ $5.99. Smaller prices use chapters + credits.</label>
            <input id="comic-price" type="number" step="0.01" min="0" value="0" class="w-full mt-1 bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">
          </div>
        </div>
      </div>

      <div id="create-form-actions" class="flex flex-col sm:flex-row gap-3">
        <button type="button" onclick="closeCreateModal()" class="flex-1 py-2.5 border border-slate-700 rounded-2xl text-sm">Cancel</button>
        <button type="button" onclick="createComic()" class="flex-1 py-2.5 bg-white text-slate-900 font-medium rounded-2xl">Create Story</button>
      </div>

      <!-- Editor view inside modal (after story is created) -->
      <div id="editor-section" class="hidden flex-1 flex flex-col min-h-0">
        <div id="editor-section-scroll" class="pr-0.5 pb-2">
        <div class="mb-4">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div class="flex-1 min-w-0">
              <label class="text-[10px] text-slate-500 block mb-0.5">Story title</label>
              <input id="editor-comic-title" type="text" maxlength="200"
                     class="w-full max-w-xl font-semibold text-base sm:text-lg bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-100"
                     placeholder="Story title">
              <div id="editor-comic-genre" class="text-xs text-blue-400 mt-1"></div>
              <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span class="text-slate-400">Price:</span>
                <input id="editor-comic-price" type="text" placeholder="0 or 4.99" class="w-16 sm:w-20 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs">
                <button type="button" onclick="saveComicDetails()" class="px-2.5 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-xs">Save title &amp; price</button>
              </div>
              <div id="editor-details-status" class="text-[9px] text-slate-500 mt-0.5">0 = Free • ≥$5.99 = full story/bundle • chapters for smaller prices</div>
              <label class="mt-3 flex items-start gap-2 text-xs text-slate-300 max-w-xl">
                <input id="editor-allow-download" type="checkbox" class="mt-0.5 accent-blue-600">
                <span>Allow buyers to download an offline copy</span>
              </label>
              <p id="editor-allow-download-note" class="text-[10px] text-slate-500 mt-1 max-w-xl">Buyers keep this copy permanently, even after refunds or if you remove the story. Turning this off later does not remove copies already downloaded.</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <button type="button" id="editor-cover-btn"
                      class="text-xs sm:text-sm px-3 sm:px-4 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl">
                Add Cover
              </button>
              <button type="button" onclick="addNewPage()" 
                      class="text-xs sm:text-sm px-3 sm:px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl">+ Add Page(s)</button>
              <button type="button" onclick="openStoryBuilder()" 
                      class="text-xs sm:text-sm px-3 sm:px-4 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-xl">Build Structure</button>
              <input type="file" id="editor-cover-input" accept="image/*" class="hidden">
            </div>
          </div>
          <!-- Compact cover status + thumbnail (browse-card size, not full width) -->
          <div class="mt-3 flex items-center gap-3">
            <div id="editor-cover-preview"
                 class="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 flex-shrink-0"
                 style="width:10.5rem;height:7rem;">
              <div id="editor-cover-placeholder" class="w-full h-full flex items-center justify-center text-slate-500 text-[10px] px-2 text-center">No cover</div>
              <img id="editor-cover-img" alt="Cover" class="w-full h-full object-contain bg-slate-950 hidden" style="width:10.5rem;height:7rem;object-fit:contain;">
            </div>
            <div class="min-w-0 text-[11px] text-slate-500">
              <div class="text-slate-400 font-medium">Browse cover</div>
              <div id="editor-cover-status" class="mt-0.5">Shown on story cards. Click Add Cover to upload.</div>
              <div class="mt-1 text-slate-600">Best: landscape <span class="text-slate-400">3:2</span> (e.g. 1200×800). Full image is shown; other shapes may leave empty bars.</div>
            </div>
          </div>
        </div>

        <div class="mb-4 p-3 bg-slate-950 border border-slate-800 rounded-2xl">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="text-xs font-medium text-slate-300">Chapters (credits — e.g. $0.99 each)</div>
            <button type="button" onclick="addEditorChapter()" class="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-xl">+ Chapter</button>
          </div>
          <div id="editor-chapters-list" class="space-y-2 text-xs"></div>
        </div>

        <div id="pages-list" class="space-y-2 pr-1"></div>
        </div>

        <div id="editor-section-actions" class="flex flex-col sm:flex-row gap-3 text-sm">
          <button type="button" onclick="previewComic()" class="flex-1 py-2 border border-slate-700 rounded-2xl hover:bg-slate-800">Preview Reader</button>
          <button type="button" onclick="closeCreateModal()" class="flex-1 py-2 bg-white text-slate-900 font-medium rounded-2xl">Done</button>
        </div>
      </div>
    </div>
  </div>`;

  var html = ''
    + '<div id="view-account" class="hidden max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">'
    + '<div class="mb-6 sm:mb-8"><h2 class="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tighter">Account</h2>'
    + '<p class="text-slate-400 text-sm sm:text-base">Profile, security, and creator earnings</p></div>'
    + '<div class="space-y-6">'
    + '<section id="account-notices" class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6">'
    + '<div class="flex items-center justify-between gap-2 mb-3"><h3 class="text-sm font-medium text-slate-300">Notices</h3>'
    + '<button type="button" id="account-notices-read-all" class="text-xs text-blue-400 underline">Mark all read</button></div>'
    + '<div id="account-notices-list" class="space-y-3"></div>'
    + '<p id="account-notices-empty" class="hidden text-sm text-slate-400">No notices.</p></section>'
    + '<section class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6">'
    + '<h3 class="text-sm font-medium text-slate-300 mb-3">Profile</h3>'
    + '<div class="text-xs text-slate-400">Logged in as</div>'
    + '<div id="account-email" class="font-medium break-all mt-0.5"></div>'
    + '<div id="account-username" class="text-sm text-slate-400 mt-1"></div>'
    + '<div class="mt-3 text-sm">Credits: $<span id="account-credits-balance">0.00</span> '
    + '<button type="button" onclick="showCreditsModal()" class="ml-2 text-xs text-blue-400 underline">Add credits</button></div></section>'
    + '<section class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6">'
    + '<h3 class="text-sm font-medium text-slate-300 mb-3">Change password</h3>'
    + '<div class="space-y-3">'
    + '<input id="current-password" type="password" placeholder="Current password" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">'
    + '<input id="new-password" type="password" placeholder="New password (min 8 chars)" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">'
    + '<input id="confirm-new-password" type="password" placeholder="Confirm new password" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-2.5 text-sm">'
    + '</div>'
    + '<button onclick="changePassword()" class="mt-4 w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-2xl text-sm font-medium">Update password</button>'
    + '<div id="change-password-error" class="mt-2 text-xs text-red-400 hidden"></div>'
    + '<div id="change-password-success" class="mt-2 text-xs text-emerald-400 hidden"></div></section>'
    + '<section class="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6">'
    + '<h3 class="text-sm font-medium text-slate-300 mb-3">Creator earnings</h3>'
    + '<div id="account-stripe-connect" class="hidden mb-4 p-3 bg-amber-900/30 border border-amber-600 rounded-2xl text-sm">Connect Stripe to receive payouts. '
    + '<button type="button" id="account-connect-stripe-btn" class="ml-2 px-3 py-1 bg-white text-slate-900 rounded-xl text-xs font-medium">Connect Stripe</button></div>'
    + '<div class="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-3">'
    + '<div>Pending<br><span id="account-earn-pending" class="text-white text-base">$0.00</span></div>'
    + '<div>Available<br><span id="account-earn-available" class="text-emerald-400 text-base">$0.00</span></div>'
    + '<div>Paid out<br><span id="account-earn-paid" class="text-slate-300 text-base">$0.00</span></div></div>'
    + '<div class="text-[11px] text-slate-500 mb-3">Payouts require $50+ available after a 30-day waiting period. Platform fee: 15% (10% after $2k lifetime sales). Credit sales: Stripe top-up fees absorbed by platform.</div>'
    + '<button type="button" id="account-payout-btn" class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-xl text-xs font-medium opacity-50 cursor-not-allowed" disabled>Request payout</button>'
    + '<div id="account-earnings-recent" class="mt-4 space-y-1.5 text-xs text-slate-400"></div></section>'
    + '</div></div>'
    + '<div id="credits-modal" onclick="if (event.target.id === \'credits-modal\') closeCreditsModal()" class="hidden viewport-dialog bg-black/90 z-[70]">'
    + '<div onclick="event.stopImmediatePropagation()" class="viewport-dialog-panel w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl">'
    + '<div class="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between flex-shrink-0"><div class="font-semibold">Credits</div>'
    + '<button type="button" onclick="closeCreditsModal()" class="text-slate-400 hover:text-white px-2">Close</button></div>'
    + '<div class="viewport-dialog-scroll p-5 space-y-4">'
    + '<div class="text-sm text-slate-400">1 credit = $0.01. Use credits for chapters (e.g. $0.99). Stripe fees on top-ups are absorbed by the platform.</div>'
    + '<div class="text-2xl font-semibold">Balance: $<span id="credits-balance-display">0.00</span></div>'
    + '<div id="credits-packages" class="space-y-2"></div>'
    + '<div class="text-[11px] text-slate-500">Minimum top-up $5. Purchases over $20 include a 10% credit bonus.</div>'
    + '</div></div></div>'
    + '<div id="auth-modal" onclick="if (event.target.id === \'auth-modal\') closeAuthModal()" class="hidden viewport-dialog bg-black/80 z-[80]">'
    + '<div onclick="event.stopImmediatePropagation()" class="viewport-dialog-panel bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-sm">'
    + '<div class="viewport-dialog-scroll p-5 sm:p-7">'
    + '<div id="auth-tabs" class="flex mb-6 border-b border-slate-800">'
    + '<button type="button" onclick="switchAuthTab(\'login\')" id="tab-login" class="flex-1 pb-3 text-sm font-medium border-b-2 border-blue-500">Log in</button>'
    + '<button type="button" onclick="switchAuthTab(\'register\')" id="tab-register" class="flex-1 pb-3 text-sm font-medium text-slate-400">Create account</button></div>'
    + '<form id="login-form" onsubmit="event.preventDefault(); login();" autocomplete="on"><div class="space-y-4">'
    + '<input id="login-email" name="email" type="email" placeholder="Email address" autocomplete="username" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<input id="login-password" name="password" type="password" placeholder="Password" autocomplete="current-password" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<label class="flex items-center gap-2 text-sm text-slate-300 cursor-pointer"><input id="login-remember" type="checkbox" class="accent-blue-600" checked><span>Remember me (stay logged in)</span></label></div>'
    + '<button type="submit" class="mt-5 w-full py-3 bg-white text-slate-900 rounded-2xl font-medium">Log in</button>'
    + '<div class="mt-3 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-sm">'
    + '<button type="button" onclick="showForgotPassword()" class="text-blue-400 hover:text-blue-300 text-xs text-left">Forgot password?</button>'
    + '<button type="button" id="login-resend-btn" onclick="resendFromLogin()" class="text-blue-400 hover:text-blue-300 text-xs text-left sm:text-right">Resend verification email</button></div>'
    + '<div id="login-resend-status" class="mt-2 text-xs text-emerald-400 hidden"></div>'
    + '<div id="login-error" class="mt-2 text-xs text-red-400 hidden"></div></form>'
    + '<div id="register-form" class="hidden"><div class="space-y-4">'
    + '<input id="reg-email" type="email" placeholder="Email address (required)" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<input id="reg-username" type="text" placeholder="Display name (optional)" maxlength="24" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<p class="text-[10px] text-slate-500 -mt-2">3–24 characters: letters, numbers, _ or -. No official/brand names or offensive language.</p>'
    + '<input id="reg-password" type="password" placeholder="Password (min 8 characters)" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<input id="reg-password2" type="password" placeholder="Confirm password" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm"></div>'
    + '<button type="button" onclick="register()" class="mt-5 w-full py-3 bg-white text-slate-900 rounded-2xl font-medium">Create account</button>'
    + '<div class="mt-3 text-xs text-slate-400 text-center">We will send a verification link to your email. Check your inbox and spam folder. Already signed up? Use <button type="button" onclick="switchAuthTab(\'login\')" class="text-blue-400 hover:text-blue-300 underline">Log in</button> and resend the verification email.</div>'
    + '<div id="reg-error" class="mt-2 text-xs text-red-400 hidden"></div></div>'
    + '<div id="forgot-password-form" class="hidden"><div class="mb-4"><div class="text-sm font-medium mb-2">Reset your password</div>'
    + '<p class="text-xs text-slate-400 mb-3">Enter your email and we will send a reset link.</p></div>'
    + '<input id="forgot-email" type="email" placeholder="Your email address" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<button onclick="sendForgotPassword()" class="mt-5 w-full py-3 bg-white text-slate-900 rounded-2xl font-medium">Send reset link</button>'
    + '<button onclick="switchAuthTab(\'login\')" class="mt-2 w-full text-xs text-slate-400 hover:text-slate-200">Back to login</button>'
    + '<div id="forgot-error" class="mt-2 text-xs text-red-400 hidden"></div>'
    + '<div id="forgot-success" class="mt-2 text-xs text-emerald-400 hidden"></div></div>'
    + '<div id="reset-password-form" class="hidden"><div class="mb-4"><div class="text-sm font-medium mb-2">Set new password</div></div>'
    + '<div class="space-y-4">'
    + '<input id="reset-password" type="password" placeholder="New password (min 8 chars)" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm">'
    + '<input id="reset-password2" type="password" placeholder="Confirm new password" class="w-full bg-slate-950 border border-slate-700 rounded-2xl px-5 py-3 text-sm"></div>'
    + '<button type="button" onclick="submitPasswordReset()" class="mt-5 w-full py-3 bg-white text-slate-900 rounded-2xl font-medium">Reset Password</button>'
    + '<div id="reset-error" class="mt-2 text-xs text-red-400 hidden"></div></div>'
    + '</div></div></div>'
    + createModalHtml;

  function ensurePrivatePanels() {
    if (inserted || (root.document && root.document.getElementById('auth-modal'))) {
      inserted = true;
      return;
    }
    var host = root.document.createElement('div');
    host.innerHTML = html;
    var account = host.querySelector('#view-account');
    var main = root.document.querySelector('.pt-14');
    if (account && main) main.appendChild(account);
    while (host.firstChild) root.document.body.appendChild(host.firstChild);
    inserted = true;
  }

  root.ensurePrivatePanels = ensurePrivatePanels;
  if (root.document && root.document.body) ensurePrivatePanels();
})(typeof window !== 'undefined' ? window : globalThis);
