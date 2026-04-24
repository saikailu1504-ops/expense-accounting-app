const state = {
  categories: [],
  expenses: [],
  currencies: [],
  user: null,
  authMode: "login",
  monthChart: null,
  categoryChart: null
};

const categoryMap = () => Object.fromEntries(state.categories.map((c) => [c.id, c.name]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2200);
}

function fillCurrencyDropdown() {
  const select = document.getElementById("expense-currency");
  select.innerHTML = state.currencies.map((cur) => `<option value="${cur}">${cur}</option>`).join("");
}

function fillCategoryDropdown() {
  const select = document.getElementById("expense-category");
  select.innerHTML = state.categories.map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join("");
}

function setViewAuthenticated(isAuthenticated) {
  document.getElementById("auth-view").classList.toggle("hidden", isAuthenticated);
  document.getElementById("app-view").classList.toggle("hidden", !isAuthenticated);
  const userPanel = document.getElementById("user-panel");
  userPanel.classList.toggle("hidden", !isAuthenticated);
  document.getElementById("welcome-user").textContent = isAuthenticated
    ? `Hi, ${state.user.fullName}`
    : "";
}

function renderCategoryList() {
  const list = document.getElementById("category-list");
  list.innerHTML = "";
  state.categories.forEach((cat) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${cat.name}</span>
      <div class="actions">
        <button class="btn-secondary" data-cat-edit="${cat.id}">Edit</button>
        <button class="btn-danger" data-cat-delete="${cat.id}">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function formatAmount(value) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderExpenses() {
  const tbody = document.getElementById("expense-table-body");
  const catMap = categoryMap();
  tbody.innerHTML = "";
  state.expenses.forEach((exp) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${exp.date}</td>
      <td>${catMap[exp.categoryId] || "Uncategorized"}</td>
      <td>${exp.description || "-"}</td>
      <td>${formatAmount(exp.amount)}</td>
      <td>${exp.currency}</td>
      <td>
        <div class="actions">
          <button class="btn-secondary" data-exp-edit="${exp.id}">Edit</button>
          <button class="btn-danger" data-exp-delete="${exp.id}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMonthlyCards(stats) {
  const container = document.getElementById("monthly-cards");
  container.innerHTML = "";
  const months = Object.keys(stats.byMonth).sort().reverse();
  if (!months.length) {
    container.innerHTML = "<p>No expense data available.</p>";
    return;
  }
  months.forEach((month) => {
    const card = document.createElement("article");
    card.className = "month-card";
    card.innerHTML = `<h4>${month}</h4><p>${formatAmount(stats.byMonth[month])}</p>`;
    container.appendChild(card);
  });
}

function updateCharts(stats) {
  const monthLabels = Object.keys(stats.byMonth).sort();
  const monthData = monthLabels.map((key) => stats.byMonth[key]);

  const categoryLabels = Object.keys(stats.byCategory).sort();
  const categoryData = categoryLabels.map((key) => stats.byCategory[key]);

  if (state.monthChart) state.monthChart.destroy();
  if (state.categoryChart) state.categoryChart.destroy();

  state.monthChart = new Chart(document.getElementById("month-chart"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{ label: "Total Spend", data: monthData, backgroundColor: "#265dff" }]
    },
    options: { responsive: true, maintainAspectRatio: false, aspectRatio: 2 }
  });

  state.categoryChart = new Chart(document.getElementById("category-chart"), {
    type: "doughnut",
    data: {
      labels: categoryLabels,
      datasets: [{
        label: "By Category",
        data: categoryData,
        backgroundColor: ["#265dff", "#648fff", "#8bb3ff", "#c5d8ff", "#1f3f8f", "#90caf9", "#bbdefb"]
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, aspectRatio: 2 }
  });
}

async function refreshAll() {
  const [categories, expenses, stats] = await Promise.all([
    api("/api/categories"),
    api("/api/expenses"),
    api("/api/stats")
  ]);

  state.categories = categories;
  state.expenses = expenses;
  fillCategoryDropdown();
  renderCategoryList();
  renderExpenses();
  renderMonthlyCards(stats);
  updateCharts(stats);
}

function resetCategoryForm() {
  document.getElementById("category-id").value = "";
  document.getElementById("category-name").value = "";
  document.getElementById("cancel-category-edit").classList.add("hidden");
}

function resetExpenseForm() {
  document.getElementById("expense-id").value = "";
  document.getElementById("expense-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("expense-amount").value = "";
  document.getElementById("expense-description").value = "";
  document.getElementById("cancel-expense-edit").classList.add("hidden");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registerMode = mode === "register";
  document.getElementById("auth-title").textContent = registerMode ? "Create Account" : "Login";
  document.getElementById("auth-submit").textContent = registerMode ? "Create account" : "Login";
  document.getElementById("toggle-auth-mode").textContent = registerMode ? "Back to login" : "Create account";
  document.getElementById("open-reset-box").classList.toggle("hidden", registerMode);
  document.getElementById("open-login-otp-box").classList.toggle("hidden", registerMode);
  document.getElementById("full-name-wrap").classList.toggle("hidden", !registerMode);
  document.getElementById("auth-fullname").toggleAttribute("required", registerMode);
}

function toggleResetBox(show) {
  document.getElementById("auth-form").classList.toggle("hidden", show);
  document.getElementById("reset-form").classList.toggle("hidden", !show);
  document.getElementById("login-otp-form").classList.add("hidden");
}

function toggleLoginOtpBox(show) {
  document.getElementById("auth-form").classList.toggle("hidden", show);
  document.getElementById("login-otp-form").classList.toggle("hidden", !show);
  document.getElementById("reset-form").classList.add("hidden");
}

async function checkSession() {
  try {
    state.user = await api("/api/auth/me");
    setViewAuthenticated(true);
    return true;
  } catch (err) {
    if (err.status !== 401) showToast(err.message);
    state.user = null;
    setViewAuthenticated(false);
    return false;
  }
}

async function init() {
  try {
    const meta = await api("/api/meta");
    state.currencies = meta.currencies;
    fillCurrencyDropdown();
    resetExpenseForm();
    setAuthMode("login");
    toggleResetBox(false);

    const hasSession = await checkSession();
    if (hasSession) await refreshAll();

    document.getElementById("auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = document.getElementById("auth-username").value.trim();
      const password = document.getElementById("auth-password").value;
      const fullName = document.getElementById("auth-fullname").value.trim();
      if (!username || !password) return;
      const endpoint = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = state.authMode === "register"
        ? { username, password, fullName }
        : { username, password };
      state.user = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      showToast(state.authMode === "register" ? "Account created." : "Logged in.");
      setViewAuthenticated(true);
      document.getElementById("auth-form").reset();
      setAuthMode("login");
      await refreshAll();
    });

    document.getElementById("toggle-auth-mode").addEventListener("click", () => {
      setAuthMode(state.authMode === "login" ? "register" : "login");
    });

    document.getElementById("open-reset-box").addEventListener("click", () => {
      toggleResetBox(true);
      document.getElementById("reset-form").reset();
      document.getElementById("reset-token").value = "";
    });

    document.getElementById("open-login-otp-box").addEventListener("click", () => {
      toggleLoginOtpBox(true);
      document.getElementById("login-otp-form").reset();
      document.getElementById("otp-login-request-id").value = "";
    });

    document.getElementById("cancel-login-otp-box").addEventListener("click", () => {
      toggleLoginOtpBox(false);
      document.getElementById("login-otp-form").reset();
    });

    document.getElementById("cancel-reset-box").addEventListener("click", () => {
      toggleResetBox(false);
      document.getElementById("reset-form").reset();
    });

    document.getElementById("generate-login-otp").addEventListener("click", async () => {
      const username = document.getElementById("otp-login-username").value.trim();
      const password = document.getElementById("otp-login-password").value;
      if (!username || !password) return;
      const result = await api("/api/auth/request-login-otp", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      document.getElementById("otp-login-request-id").value = result.otpRequestId || "";
      if (result.otpCode) {
        document.getElementById("otp-login-code").value = result.otpCode;
      }
      showToast("Login OTP generated.");
    });

    document.getElementById("login-otp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const otpRequestId = document.getElementById("otp-login-request-id").value.trim();
      const otpCode = document.getElementById("otp-login-code").value.trim();
      if (!otpRequestId || !otpCode) {
        showToast("Generate OTP first.");
        return;
      }
      state.user = await api("/api/auth/verify-login-otp", {
        method: "POST",
        body: JSON.stringify({ otpRequestId, otpCode })
      });
      showToast("Logged in with OTP.");
      setViewAuthenticated(true);
      toggleLoginOtpBox(false);
      document.getElementById("login-otp-form").reset();
      setAuthMode("login");
      await refreshAll();
    });

    document.getElementById("generate-reset-token").addEventListener("click", async () => {
      const username = document.getElementById("reset-username").value.trim();
      if (!username) return;
      const result = await api("/api/auth/request-reset-otp", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      if (result.otpRequestId) {
        document.getElementById("reset-request-id").value = result.otpRequestId;
      }
      if (result.otpCode) {
        document.getElementById("reset-token").value = result.otpCode;
        showToast("Reset OTP generated and filled.");
      } else {
        showToast(result.message || "Reset instructions generated.");
      }
    });

    document.getElementById("reset-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const otpRequestId = document.getElementById("reset-request-id").value.trim();
      const otpCode = document.getElementById("reset-token").value.trim();
      const newPassword = document.getElementById("reset-new-password").value;
      if (!otpRequestId || !otpCode || !newPassword) {
        showToast("Generate OTP first.");
        return;
      }
      const result = await api("/api/auth/reset-password-otp", {
        method: "POST",
        body: JSON.stringify({ otpRequestId, otpCode, newPassword })
      });
      showToast(result.message || "Password reset complete.");
      toggleResetBox(false);
      setAuthMode("login");
      document.getElementById("auth-password").value = "";
      document.getElementById("reset-form").reset();
    });

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      state.user = null;
      setViewAuthenticated(false);
      showToast("Logged out.");
    });

    document.getElementById("change-password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const currentPassword = document.getElementById("current-password").value;
      const newPassword = document.getElementById("new-password").value;
      if (!currentPassword || !newPassword) return;
      const result = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      showToast(result.message || "Password changed.");
      document.getElementById("change-password-form").reset();
    });

    document.getElementById("category-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = document.getElementById("category-id").value;
      const name = document.getElementById("category-name").value.trim();
      if (!name) return;
      if (id) {
        await api(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
        showToast("Category updated.");
      } else {
        await api("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
        showToast("Category added.");
      }
      resetCategoryForm();
      await refreshAll();
    });

    document.getElementById("cancel-category-edit").addEventListener("click", resetCategoryForm);

    document.getElementById("category-list").addEventListener("click", async (event) => {
      const editId = event.target.dataset.catEdit;
      const deleteId = event.target.dataset.catDelete;
      if (editId) {
        const category = state.categories.find((c) => c.id === editId);
        if (!category) return;
        document.getElementById("category-id").value = category.id;
        document.getElementById("category-name").value = category.name;
        document.getElementById("cancel-category-edit").classList.remove("hidden");
      }
      if (deleteId) {
        if (!window.confirm("Delete this category?")) return;
        await api(`/api/categories/${deleteId}`, { method: "DELETE" });
        showToast("Category deleted.");
        await refreshAll();
      }
    });

    document.getElementById("expense-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = document.getElementById("expense-id").value;
      const payload = {
        date: document.getElementById("expense-date").value,
        amount: Number(document.getElementById("expense-amount").value),
        currency: document.getElementById("expense-currency").value,
        categoryId: document.getElementById("expense-category").value,
        description: document.getElementById("expense-description").value.trim()
      };

      if (id) {
        await api(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        showToast("Expense updated.");
      } else {
        await api("/api/expenses", { method: "POST", body: JSON.stringify(payload) });
        showToast("Expense added.");
      }
      resetExpenseForm();
      await refreshAll();
    });

    document.getElementById("cancel-expense-edit").addEventListener("click", resetExpenseForm);

    document.getElementById("expense-table-body").addEventListener("click", async (event) => {
      const editId = event.target.dataset.expEdit;
      const deleteId = event.target.dataset.expDelete;
      if (editId) {
        const expense = state.expenses.find((e) => e.id === editId);
        if (!expense) return;
        document.getElementById("expense-id").value = expense.id;
        document.getElementById("expense-date").value = expense.date;
        document.getElementById("expense-amount").value = expense.amount;
        document.getElementById("expense-currency").value = expense.currency;
        document.getElementById("expense-category").value = expense.categoryId;
        document.getElementById("expense-description").value = expense.description || "";
        document.getElementById("cancel-expense-edit").classList.remove("hidden");
      }
      if (deleteId) {
        if (!window.confirm("Delete this expense?")) return;
        await api(`/api/expenses/${deleteId}`, { method: "DELETE" });
        showToast("Expense deleted.");
        await refreshAll();
      }
    });
  } catch (err) {
    showToast(err.message);
  }
}

init();
