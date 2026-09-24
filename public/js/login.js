(function () {
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('loginError');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.hidden = true;
        const password = document.getElementById('password').value;
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error || 'ログインに失敗しました。';
                errorEl.hidden = false;
                return;
            }
            window.location.href = '/';
        } catch (err) {
            errorEl.textContent = '通信エラーが発生しました。';
            errorEl.hidden = false;
        } finally {
            btn.disabled = false;
        }
    });
})();
