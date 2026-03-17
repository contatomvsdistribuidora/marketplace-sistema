import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, Search, FolderTree, ChevronRight, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function MlCategories() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; name: string }>>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const categoryCount = trpc.ml.categoryCount.useQuery();
  
  // Poll sync status while syncing
  const syncStatusQuery = trpc.ml.syncStatus.useQuery(undefined, {
    enabled: isSyncing,
    refetchInterval: isSyncing ? 2000 : false,
  });

  // Watch sync status changes
  useEffect(() => {
    if (!syncStatusQuery.data) return;
    const status = syncStatusQuery.data;
    
    if (status.phase === "done" && isSyncing) {
      setIsSyncing(false);
      categoryCount.refetch();
      rootCategories.refetch();
      toast.success(`${status.total.toLocaleString("pt-BR")} categorias sincronizadas!`);
    } else if (status.phase === "error" && isSyncing) {
      setIsSyncing(false);
      toast.error(`Erro na sincronização: ${status.error}`);
    }
  }, [syncStatusQuery.data]);

  const searchResults = trpc.ml.searchCategories.useQuery(
    { query: debouncedQuery, leafOnly: false, limit: 30 },
    { enabled: debouncedQuery.length >= 2 }
  );

  const rootCategories = trpc.ml.rootCategories.useQuery(undefined, {
    enabled: !selectedParent && !debouncedQuery,
  });

  const childCategories = trpc.ml.categoryChildren.useQuery(
    { parentId: selectedParent! },
    { enabled: !!selectedParent && !debouncedQuery }
  );

  const syncMutation = trpc.ml.syncCategories.useMutation({
    onSuccess: (data) => {
      if (data.message) {
        toast.info(data.message);
        categoryCount.refetch();
      } else if (data.started) {
        setIsSyncing(true);
        toast.info("Sincronização iniciada em segundo plano...");
      }
    },
    onError: (error) => {
      toast.error(`Erro ao sincronizar: ${error.message}`);
    },
  });

  const forceSyncMutation = trpc.ml.forceSyncCategories.useMutation({
    onSuccess: (data) => {
      if (data.started) {
        setIsSyncing(true);
        toast.info("Re-sincronização iniciada em segundo plano...");
      } else if (data.message) {
        toast.info(data.message);
      }
    },
    onError: (error) => {
      toast.error(`Erro ao sincronizar: ${error.message}`);
    },
  });

  const navigateToCategory = (categoryId: string, categoryName: string) => {
    setSelectedParent(categoryId);
    setBreadcrumb((prev) => [...prev, { id: categoryId, name: categoryName }]);
    setSearchQuery("");
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index < 0) {
      setSelectedParent(null);
      setBreadcrumb([]);
    } else {
      const item = breadcrumb[index];
      setSelectedParent(item.id);
      setBreadcrumb((prev) => prev.slice(0, index + 1));
    }
  };

  const count = categoryCount.data?.count || 0;
  const syncStatus = syncStatusQuery.data;
  const isButtonDisabled = isSyncing || syncMutation.isPending || forceSyncMutation.isPending;

  const displayCategories = debouncedQuery.length >= 2
    ? searchResults.data || []
    : selectedParent
    ? childCategories.data || []
    : rootCategories.data || [];

  // Calculate progress percentage
  const getProgressPercent = () => {
    if (!syncStatus || !isSyncing) return 0;
    if (syncStatus.phase === "downloading") {
      // Estimate ~15000 total categories
      return Math.min(90, Math.round((syncStatus.downloaded / 15000) * 90));
    }
    if (syncStatus.phase === "saving") {
      if (syncStatus.total === 0) return 90;
      return 90 + Math.round((syncStatus.saved / syncStatus.total) * 10);
    }
    if (syncStatus.phase === "done") return 100;
    return 0;
  };

  const getPhaseLabel = () => {
    if (!syncStatus || !isSyncing) return "";
    if (syncStatus.phase === "downloading") {
      return `Baixando categorias... ${syncStatus.downloaded.toLocaleString("pt-BR")} baixadas`;
    }
    if (syncStatus.phase === "saving") {
      return `Salvando no banco... ${syncStatus.saved.toLocaleString("pt-BR")}/${syncStatus.total.toLocaleString("pt-BR")}`;
    }
    if (syncStatus.phase === "done") return "Concluído!";
    if (syncStatus.phase === "error") return `Erro: ${syncStatus.error}`;
    return "";
  };

  return (
    <div className="container py-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Categorias do Mercado Livre</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie e navegue pelas categorias do ML armazenadas localmente
          </p>
        </div>
      </div>

      {/* Status Card */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Categorias no banco:</span>
                <Badge variant={count > 0 ? "default" : "secondary"} className="text-sm">
                  {categoryCount.isLoading ? "..." : count.toLocaleString("pt-BR")}
                </Badge>
              </div>
              {count > 0 && !isSyncing && (
                <div className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm">Sincronizado</span>
                </div>
              )}
              {count === 0 && !categoryCount.isLoading && !isSyncing && (
                <div className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">Não sincronizado</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {count === 0 && !isSyncing ? (
                <Button
                  onClick={() => syncMutation.mutate()}
                  disabled={isButtonDisabled}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Sincronizar Categorias
                </Button>
              ) : !isSyncing ? (
                <Button
                  variant="outline"
                  onClick={() => forceSyncMutation.mutate()}
                  disabled={isButtonDisabled}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Re-sincronizar
                </Button>
              ) : null}
            </div>
          </div>

          {/* Progress bar during sync */}
          {isSyncing && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-primary">
                  {getPhaseLabel()}
                </span>
              </div>
              <Progress value={getProgressPercent()} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Baixando todas as categorias do Mercado Livre em segundo plano. 
                A árvore completa tem aproximadamente 15.000 categorias. Você pode navegar em outras páginas enquanto espera.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {count > 0 && !isSyncing && (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar categorias por nome... (ex: triciclo, celular, camiseta)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Breadcrumb */}
          {!debouncedQuery && breadcrumb.length > 0 && (
            <div className="flex items-center gap-1 mb-4 text-sm flex-wrap">
              <button
                onClick={() => navigateToBreadcrumb(-1)}
                className="text-primary hover:underline font-medium"
              >
                Raiz
              </button>
              {breadcrumb.map((item, index) => (
                <span key={item.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button
                    onClick={() => navigateToBreadcrumb(index)}
                    className={`hover:underline ${
                      index === breadcrumb.length - 1
                        ? "text-foreground font-medium"
                        : "text-primary"
                    }`}
                  >
                    {item.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Category List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {debouncedQuery
                  ? `Resultados para "${debouncedQuery}"`
                  : selectedParent
                  ? breadcrumb[breadcrumb.length - 1]?.name || "Subcategorias"
                  : "Categorias Raiz"}
              </CardTitle>
              <CardDescription>
                {displayCategories.length} categoria(s) encontrada(s)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(searchResults.isLoading || rootCategories.isLoading || childCategories.isLoading) ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayCategories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {debouncedQuery
                    ? "Nenhuma categoria encontrada para esta busca"
                    : "Nenhuma categoria disponível"}
                </div>
              ) : (
                <div className="divide-y">
                  {displayCategories.map((cat: any) => (
                    <div
                      key={cat.mlCategoryId}
                      className="flex items-center justify-between py-3 px-2 hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
                      onClick={() => {
                        if (cat.hasChildren || (!cat.isLeaf && cat.isLeaf !== 1)) {
                          navigateToCategory(cat.mlCategoryId, cat.name);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FolderTree className={`h-4 w-4 flex-shrink-0 ${
                          cat.isLeaf === 1 ? "text-green-500" : "text-amber-500"
                        }`} />
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {cat.name}
                          </div>
                          {cat.pathFromRoot && debouncedQuery && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5">
                              {cat.pathFromRoot}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {cat.mlCategoryId}
                        </span>
                        {cat.totalItems != null && (
                          <Badge variant="outline" className="text-xs">
                            {(cat.totalItems || 0).toLocaleString("pt-BR")} itens
                          </Badge>
                        )}
                        {cat.isLeaf === 1 ? (
                          <Badge variant="default" className="text-xs bg-green-600">
                            Folha
                          </Badge>
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
