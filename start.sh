#!/bin/bash

# ─────────────────────────────────────────────
#  Marketplace Sistema — Startup Checklist
# ─────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

OK="✅"
FAIL="❌"
WARN="⚠️ "

declare -A RESULTS

cd "$(dirname "$0")" || exit 1

echo -e "\n${BOLD}${CYAN}════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}   Marketplace Sistema — Checklist Init  ${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════${RESET}\n"

# ── 1. Verifica .env existe ────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${RED}${FAIL} Arquivo .env não encontrado. Abortando.${RESET}"
  exit 1
fi

# ── 2. GEMINI_API_KEY ──────────────────────────────────────────────────────────
echo -ne "  Verificando GEMINI_API_KEY...      "
GEMINI_KEY=$(grep -E "^GEMINI_API_KEY=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -n "$GEMINI_KEY" ]; then
  echo -e "${GREEN}${OK} presente${RESET}"
  RESULTS["gemini"]="ok"
else
  echo -e "${RED}${FAIL} não configurada${RESET}"
  RESULTS["gemini"]="fail"
fi

# ── 3. Shopee configurada ──────────────────────────────────────────────────────
echo -ne "  Verificando Shopee no .env...      "
SHOPEE_ID=$(grep -E "^SHOPEE_PARTNER_ID=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
SHOPEE_KEY=$(grep -E "^SHOPEE_PARTNER_KEY=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -n "$SHOPEE_ID" ] && [ -n "$SHOPEE_KEY" ]; then
  echo -e "${GREEN}${OK} SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY presentes${RESET}"
  RESULTS["shopee"]="ok"
else
  echo -e "${RED}${FAIL} SHOPEE_PARTNER_ID ou SHOPEE_PARTNER_KEY ausentes${RESET}"
  RESULTS["shopee"]="fail"
fi

# ── 4. Conexão com banco MySQL do Railway ──────────────────────────────────────
echo -ne "  Verificando banco MySQL Railway...  "
DB_URL=$(grep -E "^DATABASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$DB_URL" ]; then
  echo -e "${RED}${FAIL} DATABASE_URL não configurada${RESET}"
  RESULTS["db"]="fail"
else
  # Extrai host e porta da DATABASE_URL (mysql://user:pass@host:port/db)
  DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+)[:/].*|\1|')
  DB_PORT=$(echo "$DB_URL" | sed -E 's|.*@[^:]+:([0-9]+)/.*|\1|')
  DB_PORT=${DB_PORT:-3306}

  if timeout 5 bash -c "echo >/dev/tcp/$DB_HOST/$DB_PORT" 2>/dev/null; then
    echo -e "${GREEN}${OK} conectado em ${DB_HOST}:${DB_PORT}${RESET}"
    RESULTS["db"]="ok"
  else
    echo -e "${RED}${FAIL} não foi possível conectar em ${DB_HOST}:${DB_PORT}${RESET}"
    RESULTS["db"]="fail"
  fi
fi

# ── 5. Mata processos antigos nas portas 3000 e 3002 ──────────────────────────
echo -ne "  Liberando portas 3000 e 3002...    "
KILLED=0
for PORT in 3000 3002; do
  PIDS=$(lsof -ti tcp:$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null
    KILLED=$((KILLED + 1))
  fi
done
if [ "$KILLED" -gt 0 ]; then
  echo -e "${YELLOW}${WARN} processos antigos encerrados${RESET}"
else
  echo -e "${GREEN}${OK} portas já livres${RESET}"
fi
RESULTS["kill"]="ok"

# ── 6. Inicia o servidor ───────────────────────────────────────────────────────
echo -e "\n${BOLD}  Iniciando servidor com npm run dev...${RESET}"
npm run dev > /tmp/marketplace-server.log 2>&1 &
SERVER_PID=$!
echo -e "  PID do servidor: ${CYAN}${SERVER_PID}${RESET}"

# ── 7. Aguarda e verifica portas ───────────────────────────────────────────────
echo -ne "\n  Aguardando 5 segundos..."
sleep 5
echo -e " pronto.\n"

echo -ne "  Verificando porta 3000 (backend)... "
if lsof -ti tcp:3000 > /dev/null 2>&1; then
  echo -e "${GREEN}${OK} ativa${RESET}"
  RESULTS["port3000"]="ok"
else
  echo -e "${RED}${FAIL} não responde${RESET}"
  RESULTS["port3000"]="fail"
fi

echo -ne "  Verificando porta 3002 (vite)...    "
if lsof -ti tcp:3002 > /dev/null 2>&1; then
  echo -e "${GREEN}${OK} ativa${RESET}"
  RESULTS["port3002"]="ok"
else
  echo -e "${RED}${FAIL} não responde${RESET}"
  RESULTS["port3002"]="fail"
fi

# ── 8. Resumo final ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${CYAN}════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}   Resumo do Checklist                   ${RESET}"
echo -e "${BOLD}${CYAN}════════════════════════════════════════${RESET}"

_icon() { [ "$1" = "ok" ] && echo -e "${GREEN}${OK}${RESET}" || echo -e "${RED}${FAIL}${RESET}"; }

echo -e "  $(_icon "${RESULTS[db]}")      Banco MySQL Railway"
echo -e "  $(_icon "${RESULTS[gemini]}")  GEMINI_API_KEY"
echo -e "  $(_icon "${RESULTS[shopee]}")  Shopee (PARTNER_ID + PARTNER_KEY)"
echo -e "  $(_icon "${RESULTS[kill]}")    Portas 3000/3002 liberadas"
echo -e "  $(_icon "${RESULTS[port3000]}")  Servidor na porta 3000"
echo -e "  $(_icon "${RESULTS[port3002]}")  Vite na porta 3002"

FAILURES=0
for KEY in db gemini shopee port3000 port3002; do
  [ "${RESULTS[$KEY]}" != "ok" ] && FAILURES=$((FAILURES + 1))
done

echo -e "\n${BOLD}  Log do servidor: ${CYAN}/tmp/marketplace-server.log${RESET}"

if [ "$FAILURES" -eq 0 ]; then
  echo -e "\n${BOLD}${GREEN}  Sistema iniciado com sucesso! 🚀${RESET}\n"
else
  echo -e "\n${BOLD}${YELLOW}  Sistema iniciado com ${FAILURES} problema(s). Verifique acima.${RESET}\n"
fi
