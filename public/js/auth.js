/* Auth pages (login/register): client validation + submit */
"use strict";

(async function () {
  const { Api, Toast } = window.__DIAGRAM__;

  const isRegister = Boolean(document.getElementById("registerForm"));
  const form = document.getElementById(isRegister ? "registerForm" : "loginForm");
  if (!form) return;
  const submitBtn = document.getElementById("submitBtn");
  const formAlert = document.getElementById("formAlert");

  function showAlert(msg) {
    formAlert.textContent = msg;
    formAlert.classList.add("show");
  }
  function clearAlert() {
    formAlert.classList.remove("show");
    formAlert.textContent = "";
  }
  function setFieldError(name, msg) {
    const el = document.getElementById(`err-${name}`);
    const input = document.getElementById(name);
    if (el) el.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function validate() {
    let ok = true;
    ["username", "email", "password", "confirmPassword"].forEach((n) => setFieldError(n, ""));
    clearAlert();

    if (isRegister) {
      const username = form.username.value.trim();
      if (username.length < 3 || username.length > 32) {
        setFieldError("username", "Tên đăng nhập phải 3–32 ký tự.");
        ok = false;
      } else if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        setFieldError("username", "Chỉ gồm chữ, số, . _ -");
        ok = false;
      }
    }

    const email = form.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      setFieldError("email", "Email không hợp lệ.");
      ok = false;
    }

    const password = form.password.value;
    if (password.length < 8 || password.length > 128) {
      setFieldError("password", "Mật khẩu phải 8–128 ký tự.");
      ok = false;
    }

    if (isRegister && password !== form.confirmPassword.value) {
      setFieldError("confirmPassword", "Xác nhận mật khẩu không khớp.");
      ok = false;
    }
    return ok;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) return;

    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    try {
      const body = isRegister
        ? {
            username: form.username.value.trim(),
            email: form.email.value.trim().toLowerCase(),
            password: form.password.value,
            confirmPassword: form.confirmPassword.value,
          }
        : { email: form.email.value.trim().toLowerCase(), password: form.password.value };

      const res = await Api.post(isRegister ? "/api/v1/auth/register" : "/api/v1/auth/login", body);

      if (res.success) {
        if (res.data.csrfToken) Api.csrfToken = res.data.csrfToken;
        Toast.ok(isRegister ? "Tạo tài khoản thành công!" : "Đăng nhập thành công!");
        setTimeout(() => { window.location.href = "/diagrams"; }, 400);
      } else {
        const details = res.error?.details;
        if (details) {
          for (const [field, msg] of Object.entries(details)) {
            setFieldError(field === "_" ? "" : field, msg);
          }
          showAlert("Vui lòng sửa các lỗi dưới đây.");
          Toast.error("Dữ liệu chưa hợp lệ, vui lòng kiểm tra lại các ô nhập.");
        } else {
          const msg = res.error?.message || "Có lỗi xảy ra, vui lòng thử lại.";
          showAlert(msg);
          Toast.error(msg);
        }
      }
    } catch (err) {
      // Lỗi bất ngờ (bug): hiện toast; ở development bấm vào toast để xem stack trace.
      showAlert("Có lỗi xảy ra, vui lòng thử lại.");
      Toast.error("Có lỗi xảy ra, vui lòng thử lại.");
      throw err; // để DevErrors ghi lại + hiện toast chi tiết
    } finally {
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
    }
  });
})();
