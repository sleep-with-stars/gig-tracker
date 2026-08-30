/**
 * 工时与收入记工助手 - 核心业务与交互逻辑
 */

// ==================== 1. 数据常量与存储引擎 ====================
const STORAGE_KEYS = {
  SETTINGS: 'gig_tracker_settings_v1',
  RECORDS: 'gig_tracker_records_v1',
  ACTIVE_PUNCH: 'gig_tracker_active_punch_v1',
  CUSTOM_ICON: 'gig_tracker_custom_icon_v1'
};

const DEFAULT_SETTINGS = {
  defaultMode: 'PIECE', // 'PIECE' | 'HOURLY' | 'HYBRID'
  pieceRate: 5.0,        // 元/单
  hourlyRate: 25.0,      // 元/小时
  hybridBaseRate: 15.0,  // 底薪 (元/小时)
  hybridPieceRate: 3.0   // 提成 (元/单)
};

class StorageManager {
  static getSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      console.error('Failed to read settings', e);
      return { ...DEFAULT_SETTINGS };
    }
  }

  static saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error('Failed to save settings', e);
      return false;
    }
  }

  static getAllRecords() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.RECORDS);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error('Failed to read records', e);
      return {};
    }
  }

  static saveAllRecords(records) {
    try {
      localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
      return true;
    } catch (e) {
      console.error('Failed to save records', e);
      return false;
    }
  }

  static getDayRecord(dateStr) {
    const records = this.getAllRecords();
    return records[dateStr] || null;
  }

  static saveDayRecord(dateStr, record) {
    const records = this.getAllRecords();
    records[dateStr] = {
      ...record,
      updatedAt: new Date().toISOString()
    };
    this.saveAllRecords(records);
  }

  static deleteDayRecord(dateStr) {
    const records = this.getAllRecords();
    if (records[dateStr]) {
      delete records[dateStr];
      this.saveAllRecords(records);
      return true;
    }
    return false;
  }

  static getActivePunch() {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ACTIVE_PUNCH);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  static saveActivePunch(punchData) {
    if (!punchData) {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PUNCH);
    } else {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PUNCH, JSON.stringify(punchData));
    }
  }
}

// ==================== 2. 全局状态与控制器 ====================
const state = {
  currentTab: 'tabToday',
  settings: StorageManager.getSettings(),
  currentEditingDate: formatDateToYMD(new Date()),
  calendarViewDate: new Date(), // Year & Month for calendar tab
  activePunch: StorageManager.getActivePunch(),
  timerIntervalId: null,
  editingShiftIndex: -1 // for shift edit modal
};

// ==================== 3. 辅助函数 ====================
function formatDateToYMD(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseYMD(ymdStr) {
  const [year, month, day] = ymdStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatChineseDate(d) {
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = weekDays[d.getDay()];
  return `${y}年${m}月${day}日 星期${w}`;
}

function formatTimeHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function computeTimeDiffHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(':').map(Number);
  const [eh, em] = endHHMM.split(':').map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes < startMinutes) {
    // 跨天情况 (比如晚上22:00到次日02:00)
    endMinutes += 24 * 60;
  }
  const diffMinutes = Math.max(0, endMinutes - startMinutes);
  return Number((diffMinutes / 60).toFixed(2));
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-slate-900 text-white' : (type === 'error' ? 'bg-rose-600 text-white' : 'bg-brand-700 text-white');
  const iconName = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-circle' : 'info');

  toast.className = `${bgColor} px-4 py-2.5 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2 toast-enter pointer-events-auto border border-white/10`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  lucide.createIcons({ root: toast });

  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, 2200);
}

// ==================== 4. 收入计算核心逻辑 ====================
function calculateDayIncome(record, settings) {
  const mode = record.mode || settings.defaultMode || 'PIECE';
  const customRate = !!record.customRate;

  const pieceRate = customRate && record.rates?.pieceRate !== undefined 
    ? Number(record.rates.pieceRate) : Number(settings.pieceRate || 5.0);

  const hourlyRate = customRate && record.rates?.hourlyRate !== undefined 
    ? Number(record.rates.hourlyRate) : Number(settings.hourlyRate || 25.0);

  const hybridBaseRate = customRate && record.rates?.hybridBaseRate !== undefined 
    ? Number(record.rates.hybridBaseRate) : Number(settings.hybridBaseRate || 15.0);

  const hybridPieceRate = customRate && record.rates?.hybridPieceRate !== undefined 
    ? Number(record.rates.hybridPieceRate) : Number(settings.hybridPieceRate || 3.0);

  // 计算工时
  let totalHours = 0;
  if (record.shifts && record.shifts.length > 0) {
    totalHours = record.shifts.reduce((acc, cur) => acc + Number(cur.durationHours || 0), 0);
  } else if (record.directHours) {
    totalHours = Number(record.directHours || 0);
  }
  totalHours = Number(totalHours.toFixed(2));

  const orderCount = Math.max(0, parseInt(record.orderCount || 0, 10));
  const allowance = Math.max(0, parseFloat(record.allowance || 0));
  const deduction = Math.max(0, parseFloat(record.deduction || 0));

  let baseWage = 0;
  let formulaText = '';

  if (mode === 'PIECE') {
    baseWage = orderCount * pieceRate;
    formulaText = `送单 ${orderCount}单 × ¥${pieceRate.toFixed(2)}`;
  } else if (mode === 'HOURLY') {
    baseWage = totalHours * hourlyRate;
    formulaText = `工时 ${totalHours.toFixed(2)}h × ¥${hourlyRate.toFixed(2)}`;
  } else if (mode === 'HYBRID') {
    const timeWage = totalHours * hybridBaseRate;
    const pieceWage = orderCount * hybridPieceRate;
    baseWage = timeWage + pieceWage;
    formulaText = `(${totalHours.toFixed(2)}h×¥${hybridBaseRate}) + (${orderCount}单×¥${hybridPieceRate})`;
  }

  if (allowance > 0) formulaText += ` + 补贴¥${allowance}`;
  if (deduction > 0) formulaText += ` - 扣款¥${deduction}`;

  const totalIncome = Math.max(0, Number((baseWage + allowance - deduction).toFixed(2)));

  return {
    mode,
    totalHours,
    orderCount,
    allowance,
    deduction,
    rates: { pieceRate, hourlyRate, hybridBaseRate, hybridPieceRate },
    formulaText,
    totalIncome
  };
}

// ==================== 5. 打卡计时器逻辑 ====================
function initPunchClock() {
  const btnPunch = document.getElementById('btnPunchAction');
  const btnPunchText = document.getElementById('btnPunchActionText');
  const heroTimer = document.getElementById('heroTimerDisplay');
  const heroDot = document.getElementById('heroStatusDot');
  const heroText = document.getElementById('heroStatusText');
  const activeBadge = document.getElementById('activePunchBadge');
  const activeTimerText = document.getElementById('activePunchTimerText');

  function updateTimerUI() {
    if (state.activePunch && state.activePunch.startTime) {
      const now = Date.now();
      const elapsedMs = Math.max(0, now - state.activePunch.startTime);
      const totalSec = Math.floor(elapsedMs / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      const timerStr = `${h}:${m}:${s}`;

      heroTimer.textContent = timerStr;
      activeTimerText.textContent = timerStr;
      activeBadge.classList.remove('hidden');

      heroDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-ping';
      heroText.textContent = `上班中 (${formatTimeHHMM(new Date(state.activePunch.startTime))} 开始)`;
      
      btnPunch.className = 'flex-1 py-3.5 px-6 rounded-2xl font-bold text-base shadow-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white shadow-rose-500/30';
      btnPunchText.textContent = '结束下班打卡';
      
      const icon = btnPunch.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', 'square');
        lucide.createIcons({ root: btnPunch });
      }
    } else {
      heroTimer.textContent = '00:00:00';
      activeBadge.classList.add('hidden');
      heroDot.className = 'w-2 h-2 rounded-full bg-slate-400';
      heroText.textContent = '当前未上班';

      btnPunch.className = 'flex-1 py-3.5 px-6 rounded-2xl font-bold text-base shadow-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 bg-gradient-to-r from-brand-500 to-emerald-400 hover:from-brand-600 hover:to-emerald-500 text-white shadow-brand-500/30';
      btnPunchText.textContent = '开始上班打卡';

      const icon = btnPunch.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', 'play');
        lucide.createIcons({ root: btnPunch });
      }
    }
  }

  // 启动全局秒定时器
  if (state.timerIntervalId) clearInterval(state.timerIntervalId);
  state.timerIntervalId = setInterval(updateTimerUI, 1000);
  updateTimerUI();

  // 点击打卡按钮
  btnPunch.onclick = () => {
    if (state.activePunch) {
      // 结束打卡
      const endTime = new Date();
      const startTime = new Date(state.activePunch.startTime);
      const startStr = formatTimeHHMM(startTime);
      const endStr = formatTimeHHMM(endTime);
      const durationHours = computeTimeDiffHours(startStr, endStr);

      const targetDate = state.activePunch.date || state.currentEditingDate;
      let dayRec = StorageManager.getDayRecord(targetDate) || createEmptyDayRecord(targetDate);
      if (!dayRec.shifts) dayRec.shifts = [];

      dayRec.shifts.push({
        id: 'shift_' + Date.now(),
        startTime: startStr,
        endTime: endStr,
        durationHours: Math.max(0.01, durationHours),
        label: `打卡时段 (${startStr} - ${endStr})`
      });

      StorageManager.saveDayRecord(targetDate, dayRec);
      state.activePunch = null;
      StorageManager.saveActivePunch(null);

      showToast(`下班打卡成功！记录工时 ${durationHours} 小时`, 'success');
      loadRecordForCurrentDate();
      renderCalendar();
      updateTimerUI();
    } else {
      // 开始打卡
      const now = new Date();
      state.activePunch = {
        startTime: now.getTime(),
        date: state.currentEditingDate
      };
      StorageManager.saveActivePunch(state.activePunch);
      showToast(`上班打卡成功：${formatTimeHHMM(now)} 开始计时`, 'success');
      updateTimerUI();
    }
  };
}

function createEmptyDayRecord(dateStr) {
  return {
    date: dateStr,
    mode: state.settings.defaultMode || 'PIECE',
    customRate: false,
    rates: {
      pieceRate: state.settings.pieceRate,
      hourlyRate: state.settings.hourlyRate,
      hybridBaseRate: state.settings.hybridBaseRate,
      hybridPieceRate: state.settings.hybridPieceRate
    },
    shifts: [],
    directHours: 0,
    orderCount: 0,
    allowance: 0,
    deduction: 0,
    note: '',
    totalIncome: 0,
    totalHours: 0
  };
}

// ==================== 6. 今日页面数据绑定与交互 ====================
let currentDayRecordData = null;

function loadRecordForCurrentDate() {
  const dateStr = state.currentEditingDate;
  document.getElementById('inputRecordDate').value = dateStr;
  
  const d = parseYMD(dateStr);
  document.getElementById('headerCurrentDateText').textContent = formatChineseDate(d);

  let record = StorageManager.getDayRecord(dateStr);
  if (!record) {
    record = createEmptyDayRecord(dateStr);
  }
  currentDayRecordData = record;

  // 1. 设置模式
  const mode = record.mode || state.settings.defaultMode || 'PIECE';
  selectPricingModeUI(mode, false);

  // 2. 自定义费率勾选
  const checkCustom = document.getElementById('checkCustomDayMode');
  checkCustom.checked = !!record.customRate;
  toggleCustomRateSection(!!record.customRate);

  // 3. 填充单量、工时、备注、补贴扣款
  document.getElementById('inputOrderCount').value = record.orderCount || 0;
  document.getElementById('inputDirectHours').value = record.directHours !== undefined ? record.directHours : (record.shifts?.reduce((a,b)=>a+b.durationHours, 0) || 0).toFixed(2);
  document.getElementById('inputAllowance').value = record.allowance ? record.allowance : '';
  document.getElementById('inputDeduction').value = record.deduction ? record.deduction : '';
  document.getElementById('inputNote').value = record.note || '';

  // 4. 渲染打卡段列表
  renderShiftsList(record.shifts || []);

  // 5. 刷新计算与显示
  recalculateAndDisplayToday();
}

function selectPricingModeUI(mode, shouldRecalculate = true) {
  if (!currentDayRecordData) return;
  currentDayRecordData.mode = mode;

  // 更新模式按钮样式
  const buttons = document.querySelectorAll('#modeSelectorGroup .mode-btn');
  buttons.forEach(btn => {
    if (btn.dataset.mode === mode) {
      btn.className = 'mode-btn py-2 rounded-lg text-center transition-all bg-white text-brand-700 shadow-sm font-bold';
    } else {
      btn.className = 'mode-btn py-2 rounded-lg text-center transition-all text-slate-600 hover:text-slate-900 font-semibold';
    }
  });

  // 切换对应输入区域可见性
  const secPiece = document.getElementById('secPieceMode');
  const secHourly = document.getElementById('secHourlyMode');
  const secHybrid = document.getElementById('secHybridMode');

  secPiece.classList.add('hidden');
  secHourly.classList.add('hidden');
  secHybrid.classList.add('hidden');

  if (mode === 'PIECE') {
    secPiece.classList.remove('hidden');
  } else if (mode === 'HOURLY') {
    secHourly.classList.remove('hidden');
  } else if (mode === 'HYBRID') {
    secPiece.classList.remove('hidden');
    secHourly.classList.remove('hidden');
    secHybrid.classList.remove('hidden');
  }

  renderCustomOverrideInputs();
  if (shouldRecalculate) recalculateAndDisplayToday();
}

function toggleCustomRateSection(show) {
  const container = document.getElementById('secCustomRateOverride');
  if (show) {
    container.classList.remove('hidden');
    renderCustomOverrideInputs();
  } else {
    container.classList.add('hidden');
  }
  recalculateAndDisplayToday();
}

function renderCustomOverrideInputs() {
  const grid = document.getElementById('overrideInputsGrid');
  if (!currentDayRecordData) return;

  const mode = currentDayRecordData.mode;
  const rates = currentDayRecordData.rates || {};

  let html = '';
  if (mode === 'PIECE') {
    html = `
      <div class="col-span-2">
        <label class="text-[11px] text-slate-500 block mb-1">今日专属计件单价 (元/单)</label>
        <input type="number" id="overridePieceRate" min="0" step="0.1" value="${rates.pieceRate !== undefined ? rates.pieceRate : state.settings.pieceRate}" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800" />
      </div>
    `;
  } else if (mode === 'HOURLY') {
    html = `
      <div class="col-span-2">
        <label class="text-[11px] text-slate-500 block mb-1">今日专属时薪 (元/小时)</label>
        <input type="number" id="overrideHourlyRate" min="0" step="0.5" value="${rates.hourlyRate !== undefined ? rates.hourlyRate : state.settings.hourlyRate}" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800" />
      </div>
    `;
  } else if (mode === 'HYBRID') {
    html = `
      <div>
        <label class="text-[11px] text-slate-500 block mb-1">专属底薪时薪 (元/h)</label>
        <input type="number" id="overrideHybridBaseRate" min="0" step="0.5" value="${rates.hybridBaseRate !== undefined ? rates.hybridBaseRate : state.settings.hybridBaseRate}" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800" />
      </div>
      <div>
        <label class="text-[11px] text-slate-500 block mb-1">专属每单提成 (元/单)</label>
        <input type="number" id="overrideHybridPieceRate" min="0" step="0.1" value="${rates.hybridPieceRate !== undefined ? rates.hybridPieceRate : state.settings.hybridPieceRate}" class="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800" />
      </div>
    `;
  }

  grid.innerHTML = html;

  // 绑定事件
  grid.querySelectorAll('input').forEach(input => {
    input.oninput = () => {
      syncOverridesToCurrentRecord();
      recalculateAndDisplayToday();
    };
  });
}

function syncOverridesToCurrentRecord() {
  if (!currentDayRecordData) return;
  if (!currentDayRecordData.rates) currentDayRecordData.rates = {};

  const p = document.getElementById('overridePieceRate');
  const h = document.getElementById('overrideHourlyRate');
  const hb = document.getElementById('overrideHybridBaseRate');
  const hp = document.getElementById('overrideHybridPieceRate');

  if (p) currentDayRecordData.rates.pieceRate = parseFloat(p.value) || 0;
  if (h) currentDayRecordData.rates.hourlyRate = parseFloat(h.value) || 0;
  if (hb) currentDayRecordData.rates.hybridBaseRate = parseFloat(hb.value) || 0;
  if (hp) currentDayRecordData.rates.hybridPieceRate = parseFloat(hp.value) || 0;
}

function renderShiftsList(shifts) {
  const container = document.getElementById('shiftsListContainer');
  const summaryHours = document.getElementById('shiftsSummaryHours');
  const badge = document.getElementById('shiftCountBadge');

  badge.textContent = `${shifts.length}段`;
  const total = shifts.reduce((acc, cur) => acc + Number(cur.durationHours || 0), 0);
  summaryHours.textContent = total.toFixed(2);
  document.getElementById('heroTotalHours').textContent = total.toFixed(2);

  if (shifts.length === 0) {
    container.innerHTML = `
      <div id="shiftsEmptyState" class="py-4 text-center text-xs text-slate-400 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
        暂无打卡记录，点击上方按钮打卡或手动补录
      </div>
    `;
    return;
  }

  let html = '';
  shifts.forEach((shift, index) => {
    html += `
      <div class="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/80 text-xs transition-colors">
        <div class="flex items-center space-x-2">
          <div class="w-6 h-6 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-[10px]">
            ${index + 1}
          </div>
          <div>
            <div class="font-bold text-slate-800 flex items-center gap-1">
              <span>${shift.startTime} - ${shift.endTime}</span>
              ${shift.label ? `<span class="text-[10px] text-slate-400 font-normal">(${shift.label})</span>` : ''}
            </div>
            <div class="text-[11px] text-brand-600 font-medium font-mono">${shift.durationHours.toFixed(2)} 小时</div>
          </div>
        </div>
        <div class="flex items-center space-x-1">
          <button type="button" class="btn-edit-shift p-1.5 text-slate-400 hover:text-brand-600 active:scale-95" data-index="${index}">
            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
          </button>
          <button type="button" class="btn-delete-shift p-1.5 text-slate-400 hover:text-rose-600 active:scale-95" data-index="${index}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons({ root: container });

  // 绑定编辑与删除事件
  container.querySelectorAll('.btn-edit-shift').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openShiftEditModal(parseInt(btn.dataset.index, 10));
    };
  });

  container.querySelectorAll('.btn-delete-shift').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      currentDayRecordData.shifts.splice(idx, 1);
      renderShiftsList(currentDayRecordData.shifts);
      recalculateAndDisplayToday();
    };
  });
}

function recalculateAndDisplayToday() {
  if (!currentDayRecordData) return;

  // 搜集当前表单数据
  const isCustom = document.getElementById('checkCustomDayMode').checked;
  currentDayRecordData.customRate = isCustom;

  if (isCustom) {
    syncOverridesToCurrentRecord();
  }

  currentDayRecordData.orderCount = parseInt(document.getElementById('inputOrderCount').value, 10) || 0;
  currentDayRecordData.allowance = parseFloat(document.getElementById('inputAllowance').value) || 0;
  currentDayRecordData.deduction = parseFloat(document.getElementById('inputDeduction').value) || 0;
  currentDayRecordData.note = document.getElementById('inputNote').value.trim();

  // 更新费率标签展示
  const pieceRateVal = (isCustom && currentDayRecordData.rates?.pieceRate !== undefined) ? currentDayRecordData.rates.pieceRate : state.settings.pieceRate;
  const hourlyRateVal = (isCustom && currentDayRecordData.rates?.hourlyRate !== undefined) ? currentDayRecordData.rates.hourlyRate : state.settings.hourlyRate;
  const hybridBaseVal = (isCustom && currentDayRecordData.rates?.hybridBaseRate !== undefined) ? currentDayRecordData.rates.hybridBaseRate : state.settings.hybridBaseRate;
  const hybridPieceVal = (isCustom && currentDayRecordData.rates?.hybridPieceRate !== undefined) ? currentDayRecordData.rates.hybridPieceRate : state.settings.hybridPieceRate;

  document.getElementById('lblPieceRate').textContent = `¥${Number(pieceRateVal).toFixed(2)}`;
  document.getElementById('lblHourlyRate').textContent = `¥${Number(hourlyRateVal).toFixed(2)}`;
  document.getElementById('lblHybridBaseRate').textContent = `¥${Number(hybridBaseVal).toFixed(2)}`;
  document.getElementById('lblHybridPieceRate').textContent = `¥${Number(hybridPieceVal).toFixed(2)}`;

  // 计算今日结果
  const calcResult = calculateDayIncome(currentDayRecordData, state.settings);
  currentDayRecordData.totalIncome = calcResult.totalIncome;
  currentDayRecordData.totalHours = calcResult.totalHours;

  document.getElementById('lblTodayTotalIncome').textContent = `¥${calcResult.totalIncome.toFixed(2)}`;
  document.getElementById('lblIncomeFormula').textContent = calcResult.formulaText;
}

// ==================== 7. 手动补录工时弹窗 ====================
function openShiftEditModal(shiftIndex = -1) {
  state.editingShiftIndex = shiftIndex;
  const modal = document.getElementById('modalShiftEdit');
  const title = document.getElementById('modalShiftTitle');
  const btnDelete = document.getElementById('btnDeleteCurrentShift');
  const inputStart = document.getElementById('modalShiftStartTime');
  const inputEnd = document.getElementById('modalShiftEndTime');
  const inputDirect = document.getElementById('modalShiftDirectHours');
  const inputLabel = document.getElementById('modalShiftLabel');

  if (shiftIndex >= 0 && currentDayRecordData?.shifts?.[shiftIndex]) {
    const shift = currentDayRecordData.shifts[shiftIndex];
    title.textContent = '编辑工时段';
    btnDelete.classList.remove('hidden');
    inputStart.value = shift.startTime || '09:00';
    inputEnd.value = shift.endTime || '12:30';
    inputDirect.value = shift.durationHours || '';
    inputLabel.value = shift.label || '';
  } else {
    title.textContent = '补录新工时段';
    btnDelete.classList.add('hidden');
    inputStart.value = '09:00';
    inputEnd.value = '12:30';
    inputDirect.value = '';
    inputLabel.value = '';
  }

  updateModalShiftDurationText();
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modal.querySelector('.transform').classList.remove('translate-y-full');
  }, 10);
}

function closeShiftEditModal() {
  const modal = document.getElementById('modalShiftEdit');
  modal.classList.add('opacity-0');
  modal.querySelector('.transform').classList.add('translate-y-full');
  setTimeout(() => {
    modal.classList.add('hidden');
    state.editingShiftIndex = -1;
  }, 200);
}

function updateModalShiftDurationText() {
  const start = document.getElementById('modalShiftStartTime').value;
  const end = document.getElementById('modalShiftEndTime').value;
  const direct = parseFloat(document.getElementById('modalShiftDirectHours').value);
  const textEl = document.getElementById('modalShiftDurationText');

  if (!isNaN(direct) && direct > 0) {
    textEl.textContent = `${direct.toFixed(2)} 小时 (直接指定)`;
  } else {
    const hours = computeTimeDiffHours(start, end);
    textEl.textContent = `${hours.toFixed(2)} 小时`;
  }
}

// ==================== 8. 月度日历与看板渲染 ====================
function renderCalendar() {
  const viewDate = state.calendarViewDate;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-11

  // 标题
  document.getElementById('currentCalendarMonthLabel').textContent = `${year}年 ${month + 1}月`;
  document.getElementById('monthStatsTitle').textContent = `${year}年${month + 1}月 累计总览`;

  const grid = document.getElementById('calendarGridDays');
  grid.innerHTML = '';

  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 for Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const allRecords = StorageManager.getAllRecords();

  const todayStr = formatDateToYMD(new Date());

  // 月度聚合累加器
  let monthTotalIncome = 0;
  let monthTotalHours = 0;
  let monthTotalOrders = 0;
  let monthWorkDays = 0;

  // 填充月初空白天数
  for (let i = 0; i < firstDayOfWeek; i++) {
    const blank = document.createElement('div');
    blank.className = 'calendar-day-cell rounded-xl p-1 bg-slate-50/40 border border-transparent';
    grid.appendChild(blank);
  }

  // 渲染当月每一天
  for (let day = 1; day <= daysInMonth; day++) {
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateKey = `${year}-${mStr}-${dStr}`;

    const record = allRecords[dateKey];
    let hasWork = false;
    let income = 0;
    let hours = 0;
    let orders = 0;

    if (record) {
      const calc = calculateDayIncome(record, state.settings);
      income = calc.totalIncome;
      hours = calc.totalHours;
      orders = calc.orderCount;

      if (hours > 0 || orders > 0 || income > 0) {
        hasWork = true;
        monthWorkDays++;
        monthTotalIncome += income;
        monthTotalHours += hours;
        monthTotalOrders += orders;
      }
    }

    const isToday = (dateKey === todayStr);

    const cell = document.createElement('div');
    cell.className = `calendar-day-cell rounded-2xl p-1 flex flex-col justify-between cursor-pointer border transition-all ${
      isToday ? 'border-amber-400 bg-amber-50/40 shadow-sm' : (hasWork ? 'border-brand-200 bg-brand-50/50 hover:bg-brand-100/50' : 'border-slate-100 bg-white hover:bg-slate-50')
    }`;

    cell.innerHTML = `
      <div class="flex items-center justify-between w-full px-0.5">
        <span class="text-xs font-bold ${isToday ? 'text-amber-700 bg-amber-200/80 px-1 rounded' : (hasWork ? 'text-brand-900' : 'text-slate-700')}">${day}</span>
        ${hasWork ? `<span class="w-1.5 h-1.5 rounded-full bg-brand-500"></span>` : ''}
      </div>
      <div class="text-[9px] font-mono leading-tight truncate px-0.5">
        ${hasWork ? `
          <div class="font-bold text-brand-700 truncate">¥${Math.round(income)}</div>
          <div class="text-slate-500 scale-90 -ml-1">${hours > 0 ? hours + 'h' : ''} ${orders > 0 ? orders + '单' : ''}</div>
        ` : `<div class="text-slate-300 text-[10px]">-</div>`}
      </div>
    `;

    cell.onclick = () => openDayDetailModal(dateKey, record);
    grid.appendChild(cell);
  }

  // 渲染月度总看板数据
  document.getElementById('lblMonthTotalIncome').textContent = `¥${monthTotalIncome.toFixed(2)}`;
  document.getElementById('lblMonthTotalHours').innerHTML = `${monthTotalHours.toFixed(2)} <span class="text-xs font-normal text-slate-400">h</span>`;
  document.getElementById('lblMonthTotalOrders').innerHTML = `${monthTotalOrders} <span class="text-xs font-normal text-slate-400">单</span>`;
  document.getElementById('monthWorkDaysBadge').textContent = `出工 ${monthWorkDays} 天`;

  const avgHourly = monthTotalHours > 0 ? (monthTotalIncome / monthTotalHours) : 0;
  const avgDaily = monthWorkDays > 0 ? (monthTotalIncome / monthWorkDays) : 0;

  document.getElementById('lblMonthAvgHourly').innerHTML = `¥${avgHourly.toFixed(2)} <span class="text-[10px] font-normal text-slate-400">/h</span>`;
  document.getElementById('lblMonthAvgDaily').innerHTML = `¥${avgDaily.toFixed(2)} <span class="text-[10px] font-normal text-slate-400">/天</span>`;
}

// ==================== 9. 日历点击日期详情抽屉 ====================
let selectedModalDateStr = null;

function openDayDetailModal(dateStr, record) {
  selectedModalDateStr = dateStr;
  const modal = document.getElementById('modalDayDetail');
  const d = parseYMD(dateStr);

  document.getElementById('dayDetailTitle').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 记工详情`;
  document.getElementById('dayDetailSubtitle').textContent = formatChineseDate(d);

  const calc = record ? calculateDayIncome(record, state.settings) : { totalIncome: 0, totalHours: 0, orderCount: 0, formulaText: '无记工数据' };

  document.getElementById('dayDetailIncome').textContent = `¥${calc.totalIncome.toFixed(2)}`;
  document.getElementById('dayDetailHours').textContent = `${calc.totalHours.toFixed(2)}h`;
  document.getElementById('dayDetailOrders').textContent = `${calc.orderCount}单`;

  // 打卡时段列表
  const shiftsContainer = document.getElementById('dayDetailShiftsList');
  if (record && record.shifts && record.shifts.length > 0) {
    shiftsContainer.innerHTML = record.shifts.map((s, idx) => `
      <div class="p-2 bg-slate-50 rounded-xl flex items-center justify-between border border-slate-100">
        <span class="font-medium text-slate-700">时段 ${idx + 1}: ${s.startTime} - ${s.endTime} ${s.label ? `(${s.label})` : ''}</span>
        <span class="font-bold text-brand-600 font-mono">${s.durationHours}h</span>
      </div>
    `).join('');
  } else {
    shiftsContainer.innerHTML = `<div class="text-slate-400 py-1">无打卡时段明细</div>`;
  }

  // Meta Box
  const metaBox = document.getElementById('dayDetailMetaBox');
  const modeName = calc.mode === 'PIECE' ? '计件模式' : (calc.mode === 'HOURLY' ? '时薪模式' : '底薪+提成模式');
  metaBox.innerHTML = `
    <div><strong>结算模式:</strong> ${modeName} ${record?.customRate ? '<span class="text-amber-600">(自定义费率)</span>' : ''}</div>
    <div><strong>计算公式:</strong> ${calc.formulaText}</div>
    ${record?.allowance ? `<div><strong>补贴金额:</strong> ¥${record.allowance}</div>` : ''}
    ${record?.deduction ? `<div><strong>扣款扣罚:</strong> ¥${record.deduction}</div>` : ''}
    ${record?.note ? `<div><strong>工作备注:</strong> ${record.note}</div>` : '<div><strong>工作备注:</strong> 无</div>'}
  `;

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    modal.querySelector('.transform').classList.remove('translate-y-full');
  }, 10);
}

function closeDayDetailModal() {
  const modal = document.getElementById('modalDayDetail');
  modal.classList.add('opacity-0');
  modal.querySelector('.transform').classList.add('translate-y-full');
  setTimeout(() => {
    modal.classList.add('hidden');
    selectedModalDateStr = null;
  }, 200);
}

// ==================== 10. 数据导入与导出 (CSV / JSON) ====================
function exportCsv(isFullHistory = false) {
  const allRecords = StorageManager.getAllRecords();
  const dates = Object.keys(allRecords).sort();

  if (dates.length === 0) {
    showToast('暂无任何记工数据可供导出', 'error');
    return;
  }

  const currentYear = state.calendarViewDate.getFullYear();
  const currentMonthStr = String(state.calendarViewDate.getMonth() + 1).padStart(2, '0');
  const monthPrefix = `${currentYear}-${currentMonthStr}`;

  const targetDates = isFullHistory 
    ? dates 
    : dates.filter(d => d.startsWith(monthPrefix));

  if (targetDates.length === 0) {
    showToast(`当前月份 (${currentYear}年${currentMonthStr}月) 无记工数据`, 'error');
    return;
  }

  // CSV 表头
  let csvContent = '\uFEFF日期,星期,计费模式,总工时(h),送单量(单),单价/费率(元),补贴(元),扣款(元),当天总收入(元),打卡时段详情,备注\n';

  const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];

  targetDates.forEach(dateStr => {
    const rec = allRecords[dateStr];
    const calc = calculateDayIncome(rec, state.settings);
    const d = parseYMD(dateStr);
    const weekDay = '星期' + weekDayNames[d.getDay()];

    const modeName = calc.mode === 'PIECE' ? '计件' : (calc.mode === 'HOURLY' ? '时薪' : '底薪+提成');
    
    let rateDetail = '';
    if (calc.mode === 'PIECE') rateDetail = `计件¥${calc.rates.pieceRate}/单`;
    else if (calc.mode === 'HOURLY') rateDetail = `时薪¥${calc.rates.hourlyRate}/h`;
    else rateDetail = `底薪¥${calc.rates.hybridBaseRate}+提成¥${calc.rates.hybridPieceRate}`;

    const shiftsStr = (rec.shifts || []).map(s => `[${s.startTime}-${s.endTime} ${s.durationHours}h]`).join(' ') || '无';
    const noteClean = (rec.note || '').replace(/,/g, '，').replace(/\n/g, ' ');

    csvContent += `"${dateStr}","${weekDay}","${modeName}",${calc.totalHours},${calc.orderCount},"${rateDetail}",${calc.allowance},${calc.deduction},${calc.totalIncome},"${shiftsStr}","${noteClean}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const filename = isFullHistory ? `全部记工记录备份_${formatDateToYMD(new Date())}.csv` : `记工报表_${monthPrefix}.csv`;

  downloadBlob(blob, filename);
  showToast(`已成功导出表格: ${filename}`, 'success');
}

function exportJsonBackup() {
  const backupData = {
    version: '1.0.0',
    exportTime: new Date().toISOString(),
    settings: StorageManager.getSettings(),
    records: StorageManager.getAllRecords()
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const filename = `工时记工助手完整备份_${formatDateToYMD(new Date())}.json`;
  downloadBlob(blob, filename);
  showToast('数据备份导出成功！', 'success');
}

function importJsonBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.records) {
        StorageManager.saveAllRecords(data.records);
        if (data.settings) StorageManager.saveSettings(data.settings);
        state.settings = StorageManager.getSettings();
        
        showToast('数据恢复成功！', 'success');
        loadRecordForCurrentDate();
        renderCalendar();
        loadSettingsUI();
      } else {
        showToast('无效的备份文件格式', 'error');
      }
    } catch (err) {
      showToast('解析JSON备份文件失败', 'error');
    }
  };
  reader.readAsText(file);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function generateDemoData() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const records = StorageManager.getAllRecords();

  for (let d = 1; d <= 28; d += 2) {
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    const dateKey = `${year}-${mStr}-${dStr}`;

    const isPiece = (d % 4 === 1);
    const orderCount = isPiece ? 20 + Math.floor(Math.random() * 15) : 0;
    const hours = isPiece ? 4.5 : 6.0;

    const rec = {
      date: dateKey,
      mode: isPiece ? 'PIECE' : 'HOURLY',
      customRate: false,
      rates: { ...state.settings },
      shifts: [
        { id: 's1', startTime: '09:00', endTime: '12:00', durationHours: 3.0, label: '早班' },
        { id: 's2', startTime: '14:00', endTime: isPiece ? '15:30' : '17:00', durationHours: isPiece ? 1.5 : 3.0, label: '下午班' }
      ],
      directHours: hours,
      orderCount: orderCount,
      allowance: d % 6 === 1 ? 15 : 0,
      deduction: 0,
      note: isPiece ? '午高峰外卖跑单' : '门店营业兼职',
      totalIncome: 0,
      totalHours: hours
    };

    const calc = calculateDayIncome(rec, state.settings);
    rec.totalIncome = calc.totalIncome;
    rec.totalHours = calc.totalHours;

    records[dateKey] = rec;
  }

  StorageManager.saveAllRecords(records);
  showToast('已载入本月测试示例数据！', 'success');
  renderCalendar();
  loadRecordForCurrentDate();
}

// ==================== 11. 图标与头像个性化定制管理 ====================
const PRESET_ICONS = [
  {
    id: 'preset_rider',
    name: '外卖骑士',
    bgColor: '#0284c7',
    emoji: '🛵'
  },
  {
    id: 'preset_gold',
    name: '招财金币',
    bgColor: '#d97706',
    emoji: '💰'
  },
  {
    id: 'preset_clock',
    name: '工时沙漏',
    bgColor: '#7c3aed',
    emoji: '⏱️'
  },
  {
    id: 'preset_cat',
    name: '幸运招财猫',
    bgColor: '#db2777',
    emoji: '🐱'
  },
  {
    id: 'preset_anime',
    name: '二次元萌系',
    bgColor: '#ec4899',
    emoji: '🌸'
  }
];

class IconManager {
  static getCustomIcon() {
    return localStorage.getItem(STORAGE_KEYS.CUSTOM_ICON) || null;
  }

  static saveCustomIcon(dataUrl) {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_ICON, dataUrl);
      this.applyIconToDOM(dataUrl);
      return true;
    } catch (e) {
      console.error('Save icon error', e);
      return false;
    }
  }

  static resetToDefault() {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_ICON);
    this.applyIconToDOM(null);
  }

  static applyIconToDOM(dataUrl) {
    const headerImg = document.getElementById('headerCustomIconImg');
    const headerDefault = document.getElementById('headerDefaultIcon');
    const settingsImg = document.getElementById('settingsCustomIconImg');
    const settingsDefault = document.getElementById('settingsDefaultIcon');

    if (dataUrl) {
      if (headerImg) {
        headerImg.src = dataUrl;
        headerImg.classList.remove('hidden');
      }
      if (headerDefault) headerDefault.classList.add('hidden');

      if (settingsImg) {
        settingsImg.src = dataUrl;
        settingsImg.classList.remove('hidden');
      }
      if (settingsDefault) settingsDefault.classList.add('hidden');

      // 动态更新页面 favicon 与 apple-touch-icon
      let fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = dataUrl;
      let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = dataUrl;
    } else {
      if (headerImg) headerImg.classList.add('hidden');
      if (headerDefault) headerDefault.classList.remove('hidden');

      if (settingsImg) settingsImg.classList.add('hidden');
      if (settingsDefault) settingsDefault.classList.remove('hidden');

      let fav = document.querySelector('link[rel="icon"]');
      if (fav) fav.href = 'icon.svg';
      let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = 'icon-192.png';
    }
  }

  static async processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // 在 512x512 canvas 上居中裁剪为正方形高清图标
          const canvas = document.createElement('canvas');
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext('2d');

          // 圆角裁切
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;

          ctx.drawImage(img, sx, sy, size, size, 0, 0, 512, 512);
          const dataUrl = canvas.toDataURL('image/png', 0.92);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  static createPresetDataUrl(preset) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // 渐变底色
    ctx.fillStyle = preset.bgColor;
    ctx.beginPath();
    ctx.arc(256, 256, 256, 0, Math.PI * 2);
    ctx.fill();

    // 绘制 Emoji
    ctx.font = '240px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(preset.emoji, 256, 270);

    return canvas.toDataURL('image/png');
  }

  static renderPresetGrid() {
    const container = document.getElementById('presetIconGrid');
    if (!container) return;

    container.innerHTML = PRESET_ICONS.map(p => `
      <button type="button" class="btn-select-preset flex flex-col items-center gap-1 p-1.5 rounded-xl border border-slate-200 hover:border-brand-500 bg-slate-50 active:scale-95 transition-all" data-id="${p.id}">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-sm" style="background-color: ${p.bgColor}; color: white;">
          ${p.emoji}
        </div>
        <span class="text-[10px] font-medium text-slate-600 truncate w-full text-center">${p.name}</span>
      </button>
    `).join('');

    container.querySelectorAll('.btn-select-preset').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const preset = PRESET_ICONS.find(item => item.id === id);
        if (preset) {
          const dataUrl = IconManager.createPresetDataUrl(preset);
          IconManager.saveCustomIcon(dataUrl);
          showToast(`已更换图标为: ${preset.name}`, 'success');
        }
      };
    });
  }

  static downloadIconPack() {
    const currentIcon = this.getCustomIcon();
    const img = new Image();
    img.onload = () => {
      // 导出 512x512
      const canvas512 = document.createElement('canvas');
      canvas512.width = 512;
      canvas512.height = 512;
      canvas512.getContext('2d').drawImage(img, 0, 0, 512, 512);
      canvas512.toBlob(blob => {
        downloadBlob(blob, 'icon-512.png');
      });

      // 导出 192x192
      setTimeout(() => {
        const canvas192 = document.createElement('canvas');
        canvas192.width = 192;
        canvas192.height = 192;
        canvas192.getContext('2d').drawImage(img, 0, 0, 192, 192);
        canvas192.toBlob(blob => {
          downloadBlob(blob, 'icon-192.png');
          showToast('已导出 512 与 192 尺寸的图标 PNG 文件！', 'success');
        });
      }, 300);
    };
    img.src = currentIcon || 'icon-512.png';
  }
}

// ==================== 12. 设置面板数据绑定 ====================
function loadSettingsUI() {
  const s = state.settings;
  document.getElementById('cfgDefaultMode').value = s.defaultMode || 'PIECE';
  document.getElementById('cfgPieceRate').value = s.pieceRate || 5.0;
  document.getElementById('cfgHourlyRate').value = s.hourlyRate || 25.0;
  document.getElementById('cfgHybridBaseRate').value = s.hybridBaseRate || 15.0;
  document.getElementById('cfgHybridPieceRate').value = s.hybridPieceRate || 3.0;

  IconManager.applyIconToDOM(IconManager.getCustomIcon());
  IconManager.renderPresetGrid();
}

// ==================== 12. 事件绑定与初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  // Lucide 图标初始化
  lucide.createIcons();

  // 1. 初始化打卡器
  initPunchClock();

  // 2. Tab 切换逻辑
  const navTabs = document.querySelectorAll('.nav-tab-btn');
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;
      state.currentTab = targetId;

      // 切换Tab高亮
      navTabs.forEach(t => {
        t.className = 'nav-tab-btn flex flex-col items-center justify-center py-1 rounded-xl text-slate-400 hover:text-slate-700 transition-colors';
      });
      tab.className = 'nav-tab-btn active flex flex-col items-center justify-center py-1 rounded-xl text-brand-600 transition-colors font-bold';

      // 切换视图容器
      ['tabToday', 'tabCalendar', 'tabSettings'].forEach(id => {
        const el = document.getElementById(id);
        if (id === targetId) {
          el.classList.remove('hidden');
          el.classList.add('active-tab-section');
        } else {
          el.classList.add('hidden');
          el.classList.remove('active-tab-section');
        }
      });

      if (targetId === 'tabCalendar') {
        renderCalendar();
      } else if (targetId === 'tabSettings') {
        loadSettingsUI();
      }
    });
  });

  // 3. 首页日期选择器
  const dateInput = document.getElementById('inputRecordDate');
  dateInput.value = state.currentEditingDate;
  dateInput.onchange = () => {
    if (dateInput.value) {
      state.currentEditingDate = dateInput.value;
      loadRecordForCurrentDate();
    }
  };

  document.getElementById('btnTodayQuickJump').onclick = () => {
    state.currentEditingDate = formatDateToYMD(new Date());
    loadRecordForCurrentDate();
    showToast('已跳转至今日', 'info');
  };

  // 4. 模式切换按钮
  document.querySelectorAll('#modeSelectorGroup .mode-btn').forEach(btn => {
    btn.onclick = () => {
      selectPricingModeUI(btn.dataset.mode, true);
    };
  });

  // 5. 快速加减单量按钮
  document.querySelectorAll('.quick-order-btn').forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById('inputOrderCount');
      let currentVal = parseInt(input.value, 10) || 0;
      const delta = btn.dataset.delta;
      if (delta === 'RESET') {
        currentVal = 0;
      } else {
        currentVal = Math.max(0, currentVal + parseInt(delta, 10));
      }
      input.value = currentVal;
      recalculateAndDisplayToday();
    };
  });

  // 6. 输入框输入实时重算
  ['inputOrderCount', 'inputDirectHours', 'inputAllowance', 'inputDeduction', 'inputNote'].forEach(id => {
    document.getElementById(id).addEventListener('input', recalculateAndDisplayToday);
  });

  document.getElementById('checkCustomDayMode').onchange = (e) => {
    toggleCustomRateSection(e.target.checked);
  };

  // 从打卡同步工时按钮
  document.getElementById('btnSyncShiftsToDirectHours').onclick = () => {
    if (currentDayRecordData?.shifts) {
      const total = currentDayRecordData.shifts.reduce((a,b)=>a+Number(b.durationHours||0),0);
      document.getElementById('inputDirectHours').value = total.toFixed(2);
      recalculateAndDisplayToday();
      showToast(`已同步工时: ${total.toFixed(2)} 小时`, 'success');
    }
  };

  // 保存今日数据按钮
  document.getElementById('btnSaveTodayRecord').onclick = () => {
    recalculateAndDisplayToday();
    StorageManager.saveDayRecord(state.currentEditingDate, currentDayRecordData);
    showToast('今日记工数据已成功保存！', 'success');
    renderCalendar();
  };

  // 7. 手动补录工时弹窗事件
  document.getElementById('btnAddManualShift').onclick = () => openShiftEditModal(-1);
  document.getElementById('btnCloseShiftModal').onclick = closeShiftEditModal;

  ['modalShiftStartTime', 'modalShiftEndTime', 'modalShiftDirectHours'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateModalShiftDurationText);
  });

  document.getElementById('btnSaveShiftEntry').onclick = () => {
    const startTime = document.getElementById('modalShiftStartTime').value;
    const endTime = document.getElementById('modalShiftEndTime').value;
    const directHours = parseFloat(document.getElementById('modalShiftDirectHours').value);
    const label = document.getElementById('modalShiftLabel').value.trim();

    const duration = (!isNaN(directHours) && directHours > 0) 
      ? directHours 
      : computeTimeDiffHours(startTime, endTime);

    if (duration <= 0) {
      showToast('工时时长必须大于0', 'error');
      return;
    }

    if (!currentDayRecordData.shifts) currentDayRecordData.shifts = [];

    const newShift = {
      id: 'shift_' + Date.now(),
      startTime,
      endTime,
      durationHours: Number(duration.toFixed(2)),
      label
    };

    if (state.editingShiftIndex >= 0) {
      currentDayRecordData.shifts[state.editingShiftIndex] = newShift;
    } else {
      currentDayRecordData.shifts.push(newShift);
    }

    renderShiftsList(currentDayRecordData.shifts);
    recalculateAndDisplayToday();
    closeShiftEditModal();
    showToast('工时段已保存', 'success');
  };

  document.getElementById('btnDeleteCurrentShift').onclick = () => {
    if (state.editingShiftIndex >= 0) {
      currentDayRecordData.shifts.splice(state.editingShiftIndex, 1);
      renderShiftsList(currentDayRecordData.shifts);
      recalculateAndDisplayToday();
      closeShiftEditModal();
      showToast('工时段已删除', 'info');
    }
  };

  // 8. 月历导航按钮
  document.getElementById('btnPrevMonth').onclick = () => {
    state.calendarViewDate.setMonth(state.calendarViewDate.getMonth() - 1);
    renderCalendar();
  };

  document.getElementById('btnNextMonth').onclick = () => {
    state.calendarViewDate.setMonth(state.calendarViewDate.getMonth() + 1);
    renderCalendar();
  };

  document.getElementById('btnMonthPickerHeader').onclick = () => {
    state.calendarViewDate = new Date();
    renderCalendar();
    showToast('已返回当月', 'info');
  };

  // 9. 日历详情弹窗与操作
  document.getElementById('btnCloseDayDetailModal').onclick = closeDayDetailModal;
  
  document.getElementById('btnEditDayInHomeTab').onclick = () => {
    if (selectedModalDateStr) {
      state.currentEditingDate = selectedModalDateStr;
      closeDayDetailModal();
      // 切换回首页
      document.querySelector('.nav-tab-btn[data-target="tabToday"]').click();
      loadRecordForCurrentDate();
    }
  };

  document.getElementById('btnDeleteDayRecord').onclick = () => {
    if (selectedModalDateStr && confirm(`确定要删除 ${selectedModalDateStr} 的记工数据吗？`)) {
      StorageManager.deleteDayRecord(selectedModalDateStr);
      closeDayDetailModal();
      showToast('记工数据已删除', 'info');
      renderCalendar();
      if (state.currentEditingDate === selectedModalDateStr) {
        loadRecordForCurrentDate();
      }
    }
  };

  // 10. 报表导出与备份事件
  document.getElementById('btnExportMonthCsv').onclick = () => exportCsv(false);
  document.getElementById('btnExportFullCsv').onclick = () => exportCsv(true);
  document.getElementById('btnExportAllJson').onclick = exportJsonBackup;

  document.getElementById('inputFileImportJson').onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      importJsonBackup(e.target.files[0]);
      e.target.value = '';
    }
  };

  document.getElementById('btnLoadDemoData').onclick = () => {
    if (confirm('载入示例演示数据将填充本月的多天打卡记工，确定载入吗？')) {
      generateDemoData();
    }
  };

  document.getElementById('btnClearAllData').onclick = () => {
    if (confirm('危险操作：确定要清空所有本地记工记录吗？此操作无法撤销！')) {
      localStorage.removeItem(STORAGE_KEYS.RECORDS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PUNCH);
      state.activePunch = null;
      showToast('所有数据已清空', 'info');
      loadRecordForCurrentDate();
      renderCalendar();
    }
  };

  // 11. 设置保存
  document.getElementById('btnSaveConfig').onclick = () => {
    const newSettings = {
      defaultMode: document.getElementById('cfgDefaultMode').value,
      pieceRate: parseFloat(document.getElementById('cfgPieceRate').value) || 5.0,
      hourlyRate: parseFloat(document.getElementById('cfgHourlyRate').value) || 25.0,
      hybridBaseRate: parseFloat(document.getElementById('cfgHybridBaseRate').value) || 15.0,
      hybridPieceRate: parseFloat(document.getElementById('cfgHybridPieceRate').value) || 3.0
    };
    StorageManager.saveSettings(newSettings);
    state.settings = newSettings;
    showToast('全局计价标准已更新保存！', 'success');
    loadRecordForCurrentDate();
    renderCalendar();
  };

  // 12. 图标定制上传与导出事件
  const handleUploadIcon = async (file) => {
    if (!file) return;
    try {
      showToast('正在处理并裁剪图片...', 'info');
      const dataUrl = await IconManager.processImageFile(file);
      IconManager.saveCustomIcon(dataUrl);
      showToast('App 图标与头像更换成功！', 'success');
    } catch (err) {
      showToast('图片读取失败，请重试', 'error');
    }
  };

  const inputIcon1 = document.getElementById('inputUploadCustomIcon');
  if (inputIcon1) {
    inputIcon1.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadIcon(e.target.files[0]);
        e.target.value = '';
      }
    };
  }

  const inputIcon2 = document.getElementById('inputUploadCustomIconBtn');
  if (inputIcon2) {
    inputIcon2.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadIcon(e.target.files[0]);
        e.target.value = '';
      }
    };
  }

  const btnResetIcon = document.getElementById('btnResetAppIcon');
  if (btnResetIcon) {
    btnResetIcon.onclick = () => {
      IconManager.resetToDefault();
      showToast('已恢复为默认图标', 'info');
    };
  }

  const btnDownloadPack = document.getElementById('btnDownloadIconPack');
  if (btnDownloadPack) {
    btnDownloadPack.onclick = () => {
      IconManager.downloadIconPack();
    };
  }

  // 初始化加载当前数据与图标
  loadRecordForCurrentDate();
  renderCalendar();
  loadSettingsUI();
  IconManager.applyIconToDOM(IconManager.getCustomIcon());
});

// ==================== 13. PWA 安装与 Service Worker 注册 ====================
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btnInstall = document.getElementById('btnPwaInstall');
  if (btnInstall) {
    btnInstall.classList.remove('hidden');
    btnInstall.onclick = async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('感谢安装记工助手！', 'success');
        }
        btnInstall.classList.add('hidden');
        deferredInstallPrompt = null;
      }
    };
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}
