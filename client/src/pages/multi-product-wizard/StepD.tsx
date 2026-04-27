import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Star, Image as ImageIcon, Send, AlertTriangle, CheckCircle2,
} from "lucide-react";
import {
  itemKey, SourceBadge,
  type Listing, type ListingItem, type WizardStep,
} from "./types";
import { useResolvedProducts } from "./useResolvedProducts";

export function StepD({
  listing,
  items,
  onEditStep,
}: {
  listing: Listing;
  items: ListingItem[];
  onEditStep: (s: WizardStep) => void;
}) {
  const { productMap } = useResolvedProducts(listing, items);
  const principalKey = itemKey(listing.mainProductSource, Number(listing.mainProductSourceId));

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
          <CardTitle className="text-base">Publicar na Shopee</CardTitle>
          <CardDescription>
            Após confirmar, o anúncio será criado/atualizado na Shopee com {items.length} variações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="lg" disabled className="w-full">
                    <Send className="h-4 w-4 mr-2" />
                    Publicar na Shopee
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Disponível na Fase H</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}
