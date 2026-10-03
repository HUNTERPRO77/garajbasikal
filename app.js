import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && !image.dataset.fallback) {
    image.dataset.fallback = "true";
    image.src = "qr-placeholder.svg";
  }
}, true);
const params = new URLSearchParams(location.search);
const authFlowType = new URLSearchParams(location.hash.slice(1)).get("type") || params.get("type") ||
  (params.has("code") ? "code" : "");
const garage = params.get("garage") || "";
const groupMode = params.get("group") === "1";
let qrReady = false;
function activateQrImages() {
  if (!qrReady) return;
  $$("img[data-qr-src]").forEach((image) => {
    if (image.dataset.qrLoaded) return;
    image.dataset.qrLoaded = "true";
    image.src = image.dataset.qrSrc;
  });
}
const qrObserver = new MutationObserver(activateQrImages);
qrObserver.observe(document.documentElement, { childList: true, subtree: true });
fetch("qr-ready.json", { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error(`Tidak dapat membaca status QR (${response.status}).`);
  return response.json();
}).then((manifest) => {
  qrReady = manifest.ready === true;
  activateQrImages();
}).catch((error) => console.error("Status QR tidak dapat dimuat:", error));
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
  SUPABASE_ANON_KEY.length > 30 && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const publicNotice = $("#publicNotice");
const publicResult = $("#publicResult");
const tokenKey = groupMode ? "garaj_group_device_v1" : "garaj_bike_device_v4";
let deviceToken = localStorage.getItem(tokenKey);
if (!deviceToken) {
  deviceToken = crypto.randomUUID ? crypto.randomUUID() : `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(tokenKey, deviceToken);
}

function fingerprint() {
  const values = [navigator.platform, screen.width, screen.height, screen.colorDepth, devicePixelRatio,
    navigator.hardwareConcurrency || "", navigator.maxTouchPoints || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || ""].join("|");
  let hash = 2166136261;
  for (let i = 0; i < values.length; i++) {
    hash ^= values.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}
const deviceFingerprint = fingerprint();

function showMessage(target, message, ok) {
  target.replaceChildren();
  const box = document.createElement("div");
  box.className = `alert ${ok ? "success" : "danger"}`;
  box.textContent = message;
  target.append(box);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

function formatClock(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");
  const hour = Number(match[1]);
  const minute = match[2];
  if (hour > 23 || Number(minute) > 59) return String(value);
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

function parseClock(value) {
  const match = /^\s*(1[0-2]|0?[1-9]):([0-5]\d)\s*(AM|PM)\s*$/i.exec(String(value ?? ""));
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function remainingSessionMinutes(end) {
  const endMinutes = parseClock(formatClock(end));
  if (!endMinutes) return 0;
  const [endHour, endMinute] = endMinutes.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const currentHour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const currentMinute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return Math.max(0, endHour * 60 + endMinute - currentHour * 60 - currentMinute);
}

const unavailableMessage = "Sambungkan projek Supabase dahulu. Isi URL dan anon key dalam supabase-config.js.";
if (!configured) {
  $("#landingSection").hidden = false;
  showMessage(publicNotice, unavailableMessage, false);
  $("#loginCard").hidden = true;
} else {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function api(action, data = {}) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || SUPABASE_ANON_KEY;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action, qr_code: garage, ...data }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok && !result) return { ok: false, message: `Respons server tidak sah (${response.status}).` };
      return result || { ok: false, message: "Respons server tidak sah." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Tidak dapat berhubung ke server." };
    }
  }

  async function showPublicPage() {
    if (!garage) {
      $("#landingSection").hidden = false;
      $("#individualSection").hidden = true;
      $("#groupSection").hidden = true;
      $("#sessionsCard").hidden = true;
      publicNotice.textContent = "Scan QR rasmi garaj atau QR pinjaman berkumpulan.";
      return;
    }
    $("#landingSection").hidden = true;
    $("#individualSection").hidden = groupMode;
    $("#groupSection").hidden = !groupMode;
    $("#sessionsCard").hidden = groupMode;
    publicNotice.hidden = true;
    try {
      if (groupMode) {
        await refreshGroupStatus();
      } else {
        const status = await api("status", {
          device_token: deviceToken,
          device_fingerprint: deviceFingerprint,
          bike_no: params.get("bike") || "",
        });
        if (!status.ok) throw new Error(status.message);
        renderIndividualStatus(status);
      }
    } catch (error) {
      showMessage(publicNotice, error.message, false);
      publicNotice.hidden = false;
    }
  }

  function renderIndividualStatus(status) {
    const sessionBox = $("#sessionBox");
    if (status.session) {
      const remaining = remainingSessionMinutes(status.session.end);
      sessionBox.className = "banner active";
      sessionBox.textContent = `${status.session.name} aktif • tamat ${formatClock(status.session.end)} • baki ${remaining} minit`;
      if ((status.warning_10min && remaining <= 10) || (status.warning_5min && remaining <= 5)) {
        sessionBox.textContent += " • ⚠️ Sila bersedia untuk hantar basikal.";
      }
    } else {
      sessionBox.className = "banner";
      sessionBox.textContent = `Tiada sesi aktif. Sesi 1: ${formatClock(status.session1_start)}–${formatClock(status.session1_end)} • Sesi 2: ${formatClock(status.session2_start)}–${formatClock(status.session2_end)}.`;
    }
    $("#capacityBox").textContent = `${status.session ? `${status.session.name}: ` : ""}${status.session_active_count}/${status.capacity} peminjam aktif • ${status.available_bikes} basikal tersedia`;
    $("#capacityBox").className = `banner${status.session_active_count >= status.capacity ? " full" : ""}`;
    $("#garageName").textContent = status.garage_name || "Garaj Basikal";
    $("#session1Hours").textContent = `${formatClock(status.session1_start)}–${formatClock(status.session1_end)}`;
    $("#session2Hours").textContent = `${formatClock(status.session2_start)}–${formatClock(status.session2_end)}`;
    if (status.bike?.bike_no) {
      $("#bikeInput").value = status.bike.bike_no;
      $("#bikeInput").readOnly = true;
    } else if (params.get("bike")) {
      $("#bikeInput").value = params.get("bike").toUpperCase();
      $("#bikeInput").readOnly = true;
    }
    const active = status.active_record;
    const currentLoan = $("#currentLoan");
    currentLoan.replaceChildren();
    if (active) {
      $("#individualFields").hidden = true;
      $("#checkoutButton").hidden = true;
      const card = document.createElement("div");
      card.className = "loan-card";
      const text = document.createElement("p");
      text.textContent = `Pinjaman aktif · ${active.name} · ${active.matrix} · Basikal ${active.bike_no} · ${active.session}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn primary full";
      button.textContent = "Hantar Basikal Sekarang";
      button.addEventListener("click", () => confirmIndividualReturn(active.id, "", "", ""));
      card.append(text, button);
      currentLoan.append(card);
    } else {
      $("#individualFields").hidden = false;
      $("#checkoutButton").hidden = false;
    }
  }

  async function confirmIndividualReturn(recordId, matrix, name, fingerprintToken) {
    try {
      const result = await api("return_confirm", {
        record_id: recordId,
        matrix,
        name,
        preview_token: fingerprintToken,
        device_token: deviceToken,
        device_fingerprint: deviceFingerprint,
      });
      showMessage(publicResult, result.message, result.ok);
      if (result.ok) {
        $("#borrowForm").reset();
        if (params.get("bike")) $("#bikeInput").value = params.get("bike").toUpperCase();
        const status = await api("status", { device_token: deviceToken, device_fingerprint: deviceFingerprint });
        renderIndividualStatus(status);
      }
    } catch (error) {
      showMessage(publicResult, error.message, false);
    }
  }

  $("#borrowForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const matrix = $("#matrix").value.trim();
    const name = $("#borrowerName").value.trim();
    const bikeNo = $("#bikeInput").value.trim().toUpperCase();
    try {
      const result = await api("checkout", {
        matrix, name, bike_no: bikeNo, device_token: deviceToken, device_fingerprint: deviceFingerprint,
      });
      if (!result.ok && /pinjaman aktif/i.test(result.message)) {
        const preview = await api("return_preview", { matrix, name });
        if (preview.ok) {
          $("#returnFallback").hidden = false;
          $("#individualFields").hidden = true;
          $("#checkoutButton").hidden = true;
          $("#returnPreview").textContent = `${preview.record.name} · ${preview.record.matrix} · Basikal ${preview.record.bike_no} · ${preview.record.session}`;
          $("#confirmIndividualReturn").onclick = () => confirmIndividualReturn(preview.record.id, matrix, name, preview.preview_token || "");
          $("#cancelIndividualReturn").onclick = () => {
            $("#returnFallback").hidden = true;
            $("#individualFields").hidden = false;
            $("#checkoutButton").hidden = false;
          };
          return;
        }
      }
      showMessage(publicResult, result.message, result.ok);
      if (result.ok) {
        $("#individualFields").hidden = true;
        $("#checkoutButton").hidden = true;
        const status = await api("status", { device_token: deviceToken, device_fingerprint: deviceFingerprint });
        renderIndividualStatus(status);
      }
    } catch (error) {
      showMessage(publicResult, error.message, false);
    }
  });

  function groupDetails() {
    const form = new FormData($("#groupLoanForm"));
    return {
      lecturer_name: String(form.get("lecturer_name") || "").trim(),
      class_club: String(form.get("class_club") || "").trim(),
      quantity: String(form.get("quantity") || ""),
    };
  }

  function renderGroupReturn(loan, requireDetails) {
    const result = $("#groupResult");
    result.replaceChildren();
    $("#groupLoanForm").hidden = true;
    const card = document.createElement("div");
    card.className = "loan-card";
    const details = document.createElement("p");
    details.textContent = `Pinjaman aktif · Pensyarah: ${loan.lecturer_name} · Kelas/Kelab: ${loan.class_club} · ${loan.quantity} basikal (${loan.bikes.join(", ")}).`;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn primary full";
    confirm.textContent = "Sahkan Hantar Semua Basikal";
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const fallback = requireDetails ? groupDetails() : {};
        const returned = await api("group_return", {
          group_loan_id: loan.id,
          device_token: deviceToken,
          ...fallback,
        });
        showMessage(result, returned.message, returned.ok);
        if (returned.ok) {
          $("#groupLoanForm").reset();
          $("#groupLoanForm").hidden = false;
          await refreshGroupStatus();
        } else confirm.disabled = false;
      } catch (error) {
        showMessage(result, error.message, false);
        confirm.disabled = false;
      }
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn secondary full";
    cancel.textContent = "Batal";
    cancel.addEventListener("click", () => {
      result.replaceChildren();
      $("#groupLoanForm").hidden = false;
    });
    card.append(details, confirm, cancel);
    result.append(card);
  }

  async function refreshGroupStatus() {
    const status = await api("group_status", { device_token: deviceToken });
    if (!status.ok) throw new Error(status.message);
    $("#groupCapacityBox").textContent = `${status.available_bikes} basikal tersedia`;
    if (status.active_group) renderGroupReturn(status.active_group, false);
    else $("#groupLoanForm").hidden = false;
  }

  $("#groupLoanForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const details = groupDetails();
    try {
      const match = await api("group_match", details);
      if (!match.ok) {
        showMessage($("#groupResult"), match.message, false);
        return;
      }
      if (match.matching_group) {
        renderGroupReturn(match.matching_group, true);
        return;
      }
      const loan = await api("group_checkout", { ...details, device_token: deviceToken });
      showMessage($("#groupResult"), loan.message, loan.ok);
      if (loan.ok) {
        $("#groupLoanForm").reset();
        await refreshGroupStatus();
      }
    } catch (error) {
      showMessage($("#groupResult"), error.message, false);
    }
  });

  function renderDashboard(data, staff) {
    const dashboard = $("#dashboard");
    $("#loginCard").hidden = true;
    dashboard.hidden = false;
    dashboard.innerHTML = `
      <header class="topbar"><div><strong>${escapeHtml(data.app_settings?.[0]?.garage_name || "Garaj Basikal")}</strong><p>Portal ${escapeHtml(staff.role)}</p></div>
      <div class="top-actions"><span>${escapeHtml(staff.display_name)}</span><button id="logoutButton" class="btn secondary">Log Keluar</button></div></header>
      <div class="stats">
        <div class="stat"><span>Basikal dipinjam</span><b>${data.bikes.filter((bike) => bike.status === "borrowed").length}</b></div>
        <div class="stat"><span>Basikal tersedia</span><b>${data.bikes.filter((bike) => bike.status === "available").length}</b></div>
        <div class="stat"><span>Lewat</span><b>${data.records.filter((record) => record.late).length}</b></div>
        <div class="stat"><span>Hukuman aktif</span><b>${data.punishments.filter((row) => new Date(row.until) > new Date()).length}</b></div>
      </div>
      <nav class="tabs" id="staffTabs">
        ${staff.role === "admin" ? '<button data-tab="overview" class="tab active">Sistem</button><button data-tab="bikes" class="tab">Basikal</button><button data-tab="borrowers" class="tab">Peminjam</button>' : ""}
        <button data-tab="records" class="tab ${staff.role === "penjaga" ? "active" : ""}">Rekod</button>
        <button data-tab="notes" class="tab">Catatan</button>
        ${staff.role === "admin" ? '<button data-tab="punishment" class="tab">Hukuman</button><button data-tab="stats" class="tab">Statistik</button><button data-tab="audit" class="tab">Audit Log</button><button data-tab="settings" class="tab">Tetapan</button>' : ""}
      </nav>
      <div id="staffView"></div>`;
    $("#logoutButton").addEventListener("click", async () => {
      await supabase.auth.signOut();
      location.reload();
    });
    $$("#staffTabs [data-tab]").forEach((button) => button.addEventListener("click", () => {
      $$("#staffTabs .tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderTab(button.dataset.tab, data, staff);
    }));
    renderTab(staff.role === "admin" ? "overview" : "records", data, staff);
  }

  function renderTab(tab, data, staff) {
    const view = $("#staffView");
    if (!view) return;
    const records = [...data.records].sort((a, b) => String(b.borrowed_at).localeCompare(String(a.borrowed_at)));
    const groups = [...data.group_loans].map((loan) => ({
      ...loan,
      bikes: data.group_loan_bikes.filter((bike) => bike.group_loan_id === loan.id).map((bike) => bike.bike_no).sort(),
    }));
    if (tab === "overview") {
      const setting = data.app_settings[0];
      view.innerHTML = `<section class="section-card"><h2>Status Sistem</h2>
        <div class="grid2"><div class="mini-list">
          <div class="mini-row"><span>Pangkalan data</span><b>Supabase PostgreSQL</b></div>
          <div class="mini-row"><span>Basikal</span><b>${data.bikes.filter((b) => b.status === "available").length} tersedia / ${data.bikes.filter((b) => b.status === "borrowed").length} dipinjam / ${data.bikes.filter((b) => b.status === "damaged").length} rosak</b></div>
          <div class="mini-row"><span>Kapasiti Sesi 1</span><b>${records.filter((r) => r.session_name === "Sesi 1" && !r.returned_at).length}/${setting.session_capacity}</b></div>
          <div class="mini-row"><span>Kapasiti Sesi 2</span><b>${records.filter((r) => r.session_name === "Sesi 2" && !r.returned_at).length}/${setting.session_capacity}</b></div>
        </div><div><h3>QR</h3><img src="qr-placeholder.svg" data-qr-src="qr_garaj_basikal.png" width="160" alt="QR garaj"><img src="qr-placeholder.svg" data-qr-src="qr_pinjaman_berkumpulan.png" width="160" alt="QR pinjaman berkumpulan"></div></div></section>
        <section class="section-card"><h2>Jemput Staf</h2><p class="muted">Hantar jemputan e-mel; staf menetapkan akaun melalui pautan Supabase.</p>
          <form id="inviteForm" class="grid2"><div><label>E-mel</label><input name="email" type="email" required></div><div><label>Nama paparan</label><input name="display_name" required maxlength="100"></div>
          <div><label>Peranan</label><select name="role"><option value="penjaga">Penjaga</option><option value="admin">Admin</option></select></div><div class="align-end"><button class="btn primary">Hantar Jemputan</button></div></form>
          <div class="table-wrap"><table><thead><tr><th>E-mel</th><th>Nama</th><th>Peranan</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>
          ${data.staff_profiles.map((profile) => `<tr><td>${escapeHtml(profile.email)}</td><td>${escapeHtml(profile.display_name)}</td>
            <td><select data-staff-role="${escapeHtml(profile.user_id)}"><option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option><option value="penjaga" ${profile.role === "penjaga" ? "selected" : ""}>Penjaga</option></select></td>
            <td>${profile.active ? "Aktif" : "Nyahaktif"}</td><td><button class="btn small secondary" data-staff-toggle="${escapeHtml(profile.user_id)}" data-active="${!profile.active}">${profile.active ? "Nyahaktif" : "Aktifkan"}</button></td></tr>`).join("")}
          </tbody></table></div></section>`;
      $("#inviteForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const result = await api("staff_invite", fields);
        alert(result.message);
        if (result.ok) await loadStaff();
      });
      $$("[data-staff-toggle]").forEach((button) => button.addEventListener("click", async () => {
        const role = $(`[data-staff-role="${button.dataset.staffToggle}"]`).value;
        const result = await api("staff_update", { user_id: button.dataset.staffToggle, role, active: button.dataset.active === "true" });
        alert(result.message);
        if (result.ok) await loadStaff();
      }));
      return;
    }
    if (tab === "bikes") {
      view.innerHTML = `<section class="section-card"><h2>Pengurusan Basikal</h2><p class="muted">Basikal yang dipinjam tidak boleh ditukar status sehingga dipulangkan.</p>
        <div class="qr-grid">${data.bikes.map((bike) => `<div class="qr-item"><img src="qr-placeholder.svg" data-qr-src="qrs/${escapeHtml(bike.bike_no)}.png" alt="QR ${escapeHtml(bike.bike_no)}"><h3>${escapeHtml(bike.bike_no)}</h3>
          <span class="badge ${bike.status === "available" ? "green" : bike.status === "borrowed" ? "blue" : bike.status === "damaged" ? "red" : "gray"}">${escapeHtml(bike.status.toUpperCase())}</span>
          <form class="bike-form" data-bike="${escapeHtml(bike.bike_no)}"><select name="status"><option value="available" ${bike.status === "available" ? "selected" : ""}>Tersedia</option><option value="damaged" ${bike.status === "damaged" ? "selected" : ""}>Rosak</option><option value="inactive" ${bike.status === "inactive" ? "selected" : ""}>Tidak digunakan</option></select>
          <input name="damage_note" value="${escapeHtml(bike.damage_note)}" placeholder="Catatan"><button class="btn small primary">Simpan</button></form></div>`).join("")}</div></section>`;
      $$(".bike-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(form));
        const result = await api("bike_update", { bike_no: form.dataset.bike, ...fields });
        alert(result.message);
        if (result.ok) await loadStaff();
      }));
      return;
    }
    if (tab === "records") {
      view.innerHTML = `<section class="section-card"><div class="card-head"><div><h2>Rekod Pinjaman</h2><p class="muted">Pemulangan manual hanya untuk penjaga/admin.</p></div>
        ${staff.role === "admin" ? '<button id="exportCsv" class="btn primary">Export CSV</button>' : ""}</div>
        <div class="searchbar"><input id="recordSearch" placeholder="Cari matrik / nama / basikal"><select id="recordFilter"><option value="">Semua</option><option value="active">Sedang dipinjam</option><option value="late">Lewat</option><option value="done">Selesai</option></select><select id="sessionFilter"><option value="">Semua sesi</option><option>Sesi 1</option><option>Sesi 2</option></select><button id="refreshStaff" class="btn secondary">Segar</button></div>
        <div class="table-wrap"><table id="recordsTable"><thead><tr><th>Tarikh</th><th>Matrik</th><th>Nama</th><th>Basikal</th><th>Sesi</th><th>Ambil</th><th>Hantar</th><th>Status</th><th>Catatan Manual</th><th>Tindakan</th></tr></thead><tbody>
        ${records.map((record) => `<tr data-search="${escapeHtml(`${record.matrix} ${record.name} ${record.bike_no}`.toLowerCase())}" data-status="${record.returned_at ? record.late ? "late" : "done" : "active"}" data-session="${escapeHtml(record.session_name)}">
          <td>${fmt(record.borrowed_at)}</td><td><b>${escapeHtml(record.matrix)}</b></td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.bike_no)}</td><td>${escapeHtml(record.session_name)}</td><td>${fmt(record.borrowed_at)}</td><td>${fmt(record.returned_at)}</td>
          <td>${record.returned_at ? record.late ? '<span class="badge red">Lewat</span>' : '<span class="badge green">Selesai</span>' : '<span class="badge blue">Aktif</span>'} ${record.manual_return ? '<span class="badge gray">Manual</span>' : ""}</td>
          <td>${escapeHtml(record.manual_return_note || "-")}</td><td>${!record.returned_at && ["admin", "penjaga"].includes(staff.role) ? `<button class="btn small primary" data-manual-return="${record.id}">Hantar Manual</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div></section>
        <section class="section-card"><h2>Pinjaman Berkumpulan</h2><p class="muted">Tiada sesi atau masa ambil/hantar direkodkan. Pemulangan boleh dibuat melalui QR atau oleh staf.</p>
        <div class="table-wrap"><table><thead><tr><th>Pensyarah</th><th>Kelas/Kelab</th><th>Jumlah</th><th>Basikal</th><th>Status</th><th>Catatan Pemulangan</th><th>Tindakan</th></tr></thead><tbody>
        ${groups.map((loan) => `<tr><td>${escapeHtml(loan.lecturer_name)}</td><td>${escapeHtml(loan.class_club)}</td><td>${loan.bike_count}</td><td>${escapeHtml(loan.bikes.join(", "))}</td>
          <td>${loan.is_active ? '<span class="badge blue">Aktif</span>' : '<span class="badge green">Selesai</span>'}</td><td>${escapeHtml(loan.return_note || "-")} ${loan.returned_by ? `<br>Oleh ${escapeHtml(loan.returned_by)}` : ""}</td>
          <td>${loan.is_active && ["admin", "penjaga"].includes(staff.role) ? `<button class="btn small primary" data-group-return="${loan.id}">Pulangkan Kumpulan</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
      $("#refreshStaff")?.addEventListener("click", loadStaff);
      $("#recordSearch")?.addEventListener("input", filterRecords);
      $("#recordFilter")?.addEventListener("input", filterRecords);
      $("#sessionFilter")?.addEventListener("input", filterRecords);
      $("#exportCsv")?.addEventListener("click", () => exportCsv(data));
      $$("[data-manual-return]").forEach((button) => button.addEventListener("click", async () => {
        const note = prompt("Catatan pemulangan manual (wajib):", "Peminjam terlupa scan QR semasa menghantar basikal.");
        if (!note) return;
        const result = await api("manual_return", { record_id: button.dataset.manualReturn, note });
        alert(result.message);
        if (result.ok) await loadStaff();
      }));
      $$("[data-group-return]").forEach((button) => button.addEventListener("click", async () => {
        const note = prompt("Catatan pemulangan kumpulan (wajib):", "Semua basikal kumpulan telah dipulangkan.");
        if (!note) return;
        const result = await api("group_manual_return", { group_loan_id: button.dataset.groupReturn, note });
        alert(result.message);
        if (result.ok) await loadStaff();
      }));
      return;
    }
    if (tab === "borrowers") {
      const borrowerRows = [...data.borrowers].sort((a, b) => a.matrix.localeCompare(b.matrix));
      view.innerHTML = `<section class="section-card"><h2>Profil & Sejarah Peminjam</h2><input id="borrowerSearch" placeholder="Cari No. Matrik / Nama">
        <div class="table-wrap"><table id="borrowersTable"><thead><tr><th>Matrik</th><th>Nama</th><th>Jumlah Pinjaman</th><th>Lewat</th><th>Amaran</th><th>Status</th><th>Tahanan Tamat</th></tr></thead><tbody>
        ${borrowerRows.map((borrower) => `<tr data-search="${escapeHtml(`${borrower.matrix} ${borrower.name}`.toLowerCase())}"><td><button class="link-button" data-borrower="${escapeHtml(borrower.matrix)}">${escapeHtml(borrower.matrix)}</button></td><td>${escapeHtml(borrower.name)}</td>
        <td>${records.filter((record) => record.matrix.toLowerCase() === borrower.matrix.toLowerCase()).length}</td><td>${records.filter((record) => record.matrix.toLowerCase() === borrower.matrix.toLowerCase() && record.late).length}</td><td>${borrower.warning_count}</td>
        <td>${borrower.suspension_until && new Date(borrower.suspension_until) > new Date() ? '<span class="badge red">Disekat</span>' : '<span class="badge green">Aktif</span>'}</td><td>${fmt(borrower.suspension_until)}</td></tr>`).join("")}</tbody></table></div><div id="borrowerHistory"></div></section>`;
      $("#borrowerSearch").addEventListener("input", (event) => {
        const query = event.target.value.toLowerCase();
        $$("#borrowersTable tbody tr").forEach((row) => row.hidden = !row.dataset.search.includes(query));
      });
      $$("[data-borrower]").forEach((button) => button.addEventListener("click", () => {
        const matrix = button.dataset.borrower;
        const borrower = borrowerRows.find((row) => row.matrix === matrix);
        const history = records.filter((row) => row.matrix.toLowerCase() === matrix.toLowerCase());
        $("#borrowerHistory").innerHTML = `<h3>Sejarah ${escapeHtml(borrower.name)} (${escapeHtml(matrix)})</h3><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Basikal</th><th>Sesi</th><th>Hantar</th><th>Status</th></tr></thead><tbody>
          ${history.map((row) => `<tr><td>${fmt(row.borrowed_at)}</td><td>${escapeHtml(row.bike_no)}</td><td>${escapeHtml(row.session_name)}</td><td>${fmt(row.returned_at)}</td><td>${row.returned_at ? row.late ? "Lewat" : "Selesai" : "Aktif"}</td></tr>`).join("")}</tbody></table></div>`;
      }));
      return;
    }
    if (tab === "notes") {
      view.innerHTML = `<section class="section-card"><h2>Catatan Penyelia</h2><form id="noteForm" class="grid2"><div><label>No. Matrik</label><input name="matrix" required></div><div><label>Catatan</label><input name="text" required></div><button class="btn primary">Simpan Catatan</button></form>
        <div class="table-wrap"><table><thead><tr><th>Masa</th><th>Matrik</th><th>Nama</th><th>Catatan</th><th>Oleh</th></tr></thead><tbody>${[...data.notes].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((note) => `<tr><td>${fmt(note.created_at)}</td><td>${escapeHtml(note.matrix)}</td><td>${escapeHtml(note.name)}</td><td>${escapeHtml(note.text)}</td><td>${escapeHtml(note.created_by)}</td></tr>`).join("")}</tbody></table></div></section>`;
      $("#noteForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const result = await api("add_note", fields);
        alert(result.message);
        if (result.ok) await loadStaff();
      });
      return;
    }
    if (tab === "punishment") {
      view.innerHTML = `<section class="section-card"><h2>Bahagian Hukuman</h2><div class="table-wrap"><table><thead><tr><th>Matrik</th><th>Nama</th><th>Sebab</th><th>Mula</th><th>Tamat</th><th>Status</th></tr></thead><tbody>${[...data.punishments].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => `<tr><td>${escapeHtml(row.matrix)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.reason)}</td><td>${fmt(row.start_at)}</td><td>${fmt(row.until)}</td><td>${new Date(row.until) > new Date() ? "Sedang ditahan" : "Tamat"}</td></tr>`).join("")}</tbody></table></div></section>`;
      return;
    }
    if (tab === "stats") {
      const months = new Map();
      for (const record of records) {
        const month = record.borrowed_at.slice(0, 7);
        const value = months.get(month) || { total: 0, returned: 0, late: 0 };
        value.total++;
        if (record.returned_at) value.returned++;
        if (record.late) value.late++;
        months.set(month, value);
      }
      view.innerHTML = `<section class="section-card"><h2>Statistik Bulanan</h2><p class="muted">Pinjaman berkumpulan tidak dimasukkan kerana masa pinjam/pulang tidak direkodkan.</p><div class="table-wrap"><table><thead><tr><th>Bulan</th><th>Jumlah</th><th>Selesai</th><th>Lewat</th><th>Kadar Lewat</th></tr></thead><tbody>${[...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, item]) => `<tr><td>${month}</td><td>${item.total}</td><td>${item.returned}</td><td>${item.late}</td><td>${item.total ? (item.late / item.total * 100).toFixed(1) : "0.0"}%</td></tr>`).join("")}</tbody></table></div></section>`;
      return;
    }
    if (tab === "audit") {
      view.innerHTML = `<section class="section-card"><h2>Audit Log</h2><div class="table-wrap"><table><thead><tr><th>Masa</th><th>Pelaku</th><th>Tindakan</th><th>Matrik</th><th>Basikal</th><th>Butiran</th></tr></thead><tbody>${[...data.audit_logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => `<tr><td>${fmt(row.created_at)}</td><td>${escapeHtml(row.actor_name)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.matrix || "-")}</td><td>${escapeHtml(row.bike_no || "-")}</td><td>${escapeHtml(row.details || "-")}</td></tr>`).join("")}</tbody></table></div></section>`;
      return;
    }
    if (tab === "settings") {
      const s = data.app_settings[0];
      view.innerHTML = `<section class="section-card"><h2>Tetapan Sistem</h2><form id="settingsForm" class="grid2">
        <div><label>Nama garaj</label><input name="garage_name" value="${escapeHtml(s.garage_name)}" required>
          <label>Sesi 1 mula (AM/PM)</label><input name="session1_start" type="text" value="${escapeHtml(formatClock(s.session1_start))}" placeholder="5:15 PM" inputmode="text" pattern="(1[0-2]|0?[1-9]):[0-5][0-9]\\s*(AM|PM|am|pm)" required>
          <label>Sesi 1 tamat (AM/PM)</label><input name="session1_end" type="text" value="${escapeHtml(formatClock(s.session1_end))}" placeholder="6:00 PM" inputmode="text" pattern="(1[0-2]|0?[1-9]):[0-5][0-9]\\s*(AM|PM|am|pm)" required>
          <label>Sesi 2 mula (AM/PM)</label><input name="session2_start" type="text" value="${escapeHtml(formatClock(s.session2_start))}" placeholder="6:05 PM" inputmode="text" pattern="(1[0-2]|0?[1-9]):[0-5][0-9]\\s*(AM|PM|am|pm)" required>
          <label>Sesi 2 tamat (AM/PM)</label><input name="session2_end" type="text" value="${escapeHtml(formatClock(s.session2_end))}" placeholder="6:50 PM" inputmode="text" pattern="(1[0-2]|0?[1-9]):[0-5][0-9]\\s*(AM|PM|am|pm)" required></div>
        <div><label>Kapasiti sesi</label><input name="session_capacity" type="number" min="1" max="28" value="${s.session_capacity}" required>
          <label>Tempoh tahanan (hari)</label><input name="suspension_days" type="number" min="1" max="30" value="${s.suspension_days}" required>
          <label>Peringatan 10 minit</label><select name="warning_10min"><option value="true" ${s.warning_10min ? "selected" : ""}>Aktif</option><option value="false" ${!s.warning_10min ? "selected" : ""}>Tutup</option></select>
          <label>Peringatan 5 minit</label><select name="warning_5min"><option value="true" ${s.warning_5min ? "selected" : ""}>Aktif</option><option value="false" ${!s.warning_5min ? "selected" : ""}>Tutup</option></select></div>
          <button class="btn primary">Simpan Tetapan</button></form><hr><h3>Tukar Kata Laluan</h3><form id="passwordForm" class="grid2"><div><label>Kata laluan lama</label><input type="password" name="old_password" required></div><div><label>Kata laluan baharu</label><input type="password" name="new_password" minlength="10" required></div><button class="btn primary">Tukar Kata Laluan</button></form><hr><button id="backupButton" class="btn secondary">Eksport rekod CSV</button><p class="muted">Backup automatik dan pemulihan point-in-time tidak termasuk dalam Supabase Free; eksport CSV berkala disyorkan.</p></section>`;
      $("#settingsForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const fields = Object.fromEntries(form);
        const sessionTimes = {};
        for (const key of ["session1_start", "session1_end", "session2_start", "session2_end"]) {
          sessionTimes[key] = parseClock(fields[key]);
          if (!sessionTimes[key]) {
            alert(`Format masa bagi ${key.replaceAll("_", " ")} tidak sah. Gunakan format 5:15 PM.`);
            return;
          }
        }
        const result = await api("update_settings", { settings: {
          ...fields,
          ...sessionTimes,
          session_capacity: Number(fields.session_capacity),
          suspension_days: Number(fields.suspension_days),
          warning_10min: fields.warning_10min === "true",
          warning_5min: fields.warning_5min === "true",
        } });
        alert(result.message);
        if (result.ok) await loadStaff();
      });
      $("#passwordForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: staff.email, password: fields.old_password });
        if (verifyError) { alert("Kata laluan lama salah."); return; }
        const { error } = await supabase.auth.updateUser({ password: fields.new_password });
        alert(error?.message || "Kata laluan berjaya ditukar.");
        if (!error) event.currentTarget.reset();
      });
      $("#backupButton").addEventListener("click", () => exportCsv(data));
    }
  }

  function fmt(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "-";
    const dateText = new Intl.DateTimeFormat("ms-MY", {
      timeZone: "Asia/Kuala_Lumpur", dateStyle: "short",
    }).format(date);
    const timeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(date);
    const hour = timeParts.find((part) => part.type === "hour")?.value;
    const minute = timeParts.find((part) => part.type === "minute")?.value;
    const period = timeParts.find((part) => part.type === "dayPeriod")?.value.toUpperCase();
    return `${dateText} ${hour}:${minute} ${period}`;
  }

  function filterRecords() {
    const query = ($("#recordSearch")?.value || "").toLowerCase();
    const status = $("#recordFilter")?.value || "";
    const session = $("#sessionFilter")?.value || "";
    $$("#recordsTable tbody tr").forEach((row) => {
      row.hidden = !!((query && !row.dataset.search.includes(query)) ||
        (status && row.dataset.status !== status) || (session && row.dataset.session !== session));
    });
  }

  function exportCsv(data) {
    const headers = ["Jenis", "ID", "Nama/Pensyarah", "Kelas/Kelab", "No. Matrik", "Basikal", "Sesi", "Tarikh Ambil", "Tarikh Hantar", "Status", "Catatan"];
    const rows = [
      ...data.records.map((record) => ["Individu", record.id, record.name, "", record.matrix, record.bike_no,
        record.session_name, record.borrowed_at, record.returned_at || "", record.returned_at ? record.late ? "Lewat" : "Selesai" : "Aktif", record.manual_return_note || ""]),
      ...data.group_loans.map((loan) => ["Berkumpulan", loan.id, loan.lecturer_name, loan.class_club, "",
        data.group_loan_bikes.filter((bike) => bike.group_loan_id === loan.id).map((bike) => bike.bike_no).join(", "),
        "Luar sesi", "", "", loan.is_active ? "Aktif" : "Selesai", loan.return_note || ""]),
    ];
    const csv = [headers, ...rows].map((row) => row.map((item) => {
      let value = String(item ?? "");
      if (/^[\t\r ]*[=+\-@]/.test(value)) value = `'${value}`;
      return `"${value.replaceAll('"', '""')}"`;
    }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rekod_garaj_basikal.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadStaff() {
    const result = await api("staff_data");
    if (!result.ok) throw new Error(result.message);
    renderDashboard(result.data, result.staff);
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    if (error || !data.session) {
      showMessage($("#loginResult"), error?.message || "Log masuk gagal.", false);
      return;
    }
    try {
      const claim = await api("staff_claim_invite");
      if (!claim.ok) throw new Error(claim.message);
      await loadStaff();
    } catch (error) {
      await supabase.auth.signOut();
      showMessage($("#loginResult"), error.message, false);
    }
  });

  $("#resetPasswordButton").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    if (!email) {
      showMessage($("#loginResult"), "Masukkan e-mel akaun terlebih dahulu.", false);
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      showMessage($("#loginResult"), error?.message || "Jika akaun itu wujud, pautan set semula telah dihantar.", !error);
    } catch (error) {
      showMessage($("#loginResult"), error instanceof Error ? error.message : "Pautan set semula tidak dapat diminta.", false);
    }
  });

  $("#credentialForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#newPassword").value;
    if (password.length < 12) {
      showMessage($("#credentialResult"), "Kata laluan mestilah sekurang-kurangnya 12 aksara.", false);
      return;
    }
    if (password !== $("#confirmPassword").value) {
      showMessage($("#credentialResult"), "Pengesahan kata laluan tidak sepadan.", false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      showMessage($("#credentialResult"), error.message, false);
      return;
    }
    try {
      const claim = await api("staff_claim_invite");
      if (!claim.ok) throw new Error(claim.message);
      await loadStaff();
      $("#credentialCard").hidden = true;
    } catch (error) {
      showMessage($("#credentialResult"), error instanceof Error ? error.message : "Akaun staf tidak dapat disahkan.", false);
    }
  });

  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
      if (["invite", "recovery", "code"].includes(authFlowType)) {
        showMessage($("#loginResult"), "Pautan tidak sah atau telah tamat tempoh. Minta pautan baharu.", false);
      }
      return;
    }
    if (["invite", "recovery", "code"].includes(authFlowType)) {
      $("#loginCard").hidden = true;
      $("#credentialCard").hidden = false;
      return;
    }
    try {
      const claim = await api("staff_claim_invite");
      if (!claim.ok) return;
      await loadStaff();
    } catch (error) {
      await supabase.auth.signOut();
      showMessage($("#loginResult"), error instanceof Error ? error.message : "Sesi staf tidak dapat dipulihkan.", false);
    }
  }).catch((error) => {
    showMessage($("#loginResult"), error instanceof Error ? error.message : "Sesi log masuk tidak dapat diperiksa.", false);
  });
  showPublicPage();
  if (garage && !groupMode) setInterval(showPublicPage, 30_000);
}
