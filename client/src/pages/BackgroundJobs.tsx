import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Clock, Play, Pause, XCircle, CheckCircle, AlertCircle,
  Loader2, Calendar, RefreshCw, Timer, Package, FileText,
  Image, Upload, ChevronDown, ChevronUp
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  scheduled: { label: "Agendado", color: "bg-blue-100 text-blue-800", icon: <Calendar className="h-3 w-3" /> },
  queued: { label: "Na Fila", color: "bg-yellow-100 text-yellow-800", icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Processando", color: "bg-green-100 text-green-800", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { label: "Concluído", color: "bg-emerald-100 text-emerald-800", icon: <CheckCircle className="h-3 w-3" /> },
  failed: { label: "Falhou", color: "bg-red-100 text-red-800", icon: <AlertCircle className="h-3 w-3" /> },
  cancelled: { label: "Cancelado", color: "bg-gray-100 text-gray-800", icon: <XCircle className="h-3 w-3" /> },
};

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  export_ml: { label: "Exportar para ML", icon: <Upload className="h-4 w-4" /> },
  generate_titles: { label: "Gerar Títulos", icon: <FileText className="h-4 w-4" /> },
  generate_descriptions: { label: "Gerar Descrições", icon: <FileText className="h-4 w-4" /> },
  generate_images: { label: "Gerar Imagens", icon: <Image className="h-4 w-4" /> },
};

export default function BackgroundJobs() {

  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: jobs, isLoading, refetch } = trpc.backgroundJobs.list.useQuery(
    { limit: 100 },
    { refetchInterval: 10000 } // Auto-refresh every 10s
  );

  const cancelMutation = trpc.backgroundJobs.cancel.useMutation({
    onSuccess: () => {
      toast.success("Job cancelado com sucesso");
      refetch();
    },
    onError: (err) => {
      toast.error("Erro ao cancelar: " + err.message);
    },
  });

  const filteredJobs = useMemo(() => {
    if (!jobs) return [];
    if (statusFilter === "all") return jobs;
    return jobs.filter((j: any) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  // Stats
  const stats = useMemo(() => {
    if (!jobs) return { total: 0, processing: 0, completed: 0, failed: 0, queued: 0, scheduled: 0 };
    return {
      total: jobs.length,
      processing: jobs.filter((j: any) => j.status === "processing").length,
      completed: jobs.filter((j: any) => j.status === "completed").length,
      failed: jobs.filter((j: any) => j.status === "failed").length,
      queued: jobs.filter((j: any) => j.status === "queued").length,
      scheduled: jobs.filter((j: any) => j.status === "scheduled").length,
    };
  }, [jobs]);

  const formatDate = (date: string | Date | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const formatDuration = (start: string | Date | null, end: string | Date | null) => {
    if (!start) return "—";
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diffMs = endTime - startTime;
    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jobs em Background</h1>
          <p className="text-muted-foreground">Gerencie exportações e processamentos agendados</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("all")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("processing")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.processing}</p>
            <p className="text-xs text-muted-foreground">Processando</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("queued")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-yellow-600">{stats.queued}</p>
            <p className="text-xs text-muted-foreground">Na Fila</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("scheduled")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.scheduled}</p>
            <p className="text-xs text-muted-foreground">Agendados</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("completed")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">Concluídos</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50" onClick={() => setStatusFilter("failed")}>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">Falharam</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">Filtrar:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="processing">Processando</SelectItem>
            <SelectItem value="queued">Na Fila</SelectItem>
            <SelectItem value="scheduled">Agendados</SelectItem>
            <SelectItem value="completed">Concluídos</SelectItem>
            <SelectItem value="failed">Falharam</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter("all")}>
            Limpar filtro
          </Button>
        )}
      </div>

      {/* Jobs List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Nenhum job encontrado</p>
            <p className="text-sm">Jobs agendados ou em execução aparecerão aqui</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job: any) => {
            const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.queued;
            const typeCfg = TYPE_CONFIG[job.type] || TYPE_CONFIG.export_ml;
            const progress = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0;
            const isExpanded = expandedJob === job.id;

            return (
              <Card key={job.id} className="overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        {typeCfg.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Job #{job.id}</span>
                          <Badge variant="outline" className={`text-xs ${statusCfg.color}`}>
                            {statusCfg.icon}
                            <span className="ml-1">{statusCfg.label}</span>
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {typeCfg.label}
                          {job.accountName && ` • ${job.accountName}`}
                          {job.tagFilter && ` • Tag: ${job.tagFilter}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right text-sm">
                        <p className="font-medium">
                          {job.processedItems}/{job.totalItems}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {job.successCount > 0 && <span className="text-green-600">{job.successCount} ✓</span>}
                          {job.errorCount > 0 && <span className="text-red-600 ml-1">{job.errorCount} ✗</span>}
                        </p>
                      </div>

                      {(job.status === "processing" || job.status === "queued" || job.status === "scheduled") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelMutation.mutate({ jobId: job.id });
                          }}
                          disabled={cancelMutation.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Cancelar
                        </Button>
                      )}

                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {job.status === "processing" && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>{progress}% concluído</span>
                        <span>{formatDuration(job.startedAt, null)} decorrido</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Criado em:</span>
                        <p className="font-medium">{formatDate(job.createdAt)}</p>
                      </div>
                      {job.scheduledFor && (
                        <div>
                          <span className="text-muted-foreground">Agendado para:</span>
                          <p className="font-medium">{formatDate(job.scheduledFor)}</p>
                        </div>
                      )}
                      {job.startedAt && (
                        <div>
                          <span className="text-muted-foreground">Iniciou em:</span>
                          <p className="font-medium">{formatDate(job.startedAt)}</p>
                        </div>
                      )}
                      {job.completedAt && (
                        <div>
                          <span className="text-muted-foreground">Finalizou em:</span>
                          <p className="font-medium">{formatDate(job.completedAt)}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Duração:</span>
                        <p className="font-medium">{formatDuration(job.startedAt, job.completedAt)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Concorrência:</span>
                        <p className="font-medium">{job.concurrency} simultâneos</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Sucesso:</span>
                        <p className="font-medium text-green-600">{job.successCount}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Erros:</span>
                        <p className="font-medium text-red-600">{job.errorCount}</p>
                      </div>
                    </div>
                    {job.lastError && (
                      <div className="mt-2 p-2 bg-red-50 rounded text-sm text-red-700">
                        <strong>Último erro:</strong> {job.lastError}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
