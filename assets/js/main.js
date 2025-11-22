const components = [
    { selector: '[data-component="header"]', path: 'assets/components/header.html' },
    { selector: '[data-component="hero"]', path: 'assets/components/hero.html' },
    { selector: '[data-component="news"]', path: 'assets/components/news.html' },
    { selector: '[data-component="pocket-forest-gallery"]', path: 'assets/components/pocket-forest-gallery.html' },
    { selector: '[data-component="events"]', path: 'assets/components/events.html' },
    { selector: '[data-component="projects"]', path: 'assets/components/projects.html' },
    { selector: '[data-component="stories"]', path: 'assets/components/stories.html' },
    { selector: '[data-component="contact"]', path: 'assets/components/contact.html' },
    { selector: '[data-component="footer"]', path: 'assets/components/footer.html' }
];

function loadComponent({ selector, path }) {
    const target = document.querySelector(selector);

    if (!target) {
        return Promise.resolve();
    }

    return fetch(path)
        .then((response) => {
            if (!response.ok) {
                throw new Error(`Failed to load component: ${path}`);
            }

            return response.text();
        })
        .then((html) => {
            target.innerHTML = html;
        });
}

function loadComponents() {
    return Promise.all(components.map(loadComponent));
}

function initNavigation() {
    const navToggle = document.querySelector('.nav-toggle');
    const navList = document.getElementById('primary-navigation');

    if (navToggle && navList) {
        navToggle.addEventListener('click', () => {
            const isOpen = navList.classList.toggle('is-open');
            navToggle.setAttribute('aria-expanded', String(isOpen));
        });

        navList.addEventListener('click', (event) => {
            if (event.target instanceof HTMLAnchorElement && navList.classList.contains('is-open')) {
                navList.classList.remove('is-open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

function updateCurrentYear() {
    const currentYear = document.getElementById('current-year');

    if (currentYear) {
        currentYear.textContent = new Date().getFullYear().toString();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadComponents()
        .then(() => {
            initNavigation();
            updateCurrentYear();
        })
        .catch((error) => {
            console.error(error);
        });
});
