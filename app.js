import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let qrCodeModule;
async function generateBikeQr(bikeNo, garageQr, width) {
  if (!garageQr) throw new Error("Kod QR garaj belum ditetapkan.");
  qrCodeModule ??= import("https://esm.sh/qrcode@1.5.4").then((module) => module.default);
  const QRCode = await qrCodeModule;
  const qrUrl = new URL(location.pathname, location.origin);
  qrUrl.searchParams.set("garage", garageQr);
  qrUrl.searchParams.set("bike", bikeNo);
  return QRCode.toDataURL(qrUrl.toString(), { width, margin: 2 });
}
document.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && !image.dataset.fallback) {
    image.dataset.fallback = "true";
    image.src = "qr-placeholder.svg";
  }
}, true);
const params = new URLSearchParams(location.search);
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

  function renderDashboard(data, staff, initialTab = "records") {
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
        ${staff.role === "admin" ? '<button data-tab="overview" class="tab">Sistem</button><button data-tab="bikes" class="tab">Basikal</button><button data-tab="borrowers" class="tab">Peminjam</button>' : ""}
        <button data-tab="attendance" class="tab">Kehadiran</button>
        <button data-tab="records" class="tab active">Rekod</button>
        <button data-tab="notes" class="tab">Catatan</button>
        ${staff.role === "admin" ? '<button data-tab="punishment" class="tab">Hukuman Peminjam</button><button data-tab="keeper-discipline" class="tab">Hukuman Penjaga</button><button data-tab="stats" class="tab">Statistik</button><button data-tab="audit" class="tab">Audit Log</button><button data-tab="settings" class="tab">Tetapan</button>' : ""}
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
    $$("#staffTabs .tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === initialTab));
    renderTab(initialTab, data, staff);
  }

  function renderTab(tab, data, staff) {
    const view = $("#staffView");
    if (!view) return;
    const records = [...data.records].sort((a, b) => String(b.borrowed_at).localeCompare(String(a.borrowed_at)));
    const groups = [...data.group_loans].map((loan) => ({
      ...loan,
      bikes: data.group_loan_bikes.filter((bike) => bike.group_loan_id === loan.id).map((bike) => bike.bike_no).sort(),
    }));
    if (tab === "attendance") {
      const today = shiftDateToday();
      const attendance = data.keeper_attendance.find((row) => row.staff_user_id === staff.user_id && row.shift_date === today);
      const currentSeconds = staff.role === "penjaga" ? shiftSecondsNow() : 0;
      const isLateCheckIn = currentSeconds > 17 * 3600 + 15 * 60;
      const canCheckOut = currentSeconds > 18 * 3600 + 50 * 60;
      const attendanceRows = [...data.keeper_attendance].sort((a, b) =>
        `${b.shift_date} ${b.checked_in_at}`.localeCompare(`${a.shift_date} ${a.checked_in_at}`)
      );
      view.innerHTML = `${staff.role === "penjaga" ? `<section class="section-card"><h2>Thumbprint Kehadiran Penjaga</h2>
        <p class="muted">Syif bermula 5:15 petang. Rekod masuk sebelum 5:15 petang; jika thumbprint masuk selepas waktu itu, pilih sebab. Thumbprint keluar dibuka selepas 6:50 petang.</p>
        <div class="mini-list">
          <div class="mini-row"><span>Tarikh syif</span><b>${escapeHtml(today)}</b></div>
          <div class="mini-row"><span>Thumbprint masuk</span><b>${attendance ? fmt(attendance.checked_in_at) : "Belum direkodkan"}</b></div>
          <div class="mini-row"><span>Thumbprint keluar</span><b>${attendance?.checked_out_at ? fmt(attendance.checked_out_at) : "Belum direkodkan"}</b></div>
        </div>
        <form id="keeperCheckInForm" class="grid2">
          ${isLateCheckIn ? `<div><label for="keeperLateReason">Sebab thumbprint masuk lewat</label><select id="keeperLateReason" name="late_reason" required><option value="">Pilih sebab</option><option value="garage_opened_late">Garaj lambat buka</option><option value="late_for_duty">Terlambat bertugas</option><option value="other">Lain-lain</option></select></div>
          <div id="keeperLateOtherWrap" hidden><label for="keeperLateReasonNote">Nyatakan sebab lain</label><input id="keeperLateReasonNote" name="late_reason_note" maxlength="500"></div>` : ""}
          <button class="btn primary" ${attendance ? "disabled" : ""}>Thumbprint Masuk</button>
        </form>
        <button id="keeperCheckOutButton" class="btn secondary" ${!attendance || attendance.checked_out_at || !canCheckOut ? "disabled" : ""}>Thumbprint Keluar</button>
        <div id="keeperAttendanceResult" aria-live="polite"></div></section>` : ""}
        <section class="section-card"><h2>Rekod Kehadiran${staff.role === "admin" ? " Semua Penjaga" : ""}</h2>
        <div class="table-wrap"><table><thead><tr>${staff.role === "admin" ? "<th>Penjaga</th>" : ""}<th>Tarikh Syif</th><th>Masuk</th><th>Sebab Lewat</th><th>Catatan Sebab Lain</th><th>Keluar</th></tr></thead><tbody>
        ${attendanceRows.map((row) => `<tr>${staff.role === "admin" ? `<td>${escapeHtml(row.staff_name)} (${escapeHtml(row.staff_username)})</td>` : ""}<td>${escapeHtml(row.shift_date)}</td><td>${fmt(row.checked_in_at)}</td><td>${escapeHtml(lateReasonLabel(row.late_reason))}</td><td>${escapeHtml(row.late_reason_note || "-")}</td><td>${fmt(row.checked_out_at)}</td></tr>`).join("")}
        </tbody></table></div></section>`;
      $("#keeperLateReason")?.addEventListener("change", (event) => {
        const otherWrap = $("#keeperLateOtherWrap");
        const otherNote = $("#keeperLateReasonNote");
        const isOther = event.currentTarget.value === "other";
        otherWrap.hidden = !isOther;
        otherNote.required = isOther;
      });
      $("#keeperCheckInForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const result = await api("keeper_check_in", {
          late_reason: fields.get("late_reason") || "",
          late_reason_note: fields.get("late_reason_note") || "",
        });
        await loadStaff("attendance");
        showMessage($("#keeperAttendanceResult"), result.message, result.ok);
      });
      $("#keeperCheckOutButton")?.addEventListener("click", async () => {
        const result = await api("keeper_check_out");
        await loadStaff("attendance");
        showMessage($("#keeperAttendanceResult"), result.message, result.ok);
      });
      return;
    }
    if (tab === "overview") {
      const setting = data.app_settings[0];
      view.innerHTML = `<section class="section-card"><h2>Status Sistem</h2>
        <div class="grid2"><div class="mini-list">
          <div class="mini-row"><span>Pangkalan data</span><b>Supabase PostgreSQL</b></div>
          <div class="mini-row"><span>Basikal</span><b>${data.bikes.filter((b) => b.status === "available").length} tersedia / ${data.bikes.filter((b) => b.status === "borrowed").length} dipinjam / ${data.bikes.filter((b) => b.status === "damaged").length} rosak</b></div>
          <div class="mini-row"><span>Kapasiti Sesi 1</span><b>${records.filter((r) => r.session_name === "Sesi 1" && !r.returned_at).length}/${setting.session_capacity}</b></div>
          <div class="mini-row"><span>Kapasiti Sesi 2</span><b>${records.filter((r) => r.session_name === "Sesi 2" && !r.returned_at).length}/${setting.session_capacity}</b></div>
        </div><div><h3>QR</h3><img src="qr-placeholder.svg" data-qr-src="qr_garaj_basikal.png" width="160" alt="QR garaj"><img src="qr-placeholder.svg" data-qr-src="qr_pinjaman_berkumpulan.png" width="160" alt="QR pinjaman berkumpulan"></div></div></section>
        <section class="section-card"><h2>Tambah Akaun Staf</h2><p class="muted">Akaun menggunakan username dan kata laluan sahaja. Admin memberikan kata laluan awal secara peribadi dan boleh menetapkan semula kata laluan.</p>
          <form id="staffCreateForm" class="grid2"><div><label>Username</label><input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="off"></div><div><label>Nama paparan</label><input name="display_name" required maxlength="100"></div>
          <div><label>Peranan</label><select name="role"><option value="penjaga">Penjaga</option><option value="admin">Admin</option></select></div><div><label>Kata laluan awal (12-72 aksara)</label><input name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password"></div>
          <div class="align-end"><button class="btn primary">Cipta Akaun</button></div></form>
          <div class="table-wrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Peranan</th><th>Status</th><th>Tetapkan Semula Kata Laluan</th><th>Akses</th></tr></thead><tbody>
          ${data.staff_profiles.map((profile) => `<tr><td>${escapeHtml(profile.username)}</td><td>${escapeHtml(profile.display_name)}</td>
            <td><select data-staff-role="${escapeHtml(profile.user_id)}"><option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option><option value="penjaga" ${profile.role === "penjaga" ? "selected" : ""}>Penjaga</option></select></td>
            <td>${profile.active ? "Aktif" : "Nyahaktif"}</td>
            <td><form class="staff-password-form" data-staff-password="${escapeHtml(profile.user_id)}"><input name="password" type="password" required minlength="12" maxlength="72" autocomplete="new-password" aria-label="Kata laluan baharu untuk ${escapeHtml(profile.username)}"><button class="btn small secondary">Tetapkan</button></form></td>
            <td><button class="btn small secondary" data-staff-toggle="${escapeHtml(profile.user_id)}" data-active="${!profile.active}">${profile.active ? "Nyahaktif" : "Aktifkan"}</button></td></tr>`).join("")}
          </tbody></table></div></section>`;
      $("#staffCreateForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const result = await api("staff_create", fields);
        alert(result.message);
        if (result.ok) {
          event.currentTarget.reset();
          await loadStaff();
        }
      });
      $$(".staff-password-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const result = await api("staff_password_reset", {
          user_id: form.dataset.staffPassword,
          password: fields.get("password"),
        });
        alert(result.message);
        if (result.ok) event.currentTarget.reset();
      }));
      $$("[data-staff-toggle]").forEach((button) => button.addEventListener("click", async () => {
        const role = $(`[data-staff-role="${button.dataset.staffToggle}"]`).value;
        const result = await api("staff_update", { user_id: button.dataset.staffToggle, role, active: button.dataset.active === "true" });
        alert(result.message);
        if (result.ok) await loadStaff();
      }));
      return;
    }
    if (tab === "bikes") {
      view.innerHTML = `<section class="section-card"><h2>Pengurusan Basikal</h2><p class="muted">Admin boleh menukar nombor basikal apabila tidak sedang dipinjam. Sejarah pinjaman akan ikut nombor baharu; selepas tukar nombor, cetak dan ganti QR lama.</p>
        <div class="qr-grid">${data.bikes.map((bike) => `<div class="qr-item"><img src="qr-placeholder.svg" class="bike-qr" data-bike-qr="${escapeHtml(bike.bike_no)}" alt="QR ${escapeHtml(bike.bike_no)}"><p class="muted qr-error" data-qr-error hidden></p><h3>${escapeHtml(bike.bike_no)}</h3>
          <span class="badge ${bike.status === "available" ? "green" : bike.status === "borrowed" ? "blue" : bike.status === "damaged" ? "red" : "gray"}">${escapeHtml(bike.status.toUpperCase())}</span>
          <form class="bike-form" data-bike="${escapeHtml(bike.bike_no)}"><label>Nombor basikal</label><input name="new_bike_no" value="${escapeHtml(bike.bike_no)}" maxlength="20" pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,19}" title="1–20 aksara: huruf, nombor, sempang atau garis bawah" required><select name="status"><option value="available" ${bike.status === "available" ? "selected" : ""}>Tersedia</option><option value="damaged" ${bike.status === "damaged" ? "selected" : ""}>Rosak</option><option value="inactive" ${bike.status === "inactive" ? "selected" : ""}>Tidak digunakan</option></select>
          <input name="damage_note" value="${escapeHtml(bike.damage_note)}" placeholder="Catatan"><button class="btn small primary">Simpan</button></form></div>`).join("")}</div></section>`;
      $$(".bike-qr", view).forEach(async (image) => {
        try {
          image.src = await generateBikeQr(image.dataset.bikeQr, data.app_settings[0].garage_qr, 240);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Ralat tidak diketahui";
          const errorNotice = image.parentElement.querySelector("[data-qr-error]");
          errorNotice.textContent = `QR gagal dijana: ${message}`;
          errorNotice.hidden = false;
          console.error(`QR basikal ${image.dataset.bikeQr} gagal dijana:`, error);
        }
      });
      $$(".bike-form").forEach((form) => form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(form));
        const bikeNo = form.dataset.bike;
        const newBikeNo = String(fields.new_bike_no).trim().toUpperCase();
        const result = await api("bike_update", { bike_no: bikeNo, ...fields, new_bike_no: newBikeNo });
        alert(result.message);
        if (!result.ok) return;
        await loadStaff(newBikeNo !== bikeNo ? "bikes" : "records");
        if (newBikeNo !== bikeNo) {
          try {
            const imageUrl = await generateBikeQr(newBikeNo, data.app_settings[0].garage_qr, 480);
            const download = document.createElement("a");
            download.href = imageUrl;
            download.download = `QR_${newBikeNo}.png`;
            download.click();
          } catch (error) {
            alert(`Nombor basikal telah ditukar, tetapi QR baharu gagal dijana: ${error instanceof Error ? error.message : "Ralat tidak diketahui"}. Sila jana dan cetak QR basikal ${newBikeNo} sebelum digunakan.`);
            return;
          }
          alert(`QR baharu basikal ${newBikeNo} telah dimuat turun. Cetak dan gantikan pelekat QR lama sebelum basikal digunakan.`);
        }
      }));
      return;
    }
    if (tab === "records") {
      view.innerHTML = `<section class="section-card"><div class="card-head"><div><h2>Rekod Pinjaman</h2><p class="muted">Pemulangan manual hanya untuk penjaga/admin.</p></div>
        ${staff.role === "admin" ? '<button id="exportExcel" class="btn primary">Eksport Excel</button>' : ""}</div>
        <div class="searchbar"><input id="recordSearch" placeholder="Cari matrik / nama / basikal"><select id="recordFilter"><option value="">Semua</option><option value="active">Sedang dipinjam</option><option value="late">Lewat</option><option value="done">Selesai</option></select><select id="sessionFilter"><option value="">Semua sesi</option><option>Sesi 1</option><option>Sesi 2</option></select><button id="refreshStaff" class="btn secondary">Segar</button></div>
        <div class="table-wrap"><table id="recordsTable"><thead><tr><th>Tarikh</th><th>Matrik</th><th>Nama</th><th>Basikal</th><th>Sesi</th><th>Ambil</th><th>Hantar</th><th>Status</th><th>Catatan Lewat/Hukuman</th><th>Catatan Manual</th><th>Tindakan</th></tr></thead><tbody>
        ${records.map((record) => `<tr data-search="${escapeHtml(`${record.matrix} ${record.name} ${record.bike_no}`.toLowerCase())}" data-status="${record.returned_at ? record.late ? "late" : "done" : "active"}" data-session="${escapeHtml(record.session_name)}">
          <td>${fmt(record.borrowed_at)}</td><td><b>${escapeHtml(record.matrix)}</b></td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(record.bike_no)}</td><td>${escapeHtml(record.session_name)}</td><td>${fmt(record.borrowed_at)}</td><td>${fmt(record.returned_at)}</td>
          <td>${record.returned_at ? record.late ? '<span class="badge red">Lewat</span>' : '<span class="badge green">Selesai</span>' : '<span class="badge blue">Aktif</span>'} ${record.manual_return ? '<span class="badge gray">Manual</span>' : ""}</td>
          <td>${returnException(record)}</td>
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
      $("#exportExcel")?.addEventListener("click", () => {
        exportExcel(data).catch((error) => alert(`Eksport Excel gagal: ${error.message}`));
      });
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
        $("#borrowerHistory").innerHTML = `<h3>Sejarah ${escapeHtml(borrower.name)} (${escapeHtml(matrix)})</h3><div class="table-wrap"><table><thead><tr><th>Tarikh</th><th>Basikal</th><th>Sesi</th><th>Hantar</th><th>Status</th><th>Catatan Lewat/Hukuman</th></tr></thead><tbody>
          ${history.map((row) => `<tr><td>${fmt(row.borrowed_at)}</td><td>${escapeHtml(row.bike_no)}</td><td>${escapeHtml(row.session_name)}</td><td>${fmt(row.returned_at)}</td><td>${row.returned_at ? row.late ? "Lewat" : "Selesai" : "Aktif"}</td><td>${returnException(row)}</td></tr>`).join("")}</tbody></table></div>`;
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
      view.innerHTML = `<section class="section-card"><h2>Hukuman Peminjam</h2><div class="table-wrap"><table><thead><tr><th>Matrik</th><th>Nama</th><th>Sebab</th><th>Mula</th><th>Tamat</th><th>Status</th></tr></thead><tbody>${[...data.punishments].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => `<tr><td>${escapeHtml(row.matrix)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.reason)}</td><td>${fmt(row.start_at)}</td><td>${fmt(row.until)}</td><td>${new Date(row.until) > new Date() ? "Sedang ditahan" : "Tamat"}</td></tr>`).join("")}</tbody></table></div></section>`;
      return;
    }
    if (tab === "keeper-discipline" && staff.role === "admin") {
      const keepers = data.staff_profiles.filter((profile) => profile.role === "penjaga");
      view.innerHTML = `<section class="section-card"><h2>Rekod Amaran / Kesalahan Penjaga</h2><p class="muted">Rekod ini untuk dokumentasi sahaja dan tidak menyekat akaun secara automatik.</p>
        <form id="keeperDisciplineForm" class="grid2"><div><label for="keeperDisciplineUser">Penjaga</label><select id="keeperDisciplineUser" name="keeper_user_id" required><option value="">Pilih penjaga</option>${keepers.map((keeper) => `<option value="${escapeHtml(keeper.user_id)}">${escapeHtml(keeper.display_name)} (${escapeHtml(keeper.username)})</option>`).join("")}</select></div>
        <div><label for="keeperDisciplineCategory">Jenis kesalahan / amaran</label><input id="keeperDisciplineCategory" name="category" maxlength="100" required></div>
        <div><label for="keeperDisciplineNote">Catatan</label><textarea id="keeperDisciplineNote" name="note" maxlength="1000" rows="3"></textarea></div>
        <div class="align-end"><button class="btn primary">Simpan Rekod</button></div></form><div id="keeperDisciplineResult" aria-live="polite"></div></section>
        <section class="section-card"><h2>Sejarah Rekod Penjaga</h2><div class="table-wrap"><table><thead><tr><th>Masa</th><th>Penjaga</th><th>Jenis Kesalahan / Amaran</th><th>Catatan</th><th>Direkodkan Oleh</th></tr></thead><tbody>
        ${[...data.keeper_discipline].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => `<tr><td>${fmt(row.created_at)}</td><td>${escapeHtml(row.keeper_name)} (${escapeHtml(row.keeper_username)})</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.note || "-")}</td><td>${escapeHtml(row.created_by_name)}</td></tr>`).join("")}
        </tbody></table></div></section>`;
      $("#keeperDisciplineForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        const result = await api("keeper_discipline_create", fields);
        if (result.ok) await loadStaff("keeper-discipline");
        showMessage($("#keeperDisciplineResult"), result.message, result.ok);
      });
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
          <button class="btn primary">Simpan Tetapan</button></form><hr><h3>Tukar Kata Laluan</h3><form id="passwordForm" class="grid2"><div><label>Kata laluan baharu (12-72 aksara)</label><input type="password" name="new_password" minlength="12" maxlength="72" required autocomplete="new-password"></div><button class="btn primary">Tukar Kata Laluan</button></form><hr><button id="backupButton" class="btn secondary">Eksport rekod Excel (.xlsx)</button><p class="muted">Backup automatik dan pemulihan point-in-time tidak termasuk dalam Supabase Free; eksport Excel berkala disyorkan.</p></section>`;
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
        const { error } = await supabase.auth.updateUser({ password: fields.new_password });
        alert(error?.message || "Kata laluan berjaya ditukar.");
        if (!error) event.currentTarget.reset();
      });
      $("#backupButton").addEventListener("click", () => {
        exportExcel(data).catch((error) => alert(`Eksport Excel gagal: ${error.message}`));
      });
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

  function shiftDateToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function shiftSecondsNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    return Number(parts.find((part) => part.type === "hour")?.value || 0) * 3600 +
      Number(parts.find((part) => part.type === "minute")?.value || 0) * 60 +
      Number(parts.find((part) => part.type === "second")?.value || 0);
  }

  function lateReasonLabel(reason) {
    return ({
      garage_opened_late: "Garaj lambat buka",
      late_for_duty: "Terlambat bertugas",
      other: "Lain-lain",
    })[reason] || "-";
  }

  function returnException(record) {
    if (record.punishment_until) return `Tahanan kad matrik hingga ${fmt(record.punishment_until)}`;
    return record.warning_issued ? "Amaran lewat direkodkan" : "-";
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

  async function exportExcel(data) {
    const XLSX = (await import("https://esm.sh/xlsx-js-style@1.2.0")).default;
    const headers = ["Jenis", "ID", "Nama / Pensyarah", "Kelas / Kelab", "No. Matrik", "Basikal",
      "Sesi", "Tarikh Ambil", "Tarikh Hantar", "Status", "Catatan", "Catatan Lewat / Hukuman"];
    const rows = [
      ...data.records.map((record) => ["Individu", record.id, record.name, "", record.matrix, record.bike_no,
        record.session_name, fmt(record.borrowed_at), fmt(record.returned_at),
        record.returned_at ? record.late ? "Lewat" : "Selesai" : "Aktif",
        record.manual_return_note || "", returnException(record)]),
      ...data.group_loans.map((loan) => ["Berkumpulan", loan.id, loan.lecturer_name, loan.class_club, "",
        data.group_loan_bikes.filter((bike) => bike.group_loan_id === loan.id).map((bike) => bike.bike_no).join(", "),
        "Luar sesi", "-", "-", loan.is_active ? "Aktif" : "Selesai", loan.return_note || "", "-"]),
    ];
    const lateCount = data.records.filter((record) => record.late).length;
    const activeCount = data.records.filter((record) => !record.returned_at).length +
      data.group_loans.filter((loan) => loan.is_active).length;
    const exportedAt = fmt(new Date().toISOString());
    const sheet = XLSX.utils.aoa_to_sheet([
      ["REKOD PINJAMAN BASIKAL"],
      [`Dieksport pada ${exportedAt}`],
      [`Jumlah rekod: ${rows.length}   |   Lewat: ${lateCount}   |   Pinjaman aktif: ${activeCount}`],
      headers,
      ...rows,
    ]);
    sheet["!merges"] = [0, 1, 2].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: headers.length - 1 } }));
    sheet["!cols"] = [
      { wch: 15 }, { wch: 38 }, { wch: 26 }, { wch: 22 }, { wch: 18 }, { wch: 14 },
      { wch: 15 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 34 },
    ];
    sheet["!rows"] = [{ hpt: 34 }, { hpt: 24 }, { hpt: 24 }, { hpt: 32 },
      ...rows.map(() => ({ hpt: 32 }))];
    sheet["!autofilter"] = { ref: `A4:L${Math.max(rows.length + 4, 4)}` };
    const cellStyle = (cell, style) => {
      cell.s = style;
    };
    cellStyle(sheet.A1, {
      font: { name: "Aptos Display", sz: 18, bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "162A55" } },
      alignment: { vertical: "center" },
    });
    cellStyle(sheet.A2, {
      font: { name: "Aptos", sz: 10, italic: true, color: { rgb: "475569" } },
      alignment: { vertical: "center" },
    });
    cellStyle(sheet.A3, {
      font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "162A55" } },
      fill: { fgColor: { rgb: "EAF0F8" } },
      alignment: { vertical: "center" },
    });
    headers.forEach((_, column) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: 3, c: column })];
      cellStyle(cell, {
        font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "284778" } },
        alignment: { vertical: "center", wrapText: true },
        border: { bottom: { style: "medium", color: { rgb: "162A55" } } },
      });
    });
    rows.forEach((row, rowIndex) => {
      row.forEach((value, column) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex + 4, c: column })];
        const stripe = rowIndex % 2 ? "FFFFFF" : "F1F5F9";
        cellStyle(cell, {
          font: { name: "Aptos", sz: 10, color: { rgb: "1E293B" } },
          fill: { fgColor: { rgb: stripe } },
          alignment: { vertical: "top", wrapText: true },
          border: { bottom: { style: "hair", color: { rgb: "CBD5E1" } } },
        });
        if (column === 9) {
          const colors = { Lewat: ["FFE4E6", "9F1239"], Aktif: ["DBEAFE", "1D4ED8"], Selesai: ["DCFCE7", "166534"] };
          const [fill, color] = colors[value] || [];
          if (fill) {
            cell.s.fill = { fgColor: { rgb: fill } };
            cell.s.font = { name: "Aptos", sz: 10, bold: true, color: { rgb: color } };
          }
        }
        if (column === 11 && value && value !== "-") {
          cell.s.font = { name: "Aptos", sz: 10, bold: true, color: { rgb: "9A3412" } };
        }
      });
    });
    const workbook = XLSX.utils.book_new();
    workbook.Props = { Title: "Rekod Pinjaman Basikal", Author: "Sistem Garaj Basikal" };
    XLSX.utils.book_append_sheet(workbook, sheet, "Rekod Pinjaman");
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const url = URL.createObjectURL(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rekod_garaj_basikal_${date}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadStaff(initialTab = "records") {
    const result = await api("staff_data");
    if (!result.ok) throw new Error(result.message);
    renderDashboard(result.data, result.staff, initialTab);
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username")).trim().toLowerCase();
    const result = await api("staff_login", { username, password: String(form.get("password")) });
    if (!result.ok || !result.access_token || !result.refresh_token) {
      showMessage($("#loginResult"), result.message || "Username atau kata laluan tidak sah.", false);
      return;
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    });
    if (sessionError) {
      showMessage($("#loginResult"), sessionError.message, false);
      return;
    }
    try {
      await loadStaff();
    } catch (error) {
      await supabase.auth.signOut();
      showMessage($("#loginResult"), error.message, false);
    }
  });

  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) return;
    try {
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
