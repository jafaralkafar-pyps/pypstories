// Grant's Website - JavaScript

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Navbar scroll behavior
const navbar = document.getElementById('navbar');
let lastScrollY = window.scrollY;

function handleScroll() {
  if (window.scrollY > 20) {
    navbar.classList.add('nav-scrolled', 'border-slate-800');
    navbar.classList.remove('bg-slate-950');
  } else {
    navbar.classList.remove('nav-scrolled');
    navbar.classList.add('bg-slate-950');
  }
}

window.addEventListener('scroll', handleScroll, { passive: true });

// Mobile menu toggle
const mobileBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

if (mobileBtn && mobileMenu) {
  mobileBtn.addEventListener('click', () => {
    const isOpen = !mobileMenu.classList.contains('hidden');
    
    if (isOpen) {
      mobileMenu.classList.add('hidden');
      mobileBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      `;
    } else {
      mobileMenu.classList.remove('hidden');
      mobileBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
    }
  });

  // Close mobile menu when clicking a link
  document.querySelectorAll('.mobile-link').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.add('hidden');
      mobileBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      `;
    });
  });
}

// Simple contact form handler (demo)
function handleSubmit(e) {
  e.preventDefault();
  
  const form = e.target;
  const originalText = form.querySelector('button').textContent;
  
  const btn = form.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  
  // Simulate sending (replace this with real form handling like Formspree, EmailJS, etc.)
  setTimeout(() => {
    btn.textContent = 'Message sent!';
    btn.style.backgroundColor = '#166534';
    btn.style.color = 'white';
    
    // Reset form
    setTimeout(() => {
      form.reset();
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.backgroundColor = '';
      btn.style.color = '';
      
      // Show thank you toast
      showToast();
    }, 1600);
  }, 900);
}

function showToast() {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 text-sm px-6 py-3 rounded-3xl flex items-center gap-3 shadow-2xl z-[100]';
  toast.innerHTML = `
    <span>Thanks! I'll get back to you soon.</span>
    <button class="text-blue-400 hover:text-blue-300 text-xs">✕</button>
  `;
  
  document.body.appendChild(toast);
  
  const closeBtn = toast.querySelector('button');
  closeBtn.addEventListener('click', () => toast.remove());
  
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 5000);
}

// Optional: Keyboard escape closes mobile menu
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mobileMenu && !mobileMenu.classList.contains('hidden')) {
    mobileMenu.classList.add('hidden');
    mobileBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    `;
  }
});

// Easter egg: press "?" to highlight the contact section
document.addEventListener('keypress', (e) => {
  if (e.key === '?') {
    const contact = document.getElementById('contact');
    if (contact) {
      contact.scrollIntoView({ behavior: 'smooth', block: 'center' });
      contact.style.transition = 'box-shadow 0.4s';
      contact.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.3)';
      
      setTimeout(() => {
        contact.style.boxShadow = '';
      }, 1400);
    }
  }
});

console.log('%c[Website] Static site loaded. Open index.html directly or serve via a local server.', 'color:#64748b');
