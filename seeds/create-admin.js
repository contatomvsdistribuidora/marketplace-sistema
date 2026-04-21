import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const { MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE, DATABASE_URL } = process.env;

if (!MYSQLHOST && !DATABASE_URL) {
  console.error("[seed] Nenhuma variável de banco configurada, pulando seed");
  process.exit(0);
}

async function main() {
  const conn = MYSQLHOST
    ? await mysql.createConnection({
        host: MYSQLHOST,
        port: Number(MYSQLPORT) || 3306,
        user: MYSQLUSER,
        password: MYSQLPASSWORD,
        database: MYSQLDATABASE,
        ssl: false,
      })
    : await mysql.createConnection(DATABASE_URL);

  console.log("[seed] Conectado ao banco");

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS \`users\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`openId\` varchar(64) NOT NULL,
      \`name\` text,
      \`email\` varchar(320),
      \`passwordHash\` varchar(256),
      \`loginMethod\` varchar(64),
      \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
      \`createdAt\` timestamp NOT NULL DEFAULT now(),
      \`updatedAt\` timestamp NOT NULL DEFAULT now() ON UPDATE CURRENT_TIMESTAMP,
      \`lastSignedIn\` timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`users_openId_unique\` (\`openId\`)
    )
  `);

  const admins = [
    { email: "contato.mvsdistribuidora@gmail.com", password: "admin123", name: "Admin MVS" },
    { email: "douglas@higipack.com.br", password: "Alvilimp@00", name: "Douglas Higipack" },
  ];

  for (const { email, password, name } of admins) {
    const hash = await bcrypt.hash(password, 12);
    const openId = "local_" + crypto.randomUUID().replace(/-/g, "");
    await conn.execute(
      "INSERT IGNORE INTO `users` (openId, email, name, passwordHash, role, loginMethod) VALUES (?, ?, ?, ?, 'admin', 'email')",
      [openId, email, name, hash]
    );
    await conn.execute(
      "UPDATE `users` SET passwordHash = ?, role = 'admin' WHERE email = ?",
      [hash, email]
    );
    console.log(`[seed] ✅ ${email} pronto`);
  }

  await conn.end();
  console.log("[seed] Concluído");
}

main().catch(e => {
  console.error("[seed] Erro:", e.message);
  process.exit(0);
});
