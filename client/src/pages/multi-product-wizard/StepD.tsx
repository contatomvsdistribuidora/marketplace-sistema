import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Star, Image as ImageIcon, Send, AlertTriangle, CheckCircle2, Loader2,
  Eye, AlertCircle, X, Unlink, Copy,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  itemKey, SourceBadge,
  type Listing, type ListingItem, type WizardStep,
} from "./types";
import { useResolvedProducts } from "./useResolvedProducts";
import { ContentDiagnosis } from "@/components/shopee/ContentDiagnosis";

export function StepD({
  listing,
  items,
  onEditStep,
  onChange,
}: {
  listing: Listing;
  items: ListingItem[];
  onEditStep: (s: WizardStep) => void;
  onChange: () => void;
}) {
  const { productMap } = useResolvedProducts(listing, items);
  const principalKey = itemKey(listing.mainProductSource, Number(listing.mainProductSourceId));

  const [, setLocation] = useLocation();
  const [publishedItemUrl, setPublishedItemUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"resumo" | "json">("resumo");

  const publishMutation = trpc.multiProduct.publishToShopee.useMutation({
    onSuccess: (data) => {
      onChange();
      setPublishedItemUrl(data.itemUrl);
      toast.success(`Anúncio publicado! Item ID: ${data.itemId}`);
    },
    onError: (e) => {
      onChange(); // Refetch para pegar listing.status='error' + lastError do servidor
      toast.error(e.message);
    },
  });

  const cloneMutation = trpc.multiProduct.cloneListing.useMutation({
    onSuccess: (data) => {
      toast.success(`Anúncio clonado! ID #${data.id}`);
      window.location.href = `/multi-product-wizard?id=${data.id}`;
    },
    onError: (e) => toast.error(e.message),
  });

  const previewQuery = trpc.multiProduct.previewPublishPayload.useQuery(
    { id: listing.id },
    { enabled: false, retry: false },
  );

  const autoFixMutation = trpc.multiProduct.autoFixPricesMultiProduct.useMutation();

  const [clearOrphanOpen, setClearOrphanOpen] = useState(false);
  const clearOrphanMutation = trpc.multiProduct.clearOrphanShopeeItemId.useMutation({
    onSuccess: () => {
      toast.success("Item Shopee desvinculado. Status resetado para rascunho.");
      setClearOrphanOpen(false);
      onChange();
    },
    onError: (e) => toast.error(e.message || "Falha ao desvincular item Shopee."),
  });

  const updateListingMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => {
      onChange();
      toast.success("Produto principal atualizado.");
    },
    onError: (e) => toast.error(e.message),
  });

  const refreshDiagnosisMutation = trpc.multiProduct.refreshDiagnosis.useMutation({
    onSuccess: () => {
      onChange();
      toast.success("Diagnóstico atualizado");
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (listing.shopeeItemId && !refreshDiagnosisMutation.isPending) {
      const lastRefresh = sessionStorage.getItem(`diag-refresh-${listing.id}`);
      const now = Date.now();
      if (!lastRefresh || now - Number(lastRefresh) > 30 * 1000) {
        sessionStorage.setItem(`diag-refresh-${listing.id}`, String(now));
        refreshDiagnosisMutation.mutate({ id: listing.id });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id, listing.shopeeItemId]);

  const isPrincipalShopee = listing.mainProductSource === "shopee";
  const wsCategoryId = (() => {
    try {
      const ws = listing.wizardStateJson ? JSON.parse(listing.wizardStateJson) : null;
      return ws?.categoryId ? Number(ws.categoryId) : null;
    } catch { return null; }
  })();

  const blockingPublishReason: string | null = (() => {
    if (!isPrincipalShopee && !wsCategoryId)
      return "Marque um produto Shopee como ⭐ principal no Step A OU escolha a categoria Shopee no Step C.";
    if (!listing.title || listing.title.trim().length < 10)
      return "Título precisa ter pelo menos 10 caracteres (Step B).";
    if (!listing.description || listing.description.trim().length < 30)
      return "Descrição precisa ter pelo menos 30 caracteres (Step B).";
    if (!listing.thumbUrl) return "Gere a thumb no Step C antes de publicar.";
    if (items.length < 2) return "Adicione pelo menos 2 produtos no Step A.";
    if (listing.status === "published") return "Anúncio já publicado.";
    return null;
  })();

  const checks = {
    products: items.length >= 2,
    title: !!listing.title && listing.title.trim().length >= 10,
    description: !!listing.description && listing.description.trim().length >= 30,
    thumb: !!listing.thumbUrl,
    video: !!listing.videoBankId || !!listing.videoUrl,
  };

  const Status = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CheckCircle2 className="h-4 w-4 text-green-600" />
    ) : (
      <AlertTriangle className="h-4 w-4 text-yellow-500" />
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Status ok={checks.products} />
              Produtos ({items.length})
            </CardTitle>
            <CardDescription>
              Mínimo 2 produtos para um anúncio combinado.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onEditStep("A")}>
            Editar
          </Button>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {(() => {
              const visibleItems = items.length <= 5
                ? items
                : [...items.slice(0, 5), ...items.slice(5).filter(i => i.source === "shopee")];
              const hiddenCount = items.length - visibleItems.length;
              return (
                <>
                  {visibleItems.map((it) => {
                    const k = itemKey(it.source, Number(it.sourceId));
                    const resolved = productMap.get(k);
                    const isPrincipal = k === principalKey;
                    const isShopee = it.source === "shopee";
                    if (isShopee) {
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            disabled={updateListingMutation.isPending || isPrincipal}
                            title="Clique pra tornar este o produto principal"
                            onClick={() =>
                              updateListingMutation.mutate({
                                id: listing.id,
                                mainProductSource: "shopee",
                                mainProductSourceId: Number(it.sourceId),
                              })
                            }
                            className="w-full flex items-center gap-2 rounded px-1.5 py-1 -mx-1.5 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent disabled:opacity-100"
                          >
                            {isPrincipal
                              ? <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500 shrink-0" />
                              : <Star className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            <SourceBadge source={it.source} />
                            <span className="line-clamp-1">{resolved?.name || `(produto ${it.sourceId})`}</span>
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={it.id} className="flex items-center gap-2">
                        {isPrincipal && <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />}
                        <SourceBadge source={it.source} />
                        <span className="line-clamp-1">{resolved?.name || `(produto ${it.sourceId})`}</span>
                      </li>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <li className="text-xs text-muted-foreground">+ {hiddenCount} outros</li>
                  )}
                </>
              );
            })()}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Status ok={checks.title && checks.description} />
              Conteúdo
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onEditStep("B")}>
            Editar
          </Button>
        </CardHeader>
        <CardContent>
          <div className="text-sm">
            <span className="text-muted-foreground">Título:</span>{" "}
            <span>{listing.title || "(vazio)"}</span>
          </div>
          <div className="text-sm mt-2">
            <span className="text-muted-foreground">Descrição:</span>{" "}
            <span className="line-clamp-3">{listing.description || "(vazia)"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Status ok={checks.thumb && checks.video} />
              Mídia
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onEditStep("C")}>
            Editar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 rounded border bg-muted flex items-center justify-center overflow-hidden shrink-0">
              {listing.thumbUrl ? (
                <img src={listing.thumbUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="text-sm">
              <div>Thumb: {listing.thumbUrl ? "definida" : "(faltando)"}</div>
              <div>
                Vídeo:{" "}
                {(listing.videoBankId || listing.videoUrl) ? (
                  <span className="text-green-600 font-medium">definido ✓</span>
                ) : (
                  "(opcional, faltando)"
                )}
              </div>
            </div>
          </div>
          {listing.videoUrl && (
            <div className="border rounded p-2 bg-green-50 border-green-200">
              <div className="text-xs text-green-900 mb-1.5 flex items-center gap-1.5 font-semibold">
                <span>🎬</span>
                <span>Vídeo será enviado pra Shopee:</span>
              </div>
              <video
                src={listing.videoUrl}
                controls
                muted
                preload="metadata"
                className="w-full max-w-sm rounded border"
                style={{ maxHeight: "200px" }}
              />
            </div>
          )}
          {listing.videoBankId && !listing.videoUrl && (
            <div className="border rounded p-2 bg-blue-50 border-blue-200">
              <div className="text-xs text-blue-900 flex items-center gap-1.5">
                <span>🎬</span>
                <span>Vídeo da galeria selecionado (ID: {listing.videoBankId}). Será enviado pra Shopee.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-5 w-5" />
            Publicar na Shopee
          </CardTitle>
          <CardDescription>
            {listing.status === "published"
              ? "Este anúncio já foi publicado."
              : `Cria o anúncio combinado com ${items.length} variações na sua loja Shopee.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            <Badge
              variant={
                listing.status === "published"
                  ? "default"
                  : listing.status === "publishing"
                  ? "secondary"
                  : listing.status === "error"
                  ? "destructive"
                  : "outline"
              }
            >
              {listing.status}
            </Badge>
          </div>

          {listing.shopeeItemId && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Item ID Shopee:</span>
              <code className="text-xs bg-muted px-2 py-0.5 rounded">
                {String(listing.shopeeItemId)}
              </code>
            </div>
          )}

          {listing.status === "error" && listing.lastError && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <strong>Último erro:</strong> {listing.lastError}
            </div>
          )}

          {blockingPublishReason && listing.status !== "published" && (
            <div className="rounded border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              <strong>Não pode publicar ainda:</strong> {blockingPublishReason}
            </div>
          )}

          {listing.status !== "published" && (
            <Button
              size="lg"
              variant="outline"
              className="w-full mb-2"
              onClick={() => {
                setPreviewOpen(true);
                previewQuery.refetch();
              }}
              disabled={previewQuery.isFetching}
            >
              {previewQuery.isFetching ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando preview...</>
              ) : (
                <><Eye className="h-4 w-4 mr-2" /> Pre-visualizar publicacao</>
              )}
            </Button>
          )}
          {listing.status !== "published" && (
            <MultiStorePublishPanel
              listing={listing}
              blockingPublishReason={blockingPublishReason}
              onChange={onChange}
            />
          )}

          {(publishedItemUrl || listing.status === "published") && listing.shopeeItemId && (
            <a
              href={publishedItemUrl || `https://shopee.com.br/product/0/${listing.shopeeItemId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm underline text-blue-600 hover:text-blue-800"
            >
              Ver anúncio na Shopee →
            </a>
          )}

          {listing.status === "published" && (
            <ContentDiagnosis
              qualityLevel={listing.qualityLevel}
              unfinishedTasks={listing.unfinishedTasks}
              onRefresh={() => refreshDiagnosisMutation.mutate({ id: listing.id })}
              refreshing={refreshDiagnosisMutation.isPending}
            />
          )}

          {listing.status === "published" && (
            <div className="border-t pt-4 mt-4">
              <p className="text-sm text-muted-foreground mb-2">
                💡 Quer criar OUTRO anúncio do mesmo produto com fotos/thumb diferentes?
              </p>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                disabled={cloneMutation.isPending}
                onClick={() => {
                  if (confirm("Clonar este anúncio? Vai criar uma cópia em rascunho que você pode editar antes de publicar de novo.")) {
                    cloneMutation.mutate({ id: listing.id });
                  }
                }}
              >
                {cloneMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Clonando...</>
                ) : (
                  <><Copy className="h-4 w-4 mr-2" /> Clonar anúncio (criar versão nova)</>
                )}
              </Button>
            </div>
          )}

          {listing.status === "published" && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setLocation("/multi-product")}
            >
              Voltar para seleção
            </Button>
          )}

          {/* Tools avancadas — desvincula item Shopee orfao (referencia stale
              de uma listing publicada antes da regeneracao). Aparece somente
              quando ha shopeeItemId pra limpar. */}
          {listing.shopeeItemId && (
            <div className="border-t pt-3 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:text-destructive"
                onClick={() => setClearOrphanOpen(true)}
                disabled={clearOrphanMutation.isPending}
              >
                <Unlink className="h-4 w-4 mr-2" />
                Limpar item órfão
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={clearOrphanOpen} onOpenChange={setClearOrphanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular item Shopee?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove o vínculo com o Item ID <code className="bg-muted px-1 rounded">{String(listing.shopeeItemId)}</code> e reseta o status para rascunho.
              Use quando o item da Shopee não existe mais (foi deletado/regenerado) e você quer publicar do zero.
              <br /><br />
              <strong>Não apaga</strong> o anúncio na Shopee — só a referência local.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearOrphanMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearOrphanMutation.mutate({ id: listing.id });
              }}
              disabled={clearOrphanMutation.isPending}
            >
              {clearOrphanMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Desvinculando...</>
              ) : "Desvincular"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Preview do Payload Shopee */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="!max-w-[95vw] w-[95vw] !h-[90vh] flex flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Preview do que sera enviado pra Shopee
            </DialogTitle>
          </DialogHeader>

          {previewQuery.isFetching && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Montando payload...</span>
            </div>
          )}

          {previewQuery.error && (
            <div className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">
              <strong>Erro ao gerar preview:</strong> {previewQuery.error.message}
            </div>
          )}

          {previewQuery.data && !previewQuery.isFetching && (
            <>
              {/* Tabs */}
              <div className="flex gap-2 border-b">
                <button
                  type="button"
                  onClick={() => setPreviewTab("resumo")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                    previewTab === "resumo"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Resumo Visivel
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("json")}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                    previewTab === "json"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  JSON Tecnico
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mt-4">
                {previewTab === "resumo" && (
                  <div className="space-y-4">
                    {previewQuery.data.issues.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold text-sm">Validacao</h3>
                        {previewQuery.data.issues.some((i: any) => i.field === "price" && i.severity === "error") && (
                          <div className="rounded p-3 bg-blue-50 border border-blue-200 flex items-center gap-3 flex-wrap mb-2">
                            <span className="text-blue-900 text-xs flex-1 min-w-[180px]">
                              🔧 <b>Tem erros de preço?</b> Posso corrigir automaticamente: ajusta preços baixos pra respeitar o limite Shopee de 4x.
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const result = await autoFixMutation.mutateAsync({ id: listing.id });
                                  toast.success(result.message || "Preços corrigidos");
                                  await previewQuery.refetch();
                                } catch (e: any) {
                                  toast.error(e?.message ?? "Falha ao corrigir");
                                }
                              }}
                              disabled={autoFixMutation.isPending}
                              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 shrink-0"
                            >
                              {autoFixMutation.isPending ? "Corrigindo..." : "🔧 Auto-corrigir agora"}
                            </button>
                          </div>
                        )}
                        {previewQuery.data.issues.map((issue: any, i: number) => (
                          <div
                            key={i}
                            className={`flex items-start gap-2 rounded p-3 text-sm ${
                              issue.severity === "error"
                                ? "bg-red-50 border border-red-200 text-red-800"
                                : "bg-yellow-50 border border-yellow-200 text-yellow-800"
                            }`}
                          >
                            {issue.severity === "error" ? (
                              <X className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            )}
                            <div>
                              <strong className="capitalize">{issue.field}:</strong> {issue.message}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${
                      previewQuery.data.canPublish
                        ? "bg-green-50 border border-green-200 text-green-800"
                        : "bg-red-50 border border-red-200 text-red-800"
                    }`}>
                      {previewQuery.data.canPublish ? (
                        <><CheckCircle2 className="h-5 w-5" /> Pronto para publicar (sem erros bloqueantes)</>
                      ) : (
                        <><AlertTriangle className="h-5 w-5" /> Existem erros que impedem a publicacao</>
                      )}
                    </div>

                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-2">Item Principal</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground">Modo:</span> <strong>{previewQuery.data.mode}</strong></div>
                        <div><span className="text-muted-foreground">Conta Shopee:</span> {previewQuery.data.accountId}</div>
                        <div className="col-span-2"><span className="text-muted-foreground">Titulo:</span> {previewQuery.data.payloadPreview.addItem.item_name}</div>
                        <div><span className="text-muted-foreground">Categoria:</span> {previewQuery.data.payloadPreview.addItem.category_id ?? "—"}</div>
                        <div><span className="text-muted-foreground">Marca:</span> {previewQuery.data.payloadPreview.addItem.brand.original_brand_name}</div>
                        <div><span className="text-muted-foreground">Atributos:</span> {previewQuery.data.wizardState.attributeCount}</div>
                        <div><span className="text-muted-foreground">Imagens:</span> {previewQuery.data.media.productImagesCount} produto(s)</div>
                      </div>
                    </div>

                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-2">Variacoes ({previewQuery.data.wizardState.totalCells} combinacoes)</h3>
                      <div className="text-sm space-y-1">
                        <div>
                          <strong>Variacao 1:</strong> {previewQuery.data.wizardState.variation1.name} ({previewQuery.data.wizardState.variation1.options} opcoes)
                        </div>
                        {previewQuery.data.wizardState.variation2 && (
                          <div>
                            <strong>Variacao 2:</strong> {previewQuery.data.wizardState.variation2.name} ({previewQuery.data.wizardState.variation2.options} opcoes)
                          </div>
                        )}
                      </div>
                      {previewQuery.data.payloadPreview.initTierVariation && (
                        <div className="mt-3">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">Modelos (combinacoes)</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/30">
                                <tr>
                                  <th className="text-left p-2">Tier Index</th>
                                  <th className="text-right p-2">Preco</th>
                                  <th className="text-right p-2">Estoque</th>
                                  <th className="text-left p-2">SKU</th>
                                </tr>
                              </thead>
                              <tbody>
                                {previewQuery.data.payloadPreview.initTierVariation.model.map((m: any, i: number) => (
                                  <tr key={i} className="border-b border-muted/30">
                                    <td className="p-2">[{m.tier_index.join(", ")}]</td>
                                    <td className="p-2 text-right">R$ {m.original_price.toFixed(2)}</td>
                                    <td className="p-2 text-right">{m.seller_stock[0].stock}</td>
                                    <td className="p-2 font-mono text-[11px]">{m.model_sku}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-2">Produtos da Combinacao</h3>
                      <div className="space-y-1 text-sm">
                        {previewQuery.data.resolved.map((r: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                            <span className="flex-1">{r.name}</span>
                            <span className="text-muted-foreground">R$ {r.price.toFixed(2)}</span>
                            <span className="text-muted-foreground">Est: {r.stock}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-2">Midia</h3>
                      <div className="text-sm space-y-1">
                        <div><span className="text-muted-foreground">Thumb:</span> {previewQuery.data.media.thumbUrl ? "OK" : "Faltando"}</div>
                        <div><span className="text-muted-foreground">Video:</span> {previewQuery.data.media.videoUrl || previewQuery.data.media.videoBankId ? "OK" : "Sem video"}</div>
                      </div>
                    </div>
                  </div>
                )}

                {previewTab === "json" && (
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm mb-2">add_item payload</h3>
                      <pre className="bg-zinc-900 text-zinc-100 p-4 rounded text-xs overflow-auto max-h-96">
                        {JSON.stringify(previewQuery.data.payloadPreview.addItem, null, 2)}
                      </pre>
                    </div>
                    {previewQuery.data.payloadPreview.initTierVariation && (
                      <div>
                        <h3 className="font-semibold text-sm mb-2">init_tier_variation payload</h3>
                        <pre className="bg-zinc-900 text-zinc-100 p-4 rounded text-xs overflow-auto max-h-96">
                          {JSON.stringify(previewQuery.data.payloadPreview.initTierVariation, null, 2)}
                        </pre>
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-sm mb-2">Estado completo (debug)</h3>
                      <pre className="bg-zinc-900 text-zinc-100 p-4 rounded text-xs overflow-auto max-h-64">
                        {JSON.stringify(previewQuery.data, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Painel de publicação multi-loja (Fase 6.0).
 *
 * Tabela com 1 row por publication marcada no Step 1. Checkbox por conta
 * controla quais publicar agora. Default seguro: só conta de teste pré-
 * selecionada (Bidushop, id=2). Status ao vivo via polling de listPublications.
 *
 * Sucesso/falha é por conta — uma falha não derruba as outras.
 */
function MultiStorePublishPanel({
  listing,
  blockingPublishReason,
  onChange,
}: {
  listing: Listing;
  blockingPublishReason: string | null;
  onChange: () => void;
}) {
  const accountsQuery = trpc.shopee.listActiveAccounts.useQuery();
  const publicationsQuery = trpc.multiProduct.listPublications.useQuery(
    { listingId: listing.id },
    {
      // Polling enquanto alguma publication está 'publishing' (Fase 6.0).
      refetchInterval: (data: any) => {
        const rows = Array.isArray(data?.state?.data) ? data.state.data : data;
        if (!Array.isArray(rows)) return false;
        return rows.some((p: any) => p.publishStatus === "publishing") ? 3000 : false;
      },
    },
  );

  const publishMultiMut = trpc.multiProduct.publishToShopeeMultiStore.useMutation({
    onSuccess: (data: any) => {
      onChange();
      const ok = data.totalPublished ?? 0;
      const fail = data.totalFailed ?? 0;
      if (fail === 0) {
        toast.success(`Publicado em ${ok} conta(s)!`);
      } else if (ok === 0) {
        toast.error(`Todas as ${fail} contas falharam. Veja o detalhe na tabela.`);
      } else {
        toast.warning(`${ok} OK, ${fail} falharam. Veja detalhes na tabela.`);
      }
    },
    onError: (e) => {
      onChange();
      toast.error(e.message);
    },
  });

  const accounts = accountsQuery.data ?? [];
  const publications = publicationsQuery.data ?? [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Default seguro: só conta 2 (Bidushop) marcada pra teste inicial.
  // Operador desmarca/marca conforme quiser publicar.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<number>>(new Set([2]));

  // Quando publications carrega pela primeira vez, garante que só accounts
  // que existem nas publications são pré-marcadas.
  useEffect(() => {
    if (publications.length === 0) return;
    setSelectedAccountIds((prev) => {
      const valid = new Set<number>();
      publications.forEach((p) => {
        if (prev.has(p.shopeeAccountId)) valid.add(p.shopeeAccountId);
      });
      // Se nada bate, defaulta pra conta 2 se existir
      if (valid.size === 0) {
        const hasBidu = publications.some((p) => p.shopeeAccountId === 2);
        if (hasBidu) valid.add(2);
        else if (publications.length > 0) valid.add(publications[0].shopeeAccountId);
      }
      return valid;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publications.length]);

  const isLoading = publicationsQuery.isLoading || accountsQuery.isLoading;
  const isPending = publishMultiMut.isPending;

  function toggleAccount(accountId: number, checked: boolean) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  }

  function doPublish() {
    if (selectedAccountIds.size === 0) {
      toast.error("Marque pelo menos 1 conta.");
      return;
    }
    publishMultiMut.mutate({
      listingId: listing.id,
      onlyAccountIds: Array.from(selectedAccountIds),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Carregando contas…
      </div>
    );
  }

  if (publications.length === 0) {
    return (
      <div className="border rounded-lg p-3 bg-yellow-50 text-xs text-yellow-800">
        Nenhuma conta selecionada. Volte ao Step 1 e marque as contas onde quer publicar.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase">
        Publicação multi-loja
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs">
            <tr>
              <th className="px-2 py-1.5 text-left w-10"></th>
              <th className="px-2 py-1.5 text-left">Conta</th>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {publications.map((pub) => {
              const acc = accountById.get(pub.shopeeAccountId);
              const isPrincipal = pub.shopeeAccountId === listing.shopeeAccountId;
              const checked = selectedAccountIds.has(pub.shopeeAccountId);
              return (
                <tr key={pub.id} className="border-t">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPending}
                      onChange={(e) => toggleAccount(pub.shopeeAccountId, e.target.checked)}
                      className="h-4 w-4 accent-orange-500"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {acc?.shopName ?? `Conta #${acc?.shopId ?? pub.shopeeAccountId}`}
                      </span>
                      {isPrincipal && (
                        <Badge variant="outline" className="text-[9px] gap-1 border-yellow-300 bg-yellow-50 text-yellow-700">
                          <Star className="h-3 w-3 fill-yellow-400" />
                          principal
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">#{acc?.shopId ?? pub.shopeeAccountId}</div>
                  </td>
                  <td className="px-2 py-2">
                    {pub.publishStatus === "pending" && (
                      <Badge variant="outline" className="text-[10px]">pending</Badge>
                    )}
                    {pub.publishStatus === "publishing" && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-blue-300 bg-blue-50 text-blue-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        publicando…
                      </Badge>
                    )}
                    {pub.publishStatus === "published" && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-green-300 bg-green-50 text-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        publicado
                      </Badge>
                    )}
                    {pub.publishStatus === "failed" && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-red-300 bg-red-50 text-red-700">
                        <AlertCircle className="h-3 w-3" />
                        falhou
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {pub.shopeeItemId && (
                      <a
                        href={`https://shopee.com.br/product/${acc?.shopId}/${pub.shopeeItemId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        #{pub.shopeeItemId}
                      </a>
                    )}
                    {pub.publishError && (
                      <div className="text-[10px] text-red-700 italic line-clamp-2" title={pub.publishError}>
                        {pub.publishError}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!!blockingPublishReason || isPending || selectedAccountIds.size === 0}
        onClick={doPublish}
      >
        {isPending ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publicando…</>
        ) : (
          <><Send className="h-4 w-4 mr-2" /> Publicar em {selectedAccountIds.size} conta(s) marcada(s)</>
        )}
      </Button>
      {selectedAccountIds.size > 0 && (
        <p className="text-[10px] text-muted-foreground italic text-center">
          Cada conta publica em série. Falha em uma não interrompe as outras.
        </p>
      )}
    </div>
  );
}
