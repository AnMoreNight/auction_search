(function () {
    const customCount = document.getElementById('customCount');
    const searchBox = document.getElementById('searchBox');
    const searchBtn = document.getElementById('searchBtn');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const resultsBody = document.getElementById('resultsBody');
    const resultCountBadge = document.getElementById('resultCountBadge');
    const queryTime = document.getElementById('queryTime');
    const resultRangeText = document.getElementById('resultRangeText');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const emptyState = document.getElementById('emptyState');
    const resultsTable = document.getElementById('resultsTable');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const pagination = document.getElementById('pagination');
    const logoutBtn = document.getElementById('logoutBtn');
    const csvFile = document.getElementById('csvFile');
    const csvFileName = document.getElementById('csvFileName');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const lastUpdatedText = document.getElementById('lastUpdatedText');
    const headerDataCountValue = document.getElementById('headerDataCountValue');
    const refreshBtn = document.getElementById('refreshBtn');
    const sortableHeaders = document.querySelectorAll('.results-table th.sortable');
    const headerUploadBtn = document.getElementById('headerUploadBtn');
    const uploadModalOverlay = document.getElementById('uploadModalOverlay');
    const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const passwordModalOverlay = document.getElementById('passwordModalOverlay');
    const closePasswordModalBtn = document.getElementById('closePasswordModalBtn');
    const passwordForm = document.getElementById('passwordForm');
    const adminPasswordInput = document.getElementById('adminPasswordInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const newPasswordConfirmInput = document.getElementById('newPasswordConfirmInput');
    const passwordStatus = document.getElementById('passwordStatus');
    const changePasswordSubmitBtn = document.getElementById('changePasswordSubmitBtn');
    const tabLoginPwBtn = document.getElementById('tabLoginPwBtn');
    const tabAdminPwBtn = document.getElementById('tabAdminPwBtn');
    const passwordTabSlider = document.getElementById('passwordTabSlider');
    const adminPasswordForm = document.getElementById('adminPasswordForm');
    const currentAdminPasswordInput = document.getElementById('currentAdminPasswordInput');
    const newAdminPasswordInput = document.getElementById('newAdminPasswordInput');
    const newAdminPasswordConfirmInput = document.getElementById('newAdminPasswordConfirmInput');
    const adminPasswordStatus = document.getElementById('adminPasswordStatus');
    const changeAdminPasswordSubmitBtn = document.getElementById('changeAdminPasswordSubmitBtn');

    let currentPage = 1;
    let pageSize = parseInt(pageSizeSelect.value, 10) || 50;
    let sortBy = 'auction_no';
    let sortDir = 'desc';
    let currentTotal = 0;
    let currentAbort = null;
    let debounceTimer = null;

    const yen = new Intl.NumberFormat('ja-JP');
    const dateFmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    function buildParams(page) {
        const params = new URLSearchParams();
        params.set('q', searchBox.value.trim());
        params.set('page', String(page));
        params.set('pageSize', String(pageSize));
        params.set('sortBy', sortBy);
        params.set('sortDir', sortDir);

        const count = parseInt(customCount.value, 10);
        if (Number.isFinite(count) && count > 0) {
            params.set('scope', 'recent');
            params.set('count', String(count));
        } else {
            params.set('scope', 'all');
        }
        return params;
    }

    function renderRank(rank) {
        let clean = String(rank ?? '').trim();
        if (!clean) return '';
        // Source data mixes full-width letters (Ｊ Ｂ Ｃ Ａ) and lowercase (j c) in
        // with the plain ones - normalize so e.g. "Ｊ" gets colored the same as "J".
        clean = clean.replace(/[Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).toUpperCase();
        const cssClass = /^[A-Z]$/.test(clean) ? ` rank-${clean}` : '';
        return `<span class="rank-badge${cssClass}">${escapeHtml(clean)}</span>`;
    }

    function renderRow(item) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-auction" data-label="大会">${escapeHtml(item.auction_no)}</td>
            <td class="col-box" data-label="箱番号">${escapeHtml(item.box_no ?? '')}</td>
            <td class="col-branch" data-label="枝番号">${escapeHtml(item.branch_no ?? '')}</td>
            <td class="col-detail" data-label="詳細">${escapeHtml(item.detail ?? '')}</td>
            <td class="col-rank" data-label="ランク">${renderRank(item.rank)}</td>
            <td class="col-price" data-label="金額">${item.price != null ? yen.format(item.price) + '円' : ''}</td>
        `;
        return tr;
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function renderPagination(total, page, size) {
        pagination.innerHTML = '';
        const totalPages = Math.max(1, Math.ceil(total / size));
        if (totalPages <= 1) return;

        const makeBtn = (label, targetPage, opts = {}) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'page-btn' + (opts.active ? ' active' : '');
            btn.innerHTML = label;
            btn.disabled = !!opts.disabled;
            if (!opts.disabled && !opts.active) {
                btn.addEventListener('click', () => runSearch(targetPage));
            }
            return btn;
        };

        const prevIcon = '<svg viewBox="0 0 24 24" class="icon"><polyline points="15 18 9 12 15 6"/></svg>';
        const nextIcon = '<svg viewBox="0 0 24 24" class="icon"><polyline points="9 18 15 12 9 6"/></svg>';

        pagination.appendChild(makeBtn(prevIcon, page - 1, { disabled: page <= 1 }));

        const spread = 2;
        const pages = new Set([1, totalPages]);
        for (let p = page - spread; p <= page + spread; p++) {
            if (p >= 1 && p <= totalPages) pages.add(p);
        }
        const sorted = Array.from(pages).sort((a, b) => a - b);

        let prevPage = 0;
        sorted.forEach((p) => {
            if (p - prevPage > 1) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'page-ellipsis';
                ellipsis.textContent = '…';
                pagination.appendChild(ellipsis);
            }
            pagination.appendChild(makeBtn(String(p), p, { active: p === page }));
            prevPage = p;
        });

        pagination.appendChild(makeBtn(nextIcon, page + 1, { disabled: page >= totalPages }));
    }

    async function runSearch(page) {
        if (currentAbort) currentAbort.abort();
        currentAbort = new AbortController();

        loadingIndicator.hidden = false;
        resultsBody.innerHTML = '';
        emptyState.hidden = true;

        try {
            const params = buildParams(page);
            const res = await fetch(`/api/search?${params.toString()}`, { signal: currentAbort.signal });
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '検索に失敗しました。');

            resultsBody.innerHTML = '';
            data.items.forEach((item) => resultsBody.appendChild(renderRow(item)));

            currentPage = page;
            currentTotal = data.total;

            resultCountBadge.textContent = `${yen.format(data.items.length)} 件 / 全 ${yen.format(data.total)} 件`;
            queryTime.textContent = `(${(data.tookMs / 1000).toFixed(2)}秒)`;

            if (data.total === 0) {
                resultRangeText.textContent = '';
            } else {
                const from = (page - 1) * pageSize + 1;
                const to = Math.min(page * pageSize, data.total);
                resultRangeText.textContent = `${yen.format(from)} - ${yen.format(to)}件 / 全${yen.format(data.total)}件を表示`;
            }

            emptyState.hidden = data.total !== 0;
            resultsTable.hidden = data.total === 0;
            renderPagination(data.total, page, pageSize);
        } catch (err) {
            if (err.name === 'AbortError') return;
            resultCountBadge.textContent = '-';
            queryTime.textContent = '';
            resultRangeText.textContent = '';
            console.error(err);
            emptyState.textContent = err.message || '検索中にエラーが発生しました。';
            emptyState.hidden = false;
            resultsTable.hidden = true;
            pagination.innerHTML = '';
        } finally {
            loadingIndicator.hidden = true;
        }
    }

    function debouncedSearch() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runSearch(1), 300);
    }

    customCount.addEventListener('input', debouncedSearch);

    searchBox.addEventListener('input', () => {
        clearSearchBtn.hidden = searchBox.value.length === 0;
        debouncedSearch();
    });
    searchBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            clearTimeout(debounceTimer);
            runSearch(1);
        }
    });
    searchBtn.addEventListener('click', () => {
        clearTimeout(debounceTimer);
        runSearch(1);
    });
    clearSearchBtn.addEventListener('click', () => {
        searchBox.value = '';
        clearSearchBtn.hidden = true;
        searchBox.focus();
        runSearch(1);
    });

    pageSizeSelect.addEventListener('change', () => {
        pageSize = parseInt(pageSizeSelect.value, 10) || 50;
        runSearch(1);
    });

    sortableHeaders.forEach((th) => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortBy === key) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortBy = key;
                sortDir = 'desc';
            }
            sortableHeaders.forEach((h) => h.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            runSearch(1);
        });
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    });

    function openUploadModal() { uploadModalOverlay.hidden = false; }
    function closeUploadModal() { uploadModalOverlay.hidden = true; }

    headerUploadBtn.addEventListener('click', openUploadModal);
    closeUploadModalBtn.addEventListener('click', closeUploadModal);
    uploadModalOverlay.addEventListener('click', (e) => {
        if (e.target === uploadModalOverlay) closeUploadModal();
    });

    function showLoginPwTab() {
        tabLoginPwBtn.classList.add('active');
        tabLoginPwBtn.setAttribute('aria-selected', 'true');
        tabAdminPwBtn.classList.remove('active');
        tabAdminPwBtn.setAttribute('aria-selected', 'false');
        passwordTabSlider.style.transform = 'translateX(0)';
        adminPasswordInput.focus();
    }
    function showAdminPwTab() {
        tabAdminPwBtn.classList.add('active');
        tabAdminPwBtn.setAttribute('aria-selected', 'true');
        tabLoginPwBtn.classList.remove('active');
        tabLoginPwBtn.setAttribute('aria-selected', 'false');
        // Pixel offset computed from the actual viewport width rather than a
        // CSS percentage transform - see the note in style.css for why.
        const viewportWidth = passwordTabSlider.parentElement.clientWidth;
        passwordTabSlider.style.transform = `translateX(-${viewportWidth}px)`;
        currentAdminPasswordInput.focus();
    }
    tabLoginPwBtn.addEventListener('click', showLoginPwTab);
    tabAdminPwBtn.addEventListener('click', showAdminPwTab);

    function openPasswordModal() {
        passwordForm.reset();
        adminPasswordForm.reset();
        passwordStatus.className = 'upload-status';
        passwordStatus.textContent = '';
        adminPasswordStatus.className = 'upload-status';
        adminPasswordStatus.textContent = '';
        passwordModalOverlay.hidden = false;
        showLoginPwTab();
    }
    function closePasswordModal() { passwordModalOverlay.hidden = true; }

    changePasswordBtn.addEventListener('click', openPasswordModal);
    closePasswordModalBtn.addEventListener('click', closePasswordModal);
    passwordModalOverlay.addEventListener('click', (e) => {
        if (e.target === passwordModalOverlay) closePasswordModal();
    });

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const adminPassword = adminPasswordInput.value;
        const newPassword = newPasswordInput.value;
        const newPasswordConfirm = newPasswordConfirmInput.value;

        if (newPassword !== newPasswordConfirm) {
            passwordStatus.className = 'upload-status error';
            passwordStatus.textContent = '新しいパスワードが一致しません。';
            return;
        }
        if (newPassword.length < 4) {
            passwordStatus.className = 'upload-status error';
            passwordStatus.textContent = '新しいパスワードは4文字以上で入力してください。';
            return;
        }

        changePasswordSubmitBtn.disabled = true;
        passwordStatus.className = 'upload-status';
        passwordStatus.textContent = '変更中...';

        try {
            const res = await fetch('/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminPassword, newPassword }),
            });
            const data = await res.json();
            if (res.status === 401 && data.error === 'ログインが必要です。') {
                window.location.href = '/login.html';
                return;
            }
            if (!res.ok) throw new Error(data.error || 'パスワード変更に失敗しました。');

            passwordStatus.className = 'upload-status success';
            passwordStatus.textContent = 'パスワードを変更しました。次回ログインから新しいパスワードを使用してください。';
            passwordForm.reset();
        } catch (err) {
            passwordStatus.className = 'upload-status error';
            passwordStatus.textContent = err.message || 'パスワード変更中にエラーが発生しました。';
        } finally {
            changePasswordSubmitBtn.disabled = false;
        }
    });

    adminPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentAdminPassword = currentAdminPasswordInput.value;
        const newAdminPassword = newAdminPasswordInput.value;
        const newAdminPasswordConfirm = newAdminPasswordConfirmInput.value;

        if (newAdminPassword !== newAdminPasswordConfirm) {
            adminPasswordStatus.className = 'upload-status error';
            adminPasswordStatus.textContent = '新しい管理者パスワードが一致しません。';
            return;
        }
        if (newAdminPassword.length < 4) {
            adminPasswordStatus.className = 'upload-status error';
            adminPasswordStatus.textContent = '新しい管理者パスワードは4文字以上で入力してください。';
            return;
        }

        changeAdminPasswordSubmitBtn.disabled = true;
        adminPasswordStatus.className = 'upload-status';
        adminPasswordStatus.textContent = '変更中...';

        try {
            const res = await fetch('/api/change-admin-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentAdminPassword, newAdminPassword }),
            });
            const data = await res.json();
            if (res.status === 401 && data.error === 'ログインが必要です。') {
                window.location.href = '/login.html';
                return;
            }
            if (!res.ok) throw new Error(data.error || '管理者パスワード変更に失敗しました。');

            adminPasswordStatus.className = 'upload-status success';
            adminPasswordStatus.textContent = '管理者パスワードを変更しました。';
            adminPasswordForm.reset();
        } catch (err) {
            adminPasswordStatus.className = 'upload-status error';
            adminPasswordStatus.textContent = err.message || '管理者パスワード変更中にエラーが発生しました。';
        } finally {
            changeAdminPasswordSubmitBtn.disabled = false;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!uploadModalOverlay.hidden) closeUploadModal();
        if (!passwordModalOverlay.hidden) closePasswordModal();
    });

    csvFile.addEventListener('change', () => {
        csvFileName.textContent = csvFile.files[0] ? csvFile.files[0].name : '選択されていません';
    });

    async function loadLastUpdated() {
        try {
            const res = await fetch('/api/tournaments/latest');
            if (!res.ok) return;
            const data = await res.json();
            lastUpdatedText.textContent = data.lastUpdated
                ? `最終更新：${dateFmt.format(new Date(data.lastUpdated))}`
                : '';
            headerDataCountValue.textContent = yen.format(data.totalRecords || 0);
        } catch (err) {
            // Non-critical; leave the last-updated label blank on failure.
        }
    }

    refreshBtn.addEventListener('click', () => {
        loadLastUpdated();
        runSearch(currentPage || 1);
    });

    uploadBtn.addEventListener('click', async () => {
        const file = csvFile.files[0];
        if (!file) {
            uploadStatus.className = 'upload-status error';
            uploadStatus.textContent = 'ファイルを選択してください。';
            return;
        }
        uploadBtn.disabled = true;
        uploadStatus.className = 'upload-status';
        uploadStatus.textContent = 'アップロード中...';

        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            if (!res.ok) throw new Error(data.error || 'アップロードに失敗しました。');

            uploadStatus.className = 'upload-status success';
            let msg = `完了: 追加 ${data.inserted}件 / 更新 ${data.updated}件 / スキップ ${data.skipped}件（全${data.totalRows}行）`;
            if (data.errors && data.errors.length > 0) {
                msg += `\n先頭エラー: ` + data.errors.slice(0, 5).map((e) => `${e.row}行目: ${e.reason}`).join(' / ');
            }
            uploadStatus.textContent = msg;
            csvFile.value = '';
            csvFileName.textContent = '選択されていません';
            loadLastUpdated();
            runSearch(1);
        } catch (err) {
            uploadStatus.className = 'upload-status error';
            uploadStatus.textContent = err.message || 'アップロード中にエラーが発生しました。';
        } finally {
            uploadBtn.disabled = false;
        }
    });

    async function init() {
        try {
            const res = await fetch('/api/session');
            const data = await res.json();
            if (!data.authenticated) {
                window.location.href = '/login.html';
                return;
            }
        } catch (err) {
            window.location.href = '/login.html';
            return;
        }
        document.querySelector('.results-table th[data-sort="auction_no"]').classList.add('sort-desc');
        loadLastUpdated();
        runSearch(1);
    }

    init();
})();
