import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Star, Image as ImageIcon, Send, AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  itemKey, SourceBadge,
  type Listing, type ListingItem, type WizardStep,
} from "./types";
import { useResolvedProducts } from "./useResolvedProducts";

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

  const isPrincipalShopee = listing.mainProductSource === "shopee";

  const blockingPublishReason: string | null = (() => {
    if (!isPrincipalShopee) return "Marque um produto Shopee como ⭐ principal no Step A.";
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
    video: !!listing.videoBankId,
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
            {items.slice(0, 5).map((it) => {
              const k = itemKey(it.source, Number(it.sourceId));
              const resolved = productMap.get(k);
              const isPrincipal = k === principalKey;
              return (
                <li key={it.id} className="flex items-center gap-2">
                  {isPrincipal && <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />}
                  <SourceBadge source={it.source} />
                  <span className="line-clamp-1">{resolved?.name || `(produto ${it.sourceId})`}</span>
                </li>
              );
            })}
            {items.length > 5 && (
              <li className="text-xs text-muted-foreground">+ {items.length - 5} outros</li>
            )}
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
        <CardContent className="flex items-center gap-4">
          <div className="h-20 w-20 rounded border bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {listing.thumbUrl ? (
              <img src={listing.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="text-sm">
            <div>Thumb: {listing.thumbUrl ? "definida" : "(faltando)"}</div>
            <div>Vídeo: {listing.videoBankId ? "definido" : "(opcional, faltando)"}</div>
          </div>
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
              className="w-full"
              disabled={!!blockingPublishReason || publishMutation.isPending}
              onClick={() => publishMutation.mutate({ id: listing.id })}
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Publicando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {listing.status === "error" ? "Tentar novamente" : "Publicar na Shopee"}
                </>
              )}
            </Button>
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
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setLocation("/multi-product")}
            >
              Voltar para seleção
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
