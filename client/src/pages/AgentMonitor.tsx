import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot,
  Monitor,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Image as ImageIcon,
  MousePointer,
  Type,
  Navigation,
  Eye,
  AlertCircle,
  Info,
  RefreshCw,
  Package,
  ArrowRight,
} from "lucide-react";

const ACTION_ICONS: Record<string, React.ReactNode> = {
  navigate: <Navigation className="h-4 w-4 text-blue-500" />,
  click: <MousePointer className="h-4 w-4 text-amber-500" />,
  type: <Type className="h-4 w-4 text-purple-500" />,
  select: <ArrowRight className="h-4 w-4 text-cyan-500" />,
  screenshot: <ImageIcon className="h-4 w-4 text-green-500" />,
  wait: <Clock className="h-4 w-4 text-gray-500" />,
  success: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  info: <Info className="h-4 w-4 text-blue-400" />,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  waiting: { label: "Aguardando", color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: <Clock className="h-3.5 w-3.5" /> },
  processing: { label: "Processando", color: "bg-blue-100 text-blue-800 border-blue-300", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  completed: { label: "Concluído", color: "bg-green-100 text-green-800 border-green-300", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  failed: { label: "Falhou", color: "bg-red-100 text-red-800 border-red-300", icon: <XCircle className="h-3.5 w-3.5" /> },
  skipped: { label: "Pulado", color: "bg-gray-100 text-gray-800 border-gray-300", icon: <AlertCircle className="h-3.5 w-3.5" /> },
};

export default function AgentMonitor() {
  const [activeTab, setActiveTab] = useState("overview");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Queries with auto-refresh
  const queueStats = trpc.agent.queueStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? 3000 : false,
  });
  const queueItems = trpc.agent.queue.useQuery(undefined, {
    refetchInterval: autoRefresh ? 5000 : false,
  });
  const actions = trpc.agent.actions.useQuery({ limit: 50 }, {
    refetchInterval: autoRefresh ? 3000 : false,
  });
  const latestScreenshot = trpc.agent.latestScreenshot.useQuery(undefined, {
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const stats = queueStats.data;
  const items = queueItems.data || [];
  const actionsList = actions.data || [];
  const screenshot = latestScreenshot.data;

  const progressPercent = stats && stats.total > 0
    ? Math.round(((stats.completed + stats.failed) / stats.total) * 100)
    : 0;

  const isAgentActive = stats ? stats.processing > 0 : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-7 w-7 text-primary" />
            Monitor do Agente
          </h1>
          <p className="text-muted-foreground mt-1">
            Acompanhe em tempo real as ações do agente no painel do BaseLinker
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          </Button>
          {isAgentActive && (
            <Badge className="bg-green-500 text-white animate-pulse px-3 py-1">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Agente Ativo
            </Badge>
          )}
          {!isAgentActive && stats && stats.total > 0 && (
            <Badge variant="outline" className="px-3 py-1">
              Agente Inativo
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-sm text-muted-foreground">Total na Fila</div>
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-yellow-500" /> Aguardando
            </div>
            <div className="text-2xl font-bold text-yellow-600">{stats?.waiting || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 text-blue-500" /> Processando
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats?.processing || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> Concluído
            </div>
            <div className="text-2xl font-bold text-green-600">{stats?.completed || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-red-500" /> Falhou
            </div>
            <div className="text-2xl font-bold text-red-600">{stats?.failed || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      {stats && stats.total > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progresso Geral</span>
              <span className="text-sm text-muted-foreground">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
            <div className="text-xs text-muted-foreground mt-1">
              {stats.completed + stats.failed} de {stats.total} produtos processados
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="flex items-center gap-1">
            <Monitor className="h-4 w-4" /> Visão ao Vivo
          </TabsTrigger>
          <TabsTrigger value="queue" className="flex items-center gap-1">
            <Package className="h-4 w-4" /> Fila de Produtos
          </TabsTrigger>
          <TabsTrigger value="log" className="flex items-center gap-1">
            <Eye className="h-4 w-4" /> Log de Ações
          </TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB - Live Screenshot + Recent Actions */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Live Screenshot */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Monitor className="h-5 w-5" />
                  Tela do BaseLinker
                </CardTitle>
                <CardDescription>
                  Última captura de tela do painel do BaseLinker
                </CardDescription>
              </CardHeader>
              <CardContent>
                {screenshot?.screenshotUrl ? (
                  <div className="relative rounded-lg overflow-hidden border bg-muted">
                    <img
                      src={screenshot.screenshotUrl}
                      alt="Screenshot do BaseLinker"
                      className="w-full h-auto"
                    />
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                      {new Date(screenshot.createdAt).toLocaleTimeString("pt-BR")}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 bg-muted rounded-lg border border-dashed">
                    <Monitor className="h-12 w-12 text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground text-sm">
                      Nenhuma captura de tela disponível
                    </p>
                    <p className="text-muted-foreground/70 text-xs mt-1">
                      As capturas aparecem quando o agente está processando
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Actions Feed */}
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Ações Recentes
                </CardTitle>
                <CardDescription>
                  O que o agente está fazendo agora
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  {actionsList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64">
                      <Bot className="h-12 w-12 text-muted-foreground/50 mb-3" />
                      <p className="text-muted-foreground text-sm">
                        Nenhuma ação registrada ainda
                      </p>
                      <p className="text-muted-foreground/70 text-xs mt-1">
                        Envie produtos para a fila para iniciar
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {actionsList.map((action: any) => (
                        <div
                          key={action.id}
                          className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="mt-0.5">
                            {ACTION_ICONS[action.actionType] || ACTION_ICONS.info}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">{action.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(action.createdAt).toLocaleTimeString("pt-BR")}
                            </p>
                          </div>
                          {action.screenshotUrl && (
                            <img
                              src={action.screenshotUrl}
                              alt="Screenshot"
                              className="w-16 h-10 rounded border object-cover cursor-pointer hover:opacity-80"
                              onClick={() => window.open(action.screenshotUrl, "_blank")}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* QUEUE TAB - Product Queue */}
        <TabsContent value="queue" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Fila de Exportação</CardTitle>
              <CardDescription>
                Produtos aguardando para serem listados pelo agente no BaseLinker
              </CardDescription>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48">
                  <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground text-sm">
                    Nenhum produto na fila
                  </p>
                  <p className="text-muted-foreground/70 text-xs mt-1">
                    Exporte produtos na página Exportar para adicioná-los à fila
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {items.map((item: any) => {
                      const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.waiting;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                        >
                          {/* Product Image */}
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.productName || "Produto"}
                              className="w-12 h-12 rounded object-cover border"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center border">
                              <Package className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}

                          {/* Product Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.productName || item.productId}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {item.sku && <span>SKU: {item.sku}</span>}
                              {item.price && <span>R$ {item.price}</span>}
                              {item.mappedCategory && (
                                <span className="truncate max-w-[200px]">
                                  {item.mappedCategory}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Marketplace Info */}
                          <div className="text-right">
                            <Badge variant="outline" className="text-xs mb-1">
                              {item.marketplaceType} → {item.accountName || item.accountId}
                            </Badge>
                          </div>

                          {/* Status Badge */}
                          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${statusConfig.color}`}>
                            {statusConfig.icon}
                            {statusConfig.label}
                          </div>

                          {/* Screenshot thumbnail if available */}
                          {item.screenshotUrl && (
                            <img
                              src={item.screenshotUrl}
                              alt="Screenshot"
                              className="w-16 h-10 rounded border object-cover cursor-pointer hover:opacity-80"
                              onClick={() => window.open(item.screenshotUrl, "_blank")}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LOG TAB - Full Action Log */}
        <TabsContent value="log" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Log Completo de Ações</CardTitle>
              <CardDescription>
                Histórico detalhado de todas as ações do agente
              </CardDescription>
            </CardHeader>
            <CardContent>
              {actionsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48">
                  <Eye className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground text-sm">
                    Nenhuma ação registrada
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

                    <div className="space-y-3">
                      {actionsList.map((action: any) => (
                        <div key={action.id} className="flex items-start gap-3 relative pl-9">
                          {/* Timeline dot */}
                          <div className="absolute left-2.5 top-2 w-3 h-3 rounded-full border-2 border-background bg-primary" />

                          <div className="flex-1 p-3 rounded-lg border bg-card">
                            <div className="flex items-center gap-2 mb-1">
                              {ACTION_ICONS[action.actionType] || ACTION_ICONS.info}
                              <span className="text-xs font-medium uppercase text-muted-foreground">
                                {action.actionType}
                              </span>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {new Date(action.createdAt).toLocaleString("pt-BR")}
                              </span>
                            </div>
                            <p className="text-sm">{action.description}</p>

                            {/* Screenshot */}
                            {action.screenshotUrl && (
                              <div className="mt-2">
                                <img
                                  src={action.screenshotUrl}
                                  alt="Screenshot"
                                  className="w-full max-w-md rounded border cursor-pointer hover:opacity-90"
                                  onClick={() => window.open(action.screenshotUrl, "_blank")}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
