import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Upload, CheckCircle, XCircle, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: dashData, isLoading } = trpc.dashboard.stats.useQuery(undefined, {
    enabled: !!tokenData?.hasToken,
  });

  if (!tokenData?.hasToken) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Visão geral das suas exportações</p>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Package className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Configure seu Token do BaseLinker</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Para começar, configure seu token da API do BaseLinker nas configurações. 
                Isso permitirá acessar seus produtos e exportá-los para os marketplaces.
              </p>
            </div>
            <Button onClick={() => setLocation("/settings")} className="mt-2">
              Ir para Configurações
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = dashData?.stats;
  const recentJobs = dashData?.recentJobs || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Visão geral das suas exportações</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Jobs</CardTitle>
            <Upload className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalJobs ?? 0}</div>
            <p className="text-xs text-muted-foreground">exportações realizadas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos Exportados</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalExported ?? 0}</div>
            <p className="text-xs text-muted-foreground">produtos processados</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sucesso</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.totalSuccess ?? 0}</div>
            <p className="text-xs text-muted-foreground">exportações com sucesso</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Erros</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats?.totalErrors ?? 0}</div>
            <p className="text-xs text-muted-foreground">exportações com erro</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exportações Recentes</CardTitle>
          </CardHeader>
          <CardContent>
            {recentJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Nenhuma exportação realizada ainda.
                <br />
                <Button variant="link" onClick={() => setLocation("/export")} className="mt-2">
                  Iniciar primeira exportação
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentJobs.map((job: any) => (
                  <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Job #{job.id}</span>
                        <span className="text-xs text-muted-foreground">
                          {job.tagFilter ? `Tag: ${job.tagFilter}` : "Sem filtro de tag"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {job.successCount}/{job.totalProducts}
                      </span>
                      <StatusBadge status={job.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ações Rápidas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start" onClick={() => setLocation("/products")}>
              <Package className="mr-2 h-4 w-4" />
              Ver Produtos do BaseLinker
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => setLocation("/export")}>
              <Upload className="mr-2 h-4 w-4" />
              Nova Exportação
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => setLocation("/logs")}>
              <Clock className="mr-2 h-4 w-4" />
              Ver Histórico de Logs
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "Pendente", variant: "secondary" },
    processing: { label: "Processando", variant: "default" },
    completed: { label: "Concluído", variant: "outline" },
    failed: { label: "Falhou", variant: "destructive" },
    cancelled: { label: "Cancelado", variant: "secondary" },
  };
  const config = variants[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
