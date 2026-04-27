# Incident — Connection Leak no Background Worker

> Descoberta em 27/04/2026 madrugada durante investigação de erro recorrente nos logs Railway. Bug pré-existente, sem fix aplicado nesta sessão (foi decisão de não mexer em infra de produção sem dev original disponível).

## Sintoma observado

Logs do Railway mostram a cada ~30 segundos:

[BG Worker] Poll error: Failed query: select 'id', 'userId', ... from `background_jobs` where ...

A linha de log foi truncada e não capturou o `error.message` completo do mysql2 (provável causa raiz: connection limit, ECONNRESET, ETIMEDOUT). Pra confirmar, precisa adicionar log de `error.code + error.message + error.errno` no catch da `pollForJobs`.

## Causa raiz identificada

`server/background-worker.ts:22-30` define:

```ts
function getDbInstance() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not configured");
  try {
    return drizzle(url);
  } catch (error: any) {
    throw new Error(`DATABASE_URL inválida ("${url.slice(0, 30)}..."): ${error.message}`);
  }
}
```

Cada chamada de `getDbInstance()` invoca `drizzle(url)` passando uma **string** — o drizzle-orm/mysql2 cria internamente uma **nova pool mysql2** (não reutiliza). Não há cache, não há singleton. Cada chamada é uma pool nova, que abre conexões sob demanda e nunca é fechada.

**Conta de polling do leak (worst case por hora):**

- `pollForJobs` roda a cada 30s → **120 pools/hora** só do loop principal.
- `refreshExpiringShopeeTokens` roda 1x/h → **1 pool/hora**.
- 8 funções tRPC (`createBackgroundJob`, `getBackgroundJobs`, etc.) criam 1 pool por chamada — depende do tráfego, mas multiplica.
- Cada pool abre ao menos 1 conexão TCP no primeiro query e mantém via `enableKeepAlive`. O Node não coleta lixo de pools com sockets ativos.

**Acumulado típico de 24h:** 2.880+ pools só do polling, sem contar tRPC. Bate facilmente no `max_connections` do MySQL Railway → "Too many connections" observado na sessão anterior.

## Comparação com pool canônica

`server/db.ts:25-37` define a pool correta — uma única instância exportada:

```ts
export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  ssl: false as any,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const db = drizzle(pool, { schema, mode: "default" });
```

**Pontos importantes:**

- O `background-worker.ts` **já importa** `db.ts` na linha 14: `import * as db from "./db"`. Tem acesso direto a `db.db` e `db.pool` — não há circular import e não exigiria nova dependência.
- A pool tem `connectionLimit: 10` fixo — o app inteiro (HTTP + worker) compartilharia.
- Não há comentário no código nem na mensagem do commit `6c9bb18` (17/03/2026, autor "Manus") explicando por que o worker foi escrito com `getDbInstance()` separado em vez de reusar `db.db`. Provavelmente descuido na implementação inicial do sistema de background jobs.

## 11 call sites usando `getDbInstance()`

| Linha | Função | Contexto |
|-------|--------|----------|
| 22 | (definição) | — |
| 51 | `createBackgroundJob` | INSERT job |
| 75 | `getBackgroundJobs` | SELECT lista |
| 83 | `getBackgroundJob` | SELECT por id |
| 91 | `cancelBackgroundJob` | UPDATE status |
| 115 | `updateJobProgress` | UPDATE progresso |
| 575 | `getResumableShopeeJob` | SELECT resumível |
| 620 | `resumeSyncJob` | UPDATE re-queue |
| 632 | `cancelIncompleteShopeeJobs` | UPDATE bulk |
| 657 | `pollForJobs` | **loop de 30s** ← leak principal |
| 694 | `refreshExpiringShopeeTokens` | **loop horário** ← outro leak |

Os dois loops periódicos (657, 694) são os que vazam pool a cada tick. As 8 funções tRPC (linhas 51, 75, 83, 91, 115, 575, 620, 632) vazam por chamada vinda de cliente.

## Estratégia de fix recomendada — Opção C (pool dedicada)

**Por que pool dedicada e não compartilhar a de `db.ts`:**

A pool de `db.ts` tem `connectionLimit: 10` e atende todas as requests HTTP. O worker tem padrão de pico previsível: chunks de até `concurrency` (default **5**) `Promise.all` durante `processExportMLJob` e similares. Em pico, o worker sozinho consome 5–10 conexões. Se compartilhasse a pool de 10, restariam 0–5 para HTTP em rajadas, levando a fila e latência crescente.

Pool dedicada isola o worker — HTTP nunca degrada por causa de job pesado.

**Esboço do fix:**

1. Em `server/db.ts`, exportar uma segunda pool:
   ```ts
   export const workerPool = mysql.createPool({
     uri: process.env.DATABASE_URL,
     ssl: false as any,
     waitForConnections: true,
     connectionLimit: 5,
     maxIdle: 5,
     idleTimeout: 60000,
     queueLimit: 0,
     enableKeepAlive: true,
     keepAliveInitialDelay: 0,
   });
   export const workerDb = drizzle(workerPool, { schema, mode: "default" });
   ```
2. Em `server/background-worker.ts`, remover `getDbInstance()` e a função inteira. Trocar todas as 10 chamadas `const dbInst = getDbInstance(); ... dbInst.x` por `db.workerDb.x` (o namespace `db` já está importado).
3. Validar no MySQL: `SHOW VARIABLES LIKE 'max_connections';`. Railway MySQL gerenciado típico tem 151. App com 10+5=15 conexões totais por instância é confortável.

**Por que limit=5 e não maior:**

Worker é single-instance (`isRunning` flag). Pico observável é `concurrency=5` em `Promise.all` interno. 5 conexões dão headroom de 1:1 sem desperdício.

## Tarefas pendentes que esse fix gera

1. **Atualizar mock dos testes em `server/background-jobs.test.ts:4-6`.** Hoje o mock só expõe `getSetting`:
   ```ts
   vi.mock("./db", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
   ```
   Após o fix, o worker vai chamar `db.workerDb.insert(...)` etc. — o mock precisa expor `workerDb` (e provavelmente `db` também, dependendo de como o teste interage com a base real). Caso contrário, os 7 testes quebram com `Cannot read properties of undefined (reading 'insert')`. Opção mais simples: remover o `vi.mock("./db", …)` inteiro e deixar o teste usar a pool real (já é o que acontece hoje na prática via `getDbInstance`).

2. **Adicionar log completo de erro em `pollForJobs` (linha ~679-680).** Hoje o catch loga só `error.message`. Trocar por:
   ```ts
   console.error("[BG Worker] Poll error:", {
     code: error.code,
     errno: error.errno,
     sqlState: error.sqlState,
     message: error.message,
   });
   ```
   Sem isso, o próximo incidente vai chegar igual de cego.

3. **Race condition multi-instance — ainda em aberto.** O worker usa flag `isRunning` em memória (linha 653) para evitar processamento concorrente. Se rodarem 2+ processos do servidor (deploy zero-downtime, escala horizontal), ambos pegam o mesmo job — não há `SELECT ... FOR UPDATE` nem coluna `locked_at`. **Esse fix da pool não resolve a race**, apenas elimina o leak. Race continua latente. Solução futura: adicionar `locked_at TIMESTAMP NULL` em `background_jobs` e atualizar `pollForJobs` para `UPDATE ... SET locked_at=NOW() WHERE id=? AND locked_at IS NULL` antes de processar.

## Por que NÃO foi aplicado nesta sessão

- **Madrugada (~02:00)** — janela ruim pra mexer em infra crítica de produção.
- **Dev original ausente** — fix toca pool de DB, ponto de saturação documentado na sessão anterior. Decisão de não-fazer-sozinho.
- **Bug é pré-existente** desde `6c9bb18` (17/03/2026), não introduzido nesta sessão. Não bloqueia entrega imediata.
- **Testes vão quebrar** sem ajuste do mock — não é fix de 1 linha. Precisa revisar 7 testes em paralelo.
- **Decisão de pool dedicada vs. subir limit da única pool** ainda não foi validada com dev original. Doc deixa recomendação, mas a escolha final é dele.

Pendência aberta — dev original implementa de manhã com calma.
