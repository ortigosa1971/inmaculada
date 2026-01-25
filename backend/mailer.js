import nodemailer from "nodemailer";

function mailEnabled() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    (process.env.ALERT_TO_EMAIL || process.env.SMTP_TO)
  );
}

export async function sendLowStockEmail(rows) {
  // No bloquear la app si falta configuración
  if (!rows || rows.length === 0) return { ok: false, skipped: true, reason: "no_rows" };
  if (!mailEnabled()) {
    console.log("[MAIL] Desactivado: faltan variables SMTP_* o ALERT_TO_EMAIL.");
    return { ok: false, skipped: true, reason: "missing_env" };
  }

  const to = process.env.ALERT_TO_EMAIL || process.env.SMTP_TO;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? "true" : "false")) === "true";

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  const htmlRows = rows
    .map(
      (r) =>
        `<tr><td>${r.codigo ?? ""}</td><td>${r.nombre ?? ""}</td><td>${r.stock ?? ""}</td><td>${r.minimo ?? ""}</td></tr>`
    )
    .join("");

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `⚠️ Alerta stock mínimo (${rows.length})`,
      html: `
        <h2>Antibióticos por debajo del stock mínimo</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Stock</th><th>Mínimo</th></tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <p>Generado por Almacén.</p>
      `,
    });
    console.log("[MAIL] Enviado:", info.messageId);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.log("[MAIL] Error (no bloquea):", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
