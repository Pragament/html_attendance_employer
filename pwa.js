(() => {
    const banner = document.getElementById('installBanner');
    const button = document.getElementById('installApp');
    const instructions = document.getElementById('installInstructions');
    const standalone = window.matchMedia('(display-mode: standalone)');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(navigator.userAgent);
    let installPrompt = null;
    let dismissed = false;
    try {
        dismissed = Date.now() - Number(localStorage.getItem('empmanager-install-dismissed')) < 7 * 86400000;
    } catch (_) { /* Storage may be unavailable in private browsing. */ }

    function updateBanner() {
        banner.hidden = dismissed || standalone.matches || navigator.standalone === true
            || !(isIOS || isAndroid || installPrompt);
        button.textContent = installPrompt ? 'Add to home screen' : 'Show me how';
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
        button.hidden = false;
        instructions.hidden = true;
        updateBanner();
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        dismissed = true;
        updateBanner();
    });
    standalone.addEventListener('change', updateBanner);
    document.getElementById('dismissInstall').addEventListener('click', () => {
        dismissed = true;
        try { localStorage.setItem('empmanager-install-dismissed', String(Date.now())); } catch (_) {}
        updateBanner();
    });
    button.addEventListener('click', async () => {
        if (installPrompt) {
            const prompt = installPrompt;
            installPrompt = null;
            button.disabled = true;
            try {
                await prompt.prompt();
                const choice = await prompt.userChoice;
                if (choice.outcome === 'accepted') dismissed = true;
            } catch (error) {
                console.warn('Install prompt unavailable:', error);
            } finally {
                button.disabled = false;
                updateBanner();
            }
        } else {
            instructions.textContent = isIOS
                ? 'In Safari, open the Share menu (you may need to tap the More button first), then choose Add to Home Screen. Keep Open as Web App enabled if shown, then tap Add. If you are using another browser, open this page in Safari first.'
                : 'Open your browser menu (⋮) and choose Install app or Add to Home screen, then confirm. If the option is missing, open this page in Chrome.';
            instructions.hidden = false;
            button.hidden = true;
        }
    });
    updateBanner();
    if ('serviceWorker' in navigator && window.isSecureContext) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch((error) => {
                console.warn('Service worker registration failed:', error);
            });
        });
    }
})();
