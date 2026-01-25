import nodemailer from "nodemailer";

function mailEnabled() {
  return (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.ALERT_TO_EMAIL
  );
}

/**
 * Env esperado (Railway Variables):
 *  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *  ALERT_TO_EMAIL (destinatario)
 *  Opcional: SMTP_SECURE ("true"/"false"), ALERT_FROM_EMAIL
 */
export async function sendLowStockEmail(rows) {
  if (!rows || rows.length === 0) return;

  // Si falta configuración, NO romper la app.
  if (!mailEnabled()) {
    console.log("[MAIL] desactivado: faltan variables SMTP_* o ALERT_TO_EMAIL");
    return { ok: false, skipped: true };
  }

  try {
    const port = Number(process.env.SMTP_PORT);
    const secure =
      String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Timeouts para que el envío no bloquee endpoints.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const from = process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER;
    const to = process.env.ALERT_TO_EMAIL;

    const htmlRows = rows
      .map(
        (r) => `
          <tr>
            <td>${r.codigo ?? ""}</td>
            <td>${r.nombre ?? ""}</td>
            <td style="text-align:right">${r.cantidad ?? ""}</td>
            <td style="text-align:right">${r.stock_minimo ?? ""}</td>
          </tr>`
      )
      .join("");

    await transporter.sendMail({
      from,
      to,
      subject: `⚠️ Alerta stock mínimo (${rows.length})`,
      html: `
        <h2>Antibióticos por debajo del stock mínimo</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Stock</th>
              <th>Mínimo</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <p>Generado por Almacén.</p>
      `,
    });

    console.log("[MAIL] correo enviado correctamente");
    return { ok: true };
  } catch (err) {
    // Nunca romper la app por el correo.
    console.error("[MAIL] error al enviar correo:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}
