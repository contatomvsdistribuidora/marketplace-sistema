import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle, XCircle, AlertCircle, Clock, Loader2,
  ChevronLeft, ChevronRight, ExternalLink, Package,
  TrendingUp, BarChart3, Search, X, History
} from "lucide-react";
import { useState, useMemo } from "react";

const LISTING_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  gold_pro: { label: "Premium", color: "bg-amber-100 text-amber-800 border-amber-200" },
  gold_special: { label: "Clássico", color: "bg-blue-100 text-blue-800 border-blue-200" },
  free: { label: "Grátis", color: "bg-green-100 text-green-800 border-green-200" },
};

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  success: { icon: <CheckCircle className="h-4 w-4" />, label: "Sucesso", color: "text-green-600" },
  error: { icon: <XCircle className="h-4 w-4" />, label: "Erro", color: "text-red-600" },
  skipped: { icon: <AlertCircle className="h-4 w-4" />, label: "Ignorado", color: "text-amber-600" },
  pending: { icon: <Clock className="h-4 w-4" />, label: "Pendente", color: "text-muted-foreground" },
};

export default function ExportHistoryPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [listingTypeFilter, setListingTypeFilter] = useState("all");
  const [nameSearch, setNameSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const queryInput = useMemo(() => ({
    status: statusFilter !== "all" ? statusFilter : undefined,
    listingType: listingTypeFilter !== "all" ? listingTypeFilter : undefined,
    productName: nameSearch.trim() || undefined,
    page,
    pageSize,
  }), [statusFilter, listingTypeFilter, nameSearch, page, pageSize]);

  const { data: historyData, isLoading } = trpc.exports.history.useQuery(queryInput);
  const { data: stats } = trpc.exports.historyStats.useQuery();

  const hasFilters = statusFilter !== "all" || listingTypeFilter !== "all" || nameSearch.trim() !== "";

  const clearFilters = () => {
    setStatusFilter("all");
    setListingTypeFilter("all");
    setNameSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          Produtos Exportados
        </h1>
        <p className="text-muted-foreground mt-1">
          Histórico completo de exportações com filtros por status, tipo de anúncio e produto
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Exportações</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.totalExported}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Sucesso</span>
              </div>
              <p className="text-2xl font-bold mt-1 text-green-600">{stats.totalSuccess}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Erros</span>
              </div>
              <p className="text-2xl font-bold mt-1 text-red-600">{stats.totalError}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Produtos Únicos</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.uniqueSuccessProducts}</p>
            </CardContent>
          </Card>
          {stats.byListingType?.filter((lt: any) => lt.listingType !== "sem tipo").map((lt: any) => {
            const config = LISTING_TYPE_LABELS[lt.listingType] || { label: lt.listingType, color: "bg-gray-100 text-gray-800" };
            return (
              <Card key={lt.listingType}>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{config.label}</span>
                  </div>
                  <p className="text-2xl font-bold mt-1">{lt.count}</p>
                  <p className="text-xs text-muted-foreground">{lt.successCount} com sucesso</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              Filtros
            </CardTitle>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" />
                Limpar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="success">Sucesso</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                  <SelectItem value="skipped">Ignorado</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tipo de Anúncio</Label>
              <Select value={listingTypeFilter} onValueChange={(v) => { setListingTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="gold_pro">Premium</SelectItem>
                  <SelectItem value="gold_special">Clássico</SelectItem>
                  <SelectItem value="free">Grátis</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">Nome do Produto</Label>
              <Input
                className="h-9"
                placeholder="Buscar por nome do produto..."
                value={nameSearch}
                onChange={(e) => { setNameSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Badge variant="secondary">
                {historyData?.total?.toLocaleString() || 0} registro(s)
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Por página:</Label>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-8 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>Carregando histórico...</p>
            </div>
          ) : !historyData?.logs || historyData.logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <History className="h-8 w-8 text-muted-foreground/50" />
              <p>
                {hasFilters
                  ? "Nenhum registro encontrado com os filtros aplicados."
                  : "Nenhuma exportação realizada ainda."}
              </p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="h-3 w-3 mr-1" />
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Status</TableHead>
                      <TableHead className="w-24">ID Produto</TableHead>
                      <TableHead>Nome do Produto</TableHead>
                      <TableHead className="w-28">Tipo Anúncio</TableHead>
                      <TableHead className="w-32">ID ML</TableHead>
                      <TableHead className="w-20">Job</TableHead>
                      <TableHead className="w-48">Erro</TableHead>
                      <TableHead className="w-40">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyData.logs.map((log: any) => {
                      const statusCfg = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                      const listingCfg = log.listingType ? LISTING_TYPE_LABELS[log.listingType] : null;

                      return (
                        <TableRow key={log.id}>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger>
                                <span className={statusCfg.color}>{statusCfg.icon}</span>
                              </TooltipTrigger>
                              <TooltipContent>{statusCfg.label}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{log.productId}</TableCell>
                          <TableCell>
                            <span className="font-medium text-sm max-w-[250px] truncate block" title={log.productName || ""}>
                              {log.productName || "—"}
                            </span>
                            {log.mappedCategory && (
                              <span className="text-xs text-muted-foreground block truncate max-w-[250px]" title={log.mappedCategory}>
                                {log.mappedCategory}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {listingCfg ? (
                              <Badge variant="outline" className={`text-xs ${listingCfg.color}`}>
                                {listingCfg.label}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {log.mlItemId ? (
                              <a
                                href={`https://www.mercadolivre.com.br/p/${log.mlItemId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
                              >
                                {log.mlItemId}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">#{log.jobId}</TableCell>
                          <TableCell>
                            {log.errorMessage ? (
                              <Tooltip>
                                <TooltipTrigger>
                                  <span className="text-xs text-destructive max-w-[180px] truncate block cursor-help">
                                    {log.errorMessage}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-md">
                                  <p className="text-xs whitespace-pre-wrap">{log.errorMessage}</p>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString("pt-BR")}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Mostrando {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, historyData.total)} de {historyData.total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {historyData.totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= (historyData.totalPages || 1)}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
