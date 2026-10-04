/* Admin: xuất / nhập toàn bộ dữ liệu trang web */
"use strict";

(function () {
  const { Api, Toast, UI } = window.__DIAGRAM__;
  const $ = (id) => document.getElementById(id);

  const fmtDateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
  const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const LABELS = { users: "tài khoản", diagrams: "sơ đồ", shares: "liên kết chia sẻ" };

  /** Tạo phần tử DOM; chữ luôn đi qua textContent (không bao giờ innerHTML với dữ liệu từ tệp). */
  function h(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }

  /* ======================= Xuất ======================= */

  const exportBtn = $("exportBtn");
  exportBtn.addEventListener("click", async () => {
    const want = { users: $("expUsers").checked, diagrams: $("expDiagrams").checked, shares: $("expShares").checked };
    if (!want.users && !want.diagrams && !want.shares) {
      Toast.error("Hãy chọn ít nhất một loại dữ liệu để xuất.");
      return;
    }
    const q = new URLSearchParams({ users: want.users ? "1" : "0", diagrams: want.diagrams ? "1" : "0", shares: want.shares ? "1" : "0" });
    exportBtn.disabled = true;
    try {
      const res = await fetch(`/api/v1/admin/export?${q}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json())?.error?.message || ""; } catch { /* không phải JSON */ }
        Toast.error(msg || `Không xuất được dữ liệu (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const filename = m ? m[1] : "diagram-backup.json";
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      Toast.ok(`Đã xuất ${filename} (${fmtSize(blob.size)}).`);
    } catch {
      Toast.error("Không kết nối được máy chủ.");
    } finally {
      exportBtn.disabled = false;
    }
  });

  /* ======================= Nhập ======================= */

  const fileInput = $("importFile");
  const importBtn = $("importBtn");
  const errorBox = $("importError");
  const optionsBox = $("importOptions");
  const metaBox = $("importMeta");
  const secBoxes = { users: $("impUsers"), diagrams: $("impDiagrams"), shares: $("impShares") };
  let backup = null;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  }

  function resetImport() {
    backup = null;
    optionsBox.hidden = true;
    importBtn.disabled = true;
    metaBox.replaceChildren();
  }

  fileInput.addEventListener("change", async () => {
    showError("");
    resetImport();
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showError("Tệp không phải JSON hợp lệ.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || parsed.format !== "diagram-backup" || !parsed.data || typeof parsed.data !== "object") {
      showError("Đây không phải tệp sao lưu của Diagram.");
      return;
    }
    backup = parsed;

    const counts = {};
    for (const key of Object.keys(LABELS)) counts[key] = Array.isArray(parsed.data[key]) ? parsed.data[key].length : null;

    metaBox.replaceChildren(
      h("div", {}, h("b", { text: "Tệp: " }), document.createTextNode(`${file.name} (${fmtSize(file.size)})`)),
      parsed.exportedAt && !Number.isNaN(Date.parse(parsed.exportedAt))
        ? h("div", {}, h("b", { text: "Xuất lúc: " }), document.createTextNode(fmtDateTime.format(new Date(parsed.exportedAt)) + (parsed.exportedBy?.username ? ` · bởi ${String(parsed.exportedBy.username).slice(0, 64)}` : "")))
        : null,
      h("div", {}, h("b", { text: "Gồm: " }), document.createTextNode(
        Object.keys(LABELS).filter((k) => counts[k] !== null).map((k) => `${counts[k]} ${LABELS[k]}`).join(" · ") || "(trống)")),
    );

    for (const key of Object.keys(LABELS)) {
      const box = secBoxes[key];
      const present = counts[key] !== null;
      box.disabled = !present;
      box.checked = present;
    }
    optionsBox.hidden = false;
    importBtn.disabled = false;
  });

  const selectedMode = () => document.querySelector('input[name="importMode"]:checked')?.value || "merge";

  /** Đếm gọn: chỉ liệt kê các số khác 0. */
  const parts = (pairs) => pairs.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ") || "không thay đổi";

  function buildPreview(res) {
    const s = res.summary;
    const rows = [];
    if (res.use.users) {
      rows.push(["Tài khoản", parts([[s.users.added, "thêm mới"], [s.users.updated, "cập nhật"], [s.users.merged, "gộp theo email"], [s.users.renamed, "đổi tên"], [s.users.kept, "giữ nguyên (tài khoản của bạn)"], [s.users.skipped, "bỏ qua"]])]);
    }
    if (res.use.diagrams) {
      rows.push(["Sơ đồ", parts([[s.diagrams.added, "thêm mới"], [s.diagrams.updated, "cập nhật"], [s.diagrams.reassigned, "gán lại chủ sở hữu"], [s.diagrams.skipped, "bỏ qua"]])]);
    }
    if (res.use.shares) {
      rows.push(["Liên kết chia sẻ", parts([[s.shares.added, "thêm mới"], [s.shares.unchanged, "đã có sẵn"], [s.shares.skipped, "bỏ qua"]])]);
    }

    const root = h("div", {});
    root.append(h("table", { class: "summary-table" }, h("tbody", {}, rows.map(([k, v]) => h("tr", {}, h("th", { text: k }), h("td", { text: v }))))));
    root.append(h("p", { class: "text-soft", text: `Sau khi nhập: ${res.after.users} tài khoản · ${res.after.diagrams} sơ đồ · ${res.after.shares} liên kết chia sẻ.` }));

    const removedTotal = res.removed.users + res.removed.diagrams + res.removed.shares;
    if (res.mode === "replace" && removedTotal > 0) {
      root.append(h("div", { class: "notice notice-danger", text: `Sẽ XÓA: ${parts([[res.removed.users, "tài khoản"], [res.removed.diagrams, "sơ đồ"], [res.removed.shares, "liên kết chia sẻ"]])} hiện có không nằm trong tệp.` }));
    }
    if (res.impact.logout) {
      root.append(h("div", { class: "notice notice-danger", style: "margin-top:8px", text: "Tài khoản bạn đang dùng sẽ không còn hoạt động sau khi nhập — bạn sẽ bị đăng xuất và cần đăng nhập bằng tài khoản có trong tệp." }));
    } else if (res.impact.loseAdmin) {
      root.append(h("div", { class: "notice notice-danger", style: "margin-top:8px", text: "Theo tệp này, tài khoản của bạn sẽ không còn quyền quản trị." }));
    }
    if (res.errorCount > 0) {
      root.append(h("div", { class: "notice notice-warn", style: "margin-top:8px", text: `${res.errorCount} bản ghi trong tệp không hợp lệ và sẽ được bỏ qua.` }));
      root.append(h("ul", { class: "summary-list" }, res.errors.slice(0, 5).map((e) => h("li", { text: `${LABELS[e.section] || e.section} #${e.index + 1}: ${e.message}` }))));
    }
    if (res.warnings.length) {
      root.append(h("ul", { class: "summary-list" }, res.warnings.slice(0, 6).map((w) => h("li", { text: w }))));
    }
    return root;
  }

  importBtn.addEventListener("click", async () => {
    if (!backup) return;
    showError("");
    const sections = {};
    for (const key of Object.keys(LABELS)) sections[key] = !secBoxes[key].disabled && secBoxes[key].checked;
    if (!sections.users && !sections.diagrams && !sections.shares) {
      showError("Hãy chọn ít nhất một loại dữ liệu để nhập.");
      return;
    }
    const mode = selectedMode();

    importBtn.disabled = true;
    try {
      // Bước 1: xem trước (server kiểm tra toàn bộ tệp nhưng chưa ghi gì)
      const preview = await Api.post("/api/v1/admin/import", { backup, mode, sections, dryRun: true });
      if (!preview.success) {
        showError(preview.error?.message || "Không kiểm tra được tệp sao lưu.");
        return;
      }

      const danger = mode === "replace";
      const choice = await UI.modal({
        title: danger ? "Thay thế dữ liệu hiện có?" : "Nhập dữ liệu vào trang web?",
        body: buildPreview(preview.data),
        wide: true,
        actions: [
          { label: "Hủy", class: "btn-secondary", value: "cancel" },
          { label: danger ? "Thay thế" : "Nhập dữ liệu", class: danger ? "btn-danger" : "btn-primary", value: "go" },
        ],
      });
      if (choice !== "go") return;

      // Bước 2: ghi thật
      const done = await Api.post("/api/v1/admin/import", { backup, mode, sections, dryRun: false });
      if (!done.success) {
        showError(done.error?.message || "Nhập dữ liệu thất bại.");
        return;
      }
      const r = done.data;
      Toast.ok(`Đã nhập xong: ${r.applied.users} tài khoản · ${r.applied.diagrams} sơ đồ · ${r.applied.shares} liên kết chia sẻ.`);
      fileInput.value = "";
      resetImport();
      setTimeout(() => { window.location.href = r.impact.logout ? "/login" : "/admin"; }, 1400);
    } finally {
      importBtn.disabled = backup === null;
    }
  });
})();
