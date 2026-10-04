(() => {
  'use strict';

  const STORAGE_KEY = 'streakline_v2';
  const OLD_KEYS = ['neonHabitHero_data', 'habitTracker_data', 'habitTracker_days'];
  const DEFAULT_SETTINGS = {
    habitName: 'Build the streak',
    icon: '⚡',
    weeklyTarget: 5,
    weekStarts: 1,
    celebrations: true
  };

  const ACHIEVEMENTS = [
    { id: 'first', icon: '🌱', name: 'Started', description: 'Complete your first check-in.', test: s => s.total >= 1 },
    { id: 'three', icon: '🔥', name: 'Momentum', description: 'Reach a 3-day streak.', test: s => s.bestStreak >= 3 },
    { id: 'seven', icon: '⚡', name: 'One full week', description: 'Reach a 7-day streak.', test: s => s.bestStreak >= 7 },
    { id: 'thirty', icon: '🏔️', name: 'Unshakeable', description: 'Reach a 30-day streak.', test: s => s.bestStreak >= 30 },
    { id: 'fifty', icon: '💎', name: 'Fifty strong', description: 'Complete 50 total days.', test: s => s.total >= 50 },
    { id: 'hundred', icon: '🏆', name: 'Century', description: 'Complete 100 total days.', test: s => s.total >= 100 },
    { id: 'notes', icon: '✍️', name: 'Reflective', description: 'Write notes on 10 days.', test: s => s.notes >= 10 },
    { id: 'target', icon: '🎯', name: 'Target hit', description: 'Meet your weekly target.', test: s => s.thisWeek >= s.weeklyTarget }
  ];

  let state = loadState();
  let viewDate = startOfMonth(new Date());
  let activeDayKey = null;
  let toastTimer = null;

  const el = {};
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    bindEvents();
    renderAll();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function cacheElements() {
    [
      'habitIcon','habitTitle','settingsBtn','todayStatus','currentStreak','streakMessage','userLevel','xpText','xpBar',
      'weeklyCompletion','weeklyTargetText','completionRate','badgesEarned','weeklyTile','rateTile','badgesTile',
      'prevMonth','nextMonth','todayBtn','currentMonth','weekdayRow','calendar','missionTitle','missionText','missionBar',
      'checkInBtn','statsBtn','dayModal','dayModalTitle','dayNote','dayToggleBtn','saveDayBtn','analyticsModal','insightGrid','yearBars',
      'achievementsModal','achievementsGrid','settingsModal','habitNameInput','habitIconInput','weeklyTargetInput','weekStartInput',
      'celebrationsInput','saveSettingsBtn','exportBtn','importBtn','importFile','resetBtn','toast','celebration','celebrationText'
    ].forEach(id => { el[id] = document.getElementById(id); });
  }

  function bindEvents() {
    el.prevMonth.addEventListener('click', () => changeMonth(-1));
    el.nextMonth.addEventListener('click', () => changeMonth(1));
    el.todayBtn.addEventListener('click', () => { viewDate = startOfMonth(new Date()); renderCalendar(); });
    el.checkInBtn.addEventListener('click', () => toggleToday());
    el.statsBtn.addEventListener('click', openAnalytics);
    el.weeklyTile.addEventListener('click', openAnalytics);
    el.rateTile.addEventListener('click', openAnalytics);
    el.badgesTile.addEventListener('click', openAchievements);
    el.settingsBtn.addEventListener('click', openSettings);
    el.dayToggleBtn.addEventListener('click', toggleActiveDay);
    el.saveDayBtn.addEventListener('click', saveDayDetails);
    el.saveSettingsBtn.addEventListener('click', saveSettings);
    el.exportBtn.addEventListener('click', exportData);
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', importData);
    el.resetBtn.addEventListener('click', resetAllData);

    document.addEventListener('click', event => {
      const closeTarget = event.target.closest('[data-close]');
      if (closeTarget) closeModal(closeTarget.dataset.close);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeTopModal();
    });
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.version === 2 && saved.days && saved.settings) {
        return sanitizeState(saved);
      }
    } catch (_) {}

    const migratedDays = {};
    for (const key of OLD_KEYS) {
      try {
        const old = JSON.parse(localStorage.getItem(key));
        if (!old || typeof old !== 'object') continue;
        for (const [dateKey, value] of Object.entries(old)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
          const entry = typeof value === 'object' && value !== null
            ? { completed: value.completed !== false, note: String(value.note || '').slice(0, 280) }
            : { completed: Boolean(value), note: '' };
          if (entry.completed || entry.note) migratedDays[dateKey] = entry;
        }
      } catch (_) {}
    }

    const fresh = { version: 2, settings: { ...DEFAULT_SETTINGS }, days: migratedDays };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh)); } catch (_) {}
    return fresh;
  }

  function sanitizeState(raw) {
    const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    settings.habitName = String(settings.habitName || DEFAULT_SETTINGS.habitName).slice(0, 42);
    settings.icon = String(settings.icon || DEFAULT_SETTINGS.icon).slice(0, 4);
    settings.weeklyTarget = clamp(Number(settings.weeklyTarget) || 5, 1, 7);
    settings.weekStarts = Number(settings.weekStarts) === 0 ? 0 : 1;
    settings.celebrations = settings.celebrations !== false;

    const days = {};
    for (const [key, value] of Object.entries(raw.days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const entry = typeof value === 'object' && value !== null ? value : { completed: Boolean(value) };
      days[key] = { completed: Boolean(entry.completed), note: String(entry.note || '').slice(0, 280) };
      if (!days[key].completed && !days[key].note) delete days[key];
    }
    return { version: 2, settings, days };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function renderAll() {
    el.habitTitle.textContent = state.settings.habitName;
    el.habitIcon.textContent = state.settings.icon;
    renderCalendar();
    renderStats();
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    el.currentMonth.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(viewDate);

    const weekStarts = state.settings.weekStarts;
    const labelsSunday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const labelsMonday = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    el.weekdayRow.innerHTML = (weekStarts === 1 ? labelsMonday : labelsSunday).map(day => `<span>${day}</span>`).join('');

    const firstNativeDay = new Date(year, month, 1).getDay();
    const offset = weekStarts === 1 ? (firstNativeDay + 6) % 7 : firstNativeDay;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayKey = keyFromDate(new Date());
    const today = startOfDay(new Date());

    const frag = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('div');
      blank.className = 'day-cell empty';
      frag.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = keyFromDate(date);
      const entry = state.days[key];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day-cell';
      button.textContent = String(day);
      button.dataset.key = key;
      button.setAttribute('aria-label', `${formatLongDate(date)}${entry?.completed ? ', completed' : ', not completed'}${entry?.note ? ', has note' : ''}`);
      if (entry?.completed) button.classList.add('completed');
      if (key === todayKey) button.classList.add('today');
      if (date > today) button.classList.add('future');
      if (entry?.note) {
        const dot = document.createElement('i');
        dot.className = 'note-dot';
        dot.setAttribute('aria-hidden', 'true');
        button.appendChild(dot);
      }

      let timer = null;
      let longPress = false;
      button.addEventListener('pointerdown', () => {
        longPress = false;
        timer = window.setTimeout(() => { longPress = true; openDayModal(key); }, 520);
      });
      ['pointerup','pointerleave','pointercancel'].forEach(type => button.addEventListener(type, () => window.clearTimeout(timer)));
      button.addEventListener('contextmenu', event => { event.preventDefault(); openDayModal(key); });
      button.addEventListener('dblclick', event => { event.preventDefault(); openDayModal(key); });
      button.addEventListener('click', () => {
        if (longPress) return;
        toggleDay(key, true);
      });
      frag.appendChild(button);
    }

    el.calendar.replaceChildren(frag);
  }

  function renderStats() {
    const stats = calculateStats();
    const todayDone = Boolean(state.days[keyFromDate(new Date())]?.completed);
    const xp = stats.total * 10 + stats.notes * 2;
    const level = Math.floor(xp / 100) + 1;
    const inLevel = xp % 100;

    el.currentStreak.textContent = stats.currentStreak;
    el.todayStatus.textContent = todayDone ? 'Today is complete' : 'Not checked in yet';
    el.todayStatus.classList.toggle('done', todayDone);
    el.streakMessage.textContent = streakCopy(stats.currentStreak, todayDone);
    el.userLevel.textContent = level;
    el.xpText.textContent = `${inLevel} / 100 XP`;
    el.xpBar.style.width = `${inLevel}%`;
    el.weeklyCompletion.textContent = `${Math.round(stats.weekRate * 100)}%`;
    el.weeklyTargetText.textContent = `${stats.thisWeek} / ${stats.weeklyTarget} target`;
    el.completionRate.textContent = `${Math.round(stats.consistency * 100)}%`;
    el.badgesEarned.textContent = `${stats.achievements}/${ACHIEVEMENTS.length}`;

    const targetPct = Math.min(100, (stats.thisWeek / stats.weeklyTarget) * 100);
    el.missionBar.style.width = `${targetPct}%`;
    el.missionTitle.textContent = stats.thisWeek >= stats.weeklyTarget ? 'Target complete' : 'Keep your rhythm';
    el.missionText.textContent = `${stats.thisWeek} of ${stats.weeklyTarget} check-ins complete this week.`;

    el.checkInBtn.textContent = todayDone ? '✓ Today complete' : '✓ Check in today';
    el.checkInBtn.classList.toggle('checked', todayDone);
  }

  function calculateStats() {
    const completedKeys = Object.keys(state.days).filter(key => state.days[key]?.completed).sort();
    const total = completedKeys.length;
    const notes = Object.values(state.days).filter(entry => entry?.note?.trim()).length;
    const currentStreak = calculateCurrentStreak(completedKeys);
    const bestStreak = calculateBestStreak(completedKeys);
    const thisWeek = countCurrentWeek(completedKeys);
    const weeklyTarget = state.settings.weeklyTarget;
    const weekRate = Math.min(1, thisWeek / weeklyTarget);
    const consistency = calculateConsistency(completedKeys);
    const base = { total, notes, currentStreak, bestStreak, thisWeek, weeklyTarget, weekRate, consistency };
    return { ...base, achievements: ACHIEVEMENTS.filter(a => a.test(base)).length };
  }

  function calculateCurrentStreak(completedKeys) {
    const set = new Set(completedKeys);
    let cursor = startOfDay(new Date());
    if (!set.has(keyFromDate(cursor))) cursor = addDays(cursor, -1);
    let count = 0;
    while (set.has(keyFromDate(cursor))) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function calculateBestStreak(completedKeys) {
    if (!completedKeys.length) return 0;
    let best = 1, run = 1;
    for (let i = 1; i < completedKeys.length; i++) {
      const prev = dateFromKey(completedKeys[i - 1]);
      const current = dateFromKey(completedKeys[i]);
      const diff = Math.round((startOfDay(current) - startOfDay(prev)) / 86400000);
      run = diff === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  }

  function countCurrentWeek(completedKeys) {
    const start = startOfWeek(new Date(), state.settings.weekStarts);
    const end = addDays(start, 7);
    return completedKeys.filter(key => {
      const d = dateFromKey(key);
      return d >= start && d < end;
    }).length;
  }

  function calculateConsistency(completedKeys) {
    if (!completedKeys.length) return 0;
    const first = dateFromKey(completedKeys[0]);
    const today = startOfDay(new Date());
    const elapsedDays = Math.max(1, Math.floor((today - first) / 86400000) + 1);
    return Math.min(1, completedKeys.length / elapsedDays);
  }

  function toggleToday() {
    toggleDay(keyFromDate(new Date()), true);
  }

  function toggleDay(key, celebrate) {
    const date = dateFromKey(key);
    if (date > startOfDay(new Date())) {
      showToast('Future days can’t be checked in yet.');
      return;
    }
    const wasComplete = Boolean(state.days[key]?.completed);
    const existingNote = state.days[key]?.note || '';
    if (wasComplete) {
      if (existingNote) state.days[key] = { completed: false, note: existingNote };
      else delete state.days[key];
      showToast('Check-in removed.');
    } else {
      state.days[key] = { completed: true, note: existingNote };
      if (celebrate && state.settings.celebrations) showCelebration();
      else showToast('Checked in.');
    }
    saveState();
    renderAll();
  }

  function openDayModal(key) {
    activeDayKey = key;
    const date = dateFromKey(key);
    const entry = state.days[key] || { completed: false, note: '' };
    el.dayModalTitle.textContent = formatLongDate(date);
    el.dayNote.value = entry.note || '';
    el.dayToggleBtn.textContent = entry.completed ? 'Mark incomplete' : 'Mark complete';
    el.dayToggleBtn.disabled = date > startOfDay(new Date());
    openModal('dayModal');
  }

  function toggleActiveDay() {
    if (!activeDayKey) return;
    const entry = state.days[activeDayKey] || { completed: false, note: '' };
    entry.completed = !entry.completed;
    state.days[activeDayKey] = entry;
    el.dayToggleBtn.textContent = entry.completed ? 'Mark incomplete' : 'Mark complete';
  }

  function saveDayDetails() {
    if (!activeDayKey) return;
    const note = el.dayNote.value.trim().slice(0, 280);
    const entry = state.days[activeDayKey] || { completed: false, note: '' };
    entry.note = note;
    if (!entry.completed && !entry.note) delete state.days[activeDayKey];
    else state.days[activeDayKey] = entry;
    saveState();
    closeModal('dayModal');
    renderAll();
    showToast('Day saved.');
  }

  function openAnalytics() {
    const stats = calculateStats();
    const values = [
      ['Total check-ins', stats.total],
      ['Current streak', `${stats.currentStreak} days`],
      ['Best streak', `${stats.bestStreak} days`],
      ['Notes written', stats.notes]
    ];
    el.insightGrid.innerHTML = values.map(([label, value]) => `<div class="insight-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

    const months = [];
    const now = new Date();
    let max = 1;
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = date.getFullYear(), m = date.getMonth();
      const count = Object.keys(state.days).filter(key => {
        if (!state.days[key]?.completed) return false;
        const d = dateFromKey(key);
        return d.getFullYear() === y && d.getMonth() === m;
      }).length;
      max = Math.max(max, count);
      months.push({ date, count });
    }
    el.yearBars.innerHTML = months.map(item => {
      const pct = Math.max(item.count ? 4 : 1, (item.count / max) * 100);
      const label = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(item.date);
      return `<div class="bar-item" title="${escapeHtml(label)}: ${item.count} completed"><b>${item.count}</b><div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div><span>${escapeHtml(label)}</span></div>`;
    }).join('');
    openModal('analyticsModal');
  }

  function openAchievements() {
    const stats = calculateStats();
    el.achievementsGrid.innerHTML = ACHIEVEMENTS.map(item => {
      const unlocked = item.test(stats);
      return `<div class="achievement ${unlocked ? '' : 'locked'}"><div class="achievement-icon">${item.icon}</div><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(unlocked ? item.description : `Locked · ${item.description}`)}</span></div></div>`;
    }).join('');
    openModal('achievementsModal');
  }

  function openSettings() {
    el.habitNameInput.value = state.settings.habitName;
    el.habitIconInput.value = state.settings.icon;
    el.weeklyTargetInput.value = String(state.settings.weeklyTarget);
    el.weekStartInput.value = String(state.settings.weekStarts);
    el.celebrationsInput.checked = state.settings.celebrations;
    openModal('settingsModal');
  }

  function saveSettings() {
    state.settings.habitName = el.habitNameInput.value.trim().slice(0, 42) || DEFAULT_SETTINGS.habitName;
    state.settings.icon = el.habitIconInput.value.trim().slice(0, 4) || DEFAULT_SETTINGS.icon;
    state.settings.weeklyTarget = clamp(Number(el.weeklyTargetInput.value) || 5, 1, 7);
    state.settings.weekStarts = Number(el.weekStartInput.value) === 0 ? 0 : 1;
    state.settings.celebrations = el.celebrationsInput.checked;
    saveState();
    closeModal('settingsModal');
    renderAll();
    showToast('Settings saved.');
  }

  function exportData() {
    const payload = { ...state, exportedAt: new Date().toISOString(), app: 'Streakline' };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streakline-backup-${keyFromDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup exported.');
  }

  function importData(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const candidate = parsed.version === 2 ? parsed : { version: 2, settings: parsed.settings || DEFAULT_SETTINGS, days: parsed.days || parsed.habitTracker || {} };
        if (!candidate.days || typeof candidate.days !== 'object') throw new Error('No habit data found');
        state = sanitizeState(candidate);
        saveState();
        closeModal('settingsModal');
        renderAll();
        showToast('Backup imported.');
      } catch (error) {
        showToast(`Import failed: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  function resetAllData() {
    const ok = window.confirm('Reset all check-ins, notes and settings? This cannot be undone unless you exported a backup.');
    if (!ok) return;
    state = { version: 2, settings: { ...DEFAULT_SETTINGS }, days: {} };
    saveState();
    closeModal('settingsModal');
    viewDate = startOfMonth(new Date());
    renderAll();
    showToast('All data reset.');
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const focusTarget = modal.querySelector('textarea, input, select, button:not(.modal-close)');
    setTimeout(() => focusTarget?.focus(), 0);
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal.open')) document.body.style.overflow = '';
  }

  function closeTopModal() {
    const open = [...document.querySelectorAll('.modal.open')].pop();
    if (open) closeModal(open.id);
  }

  function showCelebration() {
    const streak = calculateStats().currentStreak;
    el.celebrationText.textContent = streak > 1 ? `${streak}-day streak` : 'Checked in';
    el.celebration.classList.remove('show');
    void el.celebration.offsetWidth;
    el.celebration.classList.add('show');
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function changeMonth(offset) {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
    renderCalendar();
  }

  function streakCopy(streak, todayDone) {
    if (streak >= 30) return 'This is a system now. Protect the rhythm.';
    if (streak >= 7) return 'Strong momentum. Keep the next action easy.';
    if (streak >= 3) return 'Momentum is building — keep showing up.';
    if (streak === 2) return 'Two in a row. Make tomorrow obvious.';
    if (streak === 1) return todayDone ? 'Nice start. Repeat it tomorrow.' : 'Yesterday counts. Keep it alive today.';
    return 'One check-in is all it takes to start.';
  }

  function keyFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function dateFromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function addDays(date, count) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count); }
  function startOfWeek(date, startsOn) {
    const d = startOfDay(date);
    const diff = startsOn === 1 ? (d.getDay() + 6) % 7 : d.getDay();
    return addDays(d, -diff);
  }
  function formatLongDate(date) { return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function escapeHtml(value) { return value.replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch])); }
})();
