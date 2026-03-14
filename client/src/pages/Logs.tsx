import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ScrollText, Loader2, ChevronDown, ChevronUp, CheckCircle, XCircle,
  AlertCircle, Clock, Upload, Copy
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function LogsPage() {
  const { data: jobs, isLoading } = trpc.exports.list.useQuery();
  const [expandedJob, setExpandedJob] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Logs de Exportação</h1>
        <p className="text-muted-foreground mt-1">Histórico completo de todas as exportações realizadas</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando logs...
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <ScrollText className="h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm text-center">
              Nenhuma exportação realizada ainda.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job: any) => (
            <JobCard
              key={job.id}
              job={job}
              isExpanded={expandedJob === job.id}
              onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, isExpanded, onToggle }: { job: any; isExpanded: boolean; onToggle: () => void }) {
  const [, setLocation] = useLocation();
  const { data: logs, isLoading: logsLoading } = trpc.exports.logs.useQuery(
    { jobId: job.id },
    { enabled: isExpanded }
  );

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { icon: <Clock className="h-4 w-4" />, label: "Pendente", variant: "secondary" },
    processing: { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: "Processando", variant: "default" },
    completed: { icon: <CheckCircle className="h-4 w-4" />, label: "Concluído", variant: "outline" },
    failed: { icon: <XCircle className="h-4 w-4" />, label: "Falhou", variant: "destructive" },
    cancelled: { icon: <AlertCircle className="h-4 w-4" />, label: "Cancelado", variant: "secondary" },
  };

  const config = statusConfig[job.status] || statusConfig.pending;

  const handleReExport = () => {
    // Store the job ID in sessionStorage so Export page can load products from this job
    sessionStorage.setItem("reexport_job_id", String(job.id));
    sessionStorage.setItem("reexport_job_tag", job.tagFilter || "");
    sessionStorage.setItem("reexport_marketplace_id", String(job.marketplaceId || ""));
    toast.info("Redirecionando para exportação... Selecione o novo marketplace de destino.");
    setLocation("/export");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={onToggle}>
            <CardTitle className="text-base">Job #{job.id}</CardTitle>
            <Badge variant={config.variant} className="flex items-center gap-1">
              {config.icon}
              {config.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReExport();
                  }}
                  className="gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Re-exportar</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Exportar os mesmos produtos para outro marketplace
              </TooltipContent>
            </Tooltip>
            <div className="text-sm text-muted-foreground text-right cursor-pointer" onClick={onToggle}>
              <p>{job.totalProducts} produtos</p>
              <p className="text-xs">
                {job.successCount} sucesso / {job.errorCount} erros
              </p>
            </div>
            <div className="cursor-pointer" onClick={onToggle}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
          {job.tagFilter && <span>Tag: {job.tagFilter}</span>}
          <span>Criado: {new Date(job.createdAt).toLocaleString("pt-BR")}</span>
          {job.completedAt && <span>Concluído: {new Date(job.completedAt).toLocaleString("pt-BR")}</span>}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando detalhes...
            </div>
          ) : !logs || logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Nenhum log detalhado disponível.</p>
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleReExport}
                  className="gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Exportar estes {logs.length} produtos para outro marketplace
                </Button>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Status</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Categoria Mapeada</TableHead>
                      <TableHead>Erro</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {log.status === "success" && <CheckCircle className="h-4 w-4 text-green-500" />}
                          {log.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                          {log.status === "skipped" && <AlertCircle className="h-4 w-4 text-amber-500" />}
                          {log.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[200px]">{log.productName || log.productId}</p>
                            <p className="text-xs text-muted-foreground">ID: {log.productId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{log.mappedCategory || "—"}</TableCell>
                        <TableCell>
                          {log.errorMessage ? (
                            <p className="text-xs text-destructive max-w-[200px] truncate">{log.errorMessage}</p>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("pt-BR")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
