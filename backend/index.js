import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { Pool } from "pg";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, "..", "frontend");

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL no está definido. En Railway debe ser una referencia al Postgres.");
}
// En Railway/Postgres gestionado suele requerirse SSL. En local, normalmente no.
const isProd = process.env.NODE_ENV === "production";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

app.use(express.static(frontendPath));
app.get("/", (req, res) => res.sendFile(path.join(frontendPath, "index.html")));

app.get("/api/antibiogramas", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, nombre FROM antibiogramas ORDER BY nombre");
    res.json(rows);
  } catch (e) {
    console.error("DB ERROR /api/antibiogramas:", e);
    res.status(500).json({ ok: false, where: "antibiogramas", error: String(e?.message || e) });
  }
});

app.get("/api/antibioticos", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT codigo, nombre, cantidad, stock_minimo FROM antibioticos ORDER BY nombre"
    );
    res.json(rows);
  } catch (e) {
    console.error("DB ERROR /api/antibioticos:", e);
    res.status(500).json({ ok: false, where: "antibioticos", error: String(e?.message || e) });
  }
});

// Actualiza cantidad y/o stock mínimo de un antibiótico.
app.put("/api/antibioticos/:codigo", async (req, res) => {
  try {
    const codigo = String(req.params.codigo || "").trim();
    if (!codigo) return res.status(400).json({ ok: false, error: "Falta codigo" });

    const cantidad = req.body?.cantidad;
    const stock_minimo = req.body?.stock_minimo;

    // Permite actualizar uno o ambos campos.
    const sets = [];
    const values = [];
    let i = 1;

    if (cantidad !== undefined) {
      const n = Number(cantidad);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ ok: false, error: "cantidad debe ser un entero >= 0" });
      }
      sets.push(`cantidad = $${i++}`);
      values.push(n);
    }

    if (stock_minimo !== undefined) {
      const n = Number(stock_minimo);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ ok: false, error: "stock_minimo debe ser un entero >= 0" });
      }
      sets.push(`stock_minimo = $${i++}`);
      values.push(n);
    }

    if (!sets.length) {
      return res.status(400).json({ ok: false, error: "Nada que actualizar" });
    }

    values.push(codigo);
    const q = `
      UPDATE antibioticos
      SET ${sets.join(", ")}
      WHERE codigo = $${i}
      RETURNING codigo, nombre, cantidad, stock_minimo;
    `;

    const { rows } = await pool.query(q, values);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Antibiótico no encontrado" });
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    console.error("DB ERROR PUT /api/antibioticos/:codigo:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Resta stock (cantidad) de forma segura: no permite negativos.
app.post("/api/antibioticos/:codigo/restar", async (req, res) => {
  try {
    const codigo = String(req.params.codigo || "").trim();
    const cantidad = Number(req.body?.cantidad);

    if (!codigo) return res.status(400).json({ ok: false, error: "Falta codigo" });
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ ok: false, error: "cantidad debe ser un entero > 0" });
    }

    const q = `
      UPDATE antibioticos
      SET cantidad = cantidad - $1
      WHERE codigo = $2
        AND cantidad >= $1
      RETURNING codigo, nombre, cantidad, stock_minimo;
    `;
    const { rows } = await pool.query(q, [cantidad, codigo]);

    if (rows.length === 1) return res.json({ ok: true, item: rows[0] });

    // Diferenciar "no existe" de "stock insuficiente"
    const check = await pool.query(
      "SELECT codigo, nombre, cantidad, stock_minimo FROM antibioticos WHERE codigo = $1",
      [codigo]
    );
    if (!check.rows.length) return res.status(404).json({ ok: false, error: "Antibiótico no encontrado" });

    return res.status(409).json({ ok: false, error: "Stock insuficiente", item: check.rows[0] });
  } catch (e) {
    console.error("DB ERROR POST /api/antibioticos/:codigo/restar:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/antibiogramas/:id/existencias", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const q = `
      SELECT
        a.codigo,
        a.nombre,
        EXISTS(
          SELECT 1
          FROM antibiograma_antibiotico aa
          WHERE aa.antibiograma_id = $1
            AND aa.antibiotico_codigo = a.codigo
        ) AS existe
      FROM antibioticos a
      ORDER BY a.nombre;
    `;
    const { rows } = await pool.query(q, [id]);
    res.json(rows);
  } catch (e) {
    console.error("DB ERROR /api/antibiogramas/:id/existencias:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/dbcheck", async (req, res) => {
  try {
    const now = await pool.query("SELECT NOW() as now");
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    res.json({ ok: true, now: now.rows[0].now, tables: tables.rows.map(x => x.table_name) });
  } catch (e) {
    console.error("DB ERROR /api/dbcheck:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/antibiogramas/:id/antibioticos", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      "SELECT antibiotico_codigo AS codigo FROM antibiograma_antibiotico WHERE antibiograma_id = $1",
      [id]
    );
    res.json(rows.map(r => r.codigo));
  } catch (e) {
    console.error("DB ERROR /api/antibiogramas/:id/antibioticos:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Devuelve el detalle (con stock) de los antibióticos asignados a un antibiograma.
app.get("/api/antibiogramas/:id/antibioticos_detalle", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "id inválido" });
    }

    const { rows } = await pool.query(
      `
      SELECT a.codigo, a.nombre, a.cantidad, a.stock_minimo
      FROM antibiograma_antibiotico aa
      JOIN antibioticos a ON a.codigo = aa.antibiotico_codigo
      WHERE aa.antibiograma_id = $1
      ORDER BY a.nombre
      `,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error("DB ERROR /api/antibiogramas/:id/antibioticos_detalle:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Registrar una salida de X antibiogramas: descuenta automáticamente el stock de los antibióticos asignados.
// Body: { antibiograma_id: number, unidades: number }
app.post("/api/salidas", async (req, res) => {
  const client = await pool.connect();
  try {
    const antibiograma_id = Number(req.body?.antibiograma_id);
    const unidades = Number(req.body?.unidades);

    if (!Number.isInteger(antibiograma_id) || antibiograma_id <= 0) {
      return res.status(400).json({ ok: false, error: "antibiograma_id inválido" });
    }
    if (!Number.isInteger(unidades) || unidades <= 0) {
      return res.status(400).json({ ok: false, error: "unidades debe ser un entero > 0" });
    }

    await client.query("BEGIN");

    // Obtener antibióticos asociados al antibiograma
    const rel = await client.query(
      `
      SELECT aa.antibiotico_codigo AS codigo
      FROM antibiograma_antibiotico aa
      WHERE aa.antibiograma_id = $1
      `,
      [antibiograma_id]
    );

    if (rel.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "Ese antibiograma no tiene antibióticos asignados" });
    }

    const codigos = rel.rows.map(r => r.codigo);

    // Bloquear y comprobar stock suficiente en TODOS (para evitar negativos)
    const stocks = await client.query(
      `
      SELECT codigo, nombre, cantidad, stock_minimo
      FROM antibioticos
      WHERE codigo = ANY($1)
      FOR UPDATE
      `,
      [codigos]
    );

    if (stocks.rows.length !== codigos.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "Hay antibióticos asignados que no existen en la tabla antibioticos" });
    }

    const insuf = stocks.rows.filter(r => r.cantidad < unidades);
    if (insuf.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        error: "Stock insuficiente",
        faltan: insuf.map(x => ({ codigo: x.codigo, nombre: x.nombre, cantidad: x.cantidad, necesario: unidades })),
      });
    }

    // Descontar (1 unidad por antibiótico y antibiograma; si más adelante quieres "dosis", se ajusta aquí)
    await client.query(
      `
      UPDATE antibioticos
      SET cantidad = cantidad - $1
      WHERE codigo = ANY($2)
      `,
      [unidades, codigos]
    );

    const after = await client.query(
      `
      SELECT codigo, nombre, cantidad, stock_minimo
      FROM antibioticos
      WHERE codigo = ANY($1)
      ORDER BY nombre
      `,
      [codigos]
    );

    await client.query("COMMIT");
    res.json({ ok: true, antibiograma_id, unidades, afectados: after.rows });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("DB ERROR POST /api/salidas:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    client.release();
  }
});

app.put("/api/antibiogramas/:id/antibioticos", async (req, res) => {
  const id = Number(req.params.id);
  const codes = Array.isArray(req.body.codes) ? req.body.codes : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM antibiograma_antibiotico WHERE antibiograma_id = $1", [id]);
    for (const code of codes) {
      await client.query(
        "INSERT INTO antibiograma_antibiotico (antibiograma_id, antibiotico_codigo) VALUES ($1, $2)",
        [id, code]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, saved: codes.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("DB ERROR PUT /api/antibiogramas/:id/antibioticos:", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    client.release();
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API + Frontend en http://localhost:${PORT}`));
