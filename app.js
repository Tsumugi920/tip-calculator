/* 小费计算器：实时计算 + localStorage 持久化 + JSON 导入导出（纯前端，无依赖） */
(() => {
  "use strict";

  const STORAGE_KEY = "tip-calculator:v1";
  const ROUNDINGS = ["none", "total-nearest", "person-nearest", "person-up"];
  const DEFAULT_STATE = { bill: "", tipPercent: 15, people: 2, rounding: "none" };

  const SAMPLE_BILLS = [
    {
      id: "sample-1",
      name: "示例 · 朋友聚餐",
      bill: 386.5,
      tipPercent: 15,
      people: 4,
      rounding: "none",
      createdAt: "2026-09-12T19:30:00+08:00",
      sample: true,
    },
    {
      id: "sample-2",
      name: "示例 · 咖啡小聚",
      bill: 68,
      tipPercent: 18,
      people: 2,
      rounding: "person-up",
      createdAt: "2026-10-02T15:10:00+08:00",
      sample: true,
    },
    {
      id: "sample-3",
      name: "示例 · 部门庆功宴",
      bill: 512,
      tipPercent: 20,
      people: 6,
      rounding: "total-nearest",
      createdAt: "2026-10-18T20:05:00+08:00",
      sample: true,
    },
  ];

  const $ = (id) => document.getElementById(id);

  const els = {
    bill: $("bill"),
    tip: $("tip"),
    tipRange: $("tip-range"),
    people: $("people"),
    peopleMinus: $("people-minus"),
    peoplePlus: $("people-plus"),
    rounding: $("rounding"),
    chips: $("tip-chips"),
    perPerson: $("per-person"),
    tipAmount: $("tip-amount"),
    total: $("total"),
    tipPerPerson: $("tip-per-person"),
    billPerPerson: $("bill-per-person"),
    billTotal: $("bill-total"),
    billList: $("bill-list"),
    billCount: $("bill-count"),
    emptyHint: $("empty-hint"),
    saveBill: $("save-bill"),
    reset: $("reset"),
    exportBtn: $("export"),
    importBtn: $("import"),
    importFile: $("import-file"),
    loadSamples: $("load-samples"),
    clearBills: $("clear-bills"),
    toast: $("toast"),
  };

  let state = { ...DEFAULT_STATE };
  let bills = [];
  let toastTimer = null;
  let clearArmed = false;
  let clearTimer = null;

  /* ---------- 工具 ---------- */

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function toNum(v, fallback = 0) {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function newId() {
    return "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  /* ---------- 数据校验 / 持久化 ---------- */

  function validBill(b) {
    return (
      !!b && typeof b === "object" &&
      toNum(b.bill, NaN) >= 0 &&
      Number.isFinite(toNum(b.tipPercent, NaN)) &&
      Number.isInteger(toNum(b.people, NaN)) &&
      toNum(b.people, 0) >= 1
    );
  }

  function normalizeBill(b) {
    return {
      id: typeof b.id === "string" && b.id ? b.id : newId(),
      name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 40) : "未命名账单",
      bill: Math.round(toNum(b.bill) * 100) / 100,
      tipPercent: clamp(toNum(b.tipPercent), 0, 100),
      people: clamp(Math.round(toNum(b.people)), 1, 999),
      rounding: ROUNDINGS.includes(b.rounding) ? b.rounding : "none",
      createdAt: typeof b.createdAt === "string" && b.createdAt ? b.createdAt : new Date().toISOString(),
      sample: Boolean(b.sample),
    };
  }

  function normalizeState(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      bill: s.bill == null ? "" : String(s.bill),
      tipPercent: clamp(toNum(s.tipPercent, DEFAULT_STATE.tipPercent), 0, 100),
      people: clamp(Math.round(toNum(s.people, DEFAULT_STATE.people)), 1, 99),
      rounding: ROUNDINGS.includes(s.rounding) ? s.rounding : "none",
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, bills }));
    } catch {
      /* localStorage 不可用（隐私模式等）时应用仍可运行，只是不记忆 */
    }
  }

  function loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return false;
      state = normalizeState(data.state);
      bills = Array.isArray(data.bills) ? data.bills.filter(validBill).map(normalizeBill) : [];
      return true;
    } catch {
      return false;
    }
  }

  /* ---------- 计算 ---------- */
  // 金额一律以「分」为整数单位计算，避免浮点误差
  function calcBill({ bill, tipPercent, people, rounding }) {
    const billCents = Math.round(toNum(bill) * 100);
    const n = clamp(Math.round(toNum(people, 1)), 1, 999);
    const pct = clamp(toNum(tipPercent), 0, 100);
    let tipCents = Math.round((billCents * pct) / 100);
    let totalCents = billCents + tipCents;
    let perCents = totalCents / n;

    if (rounding === "total-nearest") {
      const rounded = Math.round(totalCents / 100) * 100;
      if (rounded >= billCents) {
        totalCents = rounded;
        tipCents = totalCents - billCents;
      }
      perCents = totalCents / n;
    } else if (rounding === "person-nearest" || rounding === "person-up") {
      perCents = rounding === "person-up"
        ? Math.ceil(totalCents / n)
        : Math.round(totalCents / n);
      totalCents = perCents * n;
      if (totalCents < billCents) {
        // 取整后低于账单本身（基本只出现在小费为 0 时），回退为不取整
        tipCents = 0;
        totalCents = billCents;
        perCents = totalCents / n;
      } else {
        tipCents = totalCents - billCents;
      }
    }
    return { billCents, tipCents, totalCents, perCents, people: n };
  }

  // 展示：分 → 元，两位小数（人均可能出现半分钱，这里按四舍五入显示）
  function fmt(cents) {
    return "¥" + (Math.round(cents) / 100).toFixed(2);
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const r = calcBill(state);

    els.perPerson.textContent = fmt(r.perCents);
    els.tipAmount.textContent = fmt(r.tipCents);
    els.total.textContent = fmt(r.totalCents);
    els.tipPerPerson.textContent = fmt(r.tipCents / r.people);
    els.billPerPerson.textContent = fmt(r.billCents / r.people);
    els.billTotal.textContent = fmt(r.billCents);

    const pct = clamp(toNum(state.tipPercent), 0, 100);
    for (const chip of els.chips.querySelectorAll(".chip")) {
      chip.classList.toggle("active", Number(chip.dataset.tip) === pct);
    }

    renderBills();
  }

  function renderBills() {
    els.billCount.textContent = bills.length ? `（${bills.length}）` : "";
    els.emptyHint.hidden = bills.length > 0;
    els.billList.textContent = "";

    for (const b of bills) {
      const r = calcBill(b);
      const li = document.createElement("li");
      li.className = "bill-item";
      li.dataset.id = b.id;

      const info = document.createElement("div");
      info.className = "bill-info";
      const name = document.createElement("strong");
      name.className = "bill-name";
      name.textContent = b.name;
      if (b.sample) {
        const tag = document.createElement("em");
        tag.className = "tag";
        tag.textContent = "示例";
        name.appendChild(tag);
      }
      const meta = document.createElement("span");
      meta.className = "bill-meta";
      meta.textContent = `¥${b.bill.toFixed(2)} · 小费 ${b.tipPercent}% · ${b.people} 人 · 人均 ${fmt(r.perCents)}`;
      info.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "bill-actions";
      actions.append(mkBtn("载入", "load"), mkBtn("删除", "delete", "danger"));

      li.append(info, actions);
      els.billList.appendChild(li);
    }
  }

  function mkBtn(text, action, extra = "") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = ("btn small " + extra).trim();
    btn.textContent = text;
    btn.dataset.action = action;
    return btn;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  /* ---------- 表单 ---------- */

  function readFormToState() {
    state.bill = els.bill.value;
    if (els.tip.value.trim() !== "") {
      state.tipPercent = clamp(toNum(els.tip.value, state.tipPercent), 0, 100);
    }
    if (els.people.value.trim() !== "") {
      state.people = clamp(Math.round(toNum(els.people.value, state.people)), 1, 99);
    }
    state.rounding = ROUNDINGS.includes(els.rounding.value) ? els.rounding.value : "none";
    els.tipRange.value = String(clamp(state.tipPercent, 0, 50));
    persist();
    render();
  }

  function applyTip(pct) {
    els.tip.value = String(pct);
    els.tipRange.value = String(clamp(pct, 0, 50));
    readFormToState();
  }

  function setPeople(delta) {
    els.people.value = String(clamp(state.people + delta, 1, 99));
    readFormToState();
  }

  function resetForm() {
    els.bill.value = DEFAULT_STATE.bill;
    els.tip.value = String(DEFAULT_STATE.tipPercent);
    els.tipRange.value = String(DEFAULT_STATE.tipPercent);
    els.people.value = String(DEFAULT_STATE.people);
    els.rounding.value = DEFAULT_STATE.rounding;
    readFormToState();
    toast("已清空并重置表单");
  }

  /* ---------- 账单记录 ---------- */

  function saveCurrentBill() {
    const r = calcBill(state);
    if (r.billCents <= 0) {
      toast("请先输入大于 0 的账单金额");
      els.bill.focus();
      return;
    }
    const d = new Date();
    const b = normalizeBill({
      id: newId(),
      name: `账单 ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
      bill: r.billCents / 100,
      tipPercent: state.tipPercent,
      people: r.people,
      rounding: state.rounding,
      createdAt: d.toISOString(),
    });
    bills.unshift(b);
    persist();
    render();
    toast(`已保存「${b.name}」`);
  }

  function loadBill(id) {
    const b = bills.find((x) => x.id === id);
    if (!b) return;
    els.bill.value = String(b.bill);
    els.tip.value = String(b.tipPercent);
    els.tipRange.value = String(clamp(b.tipPercent, 0, 50));
    els.people.value = String(clamp(b.people, 1, 99));
    els.rounding.value = b.rounding;
    readFormToState();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast(`已载入「${b.name}」`);
  }

  function deleteBill(id) {
    const b = bills.find((x) => x.id === id);
    bills = bills.filter((x) => x.id !== id);
    persist();
    render();
    toast(b ? `已删除「${b.name}」` : "已删除");
  }

  /* ---------- 导入 / 导出 ---------- */

  function exportJSON() {
    if (!bills.length) {
      toast("当前没有账单可导出");
      return;
    }
    const payload = {
      app: "tip-calculator",
      version: 1,
      exportedAt: new Date().toISOString(),
      bills,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `tip-calculator-bills-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${bills.length} 条账单`);
  }

  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let list;
      try {
        const data = JSON.parse(String(reader.result));
        list = Array.isArray(data) ? data : data && typeof data === "object" ? data.bills : null;
      } catch {
        toast("导入失败：无法解析 JSON 文件");
        return;
      }
      if (!Array.isArray(list)) {
        toast("导入失败：JSON 里需要包含 bills 数组");
        return;
      }
      const byId = new Map(bills.map((b) => [b.id, b]));
      let added = 0;
      let updated = 0;
      let skipped = 0;
      for (const item of list) {
        if (!validBill(item)) {
          skipped++;
          continue;
        }
        const nb = normalizeBill(item);
        if (byId.has(nb.id)) updated++;
        else added++;
        byId.set(nb.id, nb);
      }
      bills = [...byId.values()];
      persist();
      render();
      toast(`导入完成：新增 ${added}，更新 ${updated}${skipped ? `，跳过无效 ${skipped}` : ""}`);
    };
    reader.onerror = () => toast("导入失败：无法读取文件");
    reader.readAsText(file);
  }

  function restoreSamples() {
    const have = new Set(bills.map((b) => b.id));
    const missing = SAMPLE_BILLS.filter((s) => !have.has(s.id));
    if (!missing.length) {
      toast("3 条示例账单都已在记录中");
      return;
    }
    bills = [...missing.map(normalizeBill), ...bills];
    persist();
    render();
    toast(`已恢复 ${missing.length} 条示例账单`);
  }

  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    els.clearBills.textContent = "清空记录";
    els.clearBills.classList.remove("armed");
  }

  /* ---------- 事件绑定 ---------- */

  els.bill.addEventListener("input", readFormToState);
  els.tip.addEventListener("input", readFormToState);
  els.tipRange.addEventListener("input", () => applyTip(Number(els.tipRange.value)));
  els.people.addEventListener("input", readFormToState);
  els.rounding.addEventListener("change", readFormToState);

  // 失焦时把输入框显示值归一到钳制后的状态值（如输入 300% 显示为 100）
  els.tip.addEventListener("change", () => { els.tip.value = String(state.tipPercent); });
  els.people.addEventListener("change", () => { els.people.value = String(state.people); });

  els.peopleMinus.addEventListener("click", () => setPeople(-1));
  els.peoplePlus.addEventListener("click", () => setPeople(1));

  els.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) applyTip(Number(chip.dataset.tip));
  });

  els.saveBill.addEventListener("click", saveCurrentBill);
  els.reset.addEventListener("click", resetForm);
  els.exportBtn.addEventListener("click", exportJSON);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files && els.importFile.files[0];
    if (file) importJSONFile(file);
    els.importFile.value = "";
  });
  els.loadSamples.addEventListener("click", restoreSamples);

  els.clearBills.addEventListener("click", () => {
    if (!bills.length) {
      toast("账单记录已经是空的");
      return;
    }
    if (!clearArmed) {
      // 两步确认代替原生 confirm 弹窗，避免误删
      clearArmed = true;
      els.clearBills.textContent = "再点一次确认清空";
      els.clearBills.classList.add("armed");
      clearTimer = setTimeout(disarmClear, 3000);
      return;
    }
    bills = [];
    persist();
    render();
    disarmClear();
    toast("已清空全部账单记录");
  });

  els.billList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const li = btn.closest(".bill-item");
    if (!li) return;
    if (btn.dataset.action === "load") loadBill(li.dataset.id);
    else if (btn.dataset.action === "delete") deleteBill(li.dataset.id);
  });

  /* ---------- 启动 ---------- */

  function init() {
    if (!loadAll()) {
      // 首次使用：默认表单 + 内置 3 条示例账单
      state = { ...DEFAULT_STATE };
      bills = SAMPLE_BILLS.map(normalizeBill);
      persist();
    }
    els.bill.value = state.bill;
    els.tip.value = String(state.tipPercent);
    els.tipRange.value = String(clamp(state.tipPercent, 0, 50));
    els.people.value = String(state.people);
    els.rounding.value = state.rounding;
    render();
  }

  init();
})();
